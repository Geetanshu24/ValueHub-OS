import { PrismaService } from '../../prisma/prisma.service.js';

// The case status lifecycle, in order. A case shows the furthest stage it has reached.
export const LIFECYCLE = [
  ['NEW_CASE', 'New case'],
  ['DOCUMENTS_UPLOADED', 'Documents uploaded'],
  ['ASSIGNED', 'Assigned to drafter and inspector'],
  ['EXTRACTION', 'Document extraction'],
  ['SITE_IN_PROGRESS', 'Site visit in progress'],
  ['SITE_DONE', 'Site inspection completed'],
  ['COMPARISON', 'Data comparison'],
  ['DISCREPANCY_REVIEW', 'Discrepancy review'],
  ['DRAFTING', 'Report drafting'],
  ['SUBMITTED_FOR_APPROVAL', 'Submitted for approval'],
  ['REWORK', 'Valuer review / rework'],
  ['APPROVED', 'Approved, final report generated'],
  ['SENT', 'Sent to bank'],
  ['PAYMENT_PENDING', 'Invoice generated, payment pending'],
  ['PAID', 'Paid, closed'],
] as const;
export type LifecycleKey = (typeof LIFECYCLE)[number][0];

export interface Facts {
  documents: number;
  assigned: boolean;
  typed: number;
  visit: 'none' | 'open' | 'done';
  decisions: number;
  drafting: boolean;
  handedOver: boolean; // the draft was sent for checking after it was last returned
  reworkOpen: boolean;
  approved: boolean;
  sends: number;
  billing: 'none' | 'unpaid' | 'part_paid' | 'paid';
}

// Pure: which stage a case is in, from what has happened on it.
export function stageOf(f: Facts): { key: LifecycleKey; label: string } {
  let key: LifecycleKey = 'NEW_CASE';
  if (f.billing === 'paid') key = 'PAID';
  else if (f.sends > 0 && f.billing !== 'none') key = 'PAYMENT_PENDING';
  else if (f.sends > 0) key = 'SENT';
  else if (f.approved) key = 'APPROVED';
  else if (f.reworkOpen) key = 'REWORK';
  else if (f.handedOver) key = 'SUBMITTED_FOR_APPROVAL';
  else if (f.drafting) key = 'DRAFTING';
  else if (f.visit === 'done' && f.typed > 0) key = f.decisions > 0 ? 'DISCREPANCY_REVIEW' : 'COMPARISON';
  else if (f.visit === 'done') key = 'SITE_DONE';
  else if (f.visit === 'open') key = 'SITE_IN_PROGRESS';
  else if (f.typed > 0) key = 'EXTRACTION';
  else if (f.assigned) key = 'ASSIGNED';
  else if (f.documents > 0) key = 'DOCUMENTS_UPLOADED';
  return { key, label: LIFECYCLE.find(([k]) => k === key)![1] };
}

interface Row {
  id: string;
  property: { id: string };
  assignedDrafter?: { id: string } | null;
  assignedInspector?: { id: string } | null;
  reportSubmittedAt: Date | null;
  billing: { status: 'none' | 'unpaid' | 'part_paid' | 'paid' };
}

// One batch of queries for a page of cases.
export async function lifecycleFor(prisma: PrismaService, firmId: string, rows: Row[]) {
  if (rows.length === 0) return new Map<string, { key: LifecycleKey; label: string }>();
  const ids = rows.map((r) => r.id);
  const properties = [...new Set(rows.map((r) => r.property.id))];
  const [docs, typed, visits, decisions, forms, handed, rework, sends] = await Promise.all([
    prisma.document.groupBy({ by: ['propertyId'], where: { firmId, propertyId: { in: properties } }, _count: true }),
    prisma.extractedField.findMany({ where: { firmId, source: 'MANUAL', state: { not: 'UNKNOWN' }, document: { propertyId: { in: properties } } }, select: { document: { select: { propertyId: true } } }, take: 5000 }),
    prisma.inspection.findMany({ where: { firmId, assignmentId: { in: ids } }, select: { assignmentId: true, status: true } }),
    prisma.comparisonDecision.groupBy({ by: ['assignmentId'], where: { firmId, assignmentId: { in: ids } }, _count: true }),
    prisma.bankReportForm.findMany({ where: { firmId, assignmentId: { in: ids } }, select: { assignmentId: true } }),
    prisma.auditEvent.findMany({ where: { firmId, entityType: 'Assignment', entityId: { in: ids }, action: 'bank_report.sent_for_check' }, select: { entityId: true, createdAt: true } }),
    prisma.reworkRequest.findMany({ where: { firmId, assignmentId: { in: ids } }, select: { assignmentId: true, kind: true, createdAt: true, resolvedAt: true } }),
    prisma.reportSend.groupBy({ by: ['assignmentId'], where: { firmId, assignmentId: { in: ids } }, _count: true }),
  ]);
  const out = new Map<string, { key: LifecycleKey; label: string }>();
  for (const r of rows) {
    const mine = rework.filter((x) => x.assignmentId === r.id);
    const lastReturn = mine.filter((x) => x.kind !== 'REINSPECTION').map((x) => x.createdAt.getTime()).sort((a, b) => b - a)[0] ?? 0;
    const myVisits = visits.filter((v) => v.assignmentId === r.id);
    out.set(r.id, stageOf({
      documents: docs.find((d) => d.propertyId === r.property.id)?._count ?? 0,
      assigned: !!(r.assignedDrafter || r.assignedInspector),
      typed: typed.filter((t) => t.document.propertyId === r.property.id).length,
      visit: myVisits.some((v) => v.status === 'SUBMITTED' || v.status === 'REVIEWED') ? 'done' : myVisits.length > 0 ? 'open' : 'none',
      decisions: decisions.find((d) => d.assignmentId === r.id)?._count ?? 0,
      drafting: forms.some((f) => f.assignmentId === r.id),
      handedOver: handed.some((h) => h.entityId === r.id && h.createdAt.getTime() > lastReturn),
      reworkOpen: mine.some((x) => !x.resolvedAt),
      approved: !!r.reportSubmittedAt,
      sends: sends.find((s) => s.assignmentId === r.id)?._count ?? 0,
      billing: r.billing.status,
    }));
  }
  return out;
}
