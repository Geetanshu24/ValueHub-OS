import { BadRequestException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { diffSnapshots, diffValuations, type SnapshotLike, type ValuationLike } from './diff.js';

export class CompareQuery {
  @Type(() => Number) @IsInt() @Min(1) from!: number;
  @Type(() => Number) @IsInt() @Min(1) to!: number;
}

@Controller()
export class RevisionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('assignments/:assignmentId/valuations/compare')
  async compareValuations(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Query() query: CompareQuery) {
    if (query.from === query.to) throw new BadRequestException('Pick two different versions');
    const rows = await this.prisma.valuationVersion.findMany({
      where: { assignmentId, firmId: user.firmId, versionNumber: { in: [query.from, query.to] } },
      include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
    });
    const pick = (n: number) => {
      const row = rows.find((r) => r.versionNumber === n);
      if (!row) throw new NotFoundException(`Valuation version ${n} not found`);
      return {
        versionNumber: row.versionNumber,
        status: row.status,
        method: row.method,
        areaBasis: row.areaBasis,
        adoptedAreaSqm: Number(row.adoptedAreaSqm),
        adoptedAreaSource: row.adoptedAreaSource,
        assumptions: row.assumptions,
        totalValue: Number(row.totalValue),
        changeReason: row.changeReason,
        lines: row.lineItems.map((l) => ({ component: l.component, quantity: Number(l.quantity), unit: l.unit, rate: Number(l.rate), amount: Number(l.amount), treatment: l.treatment, sourceNote: l.sourceNote })),
      } satisfies ValuationLike;
    };
    return diffValuations(pick(query.from), pick(query.to));
  }

  @Get('assignments/:assignmentId/reports/compare')
  async compareReports(@CurrentUser() user: AuthUser, @Param('assignmentId', ParseUUIDPipe) assignmentId: string, @Query() query: CompareQuery) {
    if (query.from === query.to) throw new BadRequestException('Pick two different versions');
    const rows = await this.prisma.reportVersion.findMany({
      where: { assignmentId, firmId: user.firmId, versionNumber: { in: [query.from, query.to] } },
      select: { versionNumber: true, status: true, changeReason: true, snapshot: true },
    });
    const pick = (n: number) => {
      const row = rows.find((r) => r.versionNumber === n);
      if (!row) throw new NotFoundException(`Report version ${n} not found`);
      return row;
    };
    const a = pick(query.from);
    const b = pick(query.to);
    return { fromVersion: a.versionNumber, toVersion: b.versionNumber, changeReason: b.changeReason, ...diffSnapshots(a.snapshot as unknown as SnapshotLike, b.snapshot as unknown as SnapshotLike) };
  }
}
