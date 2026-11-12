export const STAGES = [
  { n: 1, short: 'New', label: 'New' },
  { n: 2, short: 'Docs Recd', label: 'Documents received' },
  { n: 3, short: 'Assigned', label: 'Assigned to a valuer' },
  { n: 4, short: 'Extraction', label: 'Document facts extracted' },
  { n: 5, short: 'Scheduled', label: 'Site visit scheduled' },
  { n: 6, short: 'On-Site', label: 'Inspector on site' },
  { n: 7, short: 'Site Done', label: 'Site inspection submitted' },
  { n: 8, short: 'Comparison', label: 'Documents compared with the site' },
  { n: 9, short: 'Resolution', label: 'Differences settled by the valuer' },
  { n: 10, short: 'Drafting', label: 'Valuation drafted' },
  { n: 11, short: 'Submitted', label: 'Submitted for review' },
  { n: 12, short: 'Review', label: 'Valuer review' },
  { n: 13, short: 'Approved', label: 'Approved' },
  { n: 14, short: 'Sent', label: 'Sent to the bank' },
  { n: 15, short: 'Invoiced', label: 'Invoiced and closed' },
] as const;

export interface LifecycleInput {
  status: string;
  createdAt: Date;
  valuer: string | null;
  documents: { uploadedAt: Date; ocrStatus: string }[];
  factCount: number;
  inspections: { status: string; visitedAt: Date; createdAt: Date; inspector: string }[];
  openMaterialDiscrepancies: number;
  valuations: { createdAt: Date; status: string }[];
  reports: { status: string; approvedAt: Date | null; issuedAt: Date | null }[];
  submissions: { sentAt: Date; channel: string }[];
  invoices: { code: string; createdAt: Date }[];
  closedAt: Date | null;
}

export interface Stage {
  n: number;
  short: string;
  label: string;
  state: 'done' | 'active' | 'pending';
  detail: string;
  at: string | null;
}

const LATE = ['QUALITY_REVIEW', 'APPROVED', 'SUBMITTED', 'CLOSED'];
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// Where an assignment is among the fifteen stages, worked out from what exists, not from one status field.
export function computeLifecycle(input: LifecycleInput): { stages: Stage[]; active: number } {
  const first = <T>(list: T[], pick: (t: T) => Date) => (list.length ? list.map(pick).sort((a, b) => a.getTime() - b.getTime())[0] : null);
  const visits = input.inspections;
  const siteDone = visits.filter((v) => v.status === 'SUBMITTED' || v.status === 'REVIEWED');
  const onSite = visits.filter((v) => v.status !== 'SCHEDULED');
  const late = LATE.includes(input.status);
  const approved = ['APPROVED', 'SUBMITTED', 'CLOSED'].includes(input.status) || input.reports.some((r) => r.approvedAt);

  const done: Record<number, { ok: boolean; detail: string; at: Date | null }> = {
    1: { ok: true, detail: 'Assignment created', at: input.createdAt },
    2: { ok: input.documents.length > 0, detail: input.documents.length ? `${input.documents.length} document${input.documents.length === 1 ? '' : 's'} received` : 'No documents yet', at: first(input.documents, (d) => d.uploadedAt) },
    3: { ok: Boolean(input.valuer), detail: input.valuer ? `Assigned to ${input.valuer}` : 'No valuer assigned', at: input.createdAt },
    // Facts are optional: a case that has moved on to a site visit has passed this stage even if nothing was read.
    4: { ok: input.factCount > 0 || input.documents.some((d) => d.ocrStatus === 'DONE') || visits.length > 0, detail: `${input.factCount} fact${input.factCount === 1 ? '' : 's'} read from the documents`, at: null },
    5: { ok: visits.length > 0, detail: visits[0] ? `Visit on ${visits[0].visitedAt.toISOString().slice(0, 10)} (${visits[0].inspector})` : 'Not scheduled', at: first(visits, (v) => v.createdAt) },
    6: { ok: onSite.length > 0, detail: onSite[0] ? `${onSite[0].inspector} on site` : 'Not started', at: first(onSite, (v) => v.visitedAt) },
    7: { ok: siteDone.length > 0, detail: siteDone.length ? 'Measurements and photographs submitted' : 'Waiting for the inspection to be submitted', at: first(siteDone, (v) => v.visitedAt) },
    8: { ok: siteDone.length > 0, detail: siteDone.length ? 'Documents can be compared with the site' : 'Needs the site inspection', at: null },
    9: { ok: siteDone.length > 0 && input.openMaterialDiscrepancies === 0, detail: input.openMaterialDiscrepancies > 0 ? `${input.openMaterialDiscrepancies} difference${input.openMaterialDiscrepancies === 1 ? '' : 's'} still to settle` : siteDone.length ? 'No difference is waiting' : 'Needs the site inspection', at: null },
    10: { ok: input.valuations.length > 0, detail: input.valuations.length ? `Version ${input.valuations.length} drafted` : 'Not drafted', at: first(input.valuations, (v) => v.createdAt) },
    11: { ok: late, detail: late ? 'Sent for review' : 'Not yet sent for review', at: null },
    12: { ok: approved || input.status === 'SUBMITTED' || input.status === 'CLOSED', detail: input.status === 'QUALITY_REVIEW' ? 'Under review' : approved ? 'Reviewed' : 'Not yet reviewed', at: null },
    13: { ok: approved, detail: approved ? 'Approved' : 'Not approved', at: first(input.reports.filter((r) => r.approvedAt), (r) => r.approvedAt as Date) },
    14: { ok: input.submissions.length > 0 || ['SUBMITTED', 'CLOSED'].includes(input.status), detail: input.submissions[0] ? `Sent by ${input.submissions[0].channel.toLowerCase().replace('_', ' ')}` : 'Not sent', at: first(input.submissions, (s) => s.sentAt) },
    15: { ok: input.invoices.length > 0 || input.status === 'CLOSED', detail: input.invoices[0] ? `Invoice ${input.invoices[0].code}` : input.status === 'CLOSED' ? 'Closed' : 'Not invoiced', at: first(input.invoices, (i) => i.createdAt) ?? input.closedAt },
  };

  const activeIndex = STAGES.findIndex((s) => !done[s.n].ok);
  const stages = STAGES.map((s, i) => ({ n: s.n, short: s.short, label: s.label, state: (done[s.n].ok && i !== activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending') as Stage['state'], detail: done[s.n].detail, at: iso(done[s.n].at) }));
  return { stages, active: activeIndex === -1 ? STAGES.length + 1 : STAGES[activeIndex].n };
}
