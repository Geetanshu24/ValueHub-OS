import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AREA_FIELD_KEYS, type DocumentType } from '@value-hub/valuation-shared';
import { StorageService } from '../../common/storage/storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PDFDocument } from 'pdf-lib';
import { formatValue, isBlank, resolve, typeOf, type ReportContext } from './report-fields.js';
import { runQc, type QcInput, type QcResult, type SnapshotLine } from './report-qc.js';
import { parseTemplateSpec, type TemplateSpec } from './template-spec.js';

export const MAX_ANNEXURES = 40;
export const MAX_EMBEDDED_PHOTOS = 30;
const EMBEDDABLE_IMAGES = ['image/jpeg', 'image/png'];

export interface SnapshotRow {
  label: string;
  value: string;
  source: string;
  kind: string;
  missing: boolean;
}

export interface Snapshot {
  firmName: string;
  reportCode: string;
  generatedAt: string;
  template: { id: string; name: string; version: number; title: string };
  valuation: { id: string; versionNumber: number; engineVersion: string; status: string; method: string; totalValue: number };
  sections: { heading: string; rows: SnapshotRow[] }[];
  workings: { lines: SnapshotLine[]; totalValue: number; adoptedAreaSqm: number; areaBasis: string; adoptedAreaSource: string; assumptions: string | null };
  measurements: { label: string; areaSqm: number; method: string }[];
  discrepancies: { description: string; status: string; resolutionNote: string | null; sourceA: string; sourceB: string }[];
  comparables: { id: string; location: string; ratePerSqm: number; observedOn: string; source: string; isTransaction: boolean; verified: boolean }[];
  limitations: string[];
  annexures: { index: number; type: DocumentType; documentId: string; fileName: string; mimeType: string; storageKey: string; sha256: string; pages: number | null; embeddable: boolean }[];
  photos: { id: string; caption: string | null; confirmed: boolean; mimeType: string; storageKey: string; sha256: string; embedded: boolean }[];
  people: { valuer: string; preparedBy: string };
}

const num = (value: unknown) => Number(value);

@Injectable()
export class ReportSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // Gathers everything a report is drawn from, freezes it into a snapshot and
  // runs the quality checks against it.
  async build(
    firmId: string,
    actor: { userId: string },
    assignmentId: string,
    templateId: string,
    valuationVersionId: string | undefined,
    versionNumber: number,
  ): Promise<{ snapshot: Snapshot; qc: QcResult; spec: TemplateSpec }> {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: {
        code: true,
        purpose: true,
        scope: true,
        valuationDate: true,
        receivedAt: true,
        bankId: true,
        bank: { select: { name: true } },
        branch: { select: { name: true } },
        assignedValuer: { select: { fullName: true } },
        firm: { select: { name: true } },
        property: true,
      },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const template = await this.prisma.reportTemplate.findFirst({ where: { id: templateId, firmId } });
    if (!template) throw new NotFoundException('Template not found');
    const { spec, problems } = parseTemplateSpec(template.fieldMap);
    if (!spec) throw new BadRequestException({ message: ['The template is invalid', ...problems], error: 'Bad Request', statusCode: 400 });

    const valuation = await this.prisma.valuationVersion.findFirst({
      where: { assignmentId, firmId, ...(valuationVersionId && { id: valuationVersionId }) },
      orderBy: { versionNumber: 'desc' },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!valuation) throw new BadRequestException('Draft a valuation before preparing a report');

    const inspection = await this.prisma.inspection.findFirst({
      where: { assignmentId, firmId, status: { in: ['SUBMITTED', 'REVIEWED'] } },
      orderBy: { visitedAt: 'desc' },
      include: { inspector: { select: { fullName: true } }, measurements: true, photos: { orderBy: { id: 'asc' } } },
    });
    const preparer = await this.prisma.user.findFirst({ where: { id: actor.userId, firmId }, select: { fullName: true } });

    const discrepancies = await this.prisma.discrepancy.findMany({ where: { assignmentId, firmId }, orderBy: { createdAt: 'asc' }, take: 200 });

    const documents = await this.prisma.document.findMany({
      where: {
        firmId,
        propertyId: assignment.property.id,
        OR: [{ type: { in: spec.requiredAnnexures } }, { assignmentId }],
      },
      orderBy: { uploadedAt: 'desc' },
      take: MAX_ANNEXURES,
      include: { fields: { select: { fieldKey: true, state: true } } },
    });

    const citedIds = ((valuation.inputs as { comparableIds?: string[] } | null)?.comparableIds ?? []).slice(0, 100);
    const comparables = citedIds.length
      ? await this.prisma.marketComparable.findMany({ where: { id: { in: citedIds }, firmId, assignmentId } })
      : [];

    // ---- template fields -> rows
    const obs = (inspection?.observations ?? {}) as Record<string, unknown>;
    const context: ReportContext = {
      firm: { name: assignment.firm.name },
      property: assignment.property,
      assignment: {
        code: assignment.code,
        purpose: assignment.purpose,
        scope: assignment.scope,
        valuationDate: assignment.valuationDate,
        receivedAt: assignment.receivedAt,
        bank: assignment.bank.name,
        branch: assignment.branch?.name,
      },
      valuation: {
        versionNumber: valuation.versionNumber,
        method: valuation.method,
        areaBasis: valuation.areaBasis,
        adoptedAreaSqm: num(valuation.adoptedAreaSqm),
        adoptedAreaSource: valuation.adoptedAreaSource,
        assumptions: valuation.assumptions,
        totalValue: num(valuation.totalValue),
      },
      inspection: {
        visitedAt: inspection?.visitedAt,
        inspector: inspection?.inspector.fullName,
        latitude: inspection?.latitude?.toString(),
        longitude: inspection?.longitude?.toString(),
        observations: obs,
      },
      valuer: { fullName: assignment.assignedValuer.fullName },
    };

    const missingRequired: string[] = [];
    const sections = spec.sections.map((section) => ({
      heading: section.heading,
      rows: section.fields.map((field): SnapshotRow => {
        const value = resolve(context, field.source);
        const blank = isBlank(value);
        const requiredNow = field.kind === 'required' || (field.kind === 'conditional' && field.when !== undefined && !isBlank(resolve(context, field.when)));
        if (blank && requiredNow) missingRequired.push(`${section.heading}: ${field.label}`);
        return { label: field.label, value: formatValue(value, typeOf(field.source)), source: field.source, kind: field.kind, missing: blank && requiredNow };
      }),
    }));

    // ---- annexures and photos: existence and embeddability
    const annexureChecks = await Promise.all(
      documents.map(async (doc) => {
        const exists = await this.storage.exists(doc.storageKey);
        let embeddable = false;
        let pages: number | null = doc.pageCount;
        if (exists && EMBEDDABLE_IMAGES.includes(doc.mimeType)) embeddable = true;
        if (exists && doc.mimeType === 'application/pdf') {
          try {
            const parsed = await PDFDocument.load(await this.storage.read(doc.storageKey), { ignoreEncryption: false });
            pages = parsed.getPageCount();
            embeddable = true;
          } catch {
            embeddable = false;
          }
        }
        return { doc, exists, embeddable, pages };
      }),
    );
    const annexures = annexureChecks.map(({ doc, embeddable, pages }, i) => ({
      index: i + 1,
      type: doc.type as DocumentType,
      documentId: doc.id,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      storageKey: doc.storageKey,
      sha256: doc.sha256,
      pages,
      embeddable,
    }));

    const photoRows = inspection?.photos ?? [];
    const photoExists = await Promise.all(photoRows.map((p) => this.storage.exists(p.storageKey)));
    const photos = photoRows.map((p, i) => ({
      id: p.id,
      caption: p.caption,
      confirmed: p.captionConfirmed,
      mimeType: p.mimeType,
      storageKey: p.storageKey,
      sha256: p.sha256,
      embedded: photoExists[i] && EMBEDDABLE_IMAGES.includes(p.mimeType) && i < MAX_EMBEDDED_PHOTOS,
    }));

    // ---- limitations: controlled wording, plus the valuer's own disclosures
    const disclosed = discrepancies.filter((d) => d.status === 'DISCLOSED' || d.status === 'RESOLVED');
    const limitations = [
      ...spec.limitations,
      ...disclosed.map((d) => `${d.status === 'DISCLOSED' ? 'Disclosed difference' : 'Resolved difference'}: ${d.description}. ${d.resolutionNote ?? ''}`.trim()),
    ];

    const lines: SnapshotLine[] = valuation.lineItems.map((l) => ({
      component: l.component,
      quantity: num(l.quantity),
      unit: l.unit,
      rate: num(l.rate),
      amount: num(l.amount),
      treatment: l.treatment,
      sourceNote: l.sourceNote,
    }));

    const allFields = documents.flatMap((d) => d.fields);
    const areaKeys = AREA_FIELD_KEYS as readonly string[];
    const presentTypes = new Set(documents.map((d) => d.type));
    const unresolved = discrepancies.filter((d) => d.material && (d.status === 'UNRESOLVED' || d.status === 'ESCALATED')).length;

    const qcInput: QcInput = {
      spec,
      missingRequired,
      lines,
      totalValue: num(valuation.totalValue),
      adoptedAreaSqm: num(valuation.adoptedAreaSqm),
      templateClassMatches: template.propertyClass === null || template.propertyClass === assignment.property.propertyClass,
      templateBankMatches: template.bankId === null || template.bankId === assignment.bankId,
      valuationStatus: valuation.status,
      unresolvedDiscrepancies: unresolved,
      missingAnnexureTypes: spec.requiredAnnexures.filter((t) => !presentTypes.has(t)),
      annexuresMissingFiles: annexureChecks.filter((a) => !a.exists).map((a) => a.doc.fileName),
      annexuresNotEmbeddable: annexureChecks.filter((a) => a.exists && !a.embeddable).map((a) => a.doc.fileName),
      unverifiedAreaFacts: allFields.filter((f) => areaKeys.includes(f.fieldKey) && f.state === 'UNVERIFIED').length,
      unverifiedOtherFacts: allFields.filter((f) => !areaKeys.includes(f.fieldKey) && f.state === 'UNVERIFIED').length,
      photoCount: photos.length,
      unconfirmedPhotoCaptions: photos.filter((p) => !p.confirmed).length,
      photosNotEmbedded: photos.filter((p) => !p.embedded).length,
      comparablesUnverified: comparables.filter((c) => !c.verified).length,
    };

    const snapshot: Snapshot = {
      firmName: assignment.firm.name,
      reportCode: `${assignment.code}-R${versionNumber}`,
      generatedAt: new Date().toISOString(),
      template: { id: template.id, name: template.name, version: template.version, title: spec.title },
      valuation: {
        id: valuation.id,
        versionNumber: valuation.versionNumber,
        engineVersion: valuation.engineVersion,
        status: valuation.status,
        method: valuation.method,
        totalValue: num(valuation.totalValue),
      },
      sections,
      workings: {
        lines,
        totalValue: num(valuation.totalValue),
        adoptedAreaSqm: num(valuation.adoptedAreaSqm),
        areaBasis: valuation.areaBasis,
        adoptedAreaSource: valuation.adoptedAreaSource,
        assumptions: valuation.assumptions,
      },
      measurements: (inspection?.measurements ?? []).map((m) => ({ label: m.label, areaSqm: num(m.areaSqm), method: m.method })),
      discrepancies: discrepancies.map((d) => ({ description: d.description, status: d.status, resolutionNote: d.resolutionNote, sourceA: d.sourceA, sourceB: d.sourceB })),
      comparables: comparables.map((c) => ({ id: c.id, location: c.location, ratePerSqm: num(c.ratePerSqm), observedOn: c.observedOn.toISOString(), source: c.source, isTransaction: c.isTransaction, verified: c.verified })),
      limitations,
      annexures,
      photos,
      people: { valuer: assignment.assignedValuer.fullName, preparedBy: preparer?.fullName ?? '' },
    };
    return { snapshot, qc: runQc(qcInput), spec };
  }
}
