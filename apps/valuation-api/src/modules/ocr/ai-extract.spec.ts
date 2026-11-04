import { describe, expect, it } from 'vitest';
import { AI_FACT_KEYS, groupPages, parseFacts } from './ai-extract.js';

describe('ai extract helpers', () => {
  it('marks each page and starts a new group when one would be too big', () => {
    const big = 'x'.repeat(40_000);
    const groups = groupPages([big, big, 'short']);
    expect(groups.length).toBe(2);
    expect(groups[0].text).toContain('=== PAGE 1 ===');
    expect(groups[1].first).toBe(2);
    expect(groups[1].text).toContain('=== PAGE 3 ===');
  });

  it('keeps only facts that were offered, have a value and sit on a real page', () => {
    const raw = JSON.stringify({
      facts: [
        { field_key: 'buyer_name', value: ' Naresh Kumar ', page_number: 3, confidence: 0.95 },
        { field_key: 'made_up_key', value: 'x', page_number: 1, confidence: 0.9 },
        { field_key: 'district', value: '', page_number: 1, confidence: 0.9 },
        { field_key: 'plot_number', value: 'F-139', page_number: 99, confidence: 0.2 },
      ],
    });
    const out = parseFacts(raw, 24);
    expect(out.map((s) => s.fieldKey)).toEqual(['buyer_name', 'plot_number']);
    expect(out[0]).toMatchObject({ value: 'Naresh Kumar', pageNumber: 3 });
    expect(out[0].confidence).toBeLessThanOrEqual(0.8); // an AI read is still only a suggestion
    expect(out[1].pageNumber).toBe(1);
  });

  it('survives an answer that is not JSON', () => {
    expect(parseFacts('not json', 5)).toEqual([]);
    expect(AI_FACT_KEYS).toContain('registration_number');
  });
});
