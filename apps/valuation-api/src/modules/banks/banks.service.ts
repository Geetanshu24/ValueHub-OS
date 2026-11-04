import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Paginated } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { PaginationQuery, skipTake } from '../../common/pagination/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateBankDto, CreateBranchDto, UpdateBankDto, UpdateBranchDto } from './banks.dto.js';

const bankSelect = {
  id: true,
  name: true,
  createdAt: true,
  branches: { select: { id: true, name: true, city: true }, orderBy: { name: 'asc' } },
} satisfies Prisma.BankSelect;

@Injectable()
export class BanksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(firmId: string, query: PaginationQuery): Promise<Paginated<unknown>> {
    const where = { firmId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bank.findMany({ where, select: bankSelect, orderBy: { name: 'asc' }, ...skipTake(query) }),
      this.prisma.bank.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async create(firmId: string, actorId: string, dto: CreateBankDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const bank = await tx.bank.create({ data: { firmId, name: dto.name.trim() }, select: bankSelect });
        await this.audit.record({ firmId, actorId, entityType: 'Bank', entityId: bank.id, action: 'bank.created' }, tx);
        return bank;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A bank with this name already exists');
      }
      throw error;
    }
  }

  async createBranch(firmId: string, actorId: string, bankId: string, dto: CreateBranchDto) {
    const bank = await this.prisma.bank.findFirst({ where: { id: bankId, firmId }, select: { id: true } });
    if (!bank) throw new NotFoundException('Bank not found');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const branch = await tx.bankBranch.create({
          data: { ...dto, firmId, bankId },
          select: { id: true, name: true, city: true, contactName: true, contactEmail: true, contactPhone: true },
        });
        await this.audit.record(
          { firmId, actorId, entityType: 'BankBranch', entityId: branch.id, action: 'branch.created' },
          tx,
        );
        return branch;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This bank already has a branch with that name');
      }
      throw error;
    }
  }

  async rename(firmId: string, actorId: string, bankId: string, dto: UpdateBankDto) {
    const bank = await this.prisma.bank.findFirst({ where: { id: bankId, firmId }, select: { name: true } });
    if (!bank) throw new NotFoundException('Bank not found');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.bank.update({ where: { id: bankId }, data: { name: dto.name.trim() }, select: bankSelect });
        await this.audit.record(
          { firmId, actorId, entityType: 'Bank', entityId: bankId, action: 'bank.renamed', metadata: { from: bank.name, to: updated.name } },
          tx,
        );
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A bank with this name already exists');
      }
      throw error;
    }
  }

  async updateBranch(firmId: string, actorId: string, bankId: string, branchId: string, dto: UpdateBranchDto) {
    const branch = await this.prisma.bankBranch.findFirst({ where: { id: branchId, bankId, firmId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.bankBranch.update({
          where: { id: branchId },
          data: { ...dto },
          select: { id: true, name: true, city: true, contactName: true, contactEmail: true, contactPhone: true },
        });
        await this.audit.record({ firmId, actorId, entityType: 'BankBranch', entityId: branchId, action: 'branch.updated' }, tx);
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This bank already has a branch with that name');
      }
      throw error;
    }
  }
}
