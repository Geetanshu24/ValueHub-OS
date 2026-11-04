import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Paginated } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { skipTake } from '../../common/pagination/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IdsService } from '../ids/ids.service.js';
import type { BoundariesDto, CreatePropertyDto, ListPropertiesQuery, UpdatePropertyDto } from './properties.dto.js';

const propertySelect = {
  id: true,
  code: true,
  propertyClass: true,
  addressLine: true,
  unitDetail: true,
  locality: true,
  village: true,
  tehsil: true,
  district: true,
  state: true,
  pinCode: true,
  latitude: true,
  longitude: true,
  khasraNumbers: true,
  boundaries: true,
  createdAt: true,
} satisfies Prisma.PropertySelect;

// Only the four sides are stored, and a side left blank is dropped.
function toBoundaries(value: BoundariesDto | undefined): Prisma.InputJsonObject | undefined {
  if (!value) return undefined;
  const kept = Object.entries({ north: value.north, south: value.south, east: value.east, west: value.west }).filter(([, side]) => side?.trim());
  return Object.fromEntries(kept.map(([key, side]) => [key, side!.trim()]));
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdsService,
    private readonly audit: AuditService,
  ) {}

  async list(firmId: string, query: ListPropertiesQuery): Promise<Paginated<unknown>> {
    const q = query.q?.trim();
    const where: Prisma.PropertyWhereInput = {
      firmId,
      ...(query.propertyClass && { propertyClass: query.propertyClass }),
      ...(query.state && { state: { contains: query.state.trim(), mode: 'insensitive' } }),
      ...(query.district && { district: { contains: query.district.trim(), mode: 'insensitive' } }),
      ...(query.locality && { locality: { contains: query.locality.trim(), mode: 'insensitive' } }),
      ...(q && {
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { addressLine: { contains: q, mode: 'insensitive' } },
          { locality: { contains: q, mode: 'insensitive' } },
          { village: { contains: q, mode: 'insensitive' } },
          { district: { contains: q, mode: 'insensitive' } },
          { khasraNumbers: { has: q } },
        ],
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.property.findMany({
        where,
        select: propertySelect,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.property.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async get(firmId: string, id: string) {
    const property = await this.prisma.property.findFirst({ where: { id, firmId }, select: propertySelect });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  create(firmId: string, actorId: string, dto: CreatePropertyDto) {
    return this.prisma.$transaction(async (tx) => {
      const code = await this.ids.nextPropertyCode(tx, firmId);
      const property = await tx.property.create({ data: { ...dto, boundaries: toBoundaries(dto.boundaries), firmId, code }, select: propertySelect });
      await this.audit.record(
        { firmId, actorId, entityType: 'Property', entityId: property.id, action: 'property.created', metadata: { code } },
        tx,
      );
      return property;
    });
  }

  // Identity fixes only. Changing the class once a valuation exists would
  // silently reinterpret numbers produced by another engine, so it is refused.
  async update(firmId: string, actorId: string, id: string, dto: UpdatePropertyDto) {
    const current = await this.prisma.property.findFirst({ where: { id, firmId }, select: { propertyClass: true } });
    if (!current) throw new NotFoundException('Property not found');

    if (dto.propertyClass && dto.propertyClass !== current.propertyClass) {
      const valued = await this.prisma.valuationVersion.count({ where: { firmId, assignment: { propertyId: id } } });
      if (valued > 0) throw new ConflictException('Property class cannot change after a valuation has been drafted');
    }

    return this.prisma.$transaction(async (tx) => {
      const property = await tx.property.update({ where: { id }, data: { ...dto, boundaries: toBoundaries(dto.boundaries) }, select: propertySelect });
      await this.audit.record(
        { firmId, actorId, entityType: 'Property', entityId: id, action: 'property.updated', metadata: { fields: Object.keys(dto) } },
        tx,
      );
      return property;
    });
  }
}
