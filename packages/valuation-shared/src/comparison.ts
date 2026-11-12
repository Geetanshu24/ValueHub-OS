// The comparison of what the documents say with what was found on site (see apps/valuation-api comparison module).
export const COMPARISON_STATUSES = ['consistent', 'verify', 'mismatch', 'missing', 'document'] as const;
export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];

export const COMPARISON_STATUS_LABELS: Record<ComparisonStatus, string> = {
  consistent: 'Consistent',
  verify: 'Needs a look',
  mismatch: 'Mismatch',
  missing: 'Missing evidence',
  document: 'Governed by documents',
};

// What a valuer may decide about a mismatch. Each option records how the difference is treated and,
// with the valuer's note, goes into the report. `outcome` is what the discrepancy is marked as.
export interface Treatment {
  key: string;
  label: string;
  hint: string;
  outcome: 'RESOLVED' | 'DISCLOSED' | 'ESCALATED';
  // Wording offered as the starting point for the valuer's note.
  noteTemplate: string;
}

export const GENERIC_TREATMENTS: Treatment[] = [
  { key: 'adopt_document', label: 'Adopt the document figure', hint: 'The documents are taken as right; the site difference is noted.', outcome: 'RESOLVED', noteTemplate: 'The figure in the documents is adopted. The difference found on site is within what can be put down to measurement and is noted here.' },
  { key: 'adopt_site', label: 'Adopt the site figure', hint: 'What was measured or seen on site is taken as right.', outcome: 'RESOLVED', noteTemplate: 'The figure found on site is adopted, as it was measured / seen directly. The documents differ and this is disclosed.' },
  { key: 'reinspect', label: 'Ask for a re-inspection', hint: 'Cannot be settled yet. This keeps blocking until it is settled.', outcome: 'ESCALATED', noteTemplate: 'A joint re-inspection or further evidence has been asked for before this is settled.' },
];

// Mismatches with their own standard treatments.
export const TREATMENTS: Record<string, Treatment[]> = {
  built_up_area_sqm: [
    { key: 'exclude_excess', label: 'Value only the documented area', hint: 'The extra built-up area is left out of the valuation and disclosed.', outcome: 'DISCLOSED', noteTemplate: 'The documented / sanctioned built-up area is adopted. The additional area found on site is not covered by the sanction and is excluded from the valuation. It is disclosed here for the bank.' },
    { key: 'compound', label: 'Value the measured area, subject to regularisation', hint: 'Needs proof that regularisation / compounding has been applied for.', outcome: 'DISCLOSED', noteTemplate: 'The measured built-up area is valued, subject to the owner regularising the excess construction. Proof of the application is to be obtained by the bank.' },
    { key: 'reinspect', label: 'Ask for a re-inspection or architect check', hint: 'Keeps blocking until it is settled.', outcome: 'ESCALATED', noteTemplate: 'A joint re-inspection / architect verification of the built-up area has been asked for.' },
  ],
  occupation_certificate: [
    { key: 'condition_precedent', label: 'Make it a condition for the bank', hint: 'The bank obtains the occupation certificate before it disburses.', outcome: 'DISCLOSED', noteTemplate: 'The occupation / completion certificate was not produced at inspection. The bank should obtain a copy of a valid certificate, or the regularisation order, from the borrower before it disburses.' },
    { key: 'land_only', label: 'Value the land only', hint: 'No value is given to the structure.', outcome: 'DISCLOSED', noteTemplate: 'As no occupation / completion certificate was produced, the valuation is restricted to the land. No value is given to the structure.' },
    { key: 'reinspect', label: 'Ask for the certificate first', hint: 'Keeps blocking until it is settled.', outcome: 'ESCALATED', noteTemplate: 'The occupation certificate has been asked for from the borrower. This is held until it is received.' },
  ],
};

export const treatmentsFor = (rowKey: string): Treatment[] => TREATMENTS[rowKey] ?? GENERIC_TREATMENTS;
