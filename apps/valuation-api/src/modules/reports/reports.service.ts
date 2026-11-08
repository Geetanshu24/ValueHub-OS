import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service.js';
import { StorageService } from '../../common/storage/storage.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ReportPdfService } from './report-pdf.service.js';
import { ReportSnapshotService, type Snapshot } from './report-snapshot.service.js';
import { relaxChecks } from '../../common/relax-checks.js';
import type { QcResult } from './report-qc.js';
import type { CreateReportDto } from './reports.dto.js';

const reportSelect = {
  id: true,
  assignmentId: true,
  valuationVersionId: true,
  templateId: true,
  versionNumber: true,
  status: true,
  qc: true,
  sha256: true,
  createdById: true,
  changeReason: true,
  reviewerId: true,
  approvedAt: true,
  issuedAt: true,
  createdAt: true,
  template: { select: { name: true, version: true } },
} satisfies Prisma.ReportVersionSelect;

// A report can be prepared while the numbers are being finished or checked.
const PREPARABLE_STATUSES = ['VALUATION', 'QUALITY_REVIEW', 'REVISION'] as const;
type Actor = { userId: string; role: string };

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly snapshots: ReportSnapshotService,
    private readonly pdf: ReportPdfService,
    private readonly audit: AuditService,
  ) {}

  list(firmId: string, assignmentId: string) {
    return this.prisma.reportVersion.findMany({
      where: { assignmentId, firmId },
      select: reportSelect,
      orderBy: { versionNumber: 'desc' },
      take: 50,
    });
  }

  async get(firmId: string, id: string) {
    const report = await this.prisma.reportVersion.findFirst({ where: { id, firmId }, select: { ...reportSelect, snapshot: true } });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  // Runs the checks against current data without saving anything.
  async previewQc(firmId: string, actor: Actor, assignmentId: string, dto: CreateReportDto) {
    await this.requireAssignment(firmId, assignmentId);
    const next = (await this.prisma.reportVersion.aggregate({ where: { assignmentId }, _max: { versionNumber: true } }))._max.versionNumber ?? 0;
    const { qc } = await this.snapshots.build(firmId, actor, assignmentId, dto.templateId, dto.valuationVersionId, next + 1);
    return qc;
  }

  async create(firmId: string, actor: Actor, assignmentId: string, dto: CreateReportDto) {
    const assignment = await this.requireAssignment(firmId, assignmentId);
    if (!(PREPARABLE_STATUSES as readonly string[]).includes(assignment.status)) {
      throw new ConflictException(`Reports are prepared in VALUATION, QUALITY_REVIEW or REVISION, not ${assignment.status}`);
    }

    const next = (await this.prisma.reportVersion.aggregate({ where: { assignmentId }, _max: { versionNumber: true } }))._max.versionNumber ?? 0;
    const everIssued = await this.prisma.reportVersion.count({ where: { assignmentId, firmId, issuedAt: { not: null } } });
    if (everIssued > 0 && !dto.changeReason) throw new BadRequestException('changeReason is required when revising an issued report');
    const { snapshot, qc } = await this.snapshots.build(firmId, actor, assignmentId, dto.templateId, dto.valuationVersionId, next + 1);
    const file = await this.pdf.render(snapshot, { status: 'DRAFT' });
    const stored = await this.storage.save(firmId, file);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const latest = await tx.reportVersion.aggregate({ where: { assignmentId }, _max: { versionNumber: true } });
        const versionNumber = (latest._max.versionNumber ?? 0) + 1;
        if (versionNumber !== next + 1) throw new ConflictException('Another report was created at the same time; retry');

        // Unapproved drafts are replaced; approved and issued versions stay.
        await tx.reportVersion.updateMany({ where: { assignmentId, firmId, status: { in: ['DRAFT', 'IN_REVIEW'] } }, data: { status: 'SUPERSEDED' } });
        const report = await tx.reportVersion.create({
          data: {
            firmId,
            assignmentId,
            valuationVersionId: snapshot.valuation.id,
            templateId: dto.templateId,
            versionNumber,
            snapshot: snapshot as unknown as Prisma.InputJsonObject,
            qc: qc as unknown as Prisma.InputJsonObject,
            storageKey: stored.storageKey,
            sha256: stored.sha256,
            createdById: actor.userId,
            changeReason: dto.changeReason,
          },
          select: reportSelect,
        });
        await this.audit.record(
          { firmId, actorId: actor.userId, entityType: 'ReportVersion', entityId: report.id, action: 'report.drafted', metadata: { versionNumber, qcPassed: qc.passed } },
          tx,
        );
        return report;
      });
    } catch (error) {
      await this.storage.remove(stored.storageKey);
      throw error;
    }
  }

  async submitForReview(firmId: string, actorId: string, id: string) {
    const report = await this.requireReport(firmId, id);
    if (report.status !== 'DRAFT') throw new ConflictException(`Only a DRAFT can be sent for review, not ${report.status}`);
    const qc = report.qc as unknown as QcResult;
    if (!qc.passed && !relaxChecks()) {
      const failed = qc.checks.filter((c) => c.status === 'FAIL').map((c) => c.label);
      throw new ConflictException({ message: ['Quality checks have not passed:', ...failed], error: 'Conflict', statusCode: 409 });
    }
    return this.move(firmId, actorId, id, 'DRAFT', 'IN_REVIEW', 'report.sent_for_review');
  }

  async approve(firmId: string, actor: Actor, id: string) {
    const report = await this.requireReport(firmId, id);
    if (report.status !== 'IN_REVIEW') throw new ConflictException(`Only a report IN_REVIEW can be approved, not ${report.status}`);
    if (report.createdById === actor.userId && actor.role !== 'FIRM_ADMIN') {
      throw new ForbiddenException('A report must be approved by someone other than its author');
    }
    await this.requireCurrentApprovedValuation(firmId, report.assignmentId, report.valuationVersionId);
    await this.requireChecklistComplete(firmId, id, report.assignmentId);
    return this.move(firmId, actor.userId, id, 'IN_REVIEW', 'APPROVED', 'report.approved', { reviewerId: actor.userId, approvedAt: new Date() });
  }

  // Locks the report. The final PDF is drawn again from the frozen snapshot
  // (so it matches what was approved), with the annexure files checked against
  // their recorded hashes first.
  async issue(firmId: string, actor: Actor, id: string) {
    const report = await this.requireReport(firmId, id);
    if (report.status !== 'APPROVED') throw new ConflictException(`Only an APPROVED report can be issued, not ${report.status}`);
    await this.requireCurrentApprovedValuation(firmId, report.assignmentId, report.valuationVersionId);

    const snapshot = report.snapshot as unknown as Snapshot;
    const changed: string[] = [];
    for (const item of [...snapshot.annexures, ...snapshot.photos]) {
      const digest = createHash('sha256').update(await this.storage.read(item.storageKey)).digest('hex');
      if (digest !== item.sha256) changed.push('fileName' in item ? item.fileName : `photo ${item.id}`);
    }
    if (changed.length > 0) throw new ConflictException(`Attached files no longer match their recorded hashes: ${changed.join(', ')}`);

    const approver = report.reviewerId ? await this.prisma.user.findUnique({ where: { id: report.reviewerId }, select: { fullName: true } }) : null;
    const issuedAt = new Date();
    const file = await this.pdf.render(snapshot, { status: 'ISSUED', approvedBy: approver?.fullName, issuedAt });
    const stored = await this.storage.save(firmId, file);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.reportVersion.updateMany({
          where: { id, firmId, status: 'APPROVED' },
          data: { status: 'ISSUED', issuedAt, issuedById: actor.userId, storageKey: stored.storageKey, sha256: stored.sha256 },
        });
        if (count !== 1) throw new ConflictException('Report changed concurrently; reload and retry');
        // The newly issued copy replaces earlier issued ones in force; those stay on record.
        await tx.reportVersion.updateMany({ where: { assignmentId: report.assignmentId, firmId, status: 'ISSUED', id: { not: id } }, data: { status: 'SUPERSEDED' } });
        await this.audit.record({ firmId, actorId: actor.userId, entityType: 'ReportVersion', entityId: id, action: 'report.issued', metadata: { sha256: stored.sha256 } }, tx);
        return tx.reportVersion.findUniqueOrThrow({ where: { id }, select: reportSelect });
      });
      await this.storage.remove(report.storageKey);
      return result;
    } catch (error) {
      await this.storage.remove(stored.storageKey);
      throw error;
    }
  }

  async download(firmId: string, actorId: string, id: string): Promise<StreamableFile> {
    const report = await this.prisma.reportVersion.findFirst({
      where: { id, firmId },
      select: { storageKey: true, status: true, assignment: { select: { code: true } }, versionNumber: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    await this.audit.record({ firmId, actorId, entityType: 'ReportVersion', entityId: id, action: 'report.downloaded' });
    const name = `${report.assignment.code}-R${report.versionNumber}${report.status === 'ISSUED' ? '' : '-DRAFT'}.pdf`;
    return new StreamableFile(await this.storage.open(report.storageKey), { type: 'application/pdf', disposition: `attachment; filename="${name}"` });
  }

  // Every active firm checklist item that applies to this property class must be ticked.
  private async requireChecklistComplete(firmId: string, reportId: string, assignmentId: string) {
    if (relaxChecks()) return;
    const assignment = await this.prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, select: { property: { select: { propertyClass: true } } } });
    const items = await this.prisma.checklistItem.findMany({
      where: { firmId, isActive: true, OR: [{ propertyClass: null }, { propertyClass: assignment.property.propertyClass }] },
      select: { id: true, label: true },
      take: 200,
    });
    if (items.length === 0) return;
    const ticked = await this.prisma.reportChecklistResponse.findMany({ where: { reportVersionId: reportId, checked: true, itemId: { in: items.map((i) => i.id) } }, select: { itemId: true } });
    const done = new Set(ticked.map((t) => t.itemId));
    const open = items.filter((i) => !done.has(i.id));
    if (open.length > 0) {
      throw new ConflictException({ message: ['Complete the review checklist first:', ...open.map((i) => i.label)], error: 'Conflict', statusCode: 409 });
    }
  }

  private async requireAssignment(firmId: string, id: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id, firmId }, select: { status: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    return assignment;
  }

  private async requireReport(firmId: string, id: string) {
    const report = await this.prisma.reportVersion.findFirst({ where: { id, firmId } });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  // A report is only approved or issued while it still describes the valuation in force.
  private async requireCurrentApprovedValuation(firmId: string, assignmentId: string, valuationVersionId: string) {
    const latest = await this.prisma.valuationVersion.findFirst({ where: { assignmentId, firmId }, orderBy: { versionNumber: 'desc' }, select: { id: true, status: true } });
    if (!latest || latest.id !== valuationVersionId) throw new ConflictException('A newer valuation exists; prepare a new report from it');
    if (latest.status !== 'APPROVED' && !relaxChecks()) throw new BadRequestException('The valuation behind this report must be approved first');
  }

  private async move(firmId: string, actorId: string, id: string, from: 'DRAFT' | 'IN_REVIEW', to: 'IN_REVIEW' | 'APPROVED', action: string, extra: Prisma.ReportVersionUpdateManyMutationInput = {}) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.reportVersion.updateMany({ where: { id, firmId, status: from }, data: { status: to, ...extra } });
      if (count !== 1) throw new ConflictException('Report changed concurrently; reload and retry');
      await this.audit.record({ firmId, actorId, entityType: 'ReportVersion', entityId: id, action, metadata: { from, to } }, tx);
      return tx.reportVersion.findUniqueOrThrow({ where: { id }, select: reportSelect });
    });
  }
}

