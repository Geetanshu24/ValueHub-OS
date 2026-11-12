import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { treatmentsFor, type DocumentType, type PropertyClass } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DiscrepanciesService } from '../discrepancies/discrepancies.service.js';
import { compareEvidence, summarise, type ComparisonRow, type Evidence } from './compare.js';

const OPEN = ['UNRESOLVED', 'ESCALATED'] as const;

@Injectable()
export class ComparisonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discrepancies: DiscrepanciesService,
    private readonly audit: AuditService,
  ) {}

  // The comparison for an assignment. Mismatches that need a person are recorded as discrepancies (once),
  // so the gates that already stop a valuation on open discrepancies apply here too.
  async get(firmId: string, actorId: string, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: { borrowerName: true, valuationDate: true, property: { select: { id: true, propertyClass: true, addressLine: true, unitDetail: true, khasraNumbers: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const documents = await this.prisma.document.findMany({ where: { firmId, propertyId: assignment.property.id }, select: { type: true, fileName: true }, take: 100 });
    const fields = await this.prisma.extractedField.findMany({
      where: { firmId, state: { not: 'UNKNOWN' }, document: { propertyId: assignment.property.id } },
      select: { fieldKey: true, extractedValue: true, verifiedValue: true, state: true, confidence: true, pageNumber: true, document: { select: { fileName: true } } },
      take: 1000,
    });
    const best = new Map<string, { evidence: Evidence; rank: number }>();
    for (const f of fields) {
      const reviewed = f.state === 'VERIFIED' || f.state === 'CORRECTED';
      const value = (f.verifiedValue ?? f.extractedValue).trim();
      const rank = (reviewed ? 10 : 0) + Number(f.confidence ?? 0);
      if (value && rank > (best.get(f.fieldKey)?.rank ?? -1)) best.set(f.fieldKey, { evidence: { value, source: `${f.document.fileName} p.${f.pageNumber}${reviewed ? '' : ' (not yet verified)'}` }, rank });
    }

    const visit = await this.prisma.inspection.findFirst({
      where: { assignmentId, firmId },
      orderBy: { visitedAt: 'desc' },
      select: { visitedAt: true, observations: true, measurements: { select: { label: true, areaSqm: true, fieldKey: true } }, inspector: { select: { fullName: true } } },
    });

    const rows = compareEvidence({
      propertyClass: assignment.property.propertyClass as PropertyClass,
      record: { addressLine: assignment.property.addressLine, unitDetail: assignment.property.unitDetail, khasraNumbers: assignment.property.khasraNumbers, borrowerName: assignment.borrowerName },
      docFacts: Object.fromEntries([...best].map(([k, v]) => [k, v.evidence])),
      documents: documents.map((d) => ({ type: d.type as DocumentType, fileName: d.fileName })),
      inspection: visit
        ? {
            source: `Inspection ${visit.visitedAt.toISOString().slice(0, 10)} (${visit.inspector.fullName})`,
            observations: Object.fromEntries(Object.entries((visit.observations ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])),
            measurements: visit.measurements.map((m) => ({ label: m.label, areaSqm: Number(m.areaSqm), fieldKey: m.fieldKey })),
          }
        : null,
      year: assignment.valuationDate.getUTCFullYear(),
    });

    // One discrepancy per mismatch that needs a person; the area ones may already exist from the inspection.
    const existing = await this.prisma.discrepancy.findMany({ where: { assignmentId, firmId }, orderBy: { createdAt: 'desc' }, take: 300 });
    const linked = new Map<string, (typeof existing)[number]>();
    for (const row of rows) {
      if (!row.needsResolution) continue;
      let found = existing.find((d) => d.fieldKey === row.key);
      if (!found) {
        found = await this.prisma.discrepancy.create({
          data: { firmId, assignmentId, fieldKey: row.key, description: `${row.label}: the documents and the site differ`, valueA: row.document?.value ?? '', sourceA: row.document?.source ?? 'Documents', valueB: row.site?.value ?? '', sourceB: row.site?.source ?? 'Site', material: true },
        });
        await this.audit.record({ firmId, actorId, entityType: 'Discrepancy', entityId: found.id, action: 'discrepancy.flagged', metadata: { from: 'comparison' } });
      }
      linked.set(row.key, found);
    }

    const out = rows.map((row) => {
      const d = linked.get(row.key) ?? existing.find((x) => x.fieldKey === row.key);
      return {
        ...row,
        treatments: row.needsResolution || d ? treatmentsFor(row.key) : [],
        discrepancy: d ? { id: d.id, status: d.status, resolutionNote: d.resolutionNote, treatment: d.treatment, resolvedAt: d.resolvedAt } : null,
      };
    });
    const rowKeys = new Set(rows.map((r) => r.key));
    const open = out.filter((r) => r.needsResolution && r.discrepancy && (OPEN as readonly string[]).includes(r.discrepancy.status)).length;
    // Open items flagged earlier that this table does not show (e.g. a carpet-area difference).
    const others = existing.filter((d) => !rowKeys.has(d.fieldKey) && d.material && (OPEN as readonly string[]).includes(d.status));
    return {
      rows: out,
      summary: summarise(rows),
      open: open + others.length,
      canProceed: open + others.length === 0,
      others: others.map((d) => ({ id: d.id, fieldKey: d.fieldKey, description: d.description, sourceA: d.sourceA, sourceB: d.sourceB, status: d.status })),
      inspection: visit ? { visitedAt: visit.visitedAt, by: visit.inspector.fullName } : null,
    };
  }

  // Records the valuer's decision on one row, with the standard treatment and the note.
  async resolve(firmId: string, actorId: string, assignmentId: string, rowKey: string, body: { treatment: string; note: string }) {
    const treatment = treatmentsFor(rowKey).find((t) => t.key === body.treatment);
    if (!treatment) throw new BadRequestException('Unknown treatment for this row');
    if (typeof body.note !== 'string' || body.note.trim().length < 10) throw new BadRequestException('A note of at least 10 characters is required');
    const discrepancy = await this.prisma.discrepancy.findFirst({ where: { assignmentId, firmId, fieldKey: rowKey }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!discrepancy) throw new NotFoundException('Nothing to resolve on this row');
    await this.discrepancies.resolve(firmId, actorId, discrepancy.id, { outcome: treatment.outcome, resolutionNote: body.note.trim(), treatment: treatment.key });
    return this.get(firmId, actorId, assignmentId);
  }
}
