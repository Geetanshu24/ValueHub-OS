import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TemplateField } from './docx-template.js';
import { prefillBoi, type PrefillInput } from './boi-prefill.js';
import { prefillPnb } from './pnb-prefill.js';
import { prefillSbi } from './sbi-prefill.js';

// A bank's own report format: its Word template, the boxes the valuer fills in, and how the
// records already held are turned into suggested answers.
export interface BankFormat {
  id: 'BOI' | 'PNB' | 'SBI';
  label: string;
  title: string;
  // Banks whose name this format is used for by default.
  bankName: RegExp;
  footer: string;
  fields: TemplateField[];
  keys: string[];
  template: Buffer;
  prefill: (input: PrefillInput) => Record<string, string>;
}

function load(id: BankFormat['id']) {
  const dir = fileURLToPath(new URL(`./templates/${id}/`, import.meta.url));
  const fields = JSON.parse(readFileSync(`${dir}fields.json`, 'utf8')) as TemplateField[];
  return { fields, keys: fields.map((f) => f.key), template: readFileSync(`${dir}template.docx`) };
}

export const BANK_FORMATS: BankFormat[] = [
  { id: 'BOI', label: 'Bank of India', title: 'Bank of India valuation report', bankName: /(?<!state\s)bank\s+of\s+india|\bboi\b/i, footer: 'This valuation report only meant for Bank of India purpose only. Not for other purpose', prefill: prefillBoi, ...load('BOI') },
  { id: 'PNB', label: 'Punjab National Bank', title: 'Punjab National Bank valuation report', bankName: /punjab\s+national|\bpnb\b/i, footer: 'This Report only meant for Punjab National Bank', prefill: prefillPnb, ...load('PNB') },
  { id: 'SBI', label: 'State Bank of India', title: 'State Bank of India valuation report', bankName: /state\s+bank\s+of\s+india|\bsbi\b/i, footer: 'This Report only meant for SBI Bank', prefill: prefillSbi, ...load('SBI') },
];

// The format asked for, else the one for the assignment's bank, else Bank of India's.
export function chooseFormat(bankName: string, requested?: string): BankFormat {
  return BANK_FORMATS.find((f) => f.id === requested) ?? BANK_FORMATS.find((f) => f.bankName.test(bankName)) ?? BANK_FORMATS[0];
}
