import { describe, expect, it } from 'vitest';
import { computeLifecycle, type LifecycleInput } from './lifecycle.js';

const base: LifecycleInput = { status: 'INTAKE', createdAt: new Date('2026-11-01'), valuer: 'A. Valuer', documents: [], factCount: 0, inspections: [], openMaterialDiscrepancies: 0, valuations: [], reports: [], submissions: [], invoices: [], closedAt: null };
const state = (input: LifecycleInput) => computeLifecycle(input).stages.map((s) => s.state[0]).join('');

describe('lifecycle', () => {
  it('starts at documents for a new assignment', () => {
    const life = computeLifecycle(base);
    expect(life.active).toBe(2);
    expect(life.stages).toHaveLength(15);
    expect(life.stages[0].state).toBe('done');
    expect(life.stages[1].state).toBe('active');
  });

  it('stops at the resolution gate while a difference is open', () => {
    const input: LifecycleInput = { ...base, status: 'VALUATION', documents: [{ uploadedAt: new Date('2026-11-02'), ocrStatus: 'DONE' }], factCount: 4, inspections: [{ status: 'SUBMITTED', visitedAt: new Date('2026-11-05'), createdAt: new Date('2026-11-03'), inspector: 'S. Rawat' }], openMaterialDiscrepancies: 2 };
    const life = computeLifecycle(input);
    expect(life.active).toBe(9);
    expect(life.stages[8].detail).toContain('2 differences');
    expect(state(input)).toBe('dddddddda' + 'pppppp');
  });

  it('is on the valuer review while the report is under review', () => {
    const input: LifecycleInput = { ...base, status: 'QUALITY_REVIEW', documents: [{ uploadedAt: new Date('2026-11-02'), ocrStatus: 'DONE' }], factCount: 4, inspections: [{ status: 'REVIEWED', visitedAt: new Date('2026-11-05'), createdAt: new Date('2026-11-03'), inspector: 'S. Rawat' }], valuations: [{ createdAt: new Date('2026-11-06'), status: 'IN_REVIEW' }] };
    expect(computeLifecycle(input).active).toBe(12);
  });

  it('is finished when the assignment is closed', () => {
    const life = computeLifecycle({ ...base, status: 'CLOSED', documents: [{ uploadedAt: new Date(), ocrStatus: 'DONE' }], factCount: 1, inspections: [{ status: 'REVIEWED', visitedAt: new Date(), createdAt: new Date(), inspector: 'x' }], valuations: [{ createdAt: new Date(), status: 'ISSUED' }], reports: [{ status: 'ISSUED', approvedAt: new Date(), issuedAt: new Date() }], submissions: [{ sentAt: new Date(), channel: 'EMAIL' }], invoices: [{ code: 'INV-1', createdAt: new Date() }], closedAt: new Date() });
    expect(life.active).toBe(16);
    expect(life.stages.every((s) => s.state === 'done')).toBe(true);
  });

  it('does not hold a case at fact extraction when nothing needed reading', () => {
    const life = computeLifecycle({ ...base, status: 'VALUATION', documents: [{ uploadedAt: new Date(), ocrStatus: 'NOT_RUN' }], inspections: [{ status: 'SUBMITTED', visitedAt: new Date(), createdAt: new Date(), inspector: 'x' }] });
    expect(life.active).toBe(10);
  });
});
