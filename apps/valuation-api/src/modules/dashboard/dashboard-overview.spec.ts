import { describe, expect, it } from 'vitest';
import { monthKeys, tally } from './dashboard.service.js';

describe('dashboard months', () => {
  it('lists the last months, oldest first, and counts dates into them', () => {
    const months = monthKeys(3, new Date('2026-11-12T00:00:00Z'));
    expect(months).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(tally(months, [new Date('2026-10-02'), new Date('2026-10-30'), new Date('2026-11-01'), new Date('2025-01-01')])).toEqual([0, 2, 1]);
  });
});
