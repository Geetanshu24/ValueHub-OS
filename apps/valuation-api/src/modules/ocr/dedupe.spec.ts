import { describe, expect, it } from 'vitest';
import { dedupeSuggestions } from './ocr.service.js';

describe('dedupeSuggestions', () => {
  it('keeps one of the same fact and the higher confidence', () => {
    const out = dedupeSuggestions([
      { fieldKey: 'plot_area_sqm', value: '167.22', pageNumber: 1, confidence: 0.4 },
      { fieldKey: 'plot_area_sqm', value: '167.22 ', pageNumber: 1, confidence: 0.6 },
      { fieldKey: 'plot_area_sqm', value: '200', pageNumber: 2, confidence: 0.5 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.value.trim() === '167.22')?.confidence).toBe(0.6);
  });
});
