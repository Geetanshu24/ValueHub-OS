import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { formatInvoiceCode } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { relaxChecks } from '../../common/relax-checks.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { fromPaise, outstandingPaise, paidPaise } from '../accounts/money.js';
import { IdsService } from '../ids/ids.service.js';
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
  ) {}

  async state(firmId: string, assignmentId: string) {
    const merged = await this.bankReport.merged(firmId, assignmentId);
    const compare = await this.bankReport.compare(firmId, assignmentId);
    const [checks, comparables, assignment, sends] = await Promise.all([
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
      submitted: assignment.reportSubmittedAt ? { at: assignment.reportSubmittedAt, by: submittedBy?.fullName ?? null } : null,
      billing: invoice
        ? { id: invoice.id, code: invoice.code, amount: Number(invoice.amount), dueOn: invoice.dueOn, status: invoice.status, paid: fromPaise(paidPaise(invoice.payments)), outstanding: fromPaise(outstandingPaise(invoice.amount, invoice.payments)) }
        : null,
      contact: assignment.branch ? { branch: assignment.branch.name, name: assignment.branch.contactName, email: assignment.branch.contactEmail, phone: assignment.branch.contactPhone } : null,
      sends: sends.map((s) => ({ id: s.id, channel: s.channel, recipient: s.recipient, note: s.note, format: s.format, deliveryStatus: s.deliveryStatus, deliveryError: s.deliveryError, sentAt: s.sentAt })),
    };
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
    await this.prisma.$transaction(async (tx) => {
      await tx.assignment.update({ where: { id: assignmentId }, data: { reportSubmittedAt: new Date(), reportSubmittedById: actorId } });
      await this.audit.record({ firmId, actorId, entityType: 'Assignment', entityId: assignmentId, action: 'report.submitted' }, tx);
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
        const actor = { userId: actorId, firmId, role: 'VALUER' } as never;
        const report = await this.bankReport.file(firmId, actor, assignmentId, 'pdf');
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
