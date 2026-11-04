import { describe, expect, it } from 'vitest';
import { detectAreaDiscrepancies } from './area-check.js';

const deed = { fieldKey: 'plot_area_sqm', value: 150, source: 'Deed p.3' };

describe('detectAreaDiscrepancies', () => {
  it('flags the blueprint example: 150 sq. m on deed vs 146 on site', () => {
    const result = detectAreaDiscrepancies([deed], [{ fieldKey: 'plot_area_sqm', areaSqm: 146, source: 'Visit 1' }], 0.5);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ valueA: '150', valueB: '146', sourceA: 'Deed p.3', sourceB: 'Visit 1' });
  });

  it('ignores differences within tolerance', () => {
    expect(detectAreaDiscrepancies([deed], [{ fieldKey: 'plot_area_sqm', areaSqm: 150.5, source: 'v' }], 0.5)).toEqual([]);
  });

  it('only compares the same fact', () => {
    expect(detectAreaDiscrepancies([deed], [{ fieldKey: 'built_up_area_sqm', areaSqm: 10, source: 'v' }], 0.5)).toEqual([]);
  });

  it('skips non-positive documented values instead of dividing by zero', () => {
    const zero = { fieldKey: 'plot_area_sqm', value: 0, source: 'x' };
    expect(detectAreaDiscrepancies([zero], [{ fieldKey: 'plot_area_sqm', areaSqm: 5, source: 'v' }], 0.5)).toEqual([]);
  });
});
