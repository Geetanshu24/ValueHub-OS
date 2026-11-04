import { describe, expect, it } from 'vitest';
import { outstandingPaise, statusAfterPayments, toPaise } from './money.js';

const pay = (amount: number, voided = false) => ({ amount, voidedAt: voided ? new Date() : null });

describe('money', () => {
  it('avoids floating point drift', () => {
    expect(toPaise(0.1) + toPaise(0.2)).toBe(30);
    expect(toPaise('1234.56')).toBe(123456);
  });

  it('computes outstanding and ignores voided payments', () => {
    expect(outstandingPaise(10000, [pay(2500.5), pay(1000, true)])).toBe(749950);
  });

  it('derives status from payments', () => {
    expect(statusAfterPayments(1000, [])).toBe('SENT');
    expect(statusAfterPayments(1000, [pay(400)])).toBe('PARTIALLY_PAID');
    expect(statusAfterPayments(1000, [pay(400), pay(600)])).toBe('PAID');
    expect(statusAfterPayments(1000, [pay(1000, true)])).toBe('SENT');
  });
});
