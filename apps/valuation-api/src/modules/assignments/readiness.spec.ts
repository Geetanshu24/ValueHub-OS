import { describe, expect, it } from 'vitest';
import { assessReadiness, type ReadinessInput } from './readiness.js';

const complete = { addressLine: 'Plot 1', locality: 'Sector 12', district: 'Panipat', state: 'Haryana', pinCode: '132103' };
const base: ReadinessInput = { propertyClass: 'HOUSE', property: complete, documents: [], facts: [] };

describe('assessReadiness', () => {
  it('blocks inspection until a document is on file', () => {
    const result = assessReadiness(base);
    expect(result.canProceed).toBe(false);
    expect(result.items.find((i) => i.key === 'any-document')?.state).toBe('todo');
  });

  it('lets inspection start with one document but is not complete', () => {
    const result = assessReadiness({ ...base, documents: [{ type: 'OTHER' }] });
    expect(result.canProceed).toBe(true);
    expect(result.complete).toBe(false);
  });

  it('asks for a revenue record on land but a plan on a house', () => {
    const land = assessReadiness({ ...base, propertyClass: 'LAND', documents: [{ type: 'OTHER' }] });
    expect(land.items.find((i) => i.key === 'doc-REVENUE_RECORD')?.state).toBe('todo');
    expect(land.items.find((i) => i.key === 'doc-APPROVED_PLAN')?.state).toBe('warn');
    const house = assessReadiness({ ...base, documents: [{ type: 'OTHER' }] });
    expect(house.items.find((i) => i.key === 'doc-APPROVED_PLAN')?.state).toBe('todo');
  });

  it('counts unverified facts and flags conflicting areas', () => {
    const result = assessReadiness({
      ...base,
      documents: [{ type: 'SALE_DEED' }],
      facts: [
        { documentId: 'a', fieldKey: 'plot_area_sqm', state: 'UNVERIFIED', value: '450' },
        { documentId: 'b', fieldKey: 'plot_area_sqm', state: 'VERIFIED', value: '500' },
      ],
    });
    expect(result.items.find((i) => i.key === 'facts')?.detail).toContain('1 fact');
    expect(result.items.find((i) => i.key === 'conflicts')?.detail).toContain('450 vs 500');
    expect(result.items.find((i) => i.key === 'area')?.state).toBe('done');
  });

  it('is complete when everything is in order', () => {
    const result = assessReadiness({
      propertyClass: 'LAND',
      property: complete,
      documents: [{ type: 'BANK_INSTRUCTION' }, { type: 'SALE_DEED' }, { type: 'REVENUE_RECORD' }, { type: 'APPROVED_PLAN' }, { type: 'TAX_RECEIPT' }],
      facts: [{ documentId: 'a', fieldKey: 'plot_area_sqm', state: 'VERIFIED', value: '450' }],
    });
    expect(result.complete).toBe(true);
  });
});

import { assessInspectionReadiness, type InspectionReadinessInput } from './readiness.js';

const visit = { status: 'IN_PROGRESS', measurements: 0, keyedMeasurements: 0, photos: 0, unconfirmedCaptions: 0, observations: 0, hasGps: false };
const site = (over: Partial<InspectionReadinessInput> = {}): InspectionReadinessInput => ({
  current: visit, visits: [{ status: 'IN_PROGRESS' }], documentedAreas: 0, openMaterialDiscrepancies: 0, minPhotos: 4, minObservations: 5, ...over,
});

describe('assessInspectionReadiness', () => {
  it('blocks valuation until a visit is submitted', () => {
    const r = assessInspectionReadiness(site());
    expect(r.canProceed).toBe(false);
    expect(r.items.find((i) => i.key === 'measurements')?.state).toBe('todo');
  });

  it('asks to compare with documents only when documented areas exist', () => {
    expect(assessInspectionReadiness(site()).items.some((i) => i.key === 'compared')).toBe(false);
    const r = assessInspectionReadiness(site({ documentedAreas: 2 }));
    expect(r.items.find((i) => i.key === 'compared')?.state).toBe('warn');
  });

  it('counts photos, unconfirmed captions and observations', () => {
    const r = assessInspectionReadiness(site({ current: { ...visit, photos: 2, unconfirmedCaptions: 2, observations: 7 } }));
    expect(r.items.find((i) => i.key === 'photos')?.detail).toBe('2 of at least 4 photos');
    expect(r.items.find((i) => i.key === 'captions')?.state).toBe('todo');
    expect(r.items.find((i) => i.key === 'observations')?.state).toBe('done');
  });

  it('lets valuation start once submitted, and flags open discrepancies', () => {
    const r = assessInspectionReadiness(site({ current: { ...visit, status: 'SUBMITTED' }, visits: [{ status: 'SUBMITTED' }], openMaterialDiscrepancies: 1 }));
    expect(r.canProceed).toBe(true);
    expect(r.items.find((i) => i.key === 'discrepancies')?.state).toBe('warn');
    expect(r.items.find((i) => i.key === 'reviewed')?.state).toBe('warn');
  });
});

import { assessValuationReadiness } from './readiness.js';

describe('assessValuationReadiness', () => {
  const base = { inspectionSubmitted: true, latest: null, openMaterialDiscrepancies: 0, verifiedComparables: 0, minComparables: 3 };
  it('cannot go to quality review without a draft sent for review', () => {
    expect(assessValuationReadiness(base).canProceed).toBe(false);
    const drafted = assessValuationReadiness({ ...base, latest: { versionNumber: 1, status: 'DRAFT', unsettledItems: 0, citedComparables: 0 } });
    expect(drafted.canProceed).toBe(false);
  });
  it('can proceed once the latest version is with review and nothing material is open', () => {
    const r = assessValuationReadiness({ ...base, latest: { versionNumber: 1, status: 'IN_REVIEW', unsettledItems: 0, citedComparables: 2 }, verifiedComparables: 3 });
    expect(r.canProceed).toBe(true);
    expect(r.items.find((i) => i.key === 'evidence')?.state).toBe('done');
  });
  it('is blocked by an open material discrepancy even when sent for review', () => {
    const r = assessValuationReadiness({ ...base, latest: { versionNumber: 2, status: 'APPROVED', unsettledItems: 0, citedComparables: 1 }, openMaterialDiscrepancies: 2 });
    expect(r.canProceed).toBe(false);
    expect(r.items.find((i) => i.key === 'discrepancies')?.detail).toContain('2 material');
  });
  it('lists unsettled items as something to do', () => {
    const r = assessValuationReadiness({ ...base, latest: { versionNumber: 1, status: 'DRAFT', unsettledItems: 2, citedComparables: 0 } });
    expect(r.items.find((i) => i.key === 'settled')?.state).toBe('todo');
  });
});

import { assessReviewReadiness } from './readiness.js';

describe('assessReviewReadiness', () => {
  const report = { versionNumber: 1, status: 'DRAFT', forLatestValuation: true, qcPassed: true, checklistTotal: 3, checklistDone: 3 };
  it('needs an approved valuation and an approved report to proceed', () => {
    const early = assessReviewReadiness({ valuation: { versionNumber: 1, status: 'IN_REVIEW' }, report: null, openMaterialDiscrepancies: 0 });
    expect(early.canProceed).toBe(false);
    const ready = assessReviewReadiness({ valuation: { versionNumber: 1, status: 'APPROVED' }, report: { ...report, status: 'APPROVED' }, openMaterialDiscrepancies: 0 });
    expect(ready.canProceed).toBe(true);
    expect(ready.complete).toBe(true);
  });
  it('does not count a report built on an older valuation', () => {
    const r = assessReviewReadiness({ valuation: { versionNumber: 2, status: 'APPROVED' }, report: { ...report, status: 'APPROVED', forLatestValuation: false }, openMaterialDiscrepancies: 0 });
    expect(r.canProceed).toBe(false);
    expect(r.items.find((i) => i.key === 'report')?.detail).toContain('older valuation');
  });
  it('counts the checklist', () => {
    const r = assessReviewReadiness({ valuation: { versionNumber: 1, status: 'APPROVED' }, report: { ...report, checklistDone: 1 }, openMaterialDiscrepancies: 0 });
    expect(r.items.find((i) => i.key === 'checklist')?.detail).toContain('1 of 3');
  });
});

import { assessSubmissionReadiness } from './readiness.js';

describe('assessSubmissionReadiness', () => {
  const base = { status: 'APPROVED', report: { versionNumber: 1, status: 'APPROVED' }, submissions: { delivered: 0, acknowledged: 0, failed: 0 }, openQueries: 0, invoices: 0, closeProblems: ['Archive is missing a submission record'] };
  it('asks for the report to be issued before sending', () => {
    const r = assessSubmissionReadiness(base);
    expect(r.items.find((i) => i.key === 'issued')?.state).toBe('todo');
    expect(r.canProceed).toBe(false);
    expect(r.items.find((i) => i.key === 'close')?.detail).toContain('submission record');
  });
  it('is ready to close once the archive is complete', () => {
    const r = assessSubmissionReadiness({ ...base, status: 'SUBMITTED', report: { versionNumber: 1, status: 'ISSUED' }, submissions: { delivered: 1, acknowledged: 1, failed: 0 }, invoices: 1, closeProblems: [] });
    expect(r.canProceed).toBe(true);
    expect(r.complete).toBe(true);
  });
  it('flags a failed delivery and open queries', () => {
    const r = assessSubmissionReadiness({ ...base, report: { versionNumber: 1, status: 'ISSUED' }, submissions: { delivered: 0, acknowledged: 0, failed: 1 }, openQueries: 2 });
    expect(r.items.find((i) => i.key === 'submitted')?.detail).toContain('failed');
    expect(r.items.find((i) => i.key === 'queries')?.state).toBe('todo');
  });
});
