// Mirrors the UserRole enum in apps/valuation-api/prisma/schema.prisma.
export const VALUATION_ROLES = [
  'FIRM_ADMIN',
  'VALUER',
  'INSPECTOR',
  'REVIEWER',
  'ACCOUNTS',
] as const;

export type ValuationRole = (typeof VALUATION_ROLES)[number];
