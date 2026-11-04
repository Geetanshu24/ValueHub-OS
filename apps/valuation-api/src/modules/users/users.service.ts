import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Paginated } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { hashPassword } from '../../common/auth/password.js';
import { skipTake } from '../../common/pagination/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateUserDto, ListUsersQuery, UpdateUserDto } from './users.dto.js';

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  staff(firmId: string) {
    return this.prisma.user.findMany({
      where: { firmId, isActive: true },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
      take: 200,
    });
  }

  async list(firmId: string, query: ListUsersQuery): Promise<Paginated<unknown>> {
    const where = { firmId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: userSelect, orderBy: { fullName: 'asc' }, ...skipTake(query) }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async create(firmId: string, actorId: string, dto: CreateUserDto) {
    const passwordHash = await hashPassword(dto.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { firmId, email: dto.email.toLowerCase(), fullName: dto.fullName.trim(), role: dto.role, passwordHash },
          select: userSelect,
        });
        await this.audit.record({ firmId, actorId, entityType: 'User', entityId: user.id, action: 'user.created', metadata: { role: dto.role } }, tx);
        return user;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  async update(firmId: string, actorId: string, id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findFirst({ where: { id, firmId }, select: { role: true, isActive: true } });
    if (!existing) throw new NotFoundException('User not found');
    // An admin cannot lock themselves out, which also guarantees one admin remains.
    if (id === actorId && (dto.isActive === false || (dto.role && dto.role !== existing.role))) {
      throw new BadRequestException('You cannot deactivate or change the role of your own account');
    }

    const passwordHash = dto.password ? await hashPassword(dto.password) : undefined;
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { fullName: dto.fullName?.trim(), role: dto.role, isActive: dto.isActive, passwordHash },
        select: userSelect,
      });
      await this.audit.record(
        {
          firmId,
          actorId,
          entityType: 'User',
          entityId: id,
          action: 'user.updated',
          metadata: { role: dto.role, isActive: dto.isActive, passwordReset: Boolean(dto.password) },
        },
        tx,
      );
      return user;
    });
  }
}
