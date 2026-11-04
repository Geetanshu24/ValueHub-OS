// The only values a template may pull into a report. Each path maps to one
// approved source (a record, or a calculation output), so every printed figure
// has a known origin.
export type FieldType = 'text' | 'date' | 'money' | 'sqm' | 'list';

export const SOURCE_FIELDS: Record<string, { label: string; type: FieldType }> = {
  'firm.name': { label: 'Firm name', type: 'text' },
  'property.code': { label: 'Property ID', type: 'text' },
  'property.propertyClass': { label: 'Property class', type: 'text' },
  'property.addressLine': { label: 'Address', type: 'text' },
  'property.unitDetail': { label: 'Unit / plot / floor', type: 'text' },
  'property.locality': { label: 'Locality', type: 'text' },
  'property.village': { label: 'Village', type: 'text' },
  'property.tehsil': { label: 'Tehsil', type: 'text' },
  'property.district': { label: 'District', type: 'text' },
  'property.state': { label: 'State', type: 'text' },
  'property.pinCode': { label: 'PIN code', type: 'text' },
  'property.khasraNumbers': { label: 'Khasra / killa / survey numbers', type: 'list' },
  'assignment.code': { label: 'Assignment ID', type: 'text' },
  'assignment.purpose': { label: 'Purpose of valuation', type: 'text' },
  'assignment.scope': { label: 'Scope', type: 'text' },
  'assignment.valuationDate': { label: 'Valuation date', type: 'date' },
  'assignment.receivedAt': { label: 'Instruction received', type: 'date' },
  'assignment.bank': { label: 'Bank', type: 'text' },
  'assignment.branch': { label: 'Branch', type: 'text' },
  'valuation.versionNumber': { label: 'Valuation version', type: 'text' },
  'valuation.method': { label: 'Method', type: 'text' },
  'valuation.areaBasis': { label: 'Area basis', type: 'text' },
  'valuation.adoptedAreaSqm': { label: 'Adopted area', type: 'sqm' },
  'valuation.adoptedAreaSource': { label: 'Basis for adopted area', type: 'text' },
  'valuation.assumptions': { label: 'Assumptions', type: 'text' },
  'valuation.totalValue': { label: 'Assessed value', type: 'money' },
  'inspection.visitedAt': { label: 'Inspection date', type: 'date' },
  'inspection.inspector': { label: 'Inspected by', type: 'text' },
  'inspection.latitude': { label: 'Latitude', type: 'text' },
  'inspection.longitude': { label: 'Longitude', type: 'text' },
  'valuer.fullName': { label: 'Valuer', type: 'text' },
};

// Free-form inspection notes, e.g. inspection.observations.occupancy.
const OBSERVATION_PATH = /^inspection\.observations\.[a-z][a-z0-9_]{0,59}$/;

export function isKnownSource(path: string): boolean {
  return path in SOURCE_FIELDS || OBSERVATION_PATH.test(path);
}

export function typeOf(path: string): FieldType {
  return SOURCE_FIELDS[path]?.type ?? 'text';
}

export type ReportContext = Record<string, unknown>;

export function resolve(context: ReportContext, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key];
    return undefined;
  }, context);
}

export const isBlank = (value: unknown) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);

// "Rs." rather than the rupee sign: the built-in PDF fonts cannot draw it.
export function formatMoney(value: number): string {
  const text = Math.abs(value).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${value < 0 ? '-' : ''}Rs. ${text}`;
}

export function formatValue(value: unknown, type: FieldType): string {
  if (isBlank(value)) return '';
  switch (type) {
    case 'money':
      return formatMoney(Number(value));
    case 'sqm':
      return `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })} sq. m`;
    case 'date':
      return new Date(value as string | Date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    case 'list':
      return (value as unknown[]).join(', ');
    default:
      return String(value);
  }
}
