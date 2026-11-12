import { AREA_TOLERANCE_PERCENT, type ComparisonStatus, type DocumentType, type PropertyClass } from '@value-hub/valuation-shared';

export interface Evidence {
  value: string;
  source: string;
}

export interface ComparisonRow {
  key: string;
  label: string;
  group: 'Identity' | 'Land' | 'Building' | 'Legal';
  document: Evidence | null;
  site: Evidence | null;
  status: ComparisonStatus;
  // How far apart the two are, when they are numbers.
  delta: string | null;
  tolerance: string | null;
  // A mismatch on this row must be settled by a person before the valuation goes on.
  needsResolution: boolean;
  hint: string | null;
}

export interface CompareInput {
  propertyClass: PropertyClass;
  record: { addressLine: string; unitDetail: string | null; khasraNumbers: string[]; borrowerName: string | null };
  // The best known value of each documented fact, with where it was read.
  docFacts: Record<string, Evidence>;
  documents: { type: DocumentType; fileName: string }[];
  inspection: null | {
    observations: Record<string, string>;
    measurements: { label: string; areaSqm: number; fieldKey: string | null }[];
    source: string;
  };
  year: number;
}

const SQM_PER_SQYD = 0.83612736;
const SQFT_PER_SQM = 10.7639104;
const FT_PER_M = 3.28084;
const NOISE = new Set(['plot', 'no', 'number', 'house', 'h', 'of', 'the', 'and', 'wide', 'side', 'a', 'is', 'sh', 'shri', 'mr', 'mrs', 'smt', 'late', 'so', 'sio', 'son', 'wo', 'approx', 'approximately', 'about', 'm', 'mtr', 'mtrs', 'ft', 'feet', 'metre', 'metres', 'paved']);

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !NOISE.has(w)),
  );

// How much of the shorter text is found in the other: 1 when one contains the other, 0 when nothing is shared.
export function textMatch(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (x.size === 0 || y.size === 0) return 0;
  return [...x].filter((w) => y.has(w)).length / Math.min(x.size, y.size);
}

const firstNumber = (text: string | undefined) => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(text ?? '');
  return m ? Number(m[0].replace(/,/g, '')) : null;
};

const fixed = (n: number) => String(Math.round(n * 100) / 100);
const sqft = (sqm: number) => `${fixed(sqm * SQFT_PER_SQM)} sq ft (${fixed(sqm)} sq m)`;

// "S+4" is five floors, "G+1" and "GF+FF" are two; a bare number is itself.
export function floorCount(text: string | undefined): number | null {
  const t = (text ?? '').trim();
  const plus = /^(?:S|G|GF|B)\s*\+\s*(\d+)/i.exec(t);
  if (plus) return Number(plus[1]) + 1;
  if (/^(?:GF\s*\+\s*FF)$/i.test(t)) return 2;
  const words: Record<string, number> = { ground: 1, single: 1, one: 1, two: 2, double: 2, three: 3, four: 4 };
  const lower = t.toLowerCase();
  for (const [w, n] of Object.entries(words)) if (lower.includes(w)) return n;
  return firstNumber(t);
}

function feet(text: string | undefined): number | null {
  const n = firstNumber(text);
  if (n === null) return null;
  return /\b(m|mtr|mtrs|metre|metres|meter|meters)\b/i.test(text ?? '') ? n * FT_PER_M : n;
}

type Make = Omit<ComparisonRow, 'status' | 'delta' | 'tolerance' | 'needsResolution' | 'hint'> & Partial<Pick<ComparisonRow, 'delta' | 'tolerance' | 'needsResolution' | 'hint'>>;
const row = (base: Make, status: ComparisonStatus, extra: Partial<ComparisonRow> = {}): ComparisonRow => ({ delta: null, tolerance: null, needsResolution: false, hint: null, ...base, status, ...extra });

// Compares what the documents say with what the inspection found, one parameter at a time.
// It only reads and judges; nothing here changes either side.
export function compareEvidence(input: CompareInput): ComparisonRow[] {
  const { docFacts, inspection } = input;
  const obs = inspection?.observations ?? {};
  const built = input.propertyClass !== 'LAND';
  const rows: ComparisonRow[] = [];

  const text = (key: string, label: string, group: ComparisonRow['group'], doc: Evidence | undefined, site: Evidence | null, opts: { missingHint?: string } = {}) => {
    const base: Make = { key, label, group, document: doc ?? null, site };
    if (!doc || !site) return rows.push(row(base, 'missing', { hint: opts.missingHint ?? (!doc ? 'Not read from any document yet' : 'Not recorded at inspection') }));
    const score = textMatch(doc.value, site.value);
    rows.push(row(base, score >= 0.6 ? 'consistent' : score >= 0.3 ? 'verify' : 'mismatch', { needsResolution: score < 0.3 }));
  };

  const recordAddress: Evidence = { value: input.record.addressLine, source: 'Assignment record' };
  text('property_address', 'Property address', 'Identity', docFacts.property_address, recordAddress);

  const person = obs.occupant_name?.trim() || input.record.borrowerName?.trim();
  text('owner_name', 'Owner', 'Identity', docFacts.owner_name ?? docFacts.buyer_name, person ? { value: person, source: obs.occupant_name?.trim() ? 'Person met on site' : 'Borrower in the bank instruction' } : null);

  const plotSeen = obs.plot_number_seen?.trim() || input.record.unitDetail?.trim() || input.record.khasraNumbers.join(', ');
  text('plot_number', 'Plot / khasra number', 'Identity', docFacts.plot_number ?? docFacts.khasra_numbers, plotSeen ? { value: plotSeen, source: obs.plot_number_seen?.trim() ? 'Seen on site' : 'Assignment record' } : null);

  // ---- areas, compared as numbers
  const area = (key: string, label: string, group: ComparisonRow['group'], docSqm: number | null, docSource: string, siteSqm: number | null, siteSource: string) => {
    const base: Make = { key, label, group, document: docSqm === null ? null : { value: sqft(docSqm), source: docSource }, site: siteSqm === null ? null : { value: sqft(siteSqm), source: siteSource } };
    if (docSqm === null || siteSqm === null) return rows.push(row(base, 'missing', { hint: docSqm === null ? 'No area read from the documents yet' : 'Not measured at inspection' }));
    const diff = siteSqm - docSqm;
    const pct = (diff / docSqm) * 100;
    const within = Math.abs(pct) <= AREA_TOLERANCE_PERCENT;
    // A small difference inside the tolerance is not a mismatch, but the valuer is told about it.
    const status: ComparisonStatus = Math.abs(pct) <= 0.1 ? 'consistent' : within ? 'verify' : 'mismatch';
    rows.push(row(base, status, { delta: `${diff >= 0 ? '+' : ''}${fixed(diff * SQFT_PER_SQM)} sq ft (${pct >= 0 ? '+' : ''}${fixed(pct)}%)`, tolerance: `±${AREA_TOLERANCE_PERCENT}%`, needsResolution: !within }));
  };

  const plotDoc = docFacts.plot_area_sqm ? Number(docFacts.plot_area_sqm.value) : docFacts.plot_area_sqyd ? Number(docFacts.plot_area_sqyd.value) * SQM_PER_SQYD : null;
  const plotSite = inspection?.measurements.find((m) => m.fieldKey === 'plot_area_sqm' || m.label === 'Plot');
  area('plot_area_sqm', 'Land area', 'Land', plotDoc !== null && Number.isFinite(plotDoc) ? plotDoc : null, (docFacts.plot_area_sqm ?? docFacts.plot_area_sqyd)?.source ?? '', plotSite ? plotSite.areaSqm : null, inspection ? `${inspection.source}: ${plotSite?.label ?? 'Plot'}` : '');

  for (const side of ['north', 'south', 'east', 'west'] as const) {
    const seen = obs[`boundary_${side}`]?.trim();
    text(`boundary_${side}`, `${side[0].toUpperCase()}${side.slice(1)} boundary`, 'Land', docFacts[`boundary_${side}`], seen ? { value: seen, source: inspection?.source ?? 'Inspection' } : null);
  }

  {
    const docFt = feet(docFacts.road_width?.value);
    const siteFt = obs.road_width_ft ? Number(obs.road_width_ft) : null;
    const base: Make = { key: 'road_width', label: 'Approach road width', group: 'Land', document: docFacts.road_width ?? null, site: siteFt === null ? null : { value: `${fixed(siteFt)} ft`, source: inspection?.source ?? 'Inspection' } };
    if (docFt === null || siteFt === null || !Number.isFinite(siteFt)) rows.push(row(base, 'missing'));
    else {
      const gap = Math.abs(siteFt - docFt);
      rows.push(row(base, gap <= 1.5 ? 'consistent' : gap <= 5 ? 'verify' : 'mismatch', { delta: `${fixed(siteFt - docFt)} ft`, tolerance: '±1.5 ft', needsResolution: gap > 5 }));
    }
  }

  text('land_use', 'Use of the property', 'Land', docFacts.land_use, obs.actual_use?.trim() ? { value: obs.actual_use.trim(), source: inspection?.source ?? 'Inspection' } : null);

  if (built) {
    const builtDoc = docFacts.built_up_area_sqm ? Number(docFacts.built_up_area_sqm.value) : null;
    const floors = inspection?.measurements.filter((m) => ['Ground floor', 'First floor', 'Second floor', 'Basement'].includes(m.label)) ?? [];
    const keyed = inspection?.measurements.find((m) => m.fieldKey === 'built_up_area_sqm');
    const builtSite = keyed ? keyed.areaSqm : floors.length > 0 ? floors.reduce((t, m) => t + m.areaSqm, 0) : null;
    area('built_up_area_sqm', 'Built-up area', 'Building', builtDoc !== null && Number.isFinite(builtDoc) ? builtDoc : null, docFacts.built_up_area_sqm?.source ?? '', builtSite, inspection ? `${inspection.source}: ${keyed ? keyed.label : floors.map((m) => m.label).join(' + ')}` : '');

    const docFloors = floorCount(docFacts.total_floors?.value);
    const siteFloors = obs.floors ? Number(obs.floors) : null;
    const floorBase: Make = { key: 'floors', label: 'Number of floors', group: 'Building', document: docFacts.total_floors ?? null, site: siteFloors === null ? null : { value: String(siteFloors), source: inspection?.source ?? 'Inspection' } };
    if (docFloors === null || siteFloors === null || !Number.isFinite(siteFloors)) rows.push(row(floorBase, 'missing'));
    else rows.push(row(floorBase, docFloors === siteFloors ? 'consistent' : 'mismatch', { needsResolution: docFloors !== siteFloors, delta: docFloors === siteFloors ? null : `${siteFloors - docFloors > 0 ? '+' : ''}${siteFloors - docFloors} floor` }));

    const certificate = input.documents.find((d) => d.type === 'OCCUPATION_CERTIFICATE');
    const sighted = obs.oc_sighted?.trim();
    const ocDoc: Evidence | null = certificate ? { value: `On file: ${certificate.fileName}`, source: 'Document vault' } : docFacts.oc_details ?? { value: 'Not uploaded', source: 'Document vault' };
    const ocSite: Evidence | null = sighted ? { value: sighted === 'Sighted' ? 'Seen at inspection' : sighted === 'Not sighted' ? 'Not seen at inspection' : 'Not applicable', source: inspection?.source ?? 'Inspection' } : null;
    const ocBase: Make = { key: 'occupation_certificate', label: 'Occupation certificate', group: 'Legal', document: ocDoc, site: ocSite };
    const onFile = Boolean(certificate || docFacts.oc_details);
    if (sighted === 'Not applicable') rows.push(row(ocBase, 'document', { hint: 'Marked not applicable at inspection' }));
    else if (onFile) rows.push(row(ocBase, sighted === 'Not sighted' ? 'verify' : 'consistent', { hint: sighted === 'Not sighted' ? 'On file, but not shown on site' : null }));
    else if (sighted === 'Not sighted') rows.push(row(ocBase, 'mismatch', { needsResolution: true, hint: 'Not on file and not seen on site' }));
    else if (sighted === 'Sighted') rows.push(row(ocBase, 'verify', { hint: 'Seen on site: get a copy for the file' }));
    else rows.push(row(ocBase, 'missing', { hint: 'Not on file, and not recorded at inspection' }));

    const yearDoc = firstNumber(docFacts.construction_year?.value);
    const ageSite = obs.age_years ? Number(obs.age_years) : null;
    const ageBase: Make = { key: 'building_age', label: 'Age of the building', group: 'Building', document: yearDoc === null ? null : { value: `Built ${yearDoc} (${input.year - yearDoc} years)`, source: docFacts.construction_year.source }, site: ageSite === null ? null : { value: `About ${ageSite} years`, source: `${inspection?.source ?? 'Inspection'} (inspector's estimate)` } };
    if (ageSite === null || !Number.isFinite(ageSite)) rows.push(row(ageBase, 'missing'));
    else if (yearDoc === null) rows.push(row(ageBase, 'verify', { hint: "Only the inspector's estimate: no document gives the year" }));
    else rows.push(row(ageBase, Math.abs(input.year - yearDoc - ageSite) <= 2 ? 'consistent' : 'verify', { tolerance: '±2 years', delta: `${ageSite - (input.year - yearDoc)} years` }));
  }

  {
    const restriction = docFacts.legal_restriction;
    const seen = obs.charges_seen?.trim();
    const base: Make = { key: 'encumbrance', label: 'Charges and encumbrances', group: 'Legal', document: restriction ?? { value: 'None found in the documents read', source: 'Documents' }, site: seen ? { value: seen, source: inspection?.source ?? 'Inspection' } : null };
    if (!seen) rows.push(row(base, 'missing', { hint: 'Not recorded at inspection' }));
    else if (restriction) rows.push(row(base, 'verify', { hint: 'A document mentions a restriction: confirm and disclose' }));
    else rows.push(row(base, seen.startsWith('None') ? 'consistent' : 'verify'));
  }

  rows.push(row({ key: 'tenure', label: 'Freehold / leasehold', group: 'Legal', document: docFacts.ownership_type ?? null, site: null }, docFacts.ownership_type ? 'document' : 'missing', { hint: 'A site visit cannot check tenure; the documents decide' }));
  return rows;
}

export interface Summary {
  consistent: number;
  verify: number;
  mismatch: number;
  missing: number;
  document: number;
}

export const summarise = (rows: ComparisonRow[]): Summary => ({
  consistent: rows.filter((r) => r.status === 'consistent').length,
  verify: rows.filter((r) => r.status === 'verify').length,
  mismatch: rows.filter((r) => r.status === 'mismatch').length,
  missing: rows.filter((r) => r.status === 'missing').length,
  document: rows.filter((r) => r.status === 'document').length,
});
