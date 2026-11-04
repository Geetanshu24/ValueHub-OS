import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { formatQueryCode, type Paginated } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { skipTake } from '../../common/pagination/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IdsService } from '../ids/ids.service.js';
import type { CreateQueryDto, EscalateDto, ListQueriesQuery, RespondDto } from './queries.dto.js';

const querySelect = {
  id: true,
  assignmentId: true,
  code: true,
  kind: true,
  question: true,
  receivedAt: true,
  dueAt: true,
  status: true,
  evidence: true,
  response: true,
  respondedAt: true,
  responseSentTo: true,
  responseDelivery: true,
  escalatedAt: true,
  escalationNote: true,
  assignment: { select: { code: true, property: { select: { addressLine: true } } } },
} satisfies Prisma.BankQuerySelect;

@Injectable()
export class QueriesService {
  private readonly logger = new Logger(QueriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async list(firmId: string, query: ListQueriesQuery): Promise<Paginated<unknown>> {
    const where: Prisma.BankQueryWhereInput = {
      firmId,
      ...(query.status && { status: query.status }),
      ...(query.assignmentId && { assignmentId: query.assignmentId }),
      ...(query.overdue && { status: 'OPEN', dueAt: { lt: new Date() } }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bankQuery.findMany({ where, select: querySelect, orderBy: [{ dueAt: 'asc' }], ...skipTake(query) }),
      this.prisma.bankQuery.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  // A revision request on a submitted assignment reopens it as a revision, so
  // the corrected valuation and report get new versions rather than edits.
  async create(firmId: string, actorId: string, assignmentId: string, dto: CreateQueryDto) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { status: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.status === 'CANCELLED') throw new ConflictException('A cancelled assignment cannot take queries');
    const dueAt = new Date(dto.dueAt);
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    if (dueAt < receivedAt) throw new BadRequestException('dueAt cannot be before the query was received');
    if (dto.kind === 'REVISION_REQUEST' && !['SUBMITTED', 'CLOSED'].includes(assignment.status)) {
      throw new ConflictException(`A revision can only be requested after submission, not while ${assignment.status}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const code = formatQueryCode(new Date().getFullYear(), await this.ids.nextValue(tx, firmId, `Q-${new Date().getFullYear()}`));
      const created = await tx.bankQuery.create({
        data: { firmId, assignmentId, code, kind: dto.kind, question: dto.question, dueAt, receivedAt, createdById: actorId },
        select: querySelect,
      });
      await this.audit.record({ firmId, actorId, entityType: 'BankQuery', entityId: created.id, action: 'query.received', metadata: { code, kind: dto.kind } }, tx);

      if (dto.kind === 'REVISION_REQUEST' && assignment.status === 'SUBMITTED') {
        await tx.assignment.updateMany({ where: { id: assignmentId, firmId, status: 'SUBMITTED' }, data: { status: 'REVISION' } });
        await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: 'assignment.status_changed', metadata: { from: 'SUBMITTED', to: 'REVISION', via: code } }, tx);
      }
      return created;
    });
  }

  async escalate(firmId: string, actorId: string, id: string, dto: EscalateDto) {
    const existing = await this.requireQuery(firmId, id);
    if (existing.status !== 'OPEN') throw new ConflictException('Only an open query can be escalated');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bankQuery.update({ where: { id }, data: { escalatedAt: new Date(), escalatedById: actorId, escalationNote: dto.note }, select: querySelect });
      await this.audit.record({ firmId, actorId, entityType: 'BankQuery', entityId: id, action: 'query.escalated' }, tx);
      return updated;
    });
  }

  // Records the answer and the evidence behind it. If asked, also emails it;
  // the result of that send is stored as SENT or FAILED, never as "delivered".
  async respond(firmId: string, actorId: string, id: string, dto: RespondDto) {
    const existing = await this.requireQuery(firmId, id);
    if (existing.status !== 'OPEN') throw new ConflictException(`Only an OPEN query can be answered, not ${existing.status}`);
    if (dto.sendTo && !this.mail.isConfigured) throw new ConflictException('Email is not configured on this server');
    await this.requireEvidence(firmId, existing.assignmentId, dto.evidence ?? []);

    let delivery: 'SENT' | 'FAILED' | undefined;
    if (dto.sendTo) {
      try {
        await this.mail.send({ to: dto.sendTo, subject: `Response to query ${existing.code}`, text: dto.response });
        delivery = 'SENT';
      } catch (error) {
        delivery = 'FAILED';
        this.logger.warn(`Query response email failed for ${existing.code}: ${(error as Error).message}`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.bankQuery.updateMany({
        where: { id, firmId, status: 'OPEN' },
        data: {
          status: 'RESPONDED',
          response: dto.response,
          respondedAt: new Date(),
          respondedById: actorId,
          evidence: (dto.evidence ?? []) as unknown as Prisma.InputJsonArray,
          responseSentTo: dto.sendTo,
          responseDelivery: delivery,
        },
      });
      if (count !== 1) throw new ConflictException('Query changed concurrently; reload and retry');
      await this.audit.record({ firmId, actorId, entityType: 'BankQuery', entityId: id, action: 'query.responded', metadata: { delivery: delivery ?? 'RECORDED' } }, tx);
      return tx.bankQuery.findUniqueOrThrow({ where: { id }, select: querySelect });
    });
  }

  async close(firmId: string, actorId: string, id: string) {
    const existing = await this.requireQuery(firmId, id);
    if (existing.status !== 'RESPONDED') throw new ConflictException('Respond to the query before closing it');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bankQuery.update({ where: { id }, data: { status: 'CLOSED' }, select: querySelect });
      await this.audit.record({ firmId, actorId, entityType: 'BankQuery', entityId: id, action: 'query.closed' }, tx);
      return updated;
    });
  }

  private async requireQuery(firmId: string, id: string) {
    const query = await this.prisma.bankQuery.findFirst({ where: { id, firmId }, select: { status: true, code: true, assignmentId: true } });
    if (!query) throw new NotFoundException('Query not found');
    return query;
  }

  // Every cited item must belong to the same assignment.
  private async requireEvidence(firmId: string, assignmentId: string, evidence: { type: string; id: string }[]) {
    for (const item of evidence) {
      const found = await this.exists(firmId, assignmentId, item.type, item.id);
      if (!found) throw new BadRequestException(`Evidence ${item.type} ${item.id} does not belong to this assignment`);
    }
  }

  private async exists(firmId: string, assignmentId: string, type: string, id: string): Promise<boolean> {
    switch (type) {
      case 'document':
        return (await this.prisma.document.count({ where: { id, firmId, property: { assignments: { some: { id: assignmentId } } } } })) > 0;
      case 'report':
        return (await this.prisma.reportVersion.count({ where: { id, firmId, assignmentId } })) > 0;
      case 'valuation':
        return (await this.prisma.valuationVersion.count({ where: { id, firmId, assignmentId } })) > 0;
      case 'inspection':
        return (await this.prisma.inspection.count({ where: { id, firmId, assignmentId } })) > 0;
      case 'photo':
        return (await this.prisma.inspectionPhoto.count({ where: { id, inspection: { firmId, assignmentId } } })) > 0;
      case 'comparable':
        return (await this.prisma.marketComparable.count({ where: { id, firmId, assignmentId } })) > 0;
      default:
        return false;
    }
  }
}
