import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DEFAULT_TEMPLATES } from './default-templates.js';
import { SOURCE_FIELDS } from './report-fields.js';
import type { CreateTemplateDto } from './reports.dto.js';
import { parseTemplateSpec } from './template-spec.js';

const templateSelect = {
  id: true,
  name: true,
  bankId: true,
  propertyClass: true,
  version: true,
  effectiveFrom: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.ReportTemplateSelect;

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  sourceFields() {
    return Object.entries(SOURCE_FIELDS).map(([path, meta]) => ({ path, ...meta }));
  }

  list(firmId: string) {
    return this.prisma.reportTemplate.findMany({
      where: { firmId },
      select: templateSelect,
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      take: 200,
    });
  }

  async get(firmId: string, id: string) {
    const template = await this.prisma.reportTemplate.findFirst({ where: { id, firmId }, select: { ...templateSelect, fieldMap: true } });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  // Templates that fit an assignment: its bank (or any bank), its property
  // class (or any class), and in force on the valuation date.
  async forAssignment(firmId: string, assignmentId: string) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: { bankId: true, valuationDate: true, property: { select: { propertyClass: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return this.prisma.reportTemplate.findMany({
      where: {
        firmId,
        isActive: true,
        effectiveFrom: { lte: assignment.valuationDate },
        AND: [
          { OR: [{ bankId: null }, { bankId: assignment.bankId }] },
          { OR: [{ propertyClass: null }, { propertyClass: assignment.property.propertyClass }] },
        ],
      },
      select: templateSelect,
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      take: 50,
    });
  }

  async create(firmId: string, actorId: string, dto: CreateTemplateDto) {
    const { spec, problems } = parseTemplateSpec(dto.spec);
    if (!spec) throw new BadRequestException({ message: problems, error: 'Bad Request', statusCode: 400 });
    if (dto.bankId) {
      const bank = await this.prisma.bank.findFirst({ where: { id: dto.bankId, firmId }, select: { id: true } });
      if (!bank) throw new BadRequestException('Unknown bank');
    }
    return this.publish(firmId, actorId, dto.name.trim(), dto.bankId ?? null, dto.propertyClass ?? null, new Date(dto.effectiveFrom), spec as unknown as Prisma.InputJsonObject);
  }

  // Adds the standard flat / house / land templates once; running it again does nothing.
  async installDefaults(firmId: string, actorId: string) {
    const created: string[] = [];
    for (const template of DEFAULT_TEMPLATES) {
      const exists = await this.prisma.reportTemplate.count({ where: { firmId, name: template.name } });
      if (exists > 0) continue;
      await this.publish(firmId, actorId, template.name, null, template.propertyClass, new Date('2020-01-01'), template.spec as unknown as Prisma.InputJsonObject);
      created.push(template.name);
    }
    return { created };
  }

  async setActive(firmId: string, actorId: string, id: string, isActive: boolean) {
    await this.get(firmId, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reportTemplate.update({ where: { id }, data: { isActive }, select: templateSelect });
      await this.audit.record({ firmId, actorId, entityType: 'ReportTemplate', entityId: id, action: isActive ? 'template.activated' : 'template.deactivated' }, tx);
      return updated;
    });
  }

  // Older versions stay in the library (issued reports point at them) but stop
  // being offered for new reports.
  private publish(firmId: string, actorId: string, name: string, bankId: string | null, propertyClass: Prisma.ReportTemplateCreateInput['propertyClass'], effectiveFrom: Date, fieldMap: Prisma.InputJsonObject) {
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.reportTemplate.aggregate({ where: { firmId, name }, _max: { version: true } });
      const version = (latest._max.version ?? 0) + 1;
      await tx.reportTemplate.updateMany({ where: { firmId, name }, data: { isActive: false } });
      const template = await tx.reportTemplate.create({
        data: { firmId, name, bankId, propertyClass, version, effectiveFrom, fieldMap, createdById: actorId },
        select: templateSelect,
      });
      await this.audit.record({ firmId, actorId, entityType: 'ReportTemplate', entityId: template.id, action: 'template.published', metadata: { name, version } }, tx);
      return template;
    });
  }
}
