// Mirrors DocumentType / VerificationState in apps/valuation-api/prisma/schema.prisma.
export const DOCUMENT_TYPES = [
  'BANK_INSTRUCTION',
  'SALE_DEED',
  'APPROVED_PLAN',
  'REVENUE_RECORD',
  'TAX_RECEIPT',
  'OCCUPATION_CERTIFICATE',
  'SHAJRA_PLAN',
  'WATER_BILL',
  'MAGISTRATE_CERTIFICATE',
  'PATWARI_REPORT',
  'LAYOUT_PLAN',
  'COMPLETION_CERTIFICATE',
  'ELECTRICITY_BILL',
  'PROPERTY_TAX',
  'REGISTRY_PAPERS',
  'MARKET_EVIDENCE',
  'CIRCLE_RATE_COPY',
  'OTHER',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  BANK_INSTRUCTION: 'Bank instruction',
  SALE_DEED: 'Sale deed',
  APPROVED_PLAN: 'Approved map',
  REVENUE_RECORD: 'Jamabandi',
  TAX_RECEIPT: 'Electricity bill & property tax',
  OCCUPATION_CERTIFICATE: 'Occupation certificate',
  SHAJRA_PLAN: 'Shajra plan / layout',
  WATER_BILL: 'Water bill',
  MAGISTRATE_CERTIFICATE: 'Magistrate certificate',
  PATWARI_REPORT: 'Patwari report',
  LAYOUT_PLAN: 'Layout plan',
  COMPLETION_CERTIFICATE: 'Completion certificate',
  ELECTRICITY_BILL: 'Electricity bill',
  PROPERTY_TAX: 'Property tax',
  REGISTRY_PAPERS: 'Registry papers',
  MARKET_EVIDENCE: 'Market listing screenshot',
  CIRCLE_RATE_COPY: 'Circle rate copy',
  OTHER: 'Other',
};

export const VERIFICATION_STATES = ['UNVERIFIED', 'VERIFIED', 'CORRECTED', 'UNKNOWN'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

// States a reviewer may set. UNVERIFIED is only ever the starting state.
export const REVIEW_OUTCOMES = ['VERIFIED', 'CORRECTED', 'UNKNOWN'] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export const UPLOAD_LIMITS = {
  documentBytes: 25 * 1024 * 1024,
  photoBytes: 10 * 1024 * 1024,
} as const;
