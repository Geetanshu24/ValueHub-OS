import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { formatInvoiceCode, type Paginated } from '@value-hub/valuation-shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { skipTake } from '../../common/pagination/pagination.dto.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import PDFDocument from 'pdfkit';
import { IdsService } from '../ids/ids.service.js';
import { fromPaise, outstandingPaise, paidPaise, statusAfterPayments, toPaise } from './money.js';
import type { CreateInvoiceDto, FollowUpDto, ListInvoicesQuery, RecordPaymentDto } from './accounts.dto.js';

const invoiceSelect = {
  id: true,
  assignmentId: true,
  code: true,
  amount: true,
  issuedOn: true,
  dueOn: true,
  status: true,
  sentAt: true,
  cancelReason: true,
  notes: true,
  assignment: { select: { code: true, bank: { select: { name: true } }, property: { select: { addressLine: true } } } },
  payments: { select: { id: true, amount: true, receivedOn: true, reference: true, voidedAt: true, voidReason: true }, orderBy: { receivedOn: 'asc' } },
  followUps: { select: { id: true, channel: true, note: true, contactedAt: true, nextActionOn: true, sentTo: true, delivery: true }, orderBy: { contactedAt: 'desc' }, take: 50 },
} satisfies Prisma.InvoiceSelect;

type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

const startOfToday = () => new Date(new Date().toDateString());

// Adds the figures people actually read: paid, outstanding and whether it is late.
function present(invoice: InvoiceRow) {
  const outstanding = invoice.status === 'CANCELLED' ? 0 : fromPaise(outstandingPaise(invoice.amount, invoice.payments));
  const overdue = ['SENT', 'PARTIALLY_PAID'].includes(invoice.status) && outstanding > 0 && invoice.dueOn < startOfToday();
  return { ...invoice, paid: fromPaise(paidPaise(invoice.payments)), outstanding, overdue };
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async list(firmId: string, query: ListInvoicesQuery): Promise<Paginated<unknown>> {
    const where: Prisma.InvoiceWhereInput = {
      firmId,
      ...(query.status && { status: query.status as Prisma.EnumInvoiceStatusFilter['equals'] }),
      ...(query.assignmentId && { assignmentId: query.assignmentId }),
      ...(query.overdue && { status: { in: ['SENT', 'PARTIALLY_PAID'] }, dueOn: { lt: startOfToday() } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, select: invoiceSelect, orderBy: { dueOn: 'asc' }, ...skipTake(query) }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items: rows.map(present), total, page: query.page, pageSize: query.pageSize };
  }

  async get(firmId: string, id: string) {
    return present(await this.requireInvoice(firmId, id));
  }

  // Raising an invoice needs an issued report, and the invoices on one
  // assignment can never add up to more than its agreed fee.
  async create(firmId: string, actorId: string, assignmentId: string, dto: CreateInvoiceDto) {
    const assignment = await this.prisma.assignment.findFirst({ where: { id: assignmentId, firmId }, select: { fee: true, status: true } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (!['SUBMITTED', 'CLOSED'].includes(assignment.status)) {
      throw new ConflictException(`Invoices are raised after submission, not while ${assignment.status}`);
    }
    const issuedOn = dto.issuedOn ? new Date(dto.issuedOn) : startOfToday();
    const dueOn = new Date(dto.dueOn);
    if (dueOn < issuedOn) throw new BadRequestException('dueOn cannot be before issuedOn');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findMany({ where: { assignmentId, firmId, status: { not: 'CANCELLED' } }, select: { amount: true } });
      const invoiced = existing.reduce((t, i) => t + toPaise(i.amount), 0);
      const remaining = assignment.fee ? toPaise(assignment.fee) - invoiced : null;

      const amountPaise = dto.amount !== undefined ? toPaise(dto.amount) : remaining;
      if (amountPaise === null || amountPaise <= 0) {
        throw new BadRequestException(assignment.fee ? 'The whole fee has already been invoiced' : 'amount is required because the assignment has no fee recorded');
      }
      if (remaining !== null && amountPaise > remaining) {
        throw new ConflictException(`This would invoice ₹ ${fromPaise(invoiced + amountPaise).toLocaleString('en-IN')} against an agreed fee of ₹ ${Number(assignment.fee).toLocaleString('en-IN')}; update the fee first`);
      }

      const code = formatInvoiceCode(await this.ids.nextValue(tx, firmId, 'INV'));
      const invoice = await tx.invoice.create({
        data: { firmId, assignmentId, code, amount: fromPaise(amountPaise), issuedOn, dueOn, notes: dto.notes, createdById: actorId },
        select: invoiceSelect,
      });
      await this.audit.record({ firmId, actorId, entityType: 'Invoice', entityId: invoice.id, action: 'invoice.created', metadata: { code, amount: fromPaise(amountPaise) } }, tx);
      return present(invoice);
    });
  }

  async send(firmId: string, actorId: string, id: string) {
    return this.transition(firmId, actorId, id, ['DRAFT'], 'SENT', 'invoice.sent', { sentAt: new Date() });
  }

  async cancel(firmId: string, actorId: string, id: string, reason: string) {
    const invoice = await this.requireInvoice(firmId, id);
    if (invoice.payments.some((p) => !p.voidedAt)) throw new ConflictException('Void the payments before cancelling an invoice');
    return this.transition(firmId, actorId, id, ['DRAFT', 'SENT'], 'CANCELLED', 'invoice.cancelled', { cancelReason: reason });
  }

  async recordPayment(firmId: string, actorId: string, id: string, dto: RecordPaymentDto) {
    const receivedOn = new Date(dto.receivedOn);
    if (receivedOn > new Date()) throw new BadRequestException('receivedOn cannot be in the future');

    return this.prisma.$transaction(async (tx) => {
      // Lock the invoice row so two payments cannot both fit the same balance.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} AND "firmId" = ${firmId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({ where: { id, firmId }, select: { status: true, amount: true, issuedOn: true, payments: { select: { amount: true, voidedAt: true } } } });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (!['SENT', 'PARTIALLY_PAID'].includes(invoice.status)) throw new ConflictException(`Payments are recorded against sent invoices, not ${invoice.status}`);
      if (receivedOn < invoice.issuedOn) throw new BadRequestException('receivedOn cannot be before the invoice date');

      const outstanding = outstandingPaise(invoice.amount, invoice.payments);
      if (toPaise(dto.amount) > outstanding) throw new ConflictException(`Payment exceeds the outstanding ₹ ${fromPaise(outstanding).toLocaleString('en-IN')}`);

      const payment = await tx.payment.create({ data: { firmId, invoiceId: id, amount: dto.amount, receivedOn, reference: dto.reference, recordedById: actorId }, select: { id: true, voidedAt: true, amount: true } });
      const status = statusAfterPayments(invoice.amount, [...invoice.payments, payment]);
      await tx.invoice.update({ where: { id }, data: { status } });
      await this.audit.record({ firmId, actorId, entityType: 'Payment', entityId: payment.id, action: 'payment.recorded', metadata: { invoiceId: id, amount: dto.amount, status } }, tx);
      return present(await tx.invoice.findUniqueOrThrow({ where: { id }, select: invoiceSelect }));
    });
  }

  async voidPayment(firmId: string, actorId: string, paymentId: string, reason: string) {
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, firmId }, select: { invoiceId: true, voidedAt: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.voidedAt) throw new ConflictException('Payment is already void');

    return this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidedById: actorId, voidReason: reason } });
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId }, select: { amount: true, status: true, payments: { select: { amount: true, voidedAt: true } } } });
      if (invoice.status !== 'CANCELLED') await tx.invoice.update({ where: { id: payment.invoiceId }, data: { status: statusAfterPayments(invoice.amount, invoice.payments) } });
      await this.audit.record({ firmId, actorId, entityType: 'Payment', entityId: paymentId, action: 'payment.voided', metadata: { reason } }, tx);
      return present(await tx.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId }, select: invoiceSelect }));
    });
  }

  // Logs a chase. For EMAIL with an address it also sends the reminder; the
  // outcome is stored as SENT or FAILED, never as "received".
  async followUp(firmId: string, actorId: string, id: string, dto: FollowUpDto) {
    const invoice = present(await this.requireInvoice(firmId, id));
    if (!['SENT', 'PARTIALLY_PAID'].includes(invoice.status)) throw new ConflictException('Only invoices awaiting payment can be chased');
    if (dto.sendTo && !this.mail.isConfigured) throw new ConflictException('Email is not configured on this server');

    let delivery: 'SENT' | 'FAILED' | undefined;
    if (dto.channel === 'EMAIL' && dto.sendTo) {
      try {
        await this.mail.send({
          to: dto.sendTo,
          subject: `Payment reminder: invoice ${invoice.code}`,
          text: `This is a reminder that invoice ${invoice.code} for assignment ${invoice.assignment.code} (due ${invoice.dueOn.toLocaleDateString('en-IN')}) has ₹ ${invoice.outstanding.toLocaleString('en-IN')} outstanding.\n\n${dto.note}`,
        });
        delivery = 'SENT';
      } catch (error) {
        delivery = 'FAILED';
        this.logger.warn(`Reminder email failed for ${invoice.code}: ${(error as Error).message}`);
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.invoiceFollowUp.create({
        data: { firmId, invoiceId: id, channel: dto.channel, note: dto.note, nextActionOn: dto.nextActionOn ? new Date(dto.nextActionOn) : undefined, sentTo: dto.sendTo, delivery, createdById: actorId },
      });
      await this.audit.record({ firmId, actorId, entityType: 'Invoice', entityId: id, action: 'invoice.followed_up', metadata: { channel: dto.channel, delivery: delivery ?? 'RECORDED' } }, tx);
      return row;
    });
  }

  // A plain invoice document, drawn from the stored figures each time.
  async pdf(firmId: string, id: string): Promise<{ fileName: string; buffer: Buffer }> {
    const invoice = present(await this.requireInvoice(firmId, id));
    const firm = await this.prisma.firm.findUniqueOrThrow({ where: { id: firmId }, select: { name: true } });
    const money = (value: number) => `Rs. ${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    const date = (value: Date) => value.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.font('Helvetica-Bold').fontSize(18).text(firm.name).fontSize(14).text(invoice.status === 'DRAFT' ? 'INVOICE (DRAFT)' : 'INVOICE').moveDown();
      doc.font('Helvetica').fontSize(10);
      doc.text(`Invoice no: ${invoice.code}`).text(`Date: ${date(invoice.issuedOn)}`).text(`Due: ${date(invoice.dueOn)}`).moveDown();
      doc.text(`Bill to: ${invoice.assignment.bank.name}`).text(`Assignment: ${invoice.assignment.code}`).text(`Property: ${invoice.assignment.property.addressLine}`).moveDown();
      doc.font('Helvetica-Bold').text(`Professional fee for valuation: ${money(Number(invoice.amount))}`).font('Helvetica');
      if (invoice.paid > 0) doc.text(`Received: ${money(invoice.paid)}`).text(`Balance due: ${money(invoice.outstanding)}`);
      if (invoice.notes) doc.moveDown().text(invoice.notes);
      doc.end();
    });
    return { fileName: `${invoice.code}.pdf`, buffer };
  }

  // Outstanding by bank, ageing, and how long paid invoices took.
  async summary(firmId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { firmId, status: { in: ['SENT', 'PARTIALLY_PAID', 'PAID'] } },
      select: { amount: true, dueOn: true, issuedOn: true, status: true, payments: { select: { amount: true, receivedOn: true, voidedAt: true } }, assignment: { select: { bank: { select: { name: true } } } } },
      take: 5000,
    });
    const today = startOfToday().getTime();
    const byBank = new Map<string, number>();
    const ageing = { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
    const daysToPay: number[] = [];
    let invoiced = 0;
    let received = 0;

    for (const invoice of invoices) {
      invoiced += toPaise(invoice.amount);
      received += paidPaise(invoice.payments);
      const open = outstandingPaise(invoice.amount, invoice.payments);
      if (open > 0) {
        byBank.set(invoice.assignment.bank.name, (byBank.get(invoice.assignment.bank.name) ?? 0) + open);
        const late = Math.floor((today - invoice.dueOn.getTime()) / 86_400_000);
        const bucket = late <= 0 ? 'current' : late <= 30 ? 'd1to30' : late <= 60 ? 'd31to60' : late <= 90 ? 'd61to90' : 'd90plus';
        ageing[bucket] += open;
      } else if (invoice.status === 'PAID') {
        const last = invoice.payments.filter((p) => !p.voidedAt).map((p) => p.receivedOn.getTime()).sort((a, b) => b - a)[0];
        if (last) daysToPay.push(Math.max(0, Math.round((last - invoice.issuedOn.getTime()) / 86_400_000)));
      }
    }
    return {
      invoiced: fromPaise(invoiced),
      received: fromPaise(received),
      outstanding: fromPaise(invoiced - received),
      ageing: Object.fromEntries(Object.entries(ageing).map(([k, v]) => [k, fromPaise(v)])),
      outstandingByBank: [...byBank].map(([bank, paise]) => ({ bank, outstanding: fromPaise(paise) })).sort((a, b) => b.outstanding - a.outstanding),
      averageDaysToPayment: daysToPay.length ? Math.round(daysToPay.reduce((t, d) => t + d, 0) / daysToPay.length) : null,
    };
  }

  private async transition(firmId: string, actorId: string, id: string, from: string[], to: 'SENT' | 'CANCELLED', action: string, extra: Prisma.InvoiceUpdateManyMutationInput) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.invoice.updateMany({ where: { id, firmId, status: { in: from as ('DRAFT' | 'SENT')[] } }, data: { status: to, ...extra } });
      if (count !== 1) {
        const exists = await tx.invoice.count({ where: { id, firmId } });
        if (!exists) throw new NotFoundException('Invoice not found');
        throw new ConflictException(`An invoice that is ${to === 'SENT' ? 'not a draft' : 'already paid or cancelled'} cannot move to ${to}`);
      }
      await this.audit.record({ firmId, actorId, entityType: 'Invoice', entityId: id, action }, tx);
      return present(await tx.invoice.findUniqueOrThrow({ where: { id }, select: invoiceSelect }));
    });
  }

  private async requireInvoice(firmId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, firmId }, select: invoiceSelect });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
}
