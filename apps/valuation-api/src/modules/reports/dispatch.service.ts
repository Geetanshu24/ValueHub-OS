import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { factLabel, formatInvoiceCode } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { StorageService } from '../../common/storage/storage.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { relaxChecks } from '../../common/relax-checks.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { fromPaise, outstandingPaise, paidPaise } from '../accounts/money.js';
import { IdsService } from '../ids/ids.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { BankReportService } from './bank-report.service.js';

// What the valuer ticks before approving the report: the final answer in the bank's format, next to
// what the documents and the site say. Keys are shared by all formats; the first non-empty box wins.
const ITEMS: { key: string; label: string; boxes: string[]; compare?: string }[] = [
  { key: 'owner', label: 'Owner name', boxes: ['owner_details', 'lg_2'] },
  { key: 'address', label: 'Property address', boxes: ['postal_address'], compare: 'property_address' },
  { key: 'boundary_east', label: 'Boundary: east', boxes: ['boundary_east_deed', 'adj_east'], compare: 'boundary_east' },
  { key: 'boundary_west', label: 'Boundary: west', boxes: ['boundary_west_deed', 'adj_west'], compare: 'boundary_west' },
  { key: 'boundary_north', label: 'Boundary: north', boxes: ['boundary_north_deed', 'adj_north'], compare: 'boundary_north' },
  { key: 'boundary_south', label: 'Boundary: south', boxes: ['boundary_south_deed', 'adj_south'], compare: 'boundary_south' },
  { key: 'land_area', label: 'Land area', boxes: ['extent_site', 'area_site', 'land_extent'], compare: 'plot_area_sqm' },
  { key: 'built_up_area', label: 'Built-up area', boxes: ['area_covered', 'b_plinth', 'plinth_floorwise'], compare: 'built_up_area_sqm' },
  { key: 'market_rate', label: 'Market rate', boxes: ['land_market_rate', 'val_market_rate'] },
];
export const CHECK_KEYS = [...ITEMS.map((i) => i.key), 'market_evidence'];

const DUE_DAYS = 30;
const startOfToday = () => new Date(new Date().toDateString());

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly ids: IdsService,
    private readonly bankReport: BankReportService,
    private readonly accounts: AccountsService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  async state(firmId: string, assignmentId: string) {
    const merged = await this.bankReport.merged(firmId, assignmentId);
    const compare = await this.bankReport.compare(firmId, assignmentId);
    const [checks, comparables, assignment, sends, rework, finalReport] = await Promise.all([
      this.prisma.reportCheck.findMany({ where: { assignmentId, firmId } }),
      this.prisma.marketComparable.findMany({ where: { assignmentId, firmId }, orderBy: { observedOn: 'desc' }, take: 20 }),
      this.prisma.assignment.findFirstOrThrow({
        where: { id: assignmentId, firmId },
        select: {
          reportSubmittedAt: true,
          reportSubmittedById: true,
          branch: { select: { name: true, contactName: true, contactEmail: true, contactPhone: true } },
          invoices: { where: { status: { not: 'CANCELLED' } }, orderBy: { issuedOn: 'desc' }, take: 1, select: { id: true, code: true, amount: true, dueOn: true, status: true, payments: { select: { amount: true, voidedAt: true } } } },
        },
      }),
      this.prisma.reportSend.findMany({ where: { assignmentId, firmId }, orderBy: { sentAt: 'desc' }, take: 50 }),
      this.prisma.reworkRequest.findMany({ where: { assignmentId, firmId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.finalReport.findFirst({ where: { assignmentId, firmId }, orderBy: { revision: 'desc' } }),
    ]);
    const byKey = new Map(checks.map((c) => [c.itemKey, c]));
    const compareRow = (key?: string) => compare.rows.find((r) => r.key === key);
    const items = ITEMS.map((item) => {
      const row = compareRow(item.compare);
      const check = byKey.get(item.key);
      return {
        key: item.key,
        label: item.label,
        value: item.boxes.map((b) => merged.values[b]?.trim()).find(Boolean) ?? '',
        document: row?.document ?? '',
        site: row?.site ?? '',
        match: row?.status ?? null,
        checked: check?.checked ?? false,
        note: check?.note ?? '',
      };
    });
    const evidenceCheck = byKey.get('market_evidence');
    const verified = comparables.filter((c) => c.verified).length;
    const allChecked = items.every((i) => i.checked) && (evidenceCheck?.checked ?? false);
    const invoice = assignment.invoices[0];
    const submittedBy = assignment.reportSubmittedById ? await this.prisma.user.findUnique({ where: { id: assignment.reportSubmittedById }, select: { fullName: true } }) : null;
    return {
      format: merged.format.id,
      formatLabel: merged.format.label,
      items,
      evidence: {
        checked: evidenceCheck?.checked ?? false,
        note: evidenceCheck?.note ?? '',
        comparables: comparables.map((c) => ({ id: c.id, location: c.location, source: c.source, ratePerSqm: Number(c.ratePerSqm), observedOn: c.observedOn, verified: c.verified, isTransaction: c.isTransaction })),
        summary: `${comparables.length} comparable${comparables.length === 1 ? '' : 's'}, ${verified} verified`,
      },
      allChecked,
      finalReport: finalReport ? { id: finalReport.id, reportNumber: finalReport.reportNumber, revision: finalReport.revision, approvedAt: finalReport.approvedAt, sha256: finalReport.sha256, fileName: finalReport.fileName, signature: finalReport.signature } : null,
      rework: rework.map((r) => ({ id: r.id, kind: r.kind, reason: r.reason, dueDate: r.dueDate, revision: r.revision, createdAt: r.createdAt, resolvedAt: r.resolvedAt })),
      openDifferences: compare.summary.open,
      conflicts: merged.conflicts.map((key) => factLabel(key)),
      submitted: assignment.reportSubmittedAt ? { at: assignment.reportSubmittedAt, by: submittedBy?.fullName ?? null } : null,
      billing: invoice
        ? { id: invoice.id, code: invoice.code, amount: Number(invoice.amount), dueOn: invoice.dueOn, status: invoice.status, paid: fromPaise(paidPaise(invoice.payments)), outstanding: fromPaise(outstandingPaise(invoice.amount, invoice.payments)) }
        : null,
      contact: assignment.branch ? { branch: assignment.branch.name, name: assignment.branch.contactName, email: assignment.branch.contactEmail, phone: assignment.branch.contactPhone } : null,
      sends: sends.map((s) => ({ id: s.id, channel: s.channel, recipient: s.recipient, note: s.note, format: s.format, deliveryStatus: s.deliveryStatus, deliveryError: s.deliveryError, sentAt: s.sentAt })),
    };
  }

  // The valuer sends work back before approving: to the drafter, for a new site visit, or for more documents.
  async requestRework(firmId: string, actorId: string, assignmentId: string, dto: { kind: 'DRAFTER' | 'REINSPECTION' | 'DOCUMENTS'; reason: string; dueDate?: string }) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, firmId },
      select: { code: true, reportSubmittedAt: true, assignedDrafterId: true, assignedInspectorId: true, bank: { select: { name: true } } },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.reportSubmittedAt) throw new ConflictException('The report is already approved');
    const toId = dto.kind === 'REINSPECTION' ? assignment.assignedInspectorId : assignment.assignedDrafterId;
    if (!toId) throw new BadRequestException(`No ${dto.kind === 'REINSPECTION' ? 'site inspector' : 'drafter'} is chosen on this case`);
    const reason = dto.reason.trim();
    if (reason.length < 3) throw new BadRequestException('Say what needs to be done');
    if (dto.dueDate && new Date(dto.dueDate) < new Date(new Date().toDateString())) throw new BadRequestException('The due date cannot be in the past');
    const title = dto.kind === 'DRAFTER' ? 'Report returned for rework' : dto.kind === 'REINSPECTION' ? 'New site visit requested' : 'More documents needed';
    await this.prisma.$transaction(async (tx) => {
      const last = await tx.reworkRequest.aggregate({ where: { assignmentId, firmId }, _max: { revision: true } });
      const revision = (last._max.revision ?? 0) + 1;
      await tx.reworkRequest.create({ data: { firmId, assignmentId, kind: dto.kind, reason, dueDate: dto.dueDate ? new Date(dto.dueDate) : null, assignedToId: toId, requestedById: actorId, revision } });
      await this.notifications.notify(tx, { firmId, userId: toId, assignmentId, kind: 'REWORK', title, body: `${assignment.code} · ${assignment.bank.name}. ${reason}${dto.dueDate ? ` Due ${dto.dueDate}.` : ''}` });
      await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: 'rework.requested', metadata: { kind: dto.kind, reason, revision, dueDate: dto.dueDate ?? null } }, tx);
    });
    return this.state(firmId, assignmentId);
  }

  // The approved PDF exactly as it was stored.
  async finalFile(firmId: string, assignmentId: string) {
    const report = await this.prisma.finalReport.findFirst({ where: { assignmentId, firmId }, orderBy: { revision: 'desc' } });
    if (!report) throw new NotFoundException('The report has not been approved yet');
    return { bytes: await this.storage.read(report.storageKey), name: report.fileName };
  }

  // After approval the report is locked. Reopening it starts a revision: the drafter is asked to change it, and the
  // next approval is stored as a new revision. The bill and the record of what was sent stay as they are.
  async reopen(firmId: string, actorId: string, assignmentId: string, reasonText: string) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { code: true, reportSubmittedAt: true, assignedDrafterId: true, bank: { select: { name: true } } } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (!assignment.reportSubmittedAt) throw new ConflictException('The report is not approved, so there is nothing to reopen');
    if (!assignment.assignedDrafterId) throw new BadRequestException('No drafter is chosen on this case');
    const reason = reasonText.trim();
    if (reason.length < 3) throw new BadRequestException('Say why the report is being revised');
    await this.prisma.$transaction(async (tx) => {
      const last = await tx.reworkRequest.aggregate({ where: { assignmentId, firmId }, _max: { revision: true } });
      await tx.assignment.update({ where: { id: assignmentId }, data: { reportSubmittedAt: null, reportSubmittedById: null } });
      await tx.reworkRequest.create({ data: { firmId, assignmentId, kind: 'DRAFTER', reason: `Revision: ${reason}`, assignedToId: assignment.assignedDrafterId!, requestedById: actorId, revision: (last._max.revision ?? 0) + 1 } });
      await this.notifications.notify(tx, { firmId, userId: assignment.assignedDrafterId!, assignmentId, kind: 'REWORK', title: 'Approved report reopened for a revision', body: `${assignment.code} · ${assignment.bank.name}. ${reason}` });
      await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: 'report.reopened', metadata: { reason } }, tx);
    });
    return this.state(firmId, assignmentId);
  }

  async setCheck(firmId: string, actorId: string, assignmentId: string, itemKey: string, checked: boolean, note?: string) {
    if (!CHECK_KEYS.includes(itemKey)) throw new BadRequestException('Unknown item');
    await this.requireAssignment(firmId, assignmentId);
    await this.prisma.reportCheck.upsert({
      where: { assignmentId_itemKey: { assignmentId, itemKey } },
      create: { firmId, assignmentId, itemKey, checked, note: note?.trim() || null, checkedById: actorId },
      update: { checked, ...(note !== undefined && { note: note.trim() || null }), checkedById: actorId, checkedAt: new Date() },
    });
    return this.state(firmId, assignmentId);
  }

  // Approving the report raises the bill, once. The case then shows an unpaid report until payment is recorded.
  async submit(firmId: string, actorId: string, assignmentId: string, amount?: number) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { fee: true, reportSubmittedAt: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.reportSubmittedAt) return this.state(firmId, assignmentId);
    const current = await this.state(firmId, assignmentId);
    if (!current.allChecked && !relaxChecks()) {
      const open = [...current.items.filter((i) => !i.checked).map((i) => i.label), ...(current.evidence.checked ? [] : ['Market rate evidence'])];
      throw new ConflictException({ message: ['Tick every item before approving:', ...open], error: 'Conflict', statusCode: 409 });
    }
    // Differences between documents and site, and documents that disagree, are settled by a person before the report is approved.
    if ((current.openDifferences > 0 || current.conflicts.length > 0) && !relaxChecks()) {
      throw new ConflictException({
        message: ['Settle these before approving:', ...(current.openDifferences > 0 ? [`${current.openDifferences} difference${current.openDifferences === 1 ? '' : 's'} between the documents and the site have no decision (Compare page)`] : []), ...current.conflicts.map((c) => `The documents disagree on ${c} (choose one in the workbench)`)],
        error: 'Conflict',
        statusCode: 409,
      });
    }
    // The report as approved: a stored PDF with its number, revision and a record of who approved it and when.
    const approver = await this.prisma.user.findUnique({ where: { id: actorId }, select: { fullName: true } });
    const previous = await this.prisma.finalReport.count({ where: { assignmentId, firmId } });
    const revision = previous + 1;
    const meta = await this.prisma.assignment.findFirstOrThrow({ where: { id: assignmentId, firmId }, select: { code: true } });
    const reportNumber = `${meta.code}-${current.format}-R${revision}`;
    const pdf = await this.bankReport.file(firmId, { userId: actorId, firmId, role: 'VALUER' } as never, assignmentId, 'pdf');
    const stored = await this.storage.save(firmId, Buffer.from(pdf.bytes));
    const approvedAt = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.finalReport.create({
          data: {
            firmId, assignmentId, reportNumber, revision, format: current.format, fileName: `${reportNumber}.pdf`, storageKey: stored.storageKey, sha256: stored.sha256, sizeBytes: stored.sizeBytes, approvedById: actorId, approvedAt,
            // A record of the approval, not a legal e-signature: that has to go through an approved signing provider.
            signature: { method: 'APPROVAL_RECORD', signerId: actorId, signerName: approver?.fullName ?? null, signedAt: approvedAt.toISOString(), reportNumber, sha256: stored.sha256, note: 'Recorded approval by the valuer. Not a legal e-signature.' },
          },
        });
        await tx.assignment.update({ where: { id: assignmentId }, data: { reportSubmittedAt: approvedAt, reportSubmittedById: actorId } });
        await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: 'report.approved', metadata: { reportNumber, revision, sha256: stored.sha256 } }, tx);
      });
    } catch (error) {
      await this.storage.remove(stored.storageKey);
      throw error;
    }
    await this.prisma.$transaction(async (tx) => {
      const exists = await tx.invoice.count({ where: { assignmentId, firmId, status: { not: 'CANCELLED' } } });
      // The fee on the case, or the amount the valuer typed when the case had none.
      const fee = assignment.fee && Number(assignment.fee) > 0 ? Number(assignment.fee) : amount && amount > 0 ? Math.round(amount * 100) / 100 : 0;
      if (!exists && fee > 0) {
        const issuedOn = startOfToday();
        const dueOn = new Date(issuedOn.getTime() + DUE_DAYS * 86_400_000);
        const code = formatInvoiceCode(await this.ids.nextValue(tx, firmId, 'INV'));
        const invoice = await tx.invoice.create({
          data: { firmId, assignmentId, code, amount: fee, issuedOn, dueOn, status: 'SENT', sentAt: new Date(), notes: 'Raised when the report was approved', createdById: actorId },
        });
        await this.audit.record({ firmId, actorId, entityType: 'Invoice', entityId: invoice.id, action: 'invoice.created', metadata: { code, amount: fee, auto: true } }, tx);
      }
    });
    return this.state(firmId, assignmentId);
  }

  // Sends the report (and the bill) to the bank, or records that the valuer did. Email goes from the system when it is
  // set up; WhatsApp cannot be sent by the system, so the valuer gets a ready message and the send is recorded.
  async send(firmId: string, actorId: string, assignmentId: string, dto: { channel: 'EMAIL' | 'WHATSAPP' | 'OTHER'; recipient: string; note?: string }) {
    const before = await this.state(firmId, assignmentId);
    if (!before.submitted) throw new ConflictException('Approve and submit the report first');
    const recipient = dto.recipient.trim();
    if (dto.channel === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new BadRequestException('recipient must be an email address');
    if (dto.channel === 'WHATSAPP' && recipient.replace(/\D/g, '').length < 8) throw new BadRequestException('recipient must be a phone number');

    let deliveryStatus: 'RECORDED' | 'SENT' | 'FAILED' = 'RECORDED';
    let deliveryError: string | undefined;
    if (dto.channel === 'EMAIL' && this.mail.isConfigured) {
      try {
        const report = await this.finalFile(firmId, assignmentId);
        const attachments: { filename: string; content: Buffer; contentType: string }[] = [{ filename: report.name, content: Buffer.from(report.bytes), contentType: 'application/pdf' }];
        if (before.billing) {
          const bill = await this.accounts.pdf(firmId, before.billing.id);
          attachments.push({ filename: bill.fileName, content: bill.buffer, contentType: 'application/pdf' });
        }
        const assignment = await this.prisma.assignment.findFirstOrThrow({ where: { id: assignmentId, firmId }, select: { code: true, bank: { select: { name: true } } } });
        await this.mail.send({ to: recipient, subject: `Valuation report ${assignment.code}`, text: `${dto.note?.trim() || 'Please find the valuation report attached.'}\n\n${before.billing ? `Invoice ${before.billing.code} is attached.` : ''}`, attachments });
        deliveryStatus = 'SENT';
      } catch (error) {
        deliveryStatus = 'FAILED';
        deliveryError = error instanceof Error ? error.message : 'Email failed';
      }
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.reportSend.create({
        data: { firmId, assignmentId, format: before.format, channel: dto.channel, recipient, note: dto.note?.trim() || null, invoiceId: before.billing?.id ?? null, deliveryStatus, deliveryError, sentById: actorId },
      });
      await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: 'report.sent', metadata: { channel: dto.channel, recipient, deliveryStatus } }, tx);
      return created;
    });
    const assignment = await this.prisma.assignment.findFirstOrThrow({ where: { id: assignmentId, firmId }, select: { code: true } });
    const text = `${dto.note?.trim() || `Valuation report ${assignment.code}`}${before.billing ? `. Invoice ${before.billing.code}: Rs ${before.billing.amount.toLocaleString('en-IN')}` : ''}`;
    return {
      send: { id: row.id, deliveryStatus, deliveryError: deliveryError ?? null },
      whatsappLink: dto.channel === 'WHATSAPP' ? `https://wa.me/${recipient.replace(/\D/g, '')}?text=${encodeURIComponent(text)}` : null,
      note: dto.channel === 'EMAIL' && !this.mail.isConfigured ? 'Email is not set up on this server, so the send was only recorded. Send the downloaded report yourself.' : null,
    };
  }

  private async requireAssignment(firmId: string, id: string) {
    const found = await this.prisma.assignment.findFirst({ where: { id, firmId }, select: { id: true } });
    if (!found) throw new NotFoundException('Assignment not found');
  }
}
