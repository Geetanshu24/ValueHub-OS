// Mirrors IntakeSource / AssignmentPriority in apps/valuation-api/prisma/schema.prisma.
export const INTAKE_SOURCES = ['WHATSAPP', 'EMAIL', 'MOBILE_APP', 'DASHBOARD', 'MANUAL'] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];

export const INTAKE_SOURCE_LABELS: Record<IntakeSource, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  MOBILE_APP: 'Mobile app',
  DASHBOARD: 'Dashboard upload',
  MANUAL: 'Manual entry',
};

export const ASSIGNMENT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type AssignmentPriority = (typeof ASSIGNMENT_PRIORITIES)[number];

export const ASSIGNMENT_PRIORITY_LABELS: Record<AssignmentPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};
