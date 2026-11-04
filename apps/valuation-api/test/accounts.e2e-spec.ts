import { beforeAll, describe, expect, it } from 'vitest';
import { BASE, adminLogin, e2eEnabled, http, makeAssignment, makeUser } from './helpers.js';

describe.skipIf(!e2eEnabled)('accounts', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  const day = (offset: number) => new Date(Date.now() + offset * 24 * 3600 * 1000).toISOString().slice(0, 10);

  // A submitted assignment with an agreed fee of 10,000.
  const submitted = async (fee = 10000) => {
    const ids = await makeAssignment(admin, 'LAND', 'APPROVED');
    await http('PATCH', `/assignments/${ids.assignmentId}`, { token: admin.token, json: { fee } });
    const reports = await http('GET', `/assignments/${ids.assignmentId}/reports`, { token: admin.token });
    await http('POST', `/reports/${reports.body[0].id}/issue`, { token: admin.token });
    await http('POST', `/assignments/${ids.assignmentId}/submissions`, { token: admin.token, json: { reportVersionId: reports.body[0].id, channel: 'PORTAL', recipient: 'bank portal' } });
    return ids;
  };

  it('invoices only after submission, never beyond the agreed fee, and defaults to the remaining fee', async () => {
    const early = await makeAssignment(admin, 'LAND');
    expect((await http('POST', `/assignments/${early.assignmentId}/invoices`, { token: admin.token, json: { dueOn: day(30), amount: 100 } })).status).toBe(409);

    const ids = await submitted();
    const first = await http('POST', `/assignments/${ids.assignmentId}/invoices`, { token: admin.token, json: { dueOn: day(30), amount: 6000 } });
    expect(first.status).toBe(201);
    expect(first.body.code).toMatch(/^VH-INV-\d{4}$/);
    expect(first.body.status).toBe('DRAFT');

    const over = await http('POST', `/assignments/${ids.assignmentId}/invoices`, { token: admin.token, json: { dueOn: day(30), amount: 5000 } });
    expect(over.status).toBe(409);
    const rest = await http('POST', `/assignments/${ids.assignmentId}/invoices`, { token: admin.token, json: { dueOn: day(30) } });
    expect(rest.body.amount).toBe('4000');
    expect((await http('POST', `/assignments/${ids.assignmentId}/invoices`, { token: admin.token, json: { dueOn: day(30) } })).status).toBe(400);
  });

  it('payments move the invoice through partial to paid, cannot overpay, and a void restores the balance', async () => {
    const ids = await submitted();
    const invoice = await http('POST', `/assignments/${ids.assignmentId}/invoices`, { token: admin.token, json: { dueOn: day(30), amount: 10000 } });
    const id = invoice.body.id;

    expect((await http('POST', `/invoices/${id}/payments`, { token: admin.token, json: { amount: 100, receivedOn: day(0) } })).status).toBe(409); // still a draft
    await http('POST', `/invoices/${id}/send`, { token: admin.token });
    expect((await http('POST', `/invoices/${id}/send`, { token: admin.token })).status).toBe(409);

    const part = await http('POST', `/invoices/${id}/payments`, { token: admin.token, json: { amount: 2500.5, receivedOn: day(0), reference: 'NEFT 1' } });
    expect(part.body.status).toBe('PARTIALLY_PAID');
    expect(part.body.outstanding).toBe(7499.5);

    expect((await http('POST', `/invoices/${id}/payments`, { token: admin.token, json: { amount: 7500, receivedOn: day(0) } })).status).toBe(409);
    expect((await http('POST', `/invoices/${id}/payments`, { token: admin.token, json: { amount: 100, receivedOn: day(5) } })).status).toBe(400);

    const full = await http('POST', `/invoices/${id}/payments`, { token: admin.token, json: { amount: 7499.5, receivedOn: day(0) } });
    expect(full.body.status).toBe('PAID');
    expect(full.body.outstanding).toBe(0);

    const lastPayment = full.body.payments.at(-1);
    const voided = await http('POST', `/payments/${lastPayment.id}/void`, { token: admin.token, json: { reason: 'Cheque bounced' } });
    expect(voided.body.status).toBe('PARTIALLY_PAID');
    expect(voided.body.outstanding).toBe(7499.5);
    expect((await http('POST', `/payments/${lastPayment.id}/void`, { token: admin.token, json: { reason: 'again please' } })).status).toBe(409);

    const accountant = await makeUser(admin.token, 'ACCOUNTS');
    expect((await http('POST', `/payments/${lastPayment.id}/void`, { token: accountant.token, json: { reason: 'not allowed' } })).status).toBe(403);
  });

  it('overdue invoices show in reminders, can be chased with history kept, and cannot be cancelled with money on them', async () => {
    const ids = await submitted();
    const invoice = await http('POST', `/assignments/${ids.assignmentId}/invoices`, { token: admin.token, json: { issuedOn: day(-60), dueOn: day(-40), amount: 4000 } });
    await http('POST', `/invoices/${invoice.body.id}/send`, { token: admin.token });

    const overdue = await http('GET', '/invoices?overdue=true', { token: admin.token });
    expect(overdue.body.items.map((i: any) => i.id)).toContain(invoice.body.id);
    expect(overdue.body.items.find((i: any) => i.id === invoice.body.id).overdue).toBe(true);
    const reminders = await http('GET', '/dashboard/reminders', { token: admin.token });
    expect(reminders.body.some((r: any) => r.type === 'INVOICE_OVERDUE' && r.ref === invoice.body.code)).toBe(true);

    const accountant = await makeUser(admin.token, 'ACCOUNTS');
    const chase = await http('POST', `/invoices/${invoice.body.id}/follow-ups`, { token: accountant.token, json: { channel: 'CALL', note: 'Spoke to branch manager; payment promised.', nextActionOn: day(7) } });
    expect(chase.status).toBe(201);
    expect((await http('GET', `/invoices/${invoice.body.id}`, { token: admin.token })).body.followUps).toHaveLength(1);

    await http('POST', `/invoices/${invoice.body.id}/payments`, { token: accountant.token, json: { amount: 100, receivedOn: day(-30) } });
    expect((await http('POST', `/invoices/${invoice.body.id}/cancel`, { token: admin.token, json: { reason: 'Raised in error' } })).status).toBe(409);

    const file = await fetch(`${BASE}/invoices/${invoice.body.id}/file`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(Buffer.from(await file.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('summary reconciles invoiced, received and outstanding, with ageing', async () => {
    const summary = await http('GET', '/accounts/summary', { token: admin.token });
    expect(summary.status).toBe(200);
    expect(Math.round((summary.body.invoiced - summary.body.received) * 100)).toBe(Math.round(summary.body.outstanding * 100));
    const ageing = Object.values(summary.body.ageing as Record<string, number>).reduce((t, v) => t + v, 0);
    expect(Math.round(ageing * 100)).toBe(Math.round(summary.body.outstanding * 100));
    const banks = summary.body.outstandingByBank.reduce((t: number, b: any) => t + b.outstanding, 0);
    expect(Math.round(banks * 100)).toBe(Math.round(summary.body.outstanding * 100));
  });

  it('unpaid invoices can be cancelled by an admin with a reason, and then free up the fee', async () => {
    const ids = await submitted();
    const invoice = await http('POST', `/assignments/${ids.assignmentId}/invoices`, { token: admin.token, json: { dueOn: day(30), amount: 10000 } });
    const cancelled = await http('POST', `/invoices/${invoice.body.id}/cancel`, { token: admin.token, json: { reason: 'Raised in error' } });
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await http('POST', `/assignments/${ids.assignmentId}/invoices`, { token: admin.token, json: { dueOn: day(30) } })).body.amount).toBe('10000');
  });
});
