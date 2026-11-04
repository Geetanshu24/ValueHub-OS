import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Paginated } from '@value-hub/valuation-shared';
import { CurrentUser, type AuthUser } from '../../common/auth/auth-user.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { PaginationQuery, skipTake } from '../../common/pagination/pagination.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export class ListAuditQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(60) entityType?: string;
  @IsOptional() @IsUUID() entityId?: string;
  @IsOptional() @IsUUID() actorId?: string;
}

@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles('FIRM_ADMIN', 'REVIEWER')
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: ListAuditQuery): Promise<Paginated<unknown>> {
    const where = {
      firmId: user.firmId,
      ...(query.entityType && { entityType: query.entityType }),
      ...(query.entityId && { entityId: query.entityId }),
      ...(query.actorId && { actorId: query.actorId }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake(query) }),
      this.prisma.auditEvent.count({ where }),
    ]);

    const actorIds = [...new Set(rows.flatMap((row) => (row.actorId ? [row.actorId] : [])))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds }, firmId: user.firmId }, select: { id: true, fullName: true } });
    const names = new Map(actors.map((actor) => [actor.id, actor.fullName]));
    const items = rows.map((row) => ({ ...row, actorName: row.actorId ? (names.get(row.actorId) ?? null) : null }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
