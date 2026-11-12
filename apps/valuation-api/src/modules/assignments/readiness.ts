import { relaxChecks } from '../../common/relax-checks.js';
import { AREA_FIELD_KEYS, documentChecklist, factLabel, DOCUMENT_TYPE_LABELS, type DocumentType, type PropertyClass } from '@value-hub/valuation-shared';

export interface ReadinessInput {
  propertyClass: PropertyClass;
  property: { addressLine: string; locality: string | null; district: string | null; state: string | null; pinCode: string | null };
  documents: { type: DocumentType }[];
  facts: { documentId: string; fieldKey: string; state: string; value: string }[];
}

export interface ReadinessItem {
  key: string;
  label: string;
  state: 'done' | 'todo' | 'warn';
  detail: string;
  // True only for what the API itself refuses to move past.
  blocking: boolean;
}

export interface Readiness {
  items: ReadinessItem[];
  done: number;
  total: number;
  // Whether the API will accept the move to inspection.
  canProceed: boolean;
  // Whether everything advisory is also in order.
  complete: boolean;
}

const REVIEWED = ['VERIFIED', 'CORRECTED'];

// Works out how ready an assignment's property file is for site inspection.
// Only "at least one document" is enforced by the API; the rest is guidance.
export function assessReadiness(input: ReadinessInput): Readiness {
  const items: ReadinessItem[] = [];
  const have = new Set(input.documents.map((d) => d.type));

  items.push(
    input.documents.length > 0
      ? { key: 'any-document', label: 'Documents on file', state: 'done', detail: `${input.documents.length} document${input.documents.length === 1 ? '' : 's'} on record`, blocking: true }
      : { key: 'any-document', label: 'Documents on file', state: 'todo', detail: 'Upload at least one property document to start inspection', blocking: true },
  );

  const missingIdentity = (
    [['locality', input.property.locality], ['district', input.property.district], ['state', input.property.state], ['PIN code', input.property.pinCode]] as const
  ).filter(([, value]) => !value?.trim()).map(([name]) => name);
  items.push(
    missingIdentity.length === 0
      ? { key: 'identity', label: 'Property identity complete', state: 'done', detail: 'Address, locality, district, state and PIN recorded', blocking: false }
      : { key: 'identity', label: 'Property identity complete', state: 'warn', detail: `Missing ${missingIdentity.join(', ')}`, blocking: false },
  );

  for (const entry of documentChecklist(input.propertyClass)) {
    const label = DOCUMENT_TYPE_LABELS[entry.type];
    items.push(
      have.has(entry.type)
        ? { key: `doc-${entry.type}`, label, state: 'done', detail: 'On file', blocking: false }
        : { key: `doc-${entry.type}`, label, state: entry.level === 'required' ? 'todo' : 'warn', detail: entry.level === 'required' ? `Required: ${entry.hint}` : `Recommended: ${entry.hint}`, blocking: false },
    );
  }

  const unreviewed = input.facts.filter((f) => f.state === 'UNVERIFIED').length;
  items.push(
    input.facts.length === 0
      ? { key: 'facts', label: 'Document facts verified', state: 'warn', detail: 'No facts recorded yet. Read a document or add facts by hand', blocking: false }
      : unreviewed > 0
        ? { key: 'facts', label: 'Document facts verified', state: 'warn', detail: `${unreviewed} fact${unreviewed === 1 ? '' : 's'} still need a person to verify`, blocking: false }
        : { key: 'facts', label: 'Document facts verified', state: 'done', detail: `All ${input.facts.length} recorded facts reviewed`, blocking: false },
  );

  const areaKeys = input.propertyClass === 'LAND' ? ['plot_area_sqm'] : ['built_up_area_sqm', 'carpet_area_sqm', 'plot_area_sqm'];
  const hasArea = input.facts.some((f) => REVIEWED.includes(f.state) && areaKeys.includes(f.fieldKey));
  items.push(
    hasArea
      ? { key: 'area', label: 'Documented area verified', state: 'done', detail: 'A document area has been verified for comparison at inspection', blocking: false }
      : { key: 'area', label: 'Documented area verified', state: 'warn', detail: 'Verify an area from the documents so the inspection can be checked against it', blocking: false },
  );

  // The same fact read differently in two places is worth a look before inspection.
  const conflicts: string[] = [];
  for (const key of [...AREA_FIELD_KEYS, 'plot_number']) {
    const values = new Set(input.facts.filter((f) => f.fieldKey === key && f.state !== 'UNKNOWN').map((f) => f.value.trim()));
    if (values.size > 1) conflicts.push(`${factLabel(key)}: ${[...values].join(' vs ')}`);
  }
  if (conflicts.length > 0) items.push({ key: 'conflicts', label: 'Documents agree', state: 'warn', detail: `Values differ: ${conflicts.join('; ')}`, blocking: false });

  const done = items.filter((i) => i.state === 'done').length;
  return {
    items,
    done,
    total: items.length,
    canProceed: relaxChecks() || items.filter((i) => i.blocking).every((i) => i.state === 'done'),
    complete: done === items.length,
  };
}

export interface InspectionReadinessInput {
  // The visit being worked on: the latest one still open, else the latest.
  current: {
    status: string;
    measurements: number;
    keyedMeasurements: number;
    photos: number;
    unconfirmedCaptions: number;
    observations: number;
    hasGps: boolean;
  } | null;
  visits: { status: string }[];
  documentedAreas: number;
  openMaterialDiscrepancies: number;
  minPhotos: number;
  minObservations: number;
}

// How ready the site visit is to be submitted, and whether the assignment can
// move to valuation. The API enforces only a submitted visit (and, later,
// resolved discrepancies); the rest is guidance for the inspector.
export function assessInspectionReadiness(input: InspectionReadinessInput): Readiness {
  const items: ReadinessItem[] = [];
  const c = input.current;
  const locked = (status: string) => status === 'SUBMITTED' || status === 'REVIEWED';
  const submitted = input.visits.some((v) => locked(v.status));

  items.push(
    input.visits.length > 0
      ? { key: 'scheduled', label: 'Visit scheduled', state: 'done', detail: `${input.visits.length} visit${input.visits.length === 1 ? '' : 's'} on record`, blocking: false }
      : { key: 'scheduled', label: 'Visit scheduled', state: 'todo', detail: 'Schedule a site visit and choose who will go', blocking: false },
  );
  if (c && !locked(c.status)) {
    items.push(
      c.measurements > 0
        ? { key: 'measurements', label: 'Areas measured', state: 'done', detail: `${c.measurements} measurement${c.measurements === 1 ? '' : 's'} recorded`, blocking: false }
        : { key: 'measurements', label: 'Areas measured', state: 'todo', detail: 'Record at least one measurement. The visit cannot be submitted without it', blocking: false },
    );
    if (input.documentedAreas > 0) {
      items.push(
        c.keyedMeasurements > 0
          ? { key: 'compared', label: 'Compared with documents', state: 'done', detail: 'A measurement is linked to a documented area', blocking: false }
          : { key: 'compared', label: 'Compared with documents', state: 'warn', detail: 'Link a measurement to a documented area so differences are flagged', blocking: false },
      );
    }
    items.push(
      c.photos >= input.minPhotos
        ? { key: 'photos', label: 'Site photos', state: 'done', detail: `${c.photos} photos taken`, blocking: false }
        : { key: 'photos', label: 'Site photos', state: 'warn', detail: `${c.photos} of at least ${input.minPhotos} photos`, blocking: false },
    );
    if (c.photos > 0) {
      items.push(
        c.unconfirmedCaptions === 0
          ? { key: 'captions', label: 'Captions confirmed', state: 'done', detail: 'Every photo caption has been confirmed', blocking: false }
          : { key: 'captions', label: 'Captions confirmed', state: 'todo', detail: `${c.unconfirmedCaptions} caption${c.unconfirmedCaptions === 1 ? '' : 's'} still unconfirmed. The visit cannot be submitted until each is confirmed`, blocking: false },
      );
    }
    items.push(
      c.observations >= input.minObservations
        ? { key: 'observations', label: 'Site observations', state: 'done', detail: `${c.observations} answers recorded`, blocking: false }
        : { key: 'observations', label: 'Site observations', state: 'warn', detail: `${c.observations} of at least ${input.minObservations} answers recorded`, blocking: false },
    );
    items.push(
      c.hasGps
        ? { key: 'gps', label: 'Location captured', state: 'done', detail: 'GPS position recorded at the property', blocking: false }
        : { key: 'gps', label: 'Location captured', state: 'warn', detail: 'Capture the GPS position while at the property', blocking: false },
    );
  }

  items.push(
    submitted
      ? { key: 'submitted', label: 'Visit submitted', state: 'done', detail: 'A completed visit is on record', blocking: true }
      : { key: 'submitted', label: 'Visit submitted', state: 'todo', detail: 'Submit a visit to unlock valuation', blocking: true },
  );
  if (submitted) {
    const reviewed = input.visits.some((v) => v.status === 'REVIEWED');
    items.push(
      reviewed
        ? { key: 'reviewed', label: 'Field review', state: 'done', detail: 'A second person has checked the visit data', blocking: false }
        : { key: 'reviewed', label: 'Field review', state: 'warn', detail: 'Ask someone other than the inspector to mark it field-reviewed', blocking: false },
    );
    items.push(
      input.openMaterialDiscrepancies === 0
        ? { key: 'discrepancies', label: 'Discrepancies cleared', state: 'done', detail: 'No material differences waiting', blocking: false }
        : { key: 'discrepancies', label: 'Discrepancies cleared', state: 'warn', detail: `${input.openMaterialDiscrepancies} material difference${input.openMaterialDiscrepancies === 1 ? '' : 's'} must be resolved or disclosed before quality review`, blocking: false },
    );
  }

  const done = items.filter((i) => i.state === 'done').length;
  return { items, done, total: items.length, canProceed: relaxChecks() || submitted, complete: done === items.length };
}

export interface ValuationReadinessInput {
  inspectionSubmitted: boolean;
  // The newest version that has not been superseded.
  latest: { versionNumber: number; status: string; unsettledItems: number; citedComparables: number } | null;
  openMaterialDiscrepancies: number;
  verifiedComparables: number;
  minComparables: number;
}

// How far the valuation has got toward quality review. The API refuses the
// move unless the latest valuation is with review and no material difference
// is still open; the rest is guidance.
export function assessValuationReadiness(input: ValuationReadinessInput): Readiness {
  const items: ReadinessItem[] = [];
  const v = input.latest;
  const sent = !!v && (v.status === 'IN_REVIEW' || v.status === 'APPROVED');

  items.push(
    input.inspectionSubmitted
      ? { key: 'inspection', label: 'Site inspection submitted', state: 'done', detail: 'The valuation rests on a completed visit', blocking: false }
      : { key: 'inspection', label: 'Site inspection submitted', state: 'warn', detail: 'No submitted visit on record. Areas will have to rest on documents alone', blocking: false },
  );
  items.push(
    input.verifiedComparables >= input.minComparables
      ? { key: 'evidence', label: 'Market evidence', state: 'done', detail: `${input.verifiedComparables} verified comparables`, blocking: false }
      : { key: 'evidence', label: 'Market evidence', state: 'warn', detail: `${input.verifiedComparables} of at least ${input.minComparables} verified comparables`, blocking: false },
  );
  items.push(
    v
      ? { key: 'drafted', label: 'Valuation drafted', state: 'done', detail: `Version ${v.versionNumber} saved (${v.status.toLowerCase().replace('_', ' ')})`, blocking: false }
      : { key: 'drafted', label: 'Valuation drafted', state: 'todo', detail: 'Complete the workings and save a draft', blocking: false },
  );
  if (v) {
    items.push(
      v.citedComparables > 0
        ? { key: 'cited', label: 'Evidence cited', state: 'done', detail: `${v.citedComparables} comparable${v.citedComparables === 1 ? '' : 's'} cited`, blocking: false }
        : { key: 'cited', label: 'Evidence cited', state: 'warn', detail: 'Cite the verified comparables the rate rests on', blocking: false },
    );
    if (v.unsettledItems > 0) {
      items.push({ key: 'settled', label: 'Open items settled', state: 'todo', detail: `${v.unsettledItems} item${v.unsettledItems === 1 ? '' : 's'} still need a treatment before review`, blocking: false });
    }
  }
  items.push(
    sent
      ? { key: 'review', label: 'Sent for review', state: 'done', detail: v?.status === 'APPROVED' ? 'Approved by a second person' : 'Waiting for a second person to approve', blocking: true }
      : { key: 'review', label: 'Sent for review', state: 'todo', detail: 'Send the draft for review to continue', blocking: true },
  );
  items.push(
    input.openMaterialDiscrepancies === 0
      ? { key: 'discrepancies', label: 'Site differences cleared', state: 'done', detail: 'No material differences waiting', blocking: true }
      : { key: 'discrepancies', label: 'Site differences cleared', state: 'todo', detail: `${input.openMaterialDiscrepancies} material difference${input.openMaterialDiscrepancies === 1 ? '' : 's'} must be resolved or disclosed first`, blocking: true },
  );

  const done = items.filter((i) => i.state === 'done').length;
  return { items, done, total: items.length, canProceed: relaxChecks() || items.filter((i) => i.blocking).every((i) => i.state === 'done'), complete: done === items.length };
}

export interface ReviewReadinessInput {
  valuation: { versionNumber: number; status: string } | null;
  // The newest report that has not been superseded.
  report: { versionNumber: number; status: string; forLatestValuation: boolean; qcPassed: boolean; checklistTotal: number; checklistDone: number } | null;
  openMaterialDiscrepancies: number;
}

// How far quality review has got. The API lets the assignment move to
// approved only when the latest valuation is approved and an approved (or
// issued) report exists for it; the rest is the path to get there.
export function assessReviewReadiness(input: ReviewReadinessInput): Readiness {
  const items: ReadinessItem[] = [];
  const v = input.valuation;
  const r = input.report;
  const fresh = !!r && r.forLatestValuation;

  items.push(
    v?.status === 'APPROVED'
      ? { key: 'valuation', label: 'Valuation approved', state: 'done', detail: `Version ${v.versionNumber} has been approved`, blocking: true }
      : { key: 'valuation', label: 'Valuation approved', state: 'todo', detail: !v ? 'No valuation on record' : v.status === 'IN_REVIEW' ? `Version ${v.versionNumber} is waiting for approval` : `Version ${v.versionNumber} is ${v.status.toLowerCase().replace('_', ' ')}; send it for review first`, blocking: true },
  );
  items.push(
    input.openMaterialDiscrepancies === 0
      ? { key: 'discrepancies', label: 'Site differences cleared', state: 'done', detail: 'No material differences waiting', blocking: false }
      : { key: 'discrepancies', label: 'Site differences cleared', state: 'todo', detail: `${input.openMaterialDiscrepancies} material difference${input.openMaterialDiscrepancies === 1 ? '' : 's'} still open`, blocking: false },
  );
  items.push(
    fresh
      ? { key: 'report', label: 'Report drafted', state: 'done', detail: `Report R${r.versionNumber} drawn from the current valuation`, blocking: false }
      : r
        ? { key: 'report', label: 'Report drafted', state: 'todo', detail: `Report R${r.versionNumber} is from an older valuation. Prepare a new one`, blocking: false }
        : { key: 'report', label: 'Report drafted', state: 'todo', detail: 'Choose a template and create the draft report', blocking: false },
  );
  if (fresh) {
    items.push(
      r.qcPassed
        ? { key: 'qc', label: 'Quality checks passed', state: 'done', detail: 'Every required check passes', blocking: false }
        : { key: 'qc', label: 'Quality checks passed', state: 'todo', detail: 'Fix the failed checks and prepare the report again', blocking: false },
    );
    items.push(
      r.checklistTotal === 0
        ? { key: 'checklist', label: 'Review checklist', state: 'done', detail: 'The firm has set no checklist items for this property', blocking: false }
        : r.checklistDone === r.checklistTotal
          ? { key: 'checklist', label: 'Review checklist', state: 'done', detail: `All ${r.checklistTotal} items ticked`, blocking: false }
          : { key: 'checklist', label: 'Review checklist', state: 'todo', detail: `${r.checklistDone} of ${r.checklistTotal} items ticked. All must be ticked to approve`, blocking: false },
    );
    const sent = ['IN_REVIEW', 'APPROVED', 'ISSUED'].includes(r.status);
    items.push(
      sent
        ? { key: 'sent', label: 'Report sent for review', state: 'done', detail: r.status === 'IN_REVIEW' ? 'Waiting for a second person to approve' : 'Reviewed', blocking: false }
        : { key: 'sent', label: 'Report sent for review', state: 'todo', detail: 'Send the draft to a reviewer once the checks pass', blocking: false },
    );
  }
  const approved = fresh && (r.status === 'APPROVED' || r.status === 'ISSUED');
  items.push(
    approved
      ? { key: 'approved', label: 'Report approved', state: 'done', detail: r.status === 'ISSUED' ? 'Report has been issued' : 'Report has been approved', blocking: true }
      : { key: 'approved', label: 'Report approved', state: 'todo', detail: 'A reviewer must approve the report', blocking: true },
  );

  const done = items.filter((i) => i.state === 'done').length;
  return { items, done, total: items.length, canProceed: relaxChecks() || items.filter((i) => i.blocking).every((i) => i.state === 'done'), complete: done === items.length };
}

export interface SubmissionReadinessInput {
  status: string;
  report: { versionNumber: number; status: string } | null;
  submissions: { delivered: number; acknowledged: number; failed: number };
  openQueries: number;
  invoices: number;
  // What the API would refuse if the assignment were closed now.
  closeProblems: string[];
}

// How far the hand-over to the bank has got, and whether the file can be
// closed. The API enforces issuing before submission and the close checklist;
// the invoice and acknowledgement items are guidance.
export function assessSubmissionReadiness(input: SubmissionReadinessInput): Readiness {
  const items: ReadinessItem[] = [];
  const r = input.report;
  const issued = r?.status === 'ISSUED';

  items.push(
    r && ['APPROVED', 'ISSUED'].includes(r.status)
      ? { key: 'approved', label: 'Report approved', state: 'done', detail: `Report R${r.versionNumber} has been signed off`, blocking: false }
      : { key: 'approved', label: 'Report approved', state: 'todo', detail: 'Finish quality review so a report is approved', blocking: false },
  );
  items.push(
    issued
      ? { key: 'issued', label: 'Final report issued', state: 'done', detail: `R${r.versionNumber} is locked and ready to send`, blocking: false }
      : { key: 'issued', label: 'Final report issued', state: 'todo', detail: 'Issue the approved report to lock it', blocking: false },
  );
  items.push(
    input.submissions.delivered > 0
      ? { key: 'submitted', label: 'Submitted to the bank', state: 'done', detail: `${input.submissions.delivered} hand-over${input.submissions.delivered === 1 ? '' : 's'} recorded`, blocking: false }
      : input.submissions.failed > 0
        ? { key: 'submitted', label: 'Submitted to the bank', state: 'todo', detail: 'The last attempt failed. Send it again or record another channel', blocking: false }
        : { key: 'submitted', label: 'Submitted to the bank', state: 'todo', detail: 'Send the issued report and record how it went', blocking: false },
  );
  if (input.submissions.delivered > 0) {
    items.push(
      input.submissions.acknowledged > 0
        ? { key: 'acknowledged', label: 'Bank acknowledgement', state: 'done', detail: 'The bank has confirmed receipt', blocking: false }
        : { key: 'acknowledged', label: 'Bank acknowledgement', state: 'warn', detail: 'Record the bank’s acknowledgement when it arrives', blocking: false },
    );
  }
  items.push(
    input.openQueries === 0
      ? { key: 'queries', label: 'Bank queries answered', state: 'done', detail: 'No open queries', blocking: false }
      : { key: 'queries', label: 'Bank queries answered', state: 'todo', detail: `${input.openQueries} quer${input.openQueries === 1 ? 'y is' : 'ies are'} still open. Closing needs them answered`, blocking: false },
  );
  items.push(
    input.invoices > 0
      ? { key: 'invoice', label: 'Invoice raised', state: 'done', detail: `${input.invoices} invoice${input.invoices === 1 ? '' : 's'} on record`, blocking: false }
      : { key: 'invoice', label: 'Invoice raised', state: 'warn', detail: 'Raise the fee invoice in Accounts', blocking: false },
  );
  items.push(
    input.closeProblems.length === 0
      ? { key: 'close', label: 'Ready to close', state: 'done', detail: 'Everything needed for the archive is on record', blocking: true }
      : { key: 'close', label: 'Ready to close', state: 'todo', detail: input.closeProblems[0] + (input.closeProblems.length > 1 ? ` (+${input.closeProblems.length - 1} more)` : ''), blocking: true },
  );

  const done = items.filter((i) => i.state === 'done').length;
  return { items, done, total: items.length, canProceed: relaxChecks() || items.filter((i) => i.blocking).every((i) => i.state === 'done'), complete: done === items.length };
}
