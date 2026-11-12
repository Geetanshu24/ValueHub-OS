import { describe, expect, it } from 'vitest';
import { stubAnswer } from './ai-stub.js';

describe('AI stand-in', () => {
  it('reads facts from document text and says nothing it cannot see', () => {
    const out = stubAnswer({ properties: { facts: {} } }, [{ type: 'text', text: 'Document text:\nPlot No. F-139, Registration No: 5847/2018, area 167.22 sq m, District: Panipat' }]) as { facts: { field_key: string; value: string }[] };
    const by = Object.fromEntries(out.facts.map((f) => [f.field_key, f.value]));
    expect(by.plot_number).toBe('F-139');
    expect(by.plot_area_sqm).toBe('167.22');
    expect(by.district).toBe('Panipat');
    expect((stubAnswer({ properties: { facts: {} } }, [{ type: 'text', text: 'nothing useful' }]) as { facts: unknown[] }).facts).toHaveLength(0);
  });

  it('answers each shape the app asks for, and labels it a demo', () => {
    const drafts = stubAnswer({ properties: { drafts: { items: { properties: { key: { enum: ['a', 'b'] } } } } } }, []) as { drafts: { key: string; text: string }[] };
    expect(drafts.drafts.map((d) => d.key)).toEqual(['a', 'b']);
    expect(drafts.drafts[0].text).toContain('Demo answer');
    expect((stubAnswer({ properties: { issues: {} } }, []) as { issues: unknown[] }).issues).toHaveLength(1);
    expect((stubAnswer({ properties: { reply: {}, needs_input: {} } }, [{ type: 'text', text: 'Query from the bank (query):\nWhy is the area different?' }]) as { reply: string }).reply).toContain('Why is the area different');
  });
});
