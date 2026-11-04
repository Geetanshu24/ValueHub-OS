import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AREA_FIELD_KEYS, AREA_TOLERANCE_PERCENT, factLabel } from '@value-hub/valuation-shared';
import { assessValuationReadiness } from '../assignments/readiness.js';
import { engineFor, SUPPORTED_CLASSES } from './engines/engines.js';
import { EngineInputError, type EngineInput, type EngineResult } from './engines/types.js';
import type { CreateValuationDto, ValuationInputDto } from './valuations.dto.js';

const valuationSelect = {
  id: true,
  assignmentId: true,
  versionNumber: true,
  status: true,
  method: true,
  engineVersion: true,
  areaBasis: true,
  adoptedAreaSqm: true,
  adoptedAreaSource: true,
  assumptions: true,
  totalValue: true,
  inputs: true,
  changeReason: true,
  createdAt: true,
  approvedAt: true,
  lineItems: {
    select: {
      id: true,
      sortOrder: true,
      component: true,
      quantity: true,
      unit: true,
      rate: true,
      amount: true,
      treatment: true,
      sourceNote: true,
      overrideReason: true,
    },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.ValuationVersionSelect;

// Valuations can only be drafted while the assignment is in the stages where
// the numbers are still being worked out.
const DRAFTABLE_STATUSES = ['VALUATION', 'REVISION'] as const;
const MAX_VERSIONS_LISTED = 50;

@Injectable()
export class ValuationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async preview(firmId: string, assignmentId: string, dto: ValuationInputDto) {
    const assignment = await this.loadAssignment(firmId, assignmentId);
    const result = this.calculate(assignment.propertyClass, dto);
    return { result, warnings: await this.warnings(firmId, assignmentId) };
  }

  // Everything the valuer starts from: the areas the site visit measured and the
  // documents claim, what was seen on site, evidence on file, and how far the
  // valuation has got.
  async context(firmId: string, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { status: true, propertyId: true, property: { select: { propertyClass: true } } } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const [inspection, fields, open, disclosed, comparables, latest] = await Promise.all([
      this.prisma.inspection.findFirst({
        where: { assignmentId, firmId, status: { in: ['SUBMITTED', 'REVIEWED'] } },
        orderBy: { visitedAt: 'desc' },
        select: { visitedAt: true, status: true, observations: true, inspector: { select: { fullName: true } }, measurements: { select: { label: true, fieldKey: true, areaSqm: true, method: true } } },
      }),
      this.prisma.extractedField.findMany({
        where: { firmId, fieldKey: { in: [...AREA_FIELD_KEYS] }, state: { not: 'UNKNOWN' }, document: { propertyId: assignment.propertyId } },
        select: { fieldKey: true, extractedValue: true, verifiedValue: true, state: true, pageNumber: true, document: { select: { fileName: true } } },
        take: 200,
      }),
      this.prisma.discrepancy.count({ where: { assignmentId, firmId, material: true, status: { in: ['UNRESOLVED', 'ESCALATED'] } } }),
      this.prisma.discrepancy.findMany({ where: { assignmentId, firmId, status: { in: ['RESOLVED', 'DISCLOSED'] } }, select: { fieldKey: true, status: true, description: true, resolutionNote: true }, take: 20 }),
      this.prisma.marketComparable.count({ where: { assignmentId, firmId, verified: true } }),
      this.prisma.valuationVersion.findFirst({
        where: { assignmentId, firmId, status: { not: 'SUPERSEDED' } },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true, status: true, inputs: true, lineItems: { select: { treatment: true } } },
      }),
    ]);

    const documented = fields.flatMap((f) => {
      const value = Number(f.verifiedValue ?? f.extractedValue);
      return Number.isFinite(value) && value > 0 ? [{ fieldKey: f.fieldKey, value, state: f.state, source: `${f.document.fileName} p.${f.pageNumber}` }] : [];
    });
    const measured = (inspection?.measurements ?? []).map((m) => ({ label: m.label, fieldKey: m.fieldKey, value: Number(m.areaSqm), method: m.method }));
    const candidates = [
      ...measured.map((m) => {
        const refs = documented.filter((d) => d.fieldKey === m.fieldKey);
        const nearest = refs.length ? refs.reduce((b, d) => (Math.abs(d.value - m.value) < Math.abs(b.value - m.value) ? d : b)) : null;
        const withinTolerance = nearest ? (Math.abs(m.value - nearest.value) / nearest.value) * 100 <= AREA_TOLERANCE_PERCENT : null;
        return { kind: 'MEASURED' as const, label: m.label, fieldKey: m.fieldKey, factLabel: m.fieldKey ? factLabel(m.fieldKey) : null, areaSqm: m.value, source: `Site visit ${inspection?.visitedAt.toISOString().slice(0, 10)} by ${inspection?.inspector.fullName}, ${m.method}`, withinTolerance };
      }),
      ...documented.map((d) => ({ kind: 'DOCUMENTED' as const, label: factLabel(d.fieldKey), fieldKey: d.fieldKey, factLabel: factLabel(d.fieldKey), areaSqm: d.value, source: `${d.source}${d.state === 'UNVERIFIED' ? ' (not yet verified)' : ''}`, withinTolerance: null })),
    ];

    const inputs = (latest?.inputs ?? {}) as { comparableIds?: string[] };
    const readiness = assessValuationReadiness({
      inspectionSubmitted: !!inspection,
      latest: latest ? { versionNumber: latest.versionNumber, status: latest.status, unsettledItems: latest.lineItems.filter((l) => l.treatment === 'REQUIRES_REVIEW').length, citedComparables: inputs.comparableIds?.length ?? 0 } : null,
      openMaterialDiscrepancies: open,
      verifiedComparables: comparables,
      minComparables: 3,
    });
    return {
      status: assignment.status,
      propertyClass: assignment.property.propertyClass,
      site: inspection ? { visitedAt: inspection.visitedAt, status: inspection.status, inspector: inspection.inspector.fullName, observations: inspection.observations } : null,
      candidates,
      openMaterialDiscrepancies: open,
      disclosed,
      readiness,
    };
  }

  async create(firmId: string, actorId: string, assignmentId: string, dto: CreateValuationDto) {
    const assignment = await this.loadAssignment(firmId, assignmentId);
    if (!(DRAFTABLE_STATUSES as readonly string[]).includes(assignment.status)) {
      throw new ConflictException(`Valuations can only be drafted while the assignment is in VALUATION or REVISION, not ${assignment.status}`);
    }
    const { changeReason, ...input } = dto;
    const result = this.calculate(assignment.propertyClass, input);
    await this.requireVerifiedComparables(firmId, assignmentId, input.comparableIds);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const latest = await tx.valuationVersion.aggregate({ where: { assignmentId }, _max: { versionNumber: true } });
        const versionNumber = (latest._max.versionNumber ?? 0) + 1;
        if (versionNumber > 1 && !changeReason) {
          throw new BadRequestException('changeReason is required when revising an existing valuation');
        }

        // Unapproved drafts are replaced; an approved version stays in force
        // until its successor is approved.
        await tx.valuationVersion.updateMany({
          where: { assignmentId, firmId, status: { in: ['DRAFT', 'IN_REVIEW'] } },
          data: { status: 'SUPERSEDED' },
        });

        const created = await tx.valuationVersion.create({
          data: {
            firmId,
            assignmentId,
            versionNumber,
            method: result.method,
            engineVersion: result.engineVersion,
            areaBasis: result.areaBasis,
            adoptedAreaSqm: result.adoptedAreaSqm,
            adoptedAreaSource: input.areaSource,
            assumptions: input.assumptions,
            totalValue: result.totalValue,
            changeReason,
            inputs: input as unknown as Prisma.InputJsonObject,
            createdById: actorId,
            lineItems: {
              create: result.lines.map((line, index) => ({
                sortOrder: index,
                component: line.component,
                quantity: line.quantity,
                unit: line.unit,
                rate: line.rate,
                amount: line.amount,
                treatment: line.treatment,
                sourceNote: line.sourceNote,
                overrideReason: line.overrideReason,
              })),
            },
          },
          select: valuationSelect,
        });
        await this.audit.record(
          {
            firmId,
            actorId,
            entityType: 'ValuationVersion',
            entityId: created.id,
            action: 'valuation.drafted',
            metadata: { versionNumber, totalValue: result.totalValue, engineVersion: result.engineVersion },
          },
          tx,
        );
        return { valuation: created, warnings: await this.warnings(firmId, assignmentId, tx) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Another version was created at the same time; reload and retry');
      }
      throw error;
    }
  }

  async list(firmId: string, assignmentId: string) {
    await this.loadAssignment(firmId, assignmentId);
    return this.prisma.valuationVersion.findMany({
      where: { assignmentId, firmId },
      select: valuationSelect,
      orderBy: { versionNumber: 'desc' },
      take: MAX_VERSIONS_LISTED,
    });
  }

  async submitForReview(firmId: string, actorId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const version = await this.loadVersion(tx, firmId, id);
      if (version.status !== 'DRAFT') throw new ConflictException(`Only a DRAFT can be sent for review, not ${version.status}`);

      const unsettled = version.lineItems.filter((line) => line.treatment === 'REQUIRES_REVIEW');
      if (unsettled.length > 0) {
        throw new ConflictException(
          `Settle these items before review (included in base rate, separately valued, or not applicable): ${unsettled.map((l) => l.component).join(', ')}`,
        );
      }
      return this.transition(tx, firmId, actorId, id, 'DRAFT', 'IN_REVIEW', 'valuation.sent_for_review');
    });
  }

  async approve(firmId: string, actor: { userId: string; role: string }, id: string) {
    const actorId = actor.userId;
    return this.prisma.$transaction(async (tx) => {
      const version = await this.loadVersion(tx, firmId, id);
      if (version.status !== 'IN_REVIEW') throw new ConflictException(`Only a version IN_REVIEW can be approved, not ${version.status}`);
      // Four-eyes: whoever drafted a valuation cannot approve it, except a
      // firm admin (so a one-person firm can still work).
      if (version.createdById === actorId && actor.role !== 'FIRM_ADMIN') {
        throw new ForbiddenException('A valuation must be approved by someone other than its author');
      }

      await tx.valuationVersion.updateMany({
        where: { assignmentId: version.assignmentId, firmId, status: 'APPROVED', id: { not: id } },
        data: { status: 'SUPERSEDED' },
      });
      return this.transition(tx, firmId, actorId, id, 'IN_REVIEW', 'APPROVED', 'valuation.approved', {
        approvedById: actorId,
        approvedAt: new Date(),
      });
    });
  }

  private calculate(propertyClass: string, input: EngineInput): EngineResult {
    const engine = engineFor(propertyClass);
    if (!engine) {
      throw new BadRequestException(
        `No valuation engine for ${propertyClass} yet; available: ${SUPPORTED_CLASSES.join(', ')}`,
      );
    }
    try {
      return engine(input);
    } catch (error) {
      if (error instanceof EngineInputError) {
        throw new BadRequestException({ message: error.problems, error: 'Bad Request', statusCode: 400 });
      }
      throw error;
    }
  }

  // Comparables cited as evidence must belong to this assignment and have been
  // verified by a person.
  private async requireVerifiedComparables(firmId: string, assignmentId: string, ids: string[] | undefined) {
    if (!ids?.length) return;
    const found = await this.prisma.marketComparable.findMany({
      where: { id: { in: ids }, firmId, assignmentId },
      select: { id: true, verified: true },
    });
    if (found.length !== new Set(ids).size) throw new BadRequestException('A cited comparable does not belong to this assignment');
    if (found.some((c) => !c.verified)) throw new BadRequestException('Only verified comparables can be cited as evidence');
  }

  private async loadAssignment(firmId: string, id: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id, firmId },
      select: { status: true, property: { select: { propertyClass: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return { status: assignment.status, propertyClass: assignment.property.propertyClass };
  }

  private async loadVersion(tx: Prisma.TransactionClient, firmId: string, id: string) {
    const version = await tx.valuationVersion.findFirst({
      where: { id, firmId },
      select: { assignmentId: true, status: true, createdById: true, lineItems: { select: { component: true, treatment: true } } },
    });
    if (!version) throw new NotFoundException('Valuation not found');
    return version;
  }

  // Compare-and-set so two reviewers cannot both move the same version.
  private async transition(
    tx: Prisma.TransactionClient,
    firmId: string,
    actorId: string,
    id: string,
    from: 'DRAFT' | 'IN_REVIEW',
    to: 'IN_REVIEW' | 'APPROVED',
    action: string,
    extra: Prisma.ValuationVersionUpdateManyMutationInput = {},
  ) {
    const { count } = await tx.valuationVersion.updateMany({
      where: { id, firmId, status: from },
      data: { status: to, ...extra },
    });
    if (count !== 1) throw new ConflictException('Valuation changed concurrently; reload and retry');
    await this.audit.record({ firmId, actorId, entityType: 'ValuationVersion', entityId: id, action, metadata: { from, to } }, tx);
    return tx.valuationVersion.findUniqueOrThrow({ where: { id }, select: valuationSelect });
  }

  // Non-blocking reminders shown beside the numbers.
  private async warnings(firmId: string, assignmentId: string, tx: Prisma.TransactionClient = this.prisma) {
    const open = await tx.discrepancy.count({
      where: { assignmentId, firmId, material: true, status: { in: ['UNRESOLVED', 'ESCALATED'] } },
    });
    return open > 0
      ? [`${open} material discrepanc${open === 1 ? 'y is' : 'ies are'} still unresolved; the adopted area must be justified in the area source`]
      : [];
  }
}
