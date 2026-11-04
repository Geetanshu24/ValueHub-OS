// Mirrors the AssignmentStatus enum in apps/valuation-api/prisma/schema.prisma.
// One status per workflow gate in the blueprint (section 2).
export const ASSIGNMENT_STATUSES = [
  'INTAKE',
  'DOCUMENTS',
  'INSPECTION',
  'VALUATION',
  'QUALITY_REVIEW',
  'APPROVED',
  'SUBMITTED',
  'REVISION',
  'CLOSED',
  'CANCELLED',
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  INTAKE: 'Intake',
  DOCUMENTS: 'Documents',
  INSPECTION: 'Inspection',
  VALUATION: 'Valuation',
  QUALITY_REVIEW: 'Quality review',
  APPROVED: 'Approved',
  SUBMITTED: 'Submitted',
  REVISION: 'Revision',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

// Allowed moves. Backward moves exist so a reviewer can send work back;
// nothing leaves CLOSED or CANCELLED, and an issued report is only ever
// reopened through REVISION (which creates a new version, never an edit).
export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  INTAKE: ['DOCUMENTS', 'CANCELLED'],
  DOCUMENTS: ['INSPECTION', 'INTAKE', 'CANCELLED'],
  INSPECTION: ['VALUATION', 'DOCUMENTS', 'CANCELLED'],
  VALUATION: ['QUALITY_REVIEW', 'INSPECTION', 'CANCELLED'],
  QUALITY_REVIEW: ['APPROVED', 'VALUATION'],
  APPROVED: ['SUBMITTED', 'QUALITY_REVIEW'],
  SUBMITTED: ['REVISION', 'CLOSED'],
  REVISION: ['VALUATION', 'QUALITY_REVIEW'],
  CLOSED: [],
  CANCELLED: [],
};

// Statuses at or beyond the quality gate. Material unresolved discrepancies
// block entry to any of these.
export const POST_VALUATION_STATUSES: readonly AssignmentStatus[] = [
  'QUALITY_REVIEW',
  'APPROVED',
  'SUBMITTED',
  'CLOSED',
];

export function canTransition(from: AssignmentStatus, to: AssignmentStatus): boolean {
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}
