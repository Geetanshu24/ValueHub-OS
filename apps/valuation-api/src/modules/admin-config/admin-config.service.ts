import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ChecklistResponseDto, CreateChecklistItemDto, CreateFeeRuleDto, UpdateChecklistItemDto } from './admin-config.dto.js';

@Injectable()
export class AdminConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- settings
  async getSettings(firmId: string) {
    const row = await this.prisma.firmSettings.findUnique({ where: { firmId } });
    return { retentionYears: row?.retentionYears ?? null };
  }

  async setRetention(firmId: string, actorId: string, retentionYears: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.firmSettings.upsert({ where: { firmId }, create: { firmId, retentionYears, updatedById: actorId }, update: { retentionYears, updatedById: actorId } });
      await this.audit.record({ firmId, actorId, entityType: 'FirmSettings', entityId: firmId, action: 'settings.retention_set', metadata: { retentionYears } }, tx);
      return { retentionYears };
    });
  }

  // ---- fee schedule
  listFeeRules(firmId: string) {
    return this.prisma.feeRule.findMany({ where: { firmId }, orderBy: [{ effectiveFrom: 'desc' }], take: 200 });
  }

  async createFeeRule(firmId: string, actorId: string, dto: CreateFeeRuleDto) {
    if (dto.bankId && !(await this.prisma.bank.count({ where: { id: dto.bankId, firmId } }))) throw new BadRequestException('Unknown bank');
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.feeRule.create({ data: { firmId, bankId: dto.bankId, propertyClass: dto.propertyClass, amount: dto.amount, effectiveFrom: new Date(dto.effectiveFrom), createdById: actorId } });
      await this.audit.record({ firmId, actorId, entityType: 'FeeRule', entityId: rule.id, action: 'fee_rule.created', metadata: { amount: dto.amount } }, tx);
      return rule;
    });
  }

  async deleteFeeRule(firmId: string, actorId: string, id: string) {
    const rule = await this.prisma.feeRule.findFirst({ where: { id, firmId } });
    if (!rule) throw new NotFoundException('Fee rule not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.feeRule.delete({ where: { id } });
      await this.audit.record({ firmId, actorId, entityType: 'FeeRule', entityId: id, action: 'fee_rule.deleted', metadata: { amount: Number(rule.amount) } }, tx);
    });
    return { ok: true };
  }

  // ---- checklist
  listChecklist(firmId: string) {
    return this.prisma.checklistItem.findMany({ where: { firmId }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], take: 200 });
  }

  createChecklistItem(firmId: string, actorId: string, dto: CreateChecklistItemDto) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.checklistItem.create({ data: { firmId, label: dto.label.trim(), propertyClass: dto.propertyClass, sortOrder: dto.sortOrder ?? 0 } });
      await this.audit.record({ firmId, actorId, entityType: 'ChecklistItem', entityId: item.id, action: 'checklist.created' }, tx);
      return item;
    });
  }

  async updateChecklistItem(firmId: string, actorId: string, id: string, dto: UpdateChecklistItemDto) {
    if (!(await this.prisma.checklistItem.count({ where: { id, firmId } }))) throw new NotFoundException('Checklist item not found');
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.checklistItem.update({ where: { id }, data: { label: dto.label?.trim(), isActive: dto.isActive, sortOrder: dto.sortOrder } });
      await this.audit.record({ firmId, actorId, entityType: 'ChecklistItem', entityId: id, action: 'checklist.updated' }, tx);
      return item;
    });
  }

  // Items that apply to a report, with the reviewer's tick for each.
  async reportChecklist(firmId: string, reportId: string) {
    const report = await this.prisma.reportVersion.findFirst({ where: { id: reportId, firmId }, select: { assignment: { select: { property: { select: { propertyClass: true } } } } } });
    if (!report) throw new NotFoundException('Report not found');
    const cls = report.assignment.property.propertyClass;
    const [items, responses] = await Promise.all([
      this.prisma.checklistItem.findMany({ where: { firmId, isActive: true, OR: [{ propertyClass: null }, { propertyClass: cls }] }, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], take: 200 }),
      this.prisma.reportChecklistResponse.findMany({ where: { reportVersionId: reportId, firmId } }),
    ]);
    return items.map((item) => {
      const response = responses.find((r) => r.itemId === item.id);
      return { itemId: item.id, label: item.label, checked: response?.checked ?? false, note: response?.note ?? null, checkedAt: response?.checkedAt ?? null };
    });
  }

  async respond(firmId: string, actorId: string, reportId: string, itemId: string, dto: ChecklistResponseDto) {
    const report = await this.prisma.reportVersion.findFirst({ where: { id: reportId, firmId }, select: { status: true } });
    if (!report) throw new NotFoundException('Report not found');
    if (!['DRAFT', 'IN_REVIEW'].includes(report.status)) throw new ConflictException(`The checklist is closed once a report is ${report.status}`);
    const applicable = (await this.reportChecklist(firmId, reportId)).find((i) => i.itemId === itemId);
    if (!applicable) throw new NotFoundException('That checklist item does not apply to this report');

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.reportChecklistResponse.upsert({
        where: { reportVersionId_itemId: { reportVersionId: reportId, itemId } },
        create: { firmId, reportVersionId: reportId, itemId, label: applicable.label, checked: dto.checked, note: dto.note, checkedById: actorId },
        update: { checked: dto.checked, note: dto.note, checkedById: actorId, checkedAt: new Date() },
      });
      await this.audit.record({ firmId, actorId, entityType: 'ReportVersion', entityId: reportId, action: 'checklist.responded', metadata: { itemId, checked: dto.checked } }, tx);
      return row;
    });
  }

  // ---- retention and legal hold
  async setLegalHold(firmId: string, actorId: string, assignmentId: string, hold: boolean, reason: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { legalHold: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.legalHold === hold) throw new ConflictException(hold ? 'Already on legal hold' : 'Not on legal hold');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.assignment.update({
        where: { id: assignmentId },
        data: hold ? { legalHold: true, legalHoldReason: reason, legalHoldAt: new Date(), legalHoldById: actorId } : { legalHold: false },
        select: { id: true, code: true, legalHold: true, legalHoldReason: true, retainUntil: true },
      });
      await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: hold ? 'assignment.legal_hold_set' : 'assignment.legal_hold_released', metadata: { reason } }, tx);
      return updated;
    });
  }

  // Closed records whose retention period has run out and that are not on hold.
  // The system only reports them; deciding to dispose of anything is a person's call.
  async retentionReport(firmId: string) {
    const today = new Date(new Date().toDateString());
    const select = { id: true, code: true, closedAt: true, retainUntil: true, legalHold: true, legalHoldReason: true } satisfies Prisma.AssignmentSelect;
    const [settings, onHold, dueForReview, unscheduled] = await Promise.all([
      this.getSettings(firmId),
      this.prisma.assignment.findMany({ where: { firmId, legalHold: true }, select, take: 200 }),
      this.prisma.assignment.findMany({ where: { firmId, status: 'CLOSED', legalHold: false, retainUntil: { lt: today } }, select, orderBy: { retainUntil: 'asc' }, take: 200 }),
      this.prisma.assignment.count({ where: { firmId, status: 'CLOSED', retainUntil: null } }),
    ]);
    return { retentionYears: settings.retentionYears, onHold, dueForReview, closedWithoutRetentionDate: unscheduled };
  }

  // Closed records that predate the retention setting get their date now.
  async applyRetentionToClosed(firmId: string, actorId: string) {
    const { retentionYears } = await this.getSettings(firmId);
    if (!retentionYears) throw new ConflictException('Set the retention period first');
    const closed = await this.prisma.assignment.findMany({ where: { firmId, status: 'CLOSED', retainUntil: null }, select: { id: true, closedAt: true, updatedAt: true }, take: 1000 });
    let updated = 0;
    for (const a of closed) {
      const basis = a.closedAt ?? a.updatedAt;
      const until = new Date(basis);
      until.setFullYear(until.getFullYear() + retentionYears);
      await this.prisma.assignment.update({ where: { id: a.id }, data: { closedAt: basis, retainUntil: until } });
      updated += 1;
    }
    await this.audit.record({ firmId, actorId, entityType: 'FirmSettings', entityId: firmId, action: 'retention.applied', metadata: { updated } });
    return { updated };
  }
}
