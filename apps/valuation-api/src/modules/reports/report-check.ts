import type { TemplateField } from './docx-template.js';

export interface Issue {
  severity: 'warn' | 'info';
  message: string;
  keys?: string[];
}

export interface CheckInput {
  fields: TemplateField[];
  // What is in the form, without the bank's standard answers.
  values: Record<string, string>;
  documentFacts: { label: string; fileName: string; facts: Record<string, string> }[];
  // The share of the fair market value the bank's form writes as realizable value (0.9, or 0.95 for SBI).
  realizableShare: number;
}

const TITLES = /\b(mr|mrs|ms|shri|sh|smt|s\/o|d\/o|w\/o|son|daughter|wife|of)\b\.?/gi;
const words = (name: string) => new Set(name.toLowerCase().replace(TITLES, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((w) => w.length > 1));

function overlap(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 1;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size);
}

const lakh = (text: string | undefined) => {
  const m = /([\d,]+(?:\.\d+)?)\s*lakh/i.exec(text ?? '');
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

const dotted = (text: string | undefined) => {
  const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(text ?? '');
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
};

// Checks that need no AI: boxes still empty, documents that disagree, and figures that do not add up.
export function checkReport(input: CheckInput): Issue[] {
  const issues: Issue[] = [];
  const { fields, values } = input;
  const answered = (f: TemplateField) => (values[f.key] ?? '').trim() !== '' || f.default !== '';

  const bySection = new Map<string, TemplateField[]>();
  for (const f of fields) if (!f.hidden && !answered(f)) bySection.set(f.section, [...(bySection.get(f.section) ?? []), f]);
  for (const [section, empty] of bySection) {
    const shown = empty.slice(0, 6).map((f) => f.label.replace(/\s+/g, ' ').slice(0, 48));
    issues.push({ severity: 'info', message: `${section}: ${empty.length} box${empty.length === 1 ? '' : 'es'} still empty (${shown.join('; ')}${empty.length > 6 ? '; ...' : ''})`, keys: empty.map((f) => f.key) });
  }

  const read = (key: string) => input.documentFacts.flatMap((d) => (d.facts[key] ? [{ doc: d.fileName, value: d.facts[key] }] : []));
  const owners = [...read('owner_name'), ...read('buyer_name')];
  for (let i = 0; i < owners.length; i += 1) {
    for (let j = i + 1; j < owners.length; j += 1) {
      if (owners[i].doc !== owners[j].doc && overlap(owners[i].value, owners[j].value) < 0.5) {
        issues.push({ severity: 'warn', message: `Owner name differs between documents: "${owners[i].value}" (${owners[i].doc}) and "${owners[j].value}" (${owners[j].doc})`, keys: ['owner_details'] });
      }
    }
  }

  const areas = read('plot_area_sqm').map((a) => ({ ...a, n: Number(a.value) })).filter((a) => Number.isFinite(a.n) && a.n > 0);
  for (let i = 0; i < areas.length; i += 1) {
    for (let j = i + 1; j < areas.length; j += 1) {
      if (areas[i].doc !== areas[j].doc && Math.abs(areas[i].n - areas[j].n) / Math.max(areas[i].n, areas[j].n) > 0.005) {
        issues.push({ severity: 'warn', message: `Plot area differs: ${areas[i].n} sq m (${areas[i].doc}) and ${areas[j].n} sq m (${areas[j].doc})` });
      }
    }
  }

  const regs = read('registration_number');
  if (new Set(regs.map((r) => r.value)).size > 1) issues.push({ severity: 'warn', message: `Registration number differs between documents: ${[...new Set(regs.map((r) => `${r.value} (${r.doc})`))].join(', ')}` });

  const total = lakh(values.abs_total ?? values.tot_market ?? values.fmv);
  const realizable = lakh(values.abs_realizable ?? values.tot_realizable ?? values.realizable);
  if (total && realizable && Math.abs(realizable / total - input.realizableShare) > 0.01) {
    issues.push({ severity: 'warn', message: `Realizable value is ${(realizable / total * 100).toFixed(1)}% of the fair market value; this bank's form uses ${input.realizableShare * 100}%` });
  }

  const inspected = dotted(values.inspection_date);
  const valued = dotted(values.valuation_date);
  const reported = dotted(values.report_date);
  if (inspected && valued && valued < inspected) issues.push({ severity: 'warn', message: 'The valuation date is before the inspection date', keys: ['valuation_date', 'inspection_date'] });
  if (inspected && reported && reported < inspected) issues.push({ severity: 'warn', message: 'The report date is before the inspection date', keys: ['report_date', 'inspection_date'] });

  return issues;
}
