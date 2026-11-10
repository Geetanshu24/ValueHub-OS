import type { Prisma } from '../../generated/prisma/client.js';
import { fromPaise, paidPaise, toPaise } from '../accounts/money.js';

// What the case shows about money: nothing billed, unpaid, part paid or paid.
export function withBilling<T extends { invoices: { code: string; amount: Prisma.Decimal; payments: { amount: Prisma.Decimal; voidedAt: Date | null }[] }[] }>(row: T) {
  const { invoices, ...rest } = row;
  const billed = invoices.reduce((t, i) => t + toPaise(i.amount), 0);
  const paid = invoices.reduce((t, i) => t + paidPaise(i.payments), 0);
  const status: 'none' | 'unpaid' | 'part_paid' | 'paid' = invoices.length === 0 ? 'none' : paid <= 0 ? 'unpaid' : paid >= billed ? 'paid' : 'part_paid';
  return { ...rest, billing: { status, amount: fromPaise(billed), outstanding: fromPaise(Math.max(0, billed - paid)), code: invoices[0]?.code ?? null } };
}

// Drafters and inspectors do not see what a case bills.
export const seenBy = <T extends { billing: unknown }>(viewer: { role: string } | undefined, row: T) => (viewer?.role === 'DRAFTER' || viewer?.role === 'INSPECTOR' ? { ...row, billing: undefined } : row);

