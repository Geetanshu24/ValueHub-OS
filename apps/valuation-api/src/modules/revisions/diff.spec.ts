import { describe, expect, it } from 'vitest';
import { diffLines, diffSnapshots, diffValuations, type ValuationLike } from './diff.js';

const land = { component: 'Land', quantity: 100, unit: 'sq. m', rate: 50000, amount: 5_000_000, treatment: 'SEPARATELY_VALUED', sourceNote: 'Comparables' };
const v1: ValuationLike = {
  versionNumber: 1, status: 'APPROVED', method: 'LAND_AREA_RATE', areaBasis: 'LAND_AREA', adoptedAreaSqm: 100,
  adoptedAreaSource: 'Revenue record', assumptions: null, totalValue: 5_000_000, changeReason: null, lines: [land],
};

describe('diffValuations', () => {
  it('reports a changed rate, the new total and the reason', () => {
    const v2: ValuationLike = { ...v1, versionNumber: 2, totalValue: 6_000_000, changeReason: 'Bank corrected rate', lines: [{ ...land, rate: 60000, amount: 6_000_000 }] };
    const diff = diffValuations(v1, v2);
    expect(diff.totalDelta).toBe(1_000_000);
    expect(diff.changeReason).toBe('Bank corrected rate');
    expect(diff.header.map((h) => h.field)).toEqual(['totalValue']);
    expect(diff.lines).toEqual([expect.objectContaining({ component: 'Land', change: 'CHANGED', fields: ['rate', 'amount'] })]);
  });

  it('reports added and removed lines, and nothing when identical', () => {
    expect(diffLines([land], [land])).toEqual([]);
    const solar = { ...land, component: 'Solar', amount: 50000 };
    const changes = diffLines([land], [solar]);
    expect(changes.map((c) => `${c.change}:${c.component}`).sort()).toEqual(['ADDED:Solar', 'REMOVED:Land']);
  });

  it('treats null, undefined and empty text as the same', () => {
    expect(diffLines([{ ...land, sourceNote: null }], [{ ...land, sourceNote: '' }])).toEqual([]);
  });
});

describe('diffSnapshots', () => {
  const snap = (value: string, limitations: string[]) => ({
    sections: [{ heading: 'Property', rows: [{ label: 'District', value }] }],
    workings: { lines: [land], totalValue: 5_000_000 },
    limitations,
    annexures: [{ documentId: 'd1', fileName: 'deed.pdf', sha256: 'abcdef123456' }],
    photos: [{ id: 'p1' }],
    template: { name: 'Standard', version: 1 },
  });

  it('finds changed fields and wording', () => {
    const diff = diffSnapshots(snap('Panipat', ['A']), snap('Karnal', ['A', 'B']));
    expect(diff.fields).toEqual([{ field: 'Property › District', from: 'Panipat', to: 'Karnal' }]);
    expect(diff.limitations).toEqual({ added: ['B'], removed: [] });
    expect(diff.template).toBeNull();
  });
});
