import { describe, expect, it } from 'vitest';
import { BankReportAiService } from './bank-report-ai.service.js';
import { BANK_FORMATS } from './bank-formats.js';
import { checkReport } from './report-check.js';

const format = BANK_FORMATS.find((f) => f.id === 'BOI')!;

describe('checkReport', () => {
  const base = { fields: format.fields, values: {}, documentFacts: [], realizableShare: 0.9 };

  it('lists the boxes still empty, by section, but not those with a standard answer', () => {
    const issues = checkReport({ ...base, values: { purpose: 'x' } });
    expect(issues.some((i) => /still empty/.test(i.message))).toBe(true);
    expect(issues.every((i) => !i.keys?.includes('purpose'))).toBe(true);
  });

  it('catches owners, areas and registration numbers that disagree between documents', () => {
    const issues = checkReport({
      ...base,
      documentFacts: [
        { label: 'Sale deed', fileName: 'deed.pdf', facts: { buyer_name: 'Naresh Kumar S/o Mahabir Prashad', plot_area_sqm: '253.94', registration_number: '2938' } },
        { label: 'Tax receipt', fileName: 'tax.pdf', facts: { owner_name: 'Mr. Rakesh Gupta', plot_area_sqm: '230', registration_number: '2938' } },
      ],
    });
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toContain('Owner name differs');
    expect(text).toContain('Plot area differs');
    expect(text).not.toContain('Registration number differs');
  });

  it('does not flag the same person written differently', () => {
    const issues = checkReport({ ...base, documentFacts: [{ label: 'a', fileName: 'a.pdf', facts: { owner_name: 'Shri Naresh Kumar' } }, { label: 'b', fileName: 'b.pdf', facts: { owner_name: 'Naresh Kumar S/o Mahabir Prashad' } }] });
    expect(issues.some((i) => /Owner name differs/.test(i.message))).toBe(false);
  });

  it('checks the realizable share and the dates', () => {
    const issues = checkReport({ ...base, values: { abs_total: 'Rs. 100.00 Lakh', abs_realizable: 'Rs. 70.00 Lakh', inspection_date: '10.10.2026', valuation_date: '09.10.2026' } });
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toContain('Realizable value is 70.0%');
    expect(text).toContain('valuation date is before the inspection date');
  });
});

describe('AI help for a report', () => {
  const ctx = { format, values: { purpose: 'Home loan' } as Record<string, string>, facts: { buyer_name: 'Naresh Kumar' }, documentFacts: [], propertyClass: 'LAND', inspectionId: null as string | null };
  const reports = { merged: async () => ctx, photos: async () => [] };

  it('drafts only boxes that exist in the format, and drops empty drafts', async () => {
    const ai = { enabled: () => true, json: async () => ({ drafts: [{ key: 'property_description', text: ' A vacant plot. ', basis: 'area' }, { key: 'market_opinion', text: '  ', basis: '' }] }) };
    const service = new BankReportAiService(reports as never, ai as never);
    const out = await service.draft('f', 'a', undefined, ['property_description', 'market_opinion', 'not_a_box']);
    expect(out.drafts).toEqual([{ key: 'property_description', label: expect.any(String), text: 'A vacant plot.', basis: 'area' }]);
  });

  it('suggests nothing from photographs when there are none', async () => {
    const service = new BankReportAiService(reports as never, { enabled: () => true } as never);
    expect(await service.photos('f', 'a')).toEqual({ suggestions: [] });
  });
});
