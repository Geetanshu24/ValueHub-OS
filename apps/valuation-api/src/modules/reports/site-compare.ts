import { AREA_TOLERANCE_PERCENT, factLabel } from '@value-hub/valuation-shared';

export type CompareStatus = 'match' | 'differs' | 'document_only' | 'site_only' | 'none' | 'check';

export interface CompareRow {
  key: string;
  label: string;
  // What the report uses (the chosen or best documented value) and each document that says something.
  document: string;
  fromDocuments: { label: string; value: string }[];
  site: string;
  status: CompareStatus;
  note?: string;
}

export interface SiteSide {
  observations: Record<string, string>;
  measurements: { label: string; fieldKey: string | null; areaSqm: number }[];
}

const FLOOR_LABELS = ['Ground floor', 'First floor', 'Second floor', 'Basement'];

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const num = (v: string) => {
  const n = Number(v.replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0]);
  return Number.isFinite(n) ? n : NaN;
};

// Loose text match: the same words, or one wording inside the other ("30 ft road" vs "road 30 ft wide").
function sameText(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 4 && y.includes(x)) return true;
  if (y.length >= 4 && x.includes(y)) return true;
  const xs = new Set(x.split(' '));
  const ys = y.split(' ');
  const shared = ys.filter((w) => xs.has(w)).length;
  return shared > 0 && shared / Math.max(xs.size, ys.length) >= 0.7;
}

interface Spec {
  key: string;
  site: (s: SiteSide) => string;
  kind: 'text' | 'area' | 'count' | 'info';
}

const obs = (k: string) => (s: SiteSide) => (s.observations[k] ?? '').trim();
const area = (fieldKey: string, labels: string[]) => (s: SiteSide) => {
  const exact = s.measurements.find((m) => m.fieldKey === fieldKey);
  if (exact) return String(exact.areaSqm);
  const parts = s.measurements.filter((m) => labels.includes(m.label));
  return parts.length ? String(Number(parts.reduce((t, m) => t + m.areaSqm, 0).toFixed(2))) : '';
};

const SPECS: Spec[] = [
  { key: 'property_address', site: obs('site_address'), kind: 'text' },
  { key: 'boundary_east', site: obs('site_boundary_east'), kind: 'text' },
  { key: 'boundary_west', site: obs('site_boundary_west'), kind: 'text' },
  { key: 'boundary_north', site: obs('site_boundary_north'), kind: 'text' },
  { key: 'boundary_south', site: obs('site_boundary_south'), kind: 'text' },
  { key: 'plot_area_sqm', site: area('plot_area_sqm', ['Plot']), kind: 'area' },
  { key: 'built_up_area_sqm', site: area('built_up_area_sqm', FLOOR_LABELS), kind: 'area' },
  { key: 'carpet_area_sqm', site: area('carpet_area_sqm', ['Carpet']), kind: 'area' },
  { key: 'dimensions', site: (s) => (s.observations.site_length_ft && s.observations.site_breadth_ft ? `${s.observations.site_length_ft} x ${s.observations.site_breadth_ft} ft` : ''), kind: 'info' },
  { key: 'year_of_construction', site: obs('site_year_built'), kind: 'text' },
  { key: 'construction_details', site: (s) => [s.observations.construction, s.observations.quality && `${s.observations.quality} quality`, s.observations.condition].filter(Boolean).join(', '), kind: 'info' },
  { key: 'total_floors', site: obs('floors'), kind: 'count' },
  { key: 'accommodation', site: (s) => [s.observations.accommodation_ground && `Ground: ${s.observations.accommodation_ground}`, s.observations.accommodation_first && `First: ${s.observations.accommodation_first}`].filter(Boolean).join('; '), kind: 'info' },
  { key: 'road_width', site: (s) => (s.observations.road_width_ft ? `${s.observations.road_width_ft} ft` : ''), kind: 'info' },
];

// As per documents against as per site, one row per fact. Numbers are checked with the same tolerance
// the inspection uses; wording is matched loosely; facts that cannot be auto-checked are shown for a person to judge.
export function compareFacts(facts: Record<string, string>, documentFacts: { label: string; facts: Record<string, string> }[], site: SiteSide): CompareRow[] {
  return SPECS.map((spec) => {
    const document = (facts[spec.key] ?? '').trim();
    const siteValue = spec.site(site).trim();
    const fromDocuments = documentFacts.flatMap((d) => (d.facts[spec.key]?.trim() ? [{ label: d.label, value: d.facts[spec.key].trim() }] : []));
    const row: CompareRow = { key: spec.key, label: factLabel(spec.key), document, fromDocuments, site: siteValue, status: 'none' };
    if (!document && !siteValue) return row;
    if (!siteValue) return { ...row, status: 'document_only' };
    if (!document) return { ...row, status: 'site_only' };
    if (spec.kind === 'info') return { ...row, status: 'check', note: 'Read both and decide' };
    if (spec.kind === 'text') return { ...row, status: sameText(document, siteValue) ? 'match' : 'differs' };
    const d = num(document);
    const s = num(siteValue);
    if (!Number.isFinite(d) || !Number.isFinite(s)) return { ...row, status: 'check', note: 'Not a number' };
    if (spec.kind === 'count') return { ...row, status: d === s ? 'match' : 'differs' };
    const pct = d === 0 ? 100 : (Math.abs(s - d) / d) * 100;
    return pct <= AREA_TOLERANCE_PERCENT ? { ...row, status: 'match' } : { ...row, status: 'differs', note: `Site is ${s > d ? 'larger' : 'smaller'} by ${pct.toFixed(1)}%` };
  });
}
