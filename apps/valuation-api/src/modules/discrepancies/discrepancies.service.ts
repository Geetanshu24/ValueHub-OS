import { Injectable, NotFoundException } from '@nestjs/common';
import { AREA_FIELD_KEYS, AREA_TOLERANCE_PERCENT } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { detectAreaDiscrepancies, type AreaFact } from './area-check.js';
import type { ResolveDiscrepancyDto } from './discrepancies.dto.js';

const discrepancySelect = {
  id: true,
  assignmentId: true,
  fieldKey: true,
  description: true,
  valueA: true,
  sourceA: true,
  valueB: true,
  sourceB: true,
  material: true,
  status: true,
  resolutionNote: true,
  treatment: true,
  resolvedAt: true,
  createdAt: true,
} satisfies Prisma.DiscrepancySelect;

@Injectable()
export class DiscrepanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listForAssignment(firmId: string, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { id: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return this.prisma.discrepancy.findMany({
      where: { assignmentId, firmId },
      select: discrepancySelect,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // The original values stay as recorded; only status and the note change.
  async resolve(firmId: string, actorId: string, id: string, dto: ResolveDiscrepancyDto) {
    const existing = await this.prisma.discrepancy.findFirst({ where: { id, firmId }, select: { status: true } });
    if (!existing) throw new NotFoundException('Discrepancy not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.discrepancy.update({
        where: { id },
        data: {
          status: dto.outcome,
          resolutionNote: dto.resolutionNote,
          treatment: dto.treatment ?? null,
          resolvedById: actorId,
          resolvedAt: new Date(),
        },
        select: discrepancySelect,
      });
      await this.audit.record(
        {
          firmId,
          actorId,
          entityType: 'Discrepancy',
          entityId: id,
          action: 'discrepancy.resolved',
          metadata: { from: existing.status, to: dto.outcome },
        },
        tx,
      );
      return updated;
    });
  }

  // Compares an inspection's keyed measurements with the property's
  // documented areas and records every difference beyond tolerance. Runs in
  // the caller's transaction and is idempotent. Returns how many were new.
  async detectForInspection(
    tx: Prisma.TransactionClient,
    ctx: { firmId: string; actorId: string; assignmentId: string; propertyId: string; inspectionId: string },
  ): Promise<number> {
    const inspection = await tx.inspection.findUniqueOrThrow({
      where: { id: ctx.inspectionId },
      select: { visitedAt: true, measurements: { select: { label: true, fieldKey: true, areaSqm: true } } },
    });
    const keyed = inspection.measurements.flatMap((m) =>
      m.fieldKey ? [{ fieldKey: m.fieldKey, areaSqm: Number(m.areaSqm), source: `Inspection ${inspection.visitedAt.toISOString().slice(0, 10)}: ${m.label}` }] : [],
    );
    if (keyed.length === 0) return 0;

    const fields = await tx.extractedField.findMany({
      where: {
        firmId: ctx.firmId,
        fieldKey: { in: [...AREA_FIELD_KEYS] },
        state: { not: 'UNKNOWN' },
        document: { propertyId: ctx.propertyId },
      },
      select: { fieldKey: true, extractedValue: true, verifiedValue: true, pageNumber: true, document: { select: { fileName: true } } },
      take: 500,
    });
    const facts: AreaFact[] = fields.flatMap((f) => {
      const value = Number(f.verifiedValue ?? f.extractedValue);
      return Number.isFinite(value) ? [{ fieldKey: f.fieldKey, value, source: `Document: ${f.document.fileName} p.${f.pageNumber}` }] : [];
    });

    let created = 0;
    for (const found of detectAreaDiscrepancies(facts, keyed, AREA_TOLERANCE_PERCENT)) {
      const duplicate = await tx.discrepancy.findFirst({
        where: {
          assignmentId: ctx.assignmentId,
          fieldKey: found.fieldKey,
          valueA: found.valueA,
          sourceA: found.sourceA,
          valueB: found.valueB,
          sourceB: found.sourceB,
        },
        select: { id: true },
      });
      if (duplicate) continue;

      const row = await tx.discrepancy.create({ data: { ...found, firmId: ctx.firmId, assignmentId: ctx.assignmentId } });
      await this.audit.record(
        { firmId: ctx.firmId, actorId: ctx.actorId, entityType: 'Discrepancy', entityId: row.id, action: 'discrepancy.flagged' },
        tx,
      );
      created += 1;
    }
    return created;
  }
}
