import { describe, expect, it } from 'vitest';
import { monthlyTrend, perSqft, perSqm, summarisePlaces } from './rates.js';

describe('market rates', () => {
  it('restates rates per sq m so sq ft and sq yd quotes compare', () => {
    expect(perSqm(10_000, 'SQ_FT')).toBeCloseTo(107_639.1, 0);
    expect(perSqm(10_000, 'SQ_M')).toBe(10_000);
    expect(perSqft(perSqm(13_000, 'SQ_FT'))).toBeCloseTo(13_000, 0);
    expect(perSqft(perSqm(170_000, 'SQ_YD'))).toBeCloseTo((170_000 / 9), -1);
  });

  it('averages by month, oldest first, and leaves out months with nothing', () => {
    const rows = [
      { observedOn: new Date('2026-10-05'), ratePerSqm: perSqm(13_000, 'SQ_FT') },
      { observedOn: new Date('2026-10-20'), ratePerSqm: perSqm(14_000, 'SQ_FT') },
      { observedOn: new Date('2026-08-02'), ratePerSqm: perSqm(12_000, 'SQ_FT') },
      { observedOn: new Date('2024-01-02'), ratePerSqm: perSqm(5_000, 'SQ_FT') },
    ];
    const trend = monthlyTrend(rows, 12, new Date('2026-11-10'));
    expect(trend.map((p) => p.month)).toEqual(['2026-08', '2026-10']);
    expect(trend[1]).toMatchObject({ count: 2 });
    expect(trend[1].average).toBeCloseTo(13_500, 0);
  });

  it('sums up each place by its middle rate and leaves circle rates out', () => {
    const at = (d: string) => new Date(d);
    const rows = [
      { locality: 'A', propertyClass: 'FLAT', ratePerSqm: perSqm(12_000, 'SQ_FT'), observedOn: at('2026-10-01'), kind: 'TRANSACTION' },
      { locality: 'A', propertyClass: 'FLAT', ratePerSqm: perSqm(13_000, 'SQ_FT'), observedOn: at('2026-10-09'), kind: 'ASKING' },
      { locality: 'A', propertyClass: 'FLAT', ratePerSqm: perSqm(20_000, 'SQ_FT'), observedOn: at('2026-10-10'), kind: 'TRANSACTION' },
      { locality: 'A', propertyClass: 'FLAT', ratePerSqm: perSqm(5_000, 'SQ_FT'), observedOn: at('2026-10-11'), kind: 'CIRCLE' },
      { locality: 'B', propertyClass: 'LAND', ratePerSqm: perSqm(9_000, 'SQ_FT'), observedOn: at('2026-09-01'), kind: 'ASKING' },
    ];
    const [a, b] = summarisePlaces(rows);
    expect(a).toMatchObject({ locality: 'A', count: 3, freshestOn: '2026-10-10' });
    expect(a.benchmark).toBeCloseTo(13_000, 0);
    expect(a.low).toBeCloseTo(12_000, 0);
    expect(a.high).toBeCloseTo(20_000, 0);
    expect(b.locality).toBe('B');
  });
});
