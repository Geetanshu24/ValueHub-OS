// Gathers what the documents say into one value per fact, without ever choosing between documents
// that a person has written differently: those are reported as conflicts until a person chooses.

export interface FieldRow {
  fieldKey: string;
  extractedValue: string;
  verifiedValue: string | null;
  state: string;
  confidence: unknown;
  useInReport: boolean;
  source: string;
  unit?: string | null;
}
export interface DocRow {
  id: string;
  fields: FieldRow[];
}

const FACTOR: Record<string, number> = { SQM: 1, SQYD: 0.83612736, SQFT: 1 / 10.7639104 };
const UNIT_LABEL: Record<string, string> = { SQM: 'sq m', SQYD: 'sq yd', SQFT: 'sq ft' };
const isArea = (key: string) => /_sqm$/.test(key);

// An area written in sq yd or sq ft, as square metres.
export function toSqm(value: string, unit?: string | null): string {
  const n = Number(value.replace(/,/g, ''));
  if (!unit || unit === 'SQM' || !Number.isFinite(n) || !FACTOR[unit]) return value;
  return String(Number((n * FACTOR[unit]).toFixed(2)));
}

const same = (a: string) => {
  const n = Number(a.replace(/,/g, ''));
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : a.toLowerCase().replace(/\s+/g, ' ').trim();
};

export function gatherFacts(documents: DocRow[]) {
  const best = new Map<string, { value: string; rank: number }>();
  const own = new Map<string, Record<string, string>>();
  const shown = new Map<string, Record<string, string>>();
  const human = new Map<string, Map<string, string>>();
  const chosen = new Set<string>();

  for (const document of documents) {
    const perDocument: Record<string, string> = {};
    const original: Record<string, string> = {};
    for (const field of document.fields) {
      const reviewed = field.state === 'VERIFIED' || field.state === 'CORRECTED';
      if (field.state === 'UNKNOWN') continue;
      const raw = (reviewed ? field.verifiedValue ?? field.extractedValue : field.extractedValue).trim();
      if (!raw) continue;
      const value = isArea(field.fieldKey) ? toSqm(raw, field.unit) : raw;
      // A person's choice beats a review, a review beats a typed value, and a typed value beats text a machine read.
      const rank = (field.useInReport ? 100 : 0) + (reviewed ? 10 : 0) + (field.source === 'MANUAL' ? 5 : 0) + Number(field.confidence ?? 0);
      if (!perDocument[field.fieldKey]) {
        perDocument[field.fieldKey] = value;
        original[field.fieldKey] = field.unit && field.unit !== 'SQM' && isArea(field.fieldKey) ? `${raw} ${UNIT_LABEL[field.unit] ?? ''} = ${value} sq m` : raw;
      }
      if (rank > (best.get(field.fieldKey)?.rank ?? -1)) best.set(field.fieldKey, { value, rank });
      if (field.useInReport) chosen.add(field.fieldKey);
      if (field.source === 'MANUAL' || reviewed) {
        if (!human.has(field.fieldKey)) human.set(field.fieldKey, new Map());
        human.get(field.fieldKey)!.set(document.id, same(value));
      }
    }
    own.set(document.id, perDocument);
    shown.set(document.id, original);
  }

  // Two documents a person has filled in differently, and nobody has chosen between them.
  const conflicts: string[] = [];
  for (const [key, perDoc] of human) {
    if (new Set(perDoc.values()).size > 1 && !chosen.has(key)) {
      conflicts.push(key);
      best.delete(key);
    }
  }
  return { best, own, shown, conflicts };
}
