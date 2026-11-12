import { describe, expect, it } from 'vitest';
import { stageOf, type Facts } from './lifecycle.js';

const base: Facts = { documents: 0, assigned: false, typed: 0, visit: 'none', decisions: 0, drafting: false, handedOver: false, reworkOpen: false, approved: false, sends: 0, billing: 'none' };
const stage = (patch: Partial<Facts>) => stageOf({ ...base, ...patch }).key;

describe('stageOf', () => {
  it('follows the case from new to paid', () => {
    expect(stage({})).toBe('NEW_CASE');
    expect(stage({ documents: 2 })).toBe('DOCUMENTS_UPLOADED');
    expect(stage({ documents: 2, assigned: true })).toBe('ASSIGNED');
    expect(stage({ documents: 2, assigned: true, typed: 3 })).toBe('EXTRACTION');
    expect(stage({ assigned: true, typed: 3, visit: 'open' })).toBe('SITE_IN_PROGRESS');
    expect(stage({ assigned: true, visit: 'done' })).toBe('SITE_DONE');
    expect(stage({ assigned: true, typed: 3, visit: 'done' })).toBe('COMPARISON');
    expect(stage({ assigned: true, typed: 3, visit: 'done', decisions: 1 })).toBe('DISCREPANCY_REVIEW');
    expect(stage({ typed: 3, visit: 'done', drafting: true })).toBe('DRAFTING');
    expect(stage({ typed: 3, visit: 'done', drafting: true, handedOver: true })).toBe('SUBMITTED_FOR_APPROVAL');
    expect(stage({ handedOver: true, reworkOpen: true })).toBe('REWORK');
    expect(stage({ approved: true })).toBe('APPROVED');
    expect(stage({ approved: true, sends: 1 })).toBe('SENT');
    expect(stage({ approved: true, sends: 1, billing: 'unpaid' })).toBe('PAYMENT_PENDING');
    expect(stage({ approved: true, sends: 1, billing: 'part_paid' })).toBe('PAYMENT_PENDING');
    expect(stage({ approved: true, sends: 1, billing: 'paid' })).toBe('PAID');
  });

  it('shows a returned report as rework until the drafter answers', () => {
    expect(stage({ drafting: true, handedOver: false, reworkOpen: true })).toBe('REWORK');
  });
});
