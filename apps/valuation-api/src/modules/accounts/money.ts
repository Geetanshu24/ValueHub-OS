// Money is handled in whole paise so sums never pick up floating-point error.
export const toPaise = (value: number | string | { toString(): string }) => Math.round(Number(value.toString()) * 100);
export const fromPaise = (paise: number) => paise / 100;

export interface PaymentLike {
  amount: number | string | { toString(): string };
  voidedAt: Date | null;
}

export function paidPaise(payments: PaymentLike[]): number {
  return payments.filter((p) => !p.voidedAt).reduce((total, p) => total + toPaise(p.amount), 0);
}

export function outstandingPaise(amount: number | string | { toString(): string }, payments: PaymentLike[]): number {
  return toPaise(amount) - paidPaise(payments);
}

// Status follows the money: nothing paid keeps it SENT, part paid is
// PARTIALLY_PAID, and fully paid is PAID.
export function statusAfterPayments(amount: number | string | { toString(): string }, payments: PaymentLike[]): 'SENT' | 'PARTIALLY_PAID' | 'PAID' {
  const paid = paidPaise(payments);
  if (paid <= 0) return 'SENT';
  return paid >= toPaise(amount) ? 'PAID' : 'PARTIALLY_PAID';
}
