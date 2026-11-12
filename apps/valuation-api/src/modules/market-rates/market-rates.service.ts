import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Paginated } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { skipTake } from '../../common/pagination/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ComparablesService } from '../comparables/comparables.service.js';
import type { CreateMarketRateDto, ListMarketRatesQuery, TrendQuery } from './market-rates.dto.js';
import { monthlyTrend, perSqm, perSqft, summarisePlaces, type RateUnit } from './rates.js';

const select = { id: true, locality: true, propertyClass: true, kind: true, rate: true, unit: true, ratePerSqm: true, rateLow: true, rateHigh: true, observedOn: true, source: true, detail: true, createdAt: true } satisfies Prisma.MarketRateSelect;

@Injectable()
export class MarketRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly comparables: ComparablesService,
  ) {}

  async list(firmId: string, query: ListMarketRatesQuery): Promise<Paginated<unknown>> {
    const where: Prisma.MarketRateWhereInput = {
      firmId,
      ...(query.propertyClass && { propertyClass: query.propertyClass }),
      ...(query.kind && { kind: query.kind }),
      ...(query.q && { OR: [{ locality: { contains: query.q, mode: 'insensitive' } }, { source: { contains: query.q, mode: 'insensitive' } }, { detail: { contains: query.q, mode: 'insensitive' } }] }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.marketRate.findMany({ where, select, orderBy: [{ observedOn: 'desc' }, { createdAt: 'desc' }], ...skipTake(query) }),
      this.prisma.marketRate.count({ where }),
    ]);
    return { items: rows.map((r) => ({ ...r, ratePerSqft: perSqft(Number(r.ratePerSqm)) })), total, page: query.page, pageSize: query.pageSize };
  }

  async localities(firmId: string) {
    const rows = await this.prisma.marketRate.groupBy({ by: ['locality'], where: { firmId }, _count: { _all: true }, orderBy: { _count: { locality: 'desc' } }, take: 100 });
    return rows.map((r) => ({ locality: r.locality, count: r._count._all }));
  }

  // One card per place: how many rates, how fresh, the range seen and the middle rate, all per sq ft.
  async summary(firmId: string) {
    const rows = await this.prisma.marketRate.findMany({ where: { firmId }, select: { locality: true, propertyClass: true, ratePerSqm: true, observedOn: true, kind: true }, orderBy: { observedOn: 'desc' }, take: 5000 });
    return { total: rows.length, places: summarisePlaces(rows.map((r) => ({ ...r, ratePerSqm: Number(r.ratePerSqm) }))).slice(0, 12) };
  }

  async trend(firmId: string, query: TrendQuery) {
    const rows = await this.prisma.marketRate.findMany({
      where: { firmId, locality: query.locality, kind: { not: 'CIRCLE' }, ...(query.propertyClass && { propertyClass: query.propertyClass }) },
      select: { observedOn: true, ratePerSqm: true },
      orderBy: { observedOn: 'desc' },
      take: 2000,
    });
    return { locality: query.locality, points: monthlyTrend(rows.map((r) => ({ observedOn: r.observedOn, ratePerSqm: Number(r.ratePerSqm) }))) };
  }

  async create(firmId: string, actorId: string, dto: CreateMarketRateDto) {
    const observedOn = new Date(dto.observedOn);
    if (observedOn > new Date()) throw new BadRequestException('The date cannot be in the future');
    const row = await this.prisma.marketRate.create({
      data: { firmId, locality: dto.locality.trim(), propertyClass: dto.propertyClass, kind: dto.kind, rate: dto.rate, unit: dto.unit, ratePerSqm: perSqm(dto.rate, dto.unit as RateUnit), rateLow: dto.rateLow ?? null, rateHigh: dto.rateHigh ?? null, observedOn, source: dto.source.trim(), detail: dto.detail?.trim() || null, recordedById: actorId },
      select,
    });
    await this.audit.record({ firmId, actorId, entityType: 'MarketRate', entityId: row.id, action: 'market_rate.added' });
    return { ...row, ratePerSqft: perSqft(Number(row.ratePerSqm)) };
  }

  // Copies a rate from the bank into an assignment as comparable evidence. The bank entry itself is untouched.
  async useIn(firmId: string, actorId: string, id: string, assignmentId: string) {
    const rate = await this.prisma.marketRate.findFirst({ where: { id, firmId }, select: { locality: true, kind: true, ratePerSqm: true, observedOn: true, source: true, detail: true, propertyClass: true } });
    if (!rate) throw new NotFoundException('Rate not found');
    return this.comparables.create(firmId, actorId, assignmentId, {
      location: rate.locality,
      source: `Rate bank: ${rate.source}`,
      isTransaction: rate.kind === 'TRANSACTION',
      observedOn: rate.observedOn.toISOString().slice(0, 10),
      areaBasis: rate.propertyClass === 'LAND' ? 'LAND' : 'BUILT_UP',
      ratePerSqm: Number(rate.ratePerSqm),
      relevanceNote: rate.detail ?? undefined,
    } as never);
  }
}
