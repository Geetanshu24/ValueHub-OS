import { describe, expect, it } from 'vitest';
import { runQc, type QcInput } from './report-qc.js';

const base: QcInput = {
  spec: { title: 'T', sections: [], limitations: [], requiredAnnexures: ['SALE_DEED'], requirePhotos: true },
  missingRequired: [],
  lines: [
    { component: 'Land', quantity: 100, unit: 'sq. m', rate: 50000, amount: 5_000_000, treatment: 'SEPARATELY_VALUED', sourceNote: 'Comparables' },
    { component: 'Depreciation – Ground floor', quantity: -20, unit: '%', rate: 2_000_000, amount: -400_000, treatment: 'SEPARATELY_VALUED', sourceNote: 'Straight line' },
    { component: 'Solar', quantity: 1, unit: 'nos', rate: 50000, amount: 0, treatment: 'INCLUDED_IN_BASE_RATE' },
  ],
  totalValue: 4_600_000,
  adoptedAreaSqm: 100,
  templateClassMatches: true,
  templateBankMatches: true,
  valuationStatus: 'APPROVED',
  unresolvedDiscrepancies: 0,
  missingAnnexureTypes: [],
  annexuresMissingFiles: [],
  annexuresNotEmbeddable: [],
  unverifiedAreaFacts: 0,
  unverifiedOtherFacts: 0,
  photoCount: 2,
  unconfirmedPhotoCaptions: 0,
  photosNotEmbedded: 0,
  comparablesUnverified: 0,
};

const failing = (input: QcInput) => runQc(input).checks.filter((c) => c.status === 'FAIL').map((c) => c.code);

describe('runQc', () => {
  it('passes a clean report', () => {
    expect(runQc(base)).toMatchObject({ passed: true });
  });

  it('fails when the lines do not add up to the total', () => {
    expect(failing({ ...base, totalValue: 4_700_000 })).toContain('total_reconciles');
  });

  it('fails a line whose amount does not multiply out, and a non-counted line with an amount', () => {
    const lines = [...base.lines];
    lines[0] = { ...lines[0], amount: 4_999_000 };
    expect(failing({ ...base, lines, totalValue: 4_599_000 })).toContain('line_arithmetic');
    const stray = [...base.lines.slice(0, 2), { ...base.lines[2], amount: 10 }];
    expect(failing({ ...base, lines: stray })).toContain('line_arithmetic');
  });

  it('fails on missing sources, unresolved discrepancies and unreviewed area facts', () => {
    const lines = [{ ...base.lines[0], sourceNote: '' }, base.lines[1], base.lines[2]];
    expect(failing({ ...base, lines })).toContain('sources');
    expect(failing({ ...base, unresolvedDiscrepancies: 1 })).toContain('discrepancies');
    expect(failing({ ...base, unverifiedAreaFacts: 1 })).toContain('area_facts');
  });

  it('only warns about other unverified facts', () => {
    const result = runQc({ ...base, unverifiedOtherFacts: 3 });
    expect(result.passed).toBe(true);
    expect(result.checks.find((c) => c.code === 'other_facts')?.status).toBe('WARN');
  });

  it('requires annexures, their files, and photos when the template says so', () => {
    expect(failing({ ...base, missingAnnexureTypes: ['SALE_DEED'] })).toContain('annexures_present');
    expect(failing({ ...base, annexuresMissingFiles: ['deed.pdf'] })).toContain('annexure_files');
    expect(failing({ ...base, photoCount: 0 })).toContain('photos');
    expect(failing({ ...base, unconfirmedPhotoCaptions: 1 })).toContain('photo_captions');
    expect(runQc({ ...base, spec: { ...base.spec, requirePhotos: false }, photoCount: 0 }).passed).toBe(true);
  });

  it('refuses a draft valuation and a template for another class or bank', () => {
    expect(failing({ ...base, valuationStatus: 'DRAFT' })).toContain('valuation_state');
    expect(failing({ ...base, templateClassMatches: false })).toContain('template_class');
    expect(failing({ ...base, templateBankMatches: false })).toContain('template_bank');
  });
});
