import { describe, expect, it } from 'vitest';
import { isOfficial } from './circle-rate.service.js';

describe('isOfficial', () => {
  it('accepts government sites', () => {
    expect(isOfficial('https://revenue.delhi.gov.in/circle-rates')).toBe(true);
    expect(isOfficial('https://igrsup.nic.in/rates.pdf')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isOfficial('https://www.magicbricks.com/circle-rate')).toBe(false);
    expect(isOfficial('https://gov.in.evil.com/x')).toBe(false);
    expect(isOfficial('https://notgov.in/x')).toBe(false);
    expect(isOfficial('javascript:alert(1)')).toBe(false);
    expect(isOfficial('')).toBe(false);
  });
});
