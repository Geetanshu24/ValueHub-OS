import { describe, expect, it } from 'vitest';
import { seenBy, withBilling } from './billing.js';

const invoice = (amount: number, paid: number[] = [], voided = false) => ({
  code: 'VH-INV-0001',
  amount: amount as never,
  payments: paid.map((p) => ({ amount: p as never, voidedAt: voided ? new Date() : null })),
});

describe('withBilling', () => {
  it('shows nothing billed when there is no invoice', () => {
    expect(withBilling({ invoices: [] }).billing).toMatchObject({ status: 'none', amount: 0, code: null });
  });

  it('shows unpaid, part paid and paid from the money received', () => {
    expect(withBilling({ invoices: [invoice(12500)] }).billing).toMatchObject({ status: 'unpaid', outstanding: 12500 });
    expect(withBilling({ invoices: [invoice(12500, [5000])] }).billing).toMatchObject({ status: 'part_paid', outstanding: 7500 });
    expect(withBilling({ invoices: [invoice(12500, [12500])] }).billing).toMatchObject({ status: 'paid', outstanding: 0 });
  });

  it('ignores a payment that was voided', () => {
    expect(withBilling({ invoices: [invoice(12500, [12500], true)] }).billing.status).toBe('unpaid');
  });

  it('adds several invoices together', () => {
    expect(withBilling({ invoices: [invoice(1000, [1000]), invoice(500)] }).billing).toMatchObject({ status: 'part_paid', amount: 1500, outstanding: 500 });
  });
});

describe('seenBy', () => {
  const row = { billing: { status: 'unpaid' } };
  it('hides the money from drafters and inspectors', () => {
    expect(seenBy({ role: 'DRAFTER' }, row).billing).toBeUndefined();
    expect(seenBy({ role: 'INSPECTOR' }, row).billing).toBeUndefined();
  });
  it('leaves it for valuers and admins', () => {
    expect(seenBy({ role: 'VALUER' }, row).billing).toBeDefined();
    expect(seenBy({ role: 'FIRM_ADMIN' }, row).billing).toBeDefined();
  });
});
