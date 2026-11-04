import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canTransition,
  type AssignmentStatus,
  type Paginated,
} from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { skipTake } from '../../common/pagination/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { unmetGates } from './assignment-gates.js';
import { AREA_FIELD_KEYS, MIN_OBSERVATIONS, MIN_PHOTOS, countObservations } from '@value-hub/valuation-shared';
import { assessInspectionReadiness, assessReadiness, assessReviewReadiness, assessSubmissionReadiness } from './readiness.js';
import { MailService } from '../../common/mail/mail.service.js';
import { IdsService } from '../ids/ids.service.js';
import type { CreateAssignmentDto, ListAssignmentsQuery, UpdateAssignmentDto } from './assignments.dto.js';

const assignmentSelect = {
  id: true,
  code: true,
  purpose: true,
  scope: true,
  valuationDate: true,
  dueDate: true,
  receivedAt: true,
  intakeSource: true,
  priority: true,
  borrowerName: true,
  instructionDate: true,
  reusedFromId: true,
  fee: true,
  status: true,
  bank: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  property: { select: { id: true, code: true, addressLine: true, propertyClass: true } },
  assignedValuer: { select: { id: true, fullName: true } },
} satisfies Prisma.AssignmentSelect;

// No further work is due once an assignment reaches one of these.
const DONE_STATUSES = ['SUBMITTED', 'CLOSED', 'CANCELLED'] as const;
const startOfToday = () => new Date(new Date().toDateString());

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async list(firmId: string, query: ListAssignmentsQuery): Promise<Paginated<unknown>> {
    const q = query.q?.trim();
    const where: Prisma.AssignmentWhereInput = {
      firmId,
      ...(query.status && { status: query.status }),
      ...(query.bankId && { bankId: query.bankId }),
      ...(query.propertyId && { propertyId: query.propertyId }),
      ...(query.assignedValuerId && { assignedValuerId: query.assignedValuerId }),
      ...(q && { code: { contains: q, mode: 'insensitive' } }),
      ...((query.overdue || query.dueFrom || query.dueTo) && {
        dueDate: {
          ...(query.overdue && { lt: startOfToday() }),
          ...(query.dueFrom && { gte: new Date(query.dueFrom) }),
          ...(query.dueTo && { lte: new Date(query.dueTo) }),
        },
      }),
      ...(query.overdue && !query.status && { status: { notIn: [...DONE_STATUSES] } }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.assignment.findMany({
        where,
        select: assignmentSelect,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        ...skipTake(query),
      }),
      this.prisma.assignment.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  // The most specific fee rule in force on the valuation date, if the firm has
  // set any: bank + class, then bank, then class, then a general rule.
  private async defaultFee(firmId: string, bankId: string, propertyClass: string, on: Date): Promise<number | undefined> {
    const rules = await this.prisma.feeRule.findMany({
      where: { firmId, effectiveFrom: { lte: on }, AND: [{ OR: [{ bankId: null }, { bankId }] }, { OR: [{ propertyClass: null }, { propertyClass: propertyClass as never }] }] },
      orderBy: { effectiveFrom: 'desc' },
      take: 50,
    });
    const rank = (r: (typeof rules)[number]) => (r.bankId ? 2 : 0) + (r.propertyClass ? 1 : 0);
    const best = [...rules].sort((a, b) => rank(b) - rank(a) || b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
    return best ? Number(best.amount) : undefined;
  }

  async get(firmId: string, id: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id, firmId }, select: assignmentSelect });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return assignment;
  }

  // How ready the property file is for site inspection. Documents belong to
  // the property, so earlier work on the same property counts.
  async readiness(firmId: string, id: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id, firmId },
      select: { propertyId: true, property: { select: { propertyClass: true, addressLine: true, locality: true, district: true, state: true, pinCode: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const [documents, fields] = await Promise.all([
      this.prisma.document.findMany({ where: { firmId, propertyId: assignment.propertyId }, select: { type: true } }),
      this.prisma.extractedField.findMany({
        where: { firmId, document: { propertyId: assignment.propertyId } },
        select: { documentId: true, fieldKey: true, state: true, extractedValue: true, verifiedValue: true },
        take: 1000,
      }),
    ]);
    return assessReadiness({
      propertyClass: assignment.property.propertyClass,
      property: assignment.property,
      documents,
      facts: fields.map((f) => ({ documentId: f.documentId, fieldKey: f.fieldKey, state: f.state, value: f.verifiedValue ?? f.extractedValue })),
    });
  }

  // What the inspector needs on site: the areas the documents claim (the same
  // facts the area check will compare against) and how ready the visit is.
  async inspectionContext(firmId: string, user: { userId: string; role: string }, id: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id, firmId }, select: { propertyId: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const [visits, fields, open] = await Promise.all([
      this.prisma.inspection.findMany({
        where: { assignmentId: id, firmId, ...(user.role === 'INSPECTOR' && { inspectorId: user.userId }) },
        orderBy: { visitedAt: 'desc' },
        select: {
          status: true, observations: true, latitude: true, longitude: true,
          measurements: { select: { fieldKey: true } },
          photos: { select: { captionConfirmed: true } },
        },
        take: 50,
      }),
      this.prisma.extractedField.findMany({
        where: { firmId, fieldKey: { in: [...AREA_FIELD_KEYS] }, state: { not: 'UNKNOWN' }, document: { propertyId: assignment.propertyId } },
        select: { fieldKey: true, extractedValue: true, verifiedValue: true, state: true, pageNumber: true, document: { select: { fileName: true, type: true } } },
        take: 200,
      }),
      this.prisma.discrepancy.count({ where: { assignmentId: id, firmId, material: true, status: { in: ['UNRESOLVED', 'ESCALATED'] } } }),
    ]);

    const documentedAreas = fields.flatMap((f) => {
      const value = Number(f.verifiedValue ?? f.extractedValue);
      return Number.isFinite(value) && value > 0 ? [{ fieldKey: f.fieldKey, value, state: f.state, source: `${f.document.fileName} p.${f.pageNumber}`, documentType: f.document.type }] : [];
    });
    const working = visits.find((v) => v.status !== 'SUBMITTED' && v.status !== 'REVIEWED') ?? visits[0];
    const readiness = assessInspectionReadiness({
      current: working
        ? {
            status: working.status,
            measurements: working.measurements.length,
            keyedMeasurements: working.measurements.filter((m) => m.fieldKey).length,
            photos: working.photos.length,
            unconfirmedCaptions: working.photos.filter((p) => !p.captionConfirmed).length,
            observations: countObservations(working.observations),
            hasGps: working.latitude !== null && working.longitude !== null,
          }
        : null,
      visits,
      documentedAreas: documentedAreas.length,
      openMaterialDiscrepancies: open,
      minPhotos: MIN_PHOTOS,
      minObservations: MIN_OBSERVATIONS,
    });
    return { documentedAreas, readiness };
  }

  // Where quality review stands: the valuation awaiting sign-off, the report
  // built on it, its checklist, and the checks it passed or failed.
  async reviewContext(firmId: string, id: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id, firmId }, select: { status: true, property: { select: { propertyClass: true } } } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const [valuation, report, open] = await Promise.all([
      this.prisma.valuationVersion.findFirst({
        where: { assignmentId: id, firmId },
        orderBy: { versionNumber: 'desc' },
        select: { id: true, versionNumber: true, status: true, method: true, totalValue: true, adoptedAreaSqm: true, createdById: true, approvedAt: true, createdAt: true },
      }),
      this.prisma.reportVersion.findFirst({
        where: { assignmentId: id, firmId, status: { not: 'SUPERSEDED' } },
        orderBy: { versionNumber: 'desc' },
        select: { id: true, versionNumber: true, status: true, valuationVersionId: true, qc: true, createdById: true, approvedAt: true, issuedAt: true, createdAt: true, template: { select: { name: true, version: true } } },
      }),
      this.prisma.discrepancy.count({ where: { assignmentId: id, firmId, material: true, status: { in: ['UNRESOLVED', 'ESCALATED'] } } }),
    ]);
    const [authorIds, checklist] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [valuation?.createdById, report?.createdById].filter((x): x is string => !!x) }, firmId }, select: { id: true, fullName: true } }),
      report
        ? Promise.all([
            this.prisma.checklistItem.count({ where: { firmId, isActive: true, OR: [{ propertyClass: null }, { propertyClass: assignment.property.propertyClass }] } }),
            this.prisma.reportChecklistResponse.count({ where: { reportVersionId: report.id, checked: true, item: { isActive: true, OR: [{ propertyClass: null }, { propertyClass: assignment.property.propertyClass }] } } }),
          ])
        : Promise.resolve([0, 0] as const),
    ]);
    const name = (uid?: string | null) => authorIds.find((u) => u.id === uid)?.fullName ?? null;
    const qc = report ? (report.qc as unknown as { passed: boolean }) : null;
    const readiness = assessReviewReadiness({
      valuation: valuation ? { versionNumber: valuation.versionNumber, status: valuation.status } : null,
      report: report && valuation ? { versionNumber: report.versionNumber, status: report.status, forLatestValuation: report.valuationVersionId === valuation.id, qcPassed: !!qc?.passed, checklistTotal: checklist[0], checklistDone: checklist[1] } : null,
      openMaterialDiscrepancies: open,
    });
    return {
      status: assignment.status,
      valuation: valuation ? { ...valuation, author: name(valuation.createdById) } : null,
      report: report ? { ...report, author: name(report.createdById), forLatestValuation: !!valuation && report.valuationVersionId === valuation.id } : null,
      openMaterialDiscrepancies: open,
      readiness,
    };
  }

  // The hand-over to the bank: who signed off what, the report to issue and
  // send, how deliveries went, open queries, and what closing would need.
  async submissionContext(firmId: string, id: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id, firmId }, select: { status: true, propertyId: true, retainUntil: true, closedAt: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const [valuation, report, submissions, openQueries, invoices] = await Promise.all([
      this.prisma.valuationVersion.findFirst({ where: { assignmentId: id, firmId, status: { not: 'SUPERSEDED' } }, orderBy: { versionNumber: 'desc' }, select: { id: true, versionNumber: true, status: true, totalValue: true, approvedAt: true, approvedById: true } }),
      this.prisma.reportVersion.findFirst({ where: { assignmentId: id, firmId, status: { not: 'SUPERSEDED' } }, orderBy: { versionNumber: 'desc' }, select: { id: true, versionNumber: true, status: true, approvedAt: true, reviewerId: true, issuedAt: true, issuedById: true, sha256: true, valuationVersionId: true } }),
      this.prisma.submission.findMany({ where: { assignmentId: id, firmId }, select: { deliveryStatus: true, acknowledgedAt: true } }),
      this.prisma.bankQuery.count({ where: { assignmentId: id, firmId, status: 'OPEN' } }),
      this.prisma.invoice.findMany({ where: { assignmentId: id, firmId, status: { not: 'CANCELLED' } }, select: { code: true, amount: true, status: true } }),
    ]);
    const people = await this.prisma.user.findMany({ where: { firmId, id: { in: [valuation?.approvedById, report?.reviewerId, report?.issuedById].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const who = (uid?: string | null) => people.find((p) => p.id === uid)?.fullName ?? null;
    const delivered = submissions.filter((x) => x.deliveryStatus !== 'FAILED');
    const closeProblems = assignment.status === 'SUBMITTED' ? await this.prisma.$transaction((tx) => unmetGates(tx, { firmId, assignmentId: id, propertyId: assignment.propertyId, to: 'CLOSED' })) : ['The assignment is not submitted yet'];
    const readiness = assessSubmissionReadiness({
      status: assignment.status,
      report: report ? { versionNumber: report.versionNumber, status: report.status } : null,
      submissions: { delivered: delivered.length, acknowledged: delivered.filter((x) => x.acknowledgedAt).length, failed: submissions.filter((x) => x.deliveryStatus === 'FAILED').length },
      openQueries,
      invoices: invoices.length,
      closeProblems: assignment.status === 'CLOSED' ? [] : closeProblems,
    });
    return {
      status: assignment.status,
      emailEnabled: this.mail.isConfigured,
      retainUntil: assignment.retainUntil,
      closedAt: assignment.closedAt,
      valuation: valuation ? { ...valuation, approvedBy: who(valuation.approvedById) } : null,
      report: report ? { ...report, approvedBy: who(report.reviewerId), issuedBy: who(report.issuedById), forLatestValuation: report.valuationVersionId === valuation?.id } : null,
      invoices,
      closeProblems: assignment.status === 'CLOSED' ? [] : closeProblems,
      readiness,
    };
  }

  async create(firmId: string, actorId: string, dto: CreateAssignmentDto) {
    const valuationDate = new Date(dto.valuationDate);
    const dueDate = new Date(dto.dueDate);
    if (dueDate < startOfToday()) {
      throw new BadRequestException('dueDate cannot be in the past');
    }

    // Every referenced record must belong to the caller's firm.
    const [bank, branch, property, valuer] = await Promise.all([
      this.prisma.bank.findFirst({ where: { id: dto.bankId, firmId }, select: { id: true } }),
      dto.branchId
        ? this.prisma.bankBranch.findFirst({
            where: { id: dto.branchId, firmId, bankId: dto.bankId },
            select: { id: true },
          })
        : Promise.resolve(true),
      this.prisma.property.findFirst({ where: { id: dto.propertyId, firmId }, select: { id: true, propertyClass: true } }),
      this.prisma.user.findFirst({
        where: { id: dto.assignedValuerId, firmId, isActive: true, role: { in: ['FIRM_ADMIN', 'VALUER'] } },
        select: { id: true },
      }),
    ]);
    if (!bank) throw new BadRequestException('Unknown bank');
    if (!branch) throw new BadRequestException('Branch does not belong to this bank');
    if (!property) throw new BadRequestException('Unknown property');
    if (!valuer) throw new BadRequestException('Assigned valuer must be an active valuer in this firm');
    if (dto.reusedFromId) {
      const earlier = await this.prisma.assignment.findFirst({ where: { id: dto.reusedFromId, firmId }, select: { propertyId: true } });
      if (!earlier) throw new BadRequestException('Unknown assignment to reuse');
      if (earlier.propertyId !== dto.propertyId) throw new BadRequestException('A reused assignment must be for the same property');
    }

    const fee = dto.fee ?? (await this.defaultFee(firmId, dto.bankId, property.propertyClass, valuationDate));

    return this.prisma.$transaction(async (tx) => {
      const code = await this.ids.nextAssignmentCode(tx, firmId, new Date().getFullYear());
      const assignment = await tx.assignment.create({
        data: {
          firmId,
          code,
          bankId: dto.bankId,
          branchId: dto.branchId,
          propertyId: dto.propertyId,
          assignedValuerId: dto.assignedValuerId,
          createdById: actorId,
          purpose: dto.purpose,
          scope: dto.scope,
          valuationDate,
          dueDate,
          intakeSource: dto.intakeSource,
          priority: dto.priority,
          borrowerName: dto.borrowerName?.trim() || undefined,
          instructionDate: dto.instructionDate ? new Date(dto.instructionDate) : undefined,
          reusedFromId: dto.reusedFromId,
          fee,
        },
        select: assignmentSelect,
      });
      await this.audit.record(
        { firmId, actorId, entityType: 'Assignment', entityId: assignment.id, action: 'assignment.created', metadata: { code, intakeSource: dto.intakeSource ?? 'DASHBOARD', ...(dto.reusedFromId && { reusedFromId: dto.reusedFromId }) } },
        tx,
      );
      return assignment;
    });
  }

  // Moves an assignment through the workflow gates. A move is rejected when
  // it is not an allowed transition, or when it would enter the quality gate
  // while a material discrepancy is still unresolved.
  async changeStatus(firmId: string, actorId: string, id: string, to: AssignmentStatus) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.assignment.findFirst({ where: { id, firmId }, select: { status: true, propertyId: true } });
      if (!current) throw new NotFoundException('Assignment not found');
      if (!canTransition(current.status, to)) {
        throw new BadRequestException(`Cannot move an assignment from ${current.status} to ${to}`);
      }

      const problems = await unmetGates(tx, { firmId, assignmentId: id, propertyId: current.propertyId, to });
      if (problems.length > 0) throw new ConflictException({ message: problems, error: 'Conflict', statusCode: 409 });

      // Guards against a concurrent move: only update if status is unchanged.
      let closing: { closedAt: Date; retainUntil: Date | null } | undefined;
      if (to === 'CLOSED') {
        const settings = await tx.firmSettings.findUnique({ where: { firmId }, select: { retentionYears: true } });
        const closedAt = new Date();
        const retainUntil = settings?.retentionYears ? new Date(closedAt) : null;
        retainUntil?.setFullYear(closedAt.getFullYear() + (settings?.retentionYears ?? 0));
        closing = { closedAt, retainUntil };
      }
      const { count } = await tx.assignment.updateMany({
        where: { id, firmId, status: current.status },
        data: { status: to, ...closing },
      });
      if (count !== 1) throw new ConflictException('Assignment status changed concurrently; reload and retry');

      await this.audit.record(
        {
          firmId,
          actorId,
          entityType: 'Assignment',
          entityId: id,
          action: 'assignment.status_changed',
          metadata: { from: current.status, to },
        },
        tx,
      );
      return tx.assignment.findUniqueOrThrow({ where: { id }, select: assignmentSelect });
    });
  }

  async update(firmId: string, actor: { userId: string; role: string }, id: string, dto: UpdateAssignmentDto) {
    const current = await this.prisma.assignment.findFirst({
      where: { id, firmId },
      select: { status: true, bankId: true, assignedValuerId: true, valuationDate: true, dueDate: true },
    });
    if (!current) throw new NotFoundException('Assignment not found');
    if (current.status === 'CLOSED' || current.status === 'CANCELLED') {
      throw new ConflictException(`A ${current.status} assignment cannot be edited`);
    }
    if (dto.assignedValuerId && actor.role !== 'FIRM_ADMIN') {
      throw new ForbiddenException('Only a firm admin can reallocate an assignment');
    }
    if (dto.dueDate && new Date(dto.dueDate) < startOfToday()) throw new BadRequestException('dueDate cannot be in the past');

    if (dto.valuationDate && new Date(dto.valuationDate).getTime() !== current.valuationDate.getTime()) {
      const valued = await this.prisma.valuationVersion.count({ where: { assignmentId: id, firmId } });
      if (valued > 0) throw new ConflictException('The valuation date cannot change once a valuation has been drafted');
    }
    if (dto.branchId) {
      const branch = await this.prisma.bankBranch.findFirst({ where: { id: dto.branchId, firmId, bankId: current.bankId }, select: { id: true } });
      if (!branch) throw new BadRequestException('Branch does not belong to this bank');
    }
    if (dto.assignedValuerId) {
      const valuer = await this.prisma.user.findFirst({
        where: { id: dto.assignedValuerId, firmId, isActive: true, role: { in: ['FIRM_ADMIN', 'VALUER'] } },
        select: { id: true },
      });
      if (!valuer) throw new BadRequestException('Assigned valuer must be an active valuer in this firm');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.update({
        where: { id },
        data: {
          purpose: dto.purpose,
          scope: dto.scope,
          valuationDate: dto.valuationDate ? new Date(dto.valuationDate) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          branchId: dto.branchId,
          priority: dto.priority,
          borrowerName: dto.borrowerName?.trim() || undefined,
          assignedValuerId: dto.assignedValuerId,
          fee: dto.fee,
        },
        select: assignmentSelect,
      });
      await this.audit.record(
        {
          firmId,
          actorId: actor.userId,
          entityType: 'Assignment',
          entityId: id,
          action: dto.assignedValuerId && dto.assignedValuerId !== current.assignedValuerId ? 'assignment.reallocated' : 'assignment.updated',
          metadata: { fields: Object.keys(dto), previousValuerId: current.assignedValuerId },
        },
        tx,
      );
      return updated;
    });
  }
}
