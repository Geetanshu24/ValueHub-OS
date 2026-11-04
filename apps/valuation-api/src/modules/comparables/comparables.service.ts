import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateComparableDto } from './comparables.dto.js';

const comparableSelect = {
  id: true,
  assignmentId: true,
  location: true,
  source: true,
  isTransaction: true,
  observedOn: true,
  areaBasis: true,
  ratePerSqm: true,
  adjustments: true,
  verified: true,
  relevanceNote: true,
  createdAt: true,
} satisfies Prisma.MarketComparableSelect;

const MAX_COMPARABLES = 100;

@Injectable()
export class ComparablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(firmId: string, assignmentId: string) {
    await this.requireAssignment(firmId, assignmentId);
    return this.prisma.marketComparable.findMany({
      where: { assignmentId, firmId },
      select: comparableSelect,
      orderBy: { observedOn: 'desc' },
      take: MAX_COMPARABLES,
    });
  }

  // Range and median of the verified rates, per area basis. A guide only: the
  // valuer still chooses and justifies the rate.
  async summary(firmId: string, assignmentId: string) {
    await this.requireAssignment(firmId, assignmentId);
    const rows = await this.prisma.marketComparable.findMany({
      where: { assignmentId, firmId, verified: true },
      select: { areaBasis: true, ratePerSqm: true },
      take: MAX_COMPARABLES,
    });
    const byBasis = new Map<string, number[]>();
    for (const row of rows) byBasis.set(row.areaBasis, [...(byBasis.get(row.areaBasis) ?? []), Number(row.ratePerSqm)]);
    return [...byBasis].map(([areaBasis, rates]) => {
      const sorted = [...rates].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return { areaBasis, count: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], median };
    });
  }

  async create(firmId: string, actorId: string, assignmentId: string, dto: CreateComparableDto) {
    const assignment = await this.requireAssignment(firmId, assignmentId);
    if (assignment.status === 'CLOSED' || assignment.status === 'CANCELLED') {
      throw new ConflictException(`Cannot add evidence to a ${assignment.status} assignment`);
    }
    const observedOn = new Date(dto.observedOn);
    if (observedOn > new Date()) throw new BadRequestException('observedOn cannot be in the future');

    return this.prisma.$transaction(async (tx) => {
      const count = await tx.marketComparable.count({ where: { assignmentId } });
      if (count >= MAX_COMPARABLES) throw new BadRequestException('Too many comparables on this assignment');

      const row = await tx.marketComparable.create({
        data: {
          firmId,
          assignmentId,
          location: dto.location,
          source: dto.source,
          isTransaction: dto.isTransaction,
          observedOn,
          areaBasis: dto.areaBasis,
          ratePerSqm: dto.ratePerSqm,
          adjustments: dto.adjustments as Prisma.InputJsonObject | undefined,
          relevanceNote: dto.relevanceNote,
          recordedById: actorId,
        },
        select: comparableSelect,
      });
      await this.audit.record({ firmId, actorId, entityType: 'MarketComparable', entityId: row.id, action: 'comparable.added' }, tx);
      return row;
    });
  }

  // Whoever recorded a comparable should not be the only one to vouch for it,
  // so verification by its recorder is limited to firm admins.
  async setVerified(firmId: string, actor: { userId: string; role: string }, id: string, verified: boolean) {
    const found = await this.prisma.marketComparable.findFirst({ where: { id, firmId }, select: { recordedById: true } });
    if (!found) throw new NotFoundException('Comparable not found');
    if (verified && found.recordedById === actor.userId && actor.role !== 'FIRM_ADMIN') {
      throw new ForbiddenException('A comparable must be verified by someone other than whoever recorded it');
    }

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.marketComparable.update({ where: { id }, data: { verified }, select: comparableSelect });
      await this.audit.record({ firmId, actorId: actor.userId, entityType: 'MarketComparable', entityId: id, action: verified ? 'comparable.verified' : 'comparable.unverified' }, tx);
      return row;
    });
  }

  private async requireAssignment(firmId: string, id: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id, firmId }, select: { status: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return assignment;
  }
}
