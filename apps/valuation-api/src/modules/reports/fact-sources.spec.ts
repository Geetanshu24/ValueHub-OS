import { describe, expect, it } from 'vitest';
import { gatherFacts, toSqm, type DocRow } from './fact-sources.js';

const field = (fieldKey: string, value: string, extra: Partial<DocRow['fields'][number]> = {}) => ({
  fieldKey, extractedValue: value, verifiedValue: null, state: 'UNVERIFIED', confidence: null, useInReport: false, source: 'MANUAL', ...extra,
});

describe('toSqm', () => {
  it('converts sq yd and sq ft, and leaves sq m alone', () => {
    expect(toSqm('200', 'SQYD')).toBe('167.23');
    expect(toSqm('1800', 'SQFT')).toBe('167.23');
    expect(toSqm('185', 'SQM')).toBe('185');
    expect(toSqm('abc', 'SQYD')).toBe('abc');
  });
});

describe('gatherFacts', () => {
  it('uses the single value when documents agree, written in any unit', () => {
    const docs: DocRow[] = [
      { id: 'deed', fields: [field('plot_area_sqm', '200', { unit: 'SQYD' })] },
      { id: 'map', fields: [field('plot_area_sqm', '167.23', { unit: 'SQM' })] },
    ];
    const g = gatherFacts(docs);
    expect(g.conflicts).toEqual([]);
    expect(g.best.get('plot_area_sqm')?.value).toBe('167.23');
    expect(g.shown.get('deed')?.plot_area_sqm).toBe('200 sq yd = 167.23 sq m');
  });

  it('does not pick between documents a person filled in differently', () => {
    const g = gatherFacts([
      { id: 'deed', fields: [field('property_address', 'Plot 12, Sector 4')] },
      { id: 'map', fields: [field('property_address', 'H.No. 12, Sector-4')] },
    ]);
    expect(g.conflicts).toEqual(['property_address']);
    expect(g.best.has('property_address')).toBe(false);
  });

  it('lets a person settle it by choosing one', () => {
    const g = gatherFacts([
      { id: 'deed', fields: [field('property_address', 'Plot 12', { useInReport: true })] },
      { id: 'map', fields: [field('property_address', 'H.No. 12')] },
    ]);
    expect(g.conflicts).toEqual([]);
    expect(g.best.get('property_address')?.value).toBe('Plot 12');
  });

  it('does not call machine-read text a conflict', () => {
    const g = gatherFacts([
      { id: 'deed', fields: [field('boundary_east', 'House of Sharma')] },
      { id: 'letter', fields: [field('boundary_east', '12M Wide Road', { source: 'OCR', confidence: 0.4 })] },
    ]);
    expect(g.conflicts).toEqual([]);
    expect(g.best.get('boundary_east')?.value).toBe('House of Sharma');
  });
});
