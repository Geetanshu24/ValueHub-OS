import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { BANK_FORMATS, chooseFormat } from './bank-formats.js';
import { renderBoiPdf } from './boi-pdf.js';
import { prefillBoi, type PrefillInput } from './boi-prefill.js';
import { docxToDocument, fillDocx, resolveValues } from './docx-template.js';
import { rupeesInWords } from './sbi-prefill.js';

const input: PrefillInput = {
  today: new Date('2026-10-10T00:00:00Z'),
  firmName: 'Bansal Valuers',
  valuerName: 'Er. Shubham Bansal',
  assignment: { code: 'SB/2026/OCT/BOI/64', purpose: 'Fair market value for banking', valuationDate: new Date('2026-10-10T00:00:00Z'), receivedAt: new Date('2026-10-09T00:00:00Z'), instructionDate: null, borrowerName: null, bankName: 'Bank of India', branchName: 'Sohna Road, Gurugram' },
  property: { propertyClass: 'LAND', addressLine: 'F-139, Central Park Flower Valley, Sector-33, Sohna', unitDetail: 'F-139', locality: 'Sector 33', village: null, tehsil: 'Sohna', district: 'Gurugram', state: 'Haryana', pinCode: '122103', latitude: null, longitude: null, boundaries: null },
  inspection: { visitedAt: new Date('2026-10-10T00:00:00Z'), latitude: 28.2813, longitude: 77.0805 },
  valuation: { totalValue: 74_408_000, adoptedAreaSqm: 253.94 },
  facts: { plot_area_sqm: '253.94', buyer_name: 'Naresh Kumar', boundary_north: 'Plot no F-140', boundary_east: '12 M Wide Road', sale_consideration: '45,879,600.00' },
  documents: [{ type: 'SALE_DEED', fileName: 'deed.pdf', registrationNumber: '2938', documentDate: '2026-06-30' }],
};

const linesOf = async (docx: Buffer) => {
  const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
  return xml.replace(/<\/w:p>/g, '\n').replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, '').replaceAll('&amp;', '&').split('\n').map((l) => l.trim()).filter(Boolean);
};

describe('prefill', () => {
  const prefill = prefillBoi(input);

  it('suggests what the records already hold', () => {
    expect(prefill.owner_details).toBe('Naresh Kumar');
    expect(prefill.extent_site).toContain('303.71 Syd');
    expect(prefill.area_site).toBe('303.71 Sq Yds i.e. 253.94 Sq Mtrs');
    expect(prefill.inspection_date).toBe('10.10.2026');
    expect(prefill.documents_list).toContain('no. 2938 dated 30.06.2026');
    expect(prefill.title_deed).toContain('Sale deed');
    expect(prefill.boundary_north_deed).toBe('Plot no F-140');
    expect(prefill.abs_total).toBe('Rs. 744.08 Lakh');
    expect(prefill.tot_realizable).toBe('Rs. 669.67 Lakh');
    expect(prefill.branch_name).toBe('Sohna Road, Gurugram');
    expect(prefill.coordinates).toContain('28°16');
  });

  it('uses what the AI read from the documents', () => {
    const out = prefillBoi({ ...input, facts: { ...input.facts, owner_name: 'Naresh Kumar S/o Mahabir Prashad', dimension_north: '20.900 m', legal_restriction: 'Plot is mortgaged to SBI', approving_authority: 'HSVP', oc_details: 'OC memo TS/40/OC/2023 dated 05.05.2023', electricity_consumer_no: '123456' } });
    expect(out.owner_details).toBe('Naresh Kumar S/o Mahabir Prashad');
    expect(out.dimension_north_deed).toBe('20.900 m');
    expect(out.lg_15).toBe('Plot is mortgaged to SBI');
    expect(out.tp_3).toBe('HSVP');
    expect(out.tp_16).toContain('TS/40/OC/2023');
    expect(out.lg_13a).toBe('Consumer no. 123456');
  });

  it('puts the valuer\'s notes on documents-versus-site differences into the report', () => {
    const out = prefillBoi({ ...input, disclosures: { built_up_area_sqm: 'Excess area is excluded from the valuation.', occupation_certificate: 'OC to be obtained by the bank.' } });
    expect(out.violations).toBe('Excess area is excluded from the valuation.');
    expect(out.tp_16).toBe('OC to be obtained by the bank.');
    expect(out.b_map_comments).toContain('OC to be obtained');
  });

  it('never suggests an "as per actual" site measure it has not seen', () => {
    expect(prefill.boundary_north_actual).toBeUndefined();
    expect(prefill.dimension_north_actual).toBeUndefined();
  });

  it('writes amounts in words the way the SBI form does', () => {
    expect(rupeesInWords(10_600_000)).toBe('Rupees One Hundred Six Lakh');
    expect(rupeesInWords(10_070_000)).toBe('Rupees One Hundred Lakh & Seventy Thousand');
    expect(rupeesInWords(9_010_000)).toBe('Rupees Ninety Lakh & Ten Thousand');
  });
});

describe('bank formats', () => {
  it('picks the format from the bank, unless one is asked for', () => {
    expect(chooseFormat('Punjab National Bank').id).toBe('PNB');
    expect(chooseFormat('PNB').id).toBe('PNB');
    expect(chooseFormat('Bank of India').id).toBe('BOI');
    expect(chooseFormat('State Bank of India').id).toBe('SBI');
    expect(chooseFormat('SBI RACPC').id).toBe('SBI');
    expect(chooseFormat('Some Other Bank').id).toBe('BOI');
    expect(chooseFormat('Punjab National Bank', 'BOI').id).toBe('BOI');
  });

  for (const format of BANK_FORMATS) {
    describe(format.id, () => {
      it('has a box for every {{placeholder}} in the template, and no two boxes share a key', async () => {
        expect(new Set(format.keys).size).toBe(format.keys.length);
        const xml = await (await JSZip.loadAsync(format.template)).file('word/document.xml')!.async('string');
        const used = new Set([...xml.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((m) => m[1]).filter((k) => k !== 'photos' && !k.startsWith('img_')));
        expect([...used].filter((k) => !format.keys.includes(k))).toEqual([]);
        expect(format.keys.filter((k) => !used.has(k))).toEqual([]);
      });

      it('puts every answer into the report, and leaves out the sample property', async () => {
        const marked = Object.fromEntries(format.fields.map((f) => [f.key, `@@${f.key}@@`]));
        const text = (await linesOf(await fillDocx(format.template, marked, {}))).join('\n');
        for (const field of format.fields) expect(text, field.key).toContain(`@@${field.key}@@`);
        expect(text).not.toMatch(/Naresh|Chawla|Agrawal|Mikasa|Honour Homes/);
      });

      it('writes a Word file and a PDF from the records', async () => {
        const values = Object.fromEntries(Object.entries(format.prefill(input)).filter(([k]) => format.keys.includes(k)));
        const answers = resolveValues(format.fields, values, true);
        const docx = await fillDocx(format.template, answers, {});
        const marked = await fillDocx(format.template, answers, {}, true);
        const pdf = await renderBoiPdf(await docxToDocument(marked, {}, format.footer));
        expect(docx.subarray(0, 2).toString()).toBe('PK');
        expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
        const text = (await linesOf(docx)).join('\n');
        expect(text).toContain('Naresh Kumar');
        expect(text).not.toContain('{{');
      });
    });
  }
});
