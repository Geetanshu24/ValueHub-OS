import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DOCUMENT_TYPE_LABELS, type DocumentType, type PropertyClass } from '@value-hub/valuation-shared';
import { readFileSync } from 'node:fs';
import { AuditService } from '../../common/audit/audit.service.js';
import { StorageService } from '../../common/storage/storage.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BANK_FORMATS, chooseFormat, type BankFormat } from './bank-formats.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { countObservations, factLabel } from '@value-hub/valuation-shared';
import { gatherFacts } from './fact-sources.js';
import { compareFacts } from './site-compare.js';
import { FIELD_OPTIONS } from './field-options.js';
import { renderBoiPdf } from './boi-pdf.js';
import { docxToDocument, fillDocx, resolveValues } from './docx-template.js';

const MAX_VALUE_LENGTH = 6000;
const MAX_PHOTOS = 12;
const EMBEDDABLE = ['image/jpeg', 'image/png'];

type Actor = { userId: string };

@Injectable()
export class BankReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // The format to fill, the values already known and which of them were suggested
  // from records. What the valuer saved always wins over a suggestion.
  async form(firmId: string, assignmentId: string, requested?: string) {
    const { values, suggested, saved, format, prefill, conflicts } = await this.merged(firmId, assignmentId, requested);
    const locked = !!(await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { reportSubmittedAt: true } }))?.reportSubmittedAt;
    // Answers saved earlier that the records (the workbench, the case) now say differently.
    const updates = Object.fromEntries(Object.entries(prefill).filter(([key, value]) => saved && key in values && values[key].trim() !== '' && values[key] !== value && !suggested.includes(key)));
    return { format: format.id, title: format.title, formats: BANK_FORMATS.map((f) => ({ id: f.id, label: f.label })), fields: format.fields.filter((f) => !f.hidden).map((f) => (FIELD_OPTIONS[f.key] ? { ...f, options: FIELD_OPTIONS[f.key] } : f)), values, suggested, saved, locked, updates, conflicts: conflicts.map((key) => ({ key, label: factLabel(key) })) };
  }

  // As per documents against as per site, for the drafter to cross-check before finishing the report.
  async compare(firmId: string, assignmentId: string) {
    const merged = await this.merged(firmId, assignmentId);
    const visit = await this.prisma.inspection.findFirst({
      where: { assignmentId, firmId },
      orderBy: { visitedAt: 'desc' },
      select: { status: true, visitedAt: true, observations: true, inspector: { select: { fullName: true } }, measurements: { select: { label: true, fieldKey: true, areaSqm: true } } },
    });
    const observations = Object.fromEntries(Object.entries((visit?.observations ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]));
    const rows = compareFacts(merged.facts, merged.documentFacts, { observations, measurements: (visit?.measurements ?? []).map((m) => ({ label: m.label, fieldKey: m.fieldKey, areaSqm: Number(m.areaSqm) })) }, merged.conflicts);
    // What a person decided about each difference, and whether the values have changed since they decided.
    const decisions = await this.prisma.comparisonDecision.findMany({ where: { assignmentId, firmId } });
    const people = await this.prisma.user.findMany({ where: { id: { in: [...new Set(decisions.map((d) => d.decidedById))] } }, select: { id: true, fullName: true } });
    const names = new Map(people.map((p) => [p.id, p.fullName]));
    const withDecisions = rows.map((row) => {
      const d = decisions.find((x) => x.factKey === row.key);
      if (!d) return row;
      return { ...row, decision: { outcome: d.outcome, reason: d.reason, by: names.get(d.decidedById) ?? null, at: d.decidedAt, stale: d.documentValue !== row.document || d.siteValue !== row.site } };
    });
    const needsDecision = (r: (typeof withDecisions)[number]) => r.status === 'differs' && !(r.decision && !r.decision.stale);
    return {
      visit: visit ? { status: visit.status, visitedAt: visit.visitedAt, inspector: visit.inspector.fullName } : null,
      rows: withDecisions,
      summary: {
        match: rows.filter((r) => r.status === 'match').length,
        differs: rows.filter((r) => r.status === 'differs').length,
        missing: rows.filter((r) => r.status === 'document_only' || r.status === 'site_only').length,
        open: withDecisions.filter(needsDecision).length,
      },
    };
  }

  // A person records what they decided about a difference and why. The system never decides.
  async decide(firmId: string, actorId: string, assignmentId: string, factKey: string, dto: { outcome: string; reason?: string }) {
    const compare = await this.compare(firmId, assignmentId);
    const row = compare.rows.find((r) => r.key === factKey);
    if (!row) throw new NotFoundException('Unknown fact');
    const reason = (dto.reason ?? '').trim();
    if (dto.outcome !== 'NOT_APPLICABLE' && reason.length < 3) throw new BadRequestException('Say why, so the decision can be traced');
    const data = { outcome: dto.outcome, reason, documentValue: row.document, siteValue: row.site, decidedById: actorId, decidedAt: new Date() };
    await this.prisma.$transaction(async (tx) => {
      await tx.comparisonDecision.upsert({ where: { assignmentId_factKey: { assignmentId, factKey } }, create: { firmId, assignmentId, factKey, ...data }, update: data });
      await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: 'comparison.decided', metadata: { factKey, outcome: dto.outcome, reason, documentValue: row.document, siteValue: row.site } }, tx);
    });
    return this.compare(firmId, assignmentId);
  }

  // Where the case stands, one line per step: who has it, what state it is in, and a few words of detail.
  async progress(firmId: string, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: {
        propertyId: true,
        reportSubmittedAt: true,
        assignedValuer: { select: { fullName: true } },
        assignedDrafter: { select: { fullName: true } },
        assignedInspector: { select: { fullName: true } },
        bankReportForms: { select: { id: true }, take: 1 },
      },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const [documents, typed, , visit, sends, compare] = await Promise.all([
      this.prisma.document.count({ where: { firmId, propertyId: assignment.propertyId } }),
      this.prisma.extractedField.count({ where: { firmId, source: 'MANUAL', state: { not: 'UNKNOWN' }, document: { propertyId: assignment.propertyId } } }),
      Promise.resolve(0),
      this.prisma.inspection.findFirst({ where: { assignmentId, firmId }, orderBy: { visitedAt: 'desc' }, select: { status: true, observations: true, _count: { select: { measurements: true } } } }),
      this.prisma.reportSend.count({ where: { assignmentId, firmId } }),
      this.compare(firmId, assignmentId),
    ]);
    // The draft counts as ready only if it was sent after the last time it was returned.
    const requests = await this.prisma.reworkRequest.findMany({ where: { assignmentId, firmId }, orderBy: { createdAt: 'desc' }, take: 10 });
    const lastReturn = requests.find((r) => r.kind === 'DRAFTER' || r.kind === 'DOCUMENTS');
    const sentAfter = await this.prisma.auditEvent.count({ where: { firmId, entityType: 'Assignment', entityId: assignmentId, action: 'bank_report.sent_for_check', ...(lastReturn && { createdAt: { gt: lastReturn.createdAt } }) } });
    const openDrafter = requests.find((r) => !r.resolvedAt && (r.kind === 'DRAFTER' || r.kind === 'DOCUMENTS'));
    const openSite = requests.find((r) => !r.resolvedAt && r.kind === 'REINSPECTION');
    type State = 'todo' | 'doing' | 'done' | 'blocked';
    const step = (key: string, title: string, who: string | null, state: State, detail: string) => ({ key, title, who, state, detail });
    const ready = sentAfter;
    const answers = countObservations(visit?.observations);
    const siteDone = visit?.status === 'SUBMITTED' || visit?.status === 'REVIEWED';
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

    const steps = [
      step('documents', 'Documents', assignment.assignedValuer.fullName, documents > 0 ? 'done' : 'todo', documents > 0 ? plural(documents, 'file') + ' uploaded' : 'No papers uploaded yet'),
      step('drafter', 'Read the documents', assignment.assignedDrafter?.fullName ?? null,
        !assignment.assignedDrafter ? 'blocked' : openDrafter ? 'doing' : ready > 0 ? 'done' : typed > 0 ? 'doing' : documents === 0 ? 'blocked' : 'todo',
        !assignment.assignedDrafter ? 'No drafter chosen yet' : openDrafter ? `Returned: ${openDrafter.reason}` : ready > 0 ? 'Draft sent for checking' : typed > 0 ? `${plural(typed, 'box')} filled` : documents === 0 ? 'Waiting for the papers' : 'Not started'),
      step('inspector', 'Site visit', assignment.assignedInspector?.fullName ?? null,
        !assignment.assignedInspector ? 'blocked' : openSite ? 'doing' : siteDone ? 'done' : visit ? 'doing' : 'todo',
        !assignment.assignedInspector ? 'No inspector chosen yet' : openSite ? `New visit requested: ${openSite.reason}` : siteDone ? 'Site data submitted' : visit ? `On site: ${plural(answers, 'answer')}, ${plural(visit._count.measurements, 'measurement')}` : 'Not started'),
      step('compare', 'Compare documents with the site', null,
        !visit ? 'blocked' : compare.summary.differs > 0 ? 'doing' : siteDone ? 'done' : 'doing',
        !visit ? 'Waiting for the site visit' : `${compare.summary.match} match, ${compare.summary.differs} differ, ${compare.summary.missing} missing on one side`),
      step('report', 'Bank report', assignment.assignedDrafter?.fullName ?? null,
        ready > 0 ? 'done' : assignment.bankReportForms.length > 0 ? 'doing' : 'todo',
        ready > 0 ? 'Ready for the valuer to check' : assignment.bankReportForms.length > 0 ? 'Saved, not sent for checking yet' : 'Not started'),
      step('check', 'Check, approve and send', assignment.assignedValuer.fullName,
        sends > 0 ? 'done' : assignment.reportSubmittedAt ? 'doing' : ready > 0 ? 'todo' : 'blocked',
        sends > 0 ? 'Approved and sent to the bank' : assignment.reportSubmittedAt ? 'Approved. Not sent to the bank yet' : ready > 0 ? 'Ready for you to check' : 'Waiting for the draft'),
    ];
    return {
      steps,
      rework: requests.filter((r) => !r.resolvedAt).map((r) => ({ id: r.id, kind: r.kind, reason: r.reason, dueDate: r.dueDate, revision: r.revision, createdAt: r.createdAt })),
    };
  }

  async sendForChecking(firmId: string, actorId: string, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { code: true, createdById: true, bank: { select: { name: true } } } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { fullName: true } });
    await this.prisma.$transaction(async (tx) => {
      if (assignment.createdById !== actorId) {
        await this.notifications.notify(tx, {
          firmId,
          userId: assignment.createdById,
          assignmentId,
          kind: 'DRAFT_READY',
          title: 'Draft ready to check',
          body: `${assignment.code} · ${assignment.bank.name}. ${actor?.fullName ?? 'The drafter'} has finished the bank report draft.`,
        });
      }
      await tx.reworkRequest.updateMany({ where: { assignmentId, firmId, kind: { in: ['DRAFTER', 'DOCUMENTS'] }, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actorId } });
      await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: 'bank_report.sent_for_check' }, tx);
    });
    return { sent: true };
  }

  async save(firmId: string, actor: Actor, assignmentId: string, incoming: Record<string, unknown>, requested?: string) {
    const approved = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { reportSubmittedAt: true } });
    if (approved?.reportSubmittedAt) throw new ConflictException('The report is approved and locked. The valuer can reopen it for a revision.');
    const format = (await this.merged(firmId, assignmentId, requested)).format;
    const known = new Set(format.keys);
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(incoming ?? {})) {
      if (!known.has(key)) throw new BadRequestException(`Unknown field "${key}"`);
      if (typeof value !== 'string') throw new BadRequestException(`"${key}" must be text`);
      if (value.length > MAX_VALUE_LENGTH) throw new BadRequestException(`"${key}" is too long`);
      values[key] = value;
    }
    const data = values as Prisma.InputJsonValue;
    await this.prisma.bankReportForm.upsert({
      where: { assignmentId_format: { assignmentId, format: format.id } },
      create: { firmId, assignmentId, format: format.id, values: data, updatedById: actor.userId },
      update: { values: data, updatedById: actor.userId },
    });
    await this.audit.record({ firmId, actorId: actor.userId, entityType: 'Assignment', entityId: assignmentId, action: 'bank_report.saved', metadata: { format: format.id, fields: Object.keys(values).length } });
    return this.form(firmId, assignmentId, format.id);
  }

  async file(firmId: string, actor: Actor, assignmentId: string, kind: 'docx' | 'pdf', requested?: string) {
    const { values, branchName, propertyClass, propertyId, inspectionId, reportCode, format } = await this.merged(firmId, assignmentId, requested);
    const photos = await this.photos(firmId, inspectionId);
    const answers = resolveValues(format.fields, { ...values, ...this.computed(format, values) }, propertyClass === 'LAND');
    let bytes: Buffer;
    if (kind === 'docx') {
      bytes = await fillDocx(format.template, answers, photos);
    } else {
      const marked = await fillDocx(format.template, answers, photos, '[[PHOTOS]]');
      const fontPath = process.env.REPORT_FONT_PATH;
      const boldPath = process.env.REPORT_FONT_BOLD_PATH;
      bytes = await renderBoiPdf(await docxToDocument(marked, photos, format.footer), fontPath && boldPath ? { regular: readFileSync(fontPath), bold: readFileSync(boldPath) } : undefined);
    }
    await this.audit.record({ firmId, actorId: actor.userId, entityType: 'Assignment', entityId: assignmentId, action: 'bank_report.exported', metadata: { format: format.id, kind, propertyId } });
    const name = `${format.id}-valuation-report-${reportCode.replaceAll('/', '-')}.${kind}`;
    const type = kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
    return { bytes, name, type };
  }

  // Values the template needs that no one types: they follow from the others.
  private computed(format: BankFormat, values: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const field of format.fields) {
      if (!field.hidden) continue;
      const base = field.key.replace(/_short$/, '');
      const source = values[base]?.trim();
      if (source) out[field.key] = source.replace(/\s*\(.*\)\s*$/, '');
    }
    return out;
  }

  async photos(firmId: string, inspectionId: string | null) {
    if (!inspectionId) return [];
    const rows = await this.prisma.inspectionPhoto.findMany({ where: { inspectionId, inspection: { firmId }, mimeType: { in: EMBEDDABLE } }, orderBy: { id: 'asc' }, take: MAX_PHOTOS });
    const out: { data: Buffer; mime: string; caption: string }[] = [];
    for (const photo of rows) {
      try {
        out.push({ data: await this.storage.read(photo.storageKey), mime: photo.mimeType, caption: photo.caption ?? photo.category ?? '' });
      } catch {
        // A photo whose file is gone is left out; the report still draws.
      }
    }
    return out;
  }

  // Everything a report is made from: the format, the answers so far and the facts read from each document.
  async merged(firmId: string, assignmentId: string, requested?: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: {
        code: true,
        purpose: true,
        valuationDate: true,
        receivedAt: true,
        instructionDate: true,
        borrowerName: true,
        bank: { select: { name: true } },
        branch: { select: { name: true } },
        assignedValuer: { select: { fullName: true } },
        firm: { select: { name: true } },
        property: true,
        bankReportForms: { select: { format: true, values: true } },
      },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const format: BankFormat = chooseFormat(assignment.bank.name, requested);

    const inspection = await this.prisma.inspection.findFirst({
      where: { assignmentId, firmId, status: { in: ['SUBMITTED', 'REVIEWED'] } },
      orderBy: { visitedAt: 'desc' },
      select: { id: true, visitedAt: true, latitude: true, longitude: true, observations: true },
    });
    const valuation = await this.prisma.valuationVersion.findFirst({ where: { assignmentId, firmId }, orderBy: { versionNumber: 'desc' }, select: { totalValue: true, adoptedAreaSqm: true } });
    const documents = await this.prisma.document.findMany({
      where: { firmId, propertyId: assignment.property.id },
      orderBy: { uploadedAt: 'asc' },
      take: 60,
      include: { fields: { select: { fieldKey: true, extractedValue: true, verifiedValue: true, state: true, confidence: true, useInReport: true, source: true, unit: true } } },
    });

    const { best, own, shown, conflicts } = gatherFacts(documents);

    const resolved = await this.prisma.discrepancy.findMany({ where: { assignmentId, firmId, status: { in: ['RESOLVED', 'DISCLOSED'] }, resolutionNote: { not: null } }, orderBy: { resolvedAt: 'asc' }, select: { fieldKey: true, resolutionNote: true } });
    const disclosures = Object.fromEntries(resolved.map((d) => [d.fieldKey, d.resolutionNote as string]));

    const boundaries = (assignment.property.boundaries ?? null) as Partial<Record<'north' | 'south' | 'east' | 'west', string>> | null;
    const prefill = format.prefill({
      today: new Date(),
      firmName: assignment.firm.name,
      valuerName: assignment.assignedValuer.fullName,
      assignment: {
        code: assignment.code,
        purpose: assignment.purpose,
        valuationDate: assignment.valuationDate,
        receivedAt: assignment.receivedAt,
        instructionDate: assignment.instructionDate,
        borrowerName: assignment.borrowerName,
        bankName: assignment.bank.name,
        branchName: assignment.branch?.name ?? null,
      },
      property: {
        propertyClass: assignment.property.propertyClass as PropertyClass,
        addressLine: assignment.property.addressLine,
        unitDetail: assignment.property.unitDetail,
        locality: assignment.property.locality,
        village: assignment.property.village,
        tehsil: assignment.property.tehsil,
        district: assignment.property.district,
        state: assignment.property.state,
        pinCode: assignment.property.pinCode,
        latitude: assignment.property.latitude === null ? null : Number(assignment.property.latitude),
        longitude: assignment.property.longitude === null ? null : Number(assignment.property.longitude),
        boundaries,
      },
      inspection: inspection ? { observations: Object.fromEntries(Object.entries((inspection.observations ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])), visitedAt: inspection.visitedAt, latitude: inspection.latitude === null ? null : Number(inspection.latitude), longitude: inspection.longitude === null ? null : Number(inspection.longitude) } : null,
      valuation: valuation ? { totalValue: Number(valuation.totalValue), adoptedAreaSqm: Number(valuation.adoptedAreaSqm) } : null,
      facts: Object.fromEntries([...best].map(([key, v]) => [key, v.value])),
      disclosures,
      documents: documents
        .filter((d) => d.type !== 'BANK_INSTRUCTION' && d.type !== 'OTHER')
        .map((d) => ({ type: d.type as DocumentType, fileName: d.fileName, registrationNumber: own.get(d.id)?.registration_number, documentDate: own.get(d.id)?.document_date })),
    });

    const known = new Set(format.keys);
    const savedForm = assignment.bankReportForms.find((f) => f.format === format.id);
    const savedValues = (savedForm?.values ?? {}) as Record<string, string>;
    const values = Object.fromEntries(Object.entries({ ...prefill, ...savedValues }).filter(([key]) => known.has(key)));
    const suggested = Object.keys(prefill).filter((key) => known.has(key) && !(key in savedValues));
    const prefillKnown = Object.fromEntries(Object.entries(prefill).filter(([key]) => known.has(key)));
    return {
      format,
      values,
      suggested,
      prefill: prefillKnown,
      saved: savedForm !== undefined,
      branchName: assignment.branch?.name ?? '',
      propertyClass: assignment.property.propertyClass,
      propertyId: assignment.property.id,
      inspectionId: inspection?.id ?? null,
      reportCode: assignment.code,
      documentFacts: documents.map((d) => ({ label: DOCUMENT_TYPE_LABELS[d.type as DocumentType], fileName: d.fileName, facts: own.get(d.id) ?? {}, shown: shown.get(d.id) ?? {} })),
      conflicts,
      facts: Object.fromEntries([...best].map(([key, v]) => [key, v.value])),
      valuationTotal: valuation ? Number(valuation.totalValue) : null,
    };
  }
}
