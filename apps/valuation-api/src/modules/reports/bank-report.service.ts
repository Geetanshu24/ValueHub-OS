import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DOCUMENT_TYPE_LABELS, type DocumentType, type PropertyClass } from '@value-hub/valuation-shared';
import { readFileSync } from 'node:fs';
import { AuditService } from '../../common/audit/audit.service.js';
import { StorageService } from '../../common/storage/storage.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BANK_FORMATS, chooseFormat, type BankFormat } from './bank-formats.js';
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
  ) {}

  // The format to fill, the values already known and which of them were suggested
  // from records. What the valuer saved always wins over a suggestion.
  async form(firmId: string, assignmentId: string, requested?: string) {
    const { values, suggested, saved, format } = await this.merged(firmId, assignmentId, requested);
    return { format: format.id, title: format.title, formats: BANK_FORMATS.map((f) => ({ id: f.id, label: f.label })), fields: format.fields.filter((f) => !f.hidden), values, suggested, saved };
  }

  async save(firmId: string, actor: Actor, assignmentId: string, incoming: Record<string, unknown>, requested?: string) {
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
      select: { id: true, visitedAt: true, latitude: true, longitude: true },
    });
    const valuation = await this.prisma.valuationVersion.findFirst({ where: { assignmentId, firmId }, orderBy: { versionNumber: 'desc' }, select: { totalValue: true, adoptedAreaSqm: true } });
    const documents = await this.prisma.document.findMany({
      where: { firmId, propertyId: assignment.property.id },
      orderBy: { uploadedAt: 'asc' },
      take: 60,
      include: { fields: { select: { fieldKey: true, extractedValue: true, verifiedValue: true, state: true, confidence: true } } },
    });

    const best = new Map<string, { value: string; rank: number }>();
    const own = new Map<string, Record<string, string>>();
    for (const document of documents) {
      const perDocument: Record<string, string> = {};
      for (const field of document.fields) {
        const reviewed = field.state === 'VERIFIED' || field.state === 'CORRECTED';
        if (field.state === 'UNKNOWN') continue;
        const value = (reviewed ? field.verifiedValue ?? field.extractedValue : field.extractedValue).trim();
        const rank = (reviewed ? 10 : 0) + Number(field.confidence ?? 0);
        if (!value) continue;
        if (!perDocument[field.fieldKey]) perDocument[field.fieldKey] = value;
        if (rank > (best.get(field.fieldKey)?.rank ?? -1)) best.set(field.fieldKey, { value, rank });
      }
      own.set(document.id, perDocument);
    }

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
      inspection: inspection ? { visitedAt: inspection.visitedAt, latitude: inspection.latitude === null ? null : Number(inspection.latitude), longitude: inspection.longitude === null ? null : Number(inspection.longitude) } : null,
      valuation: valuation ? { totalValue: Number(valuation.totalValue), adoptedAreaSqm: Number(valuation.adoptedAreaSqm) } : null,
      facts: Object.fromEntries([...best].map(([key, v]) => [key, v.value])),
      documents: documents
        .filter((d) => d.type !== 'BANK_INSTRUCTION' && d.type !== 'OTHER')
        .map((d) => ({ type: d.type as DocumentType, fileName: d.fileName, registrationNumber: own.get(d.id)?.registration_number, documentDate: own.get(d.id)?.document_date })),
    });

    const known = new Set(format.keys);
    const savedForm = assignment.bankReportForms.find((f) => f.format === format.id);
    const savedValues = (savedForm?.values ?? {}) as Record<string, string>;
    const values = Object.fromEntries(Object.entries({ ...prefill, ...savedValues }).filter(([key]) => known.has(key)));
    const suggested = Object.keys(prefill).filter((key) => known.has(key) && !(key in savedValues));
    return {
      format,
      values,
      suggested,
      saved: savedForm !== undefined,
      branchName: assignment.branch?.name ?? '',
      propertyClass: assignment.property.propertyClass,
      propertyId: assignment.property.id,
      inspectionId: inspection?.id ?? null,
      reportCode: assignment.code,
      documentFacts: documents.map((d) => ({ label: DOCUMENT_TYPE_LABELS[d.type as DocumentType], fileName: d.fileName, facts: own.get(d.id) ?? {} })),
      facts: Object.fromEntries([...best].map(([key, v]) => [key, v.value])),
      valuationTotal: valuation ? Number(valuation.totalValue) : null,
    };
  }
}
