import type { TemplateSpec } from './template-spec.js';

export type QcStatus = 'PASS' | 'FAIL' | 'WARN';
export interface QcCheck {
  code: string;
  label: string;
  status: QcStatus;
  detail?: string;
}
export interface QcResult {
  passed: boolean;
  checks: QcCheck[];
}

export interface SnapshotLine {
  component: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  treatment: string;
  sourceNote?: string | null;
}

// What the QC needs from the frozen snapshot plus facts only the database can
// answer (do the files exist, are facts verified).
export interface QcInput {
  spec: TemplateSpec;
  missingRequired: string[];
  lines: SnapshotLine[];
  totalValue: number;
  adoptedAreaSqm: number;
  templateClassMatches: boolean;
  templateBankMatches: boolean;
  valuationStatus: string;
  unresolvedDiscrepancies: number;
  missingAnnexureTypes: string[];
  annexuresMissingFiles: string[];
  annexuresNotEmbeddable: string[];
  unverifiedAreaFacts: number;
  unverifiedOtherFacts: number;
  photoCount: number;
  unconfirmedPhotoCaptions: number;
  photosNotEmbedded: number;
  comparablesUnverified: number;
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.005;
const check = (code: string, label: string, ok: boolean, detail?: string, failStatus: QcStatus = 'FAIL'): QcCheck => ({
  code,
  label,
  status: ok ? 'PASS' : failStatus,
  detail: ok ? undefined : detail,
});

// Completeness, arithmetic, consistency and scope, as the blueprint's quality
// gate. `passed` means no FAIL; warnings are shown to the reviewer.
export function runQc(input: QcInput): QcResult {
  const checks: QcCheck[] = [];

  checks.push(check('required_fields', 'Required fields are filled', input.missingRequired.length === 0, `Missing: ${input.missingRequired.join(', ')}`));

  const counted = input.lines.filter((l) => l.treatment === 'SEPARATELY_VALUED');
  const sum = counted.reduce((t, l) => t + l.amount, 0);
  checks.push(check('total_reconciles', 'Line items add up to the assessed value', close(sum, input.totalValue), `Lines sum to ${sum.toFixed(2)} but total is ${input.totalValue.toFixed(2)}`));

  const badLines = input.lines.filter((l) => {
    if (l.treatment !== 'SEPARATELY_VALUED') return l.amount !== 0;
    const expected = l.unit === '%' ? (l.rate * l.quantity) / 100 : l.quantity * l.rate;
    return !close(expected, l.amount);
  });
  checks.push(check('line_arithmetic', 'Each line multiplies out correctly', badLines.length === 0, `Check: ${badLines.map((l) => l.component).join(', ')}`));

  const unsourced = counted.filter((l) => !l.sourceNote || l.sourceNote.trim() === '');
  checks.push(check('sources', 'Every counted figure has a stated source', unsourced.length === 0, `No source for: ${unsourced.map((l) => l.component).join(', ')}`));

  checks.push(check('area_positive', 'Adopted area is a positive figure', input.adoptedAreaSqm > 0, 'Adopted area must be greater than zero'));
  checks.push(check('valuation_state', 'Valuation is in review or approved', ['IN_REVIEW', 'APPROVED'].includes(input.valuationStatus), `Valuation is ${input.valuationStatus}; send it for review first`));
  checks.push(check('template_class', 'Template matches the property class', input.templateClassMatches, 'This template is for a different property class'));
  checks.push(check('template_bank', 'Template matches the bank', input.templateBankMatches, 'This template belongs to a different bank'));
  checks.push(check('discrepancies', 'No material discrepancy is unresolved', input.unresolvedDiscrepancies === 0, `${input.unresolvedDiscrepancies} unresolved; resolve or disclose each`));
  checks.push(check('area_facts', 'Documented areas have been reviewed', input.unverifiedAreaFacts === 0, `${input.unverifiedAreaFacts} area fact(s) are still unverified`));
  checks.push(check('other_facts', 'Other extracted facts have been reviewed', input.unverifiedOtherFacts === 0, `${input.unverifiedOtherFacts} extracted fact(s) are unverified`, 'WARN'));
  checks.push(check('comparables', 'Cited comparables are verified', input.comparablesUnverified === 0, `${input.comparablesUnverified} cited comparable(s) are unverified`));

  checks.push(check('annexures_present', 'Required annexures are attached', input.missingAnnexureTypes.length === 0, `Missing: ${input.missingAnnexureTypes.join(', ')}`));
  checks.push(check('annexure_files', 'Every cited annexure file exists', input.annexuresMissingFiles.length === 0, `Missing files: ${input.annexuresMissingFiles.join(', ')}`));
  checks.push(check('annexure_embed', 'Annexures can be placed in the report package', input.annexuresNotEmbeddable.length === 0, `Cannot embed: ${input.annexuresNotEmbeddable.join(', ')}`));

  if (input.spec.requirePhotos) {
    checks.push(check('photos', 'Inspection photos are attached', input.photoCount > 0, 'This template requires site photos'));
    checks.push(check('photo_captions', 'Photo captions are confirmed by the inspector', input.unconfirmedPhotoCaptions === 0, `${input.unconfirmedPhotoCaptions} caption(s) unconfirmed`));
  }
  checks.push(check('photo_embed', 'All photos are in the package', input.photosNotEmbedded === 0, `${input.photosNotEmbedded} photo(s) are listed but not embedded (unsupported format or over the limit)`, 'WARN'));

  return { passed: checks.every((c) => c.status !== 'FAIL'), checks };
}
