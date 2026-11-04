import type { PropertyClass } from '@value-hub/valuation-shared';
import type { TemplateSpec } from './template-spec.js';

const LIMITATIONS = [
  'This report is an opinion of value prepared for the stated purpose and valuation date only.',
  'The valuation does not certify title, ownership or legal status. Documents were examined as provided.',
  'Areas and rates are as stated in the workings; any difference between records and site is disclosed below.',
];

const common = (extra: TemplateSpec['sections']): TemplateSpec['sections'] => [
  {
    heading: 'Assignment',
    fields: [
      { label: 'Assignment ID', source: 'assignment.code', kind: 'required' },
      { label: 'Bank', source: 'assignment.bank', kind: 'required' },
      { label: 'Branch', source: 'assignment.branch', kind: 'optional' },
      { label: 'Purpose', source: 'assignment.purpose', kind: 'required' },
      { label: 'Scope', source: 'assignment.scope', kind: 'optional' },
      { label: 'Valuation date', source: 'assignment.valuationDate', kind: 'required' },
    ],
  },
  {
    heading: 'Property',
    fields: [
      { label: 'Property ID', source: 'property.code', kind: 'required' },
      { label: 'Address', source: 'property.addressLine', kind: 'required' },
      { label: 'Unit / plot / floor', source: 'property.unitDetail', kind: 'optional' },
      { label: 'Locality', source: 'property.locality', kind: 'optional' },
      { label: 'District', source: 'property.district', kind: 'required' },
      { label: 'State', source: 'property.state', kind: 'optional' },
      { label: 'PIN code', source: 'property.pinCode', kind: 'optional' },
      { label: 'Khasra / survey numbers', source: 'property.khasraNumbers', kind: 'optional' },
    ],
  },
  {
    heading: 'Inspection',
    fields: [
      { label: 'Inspection date', source: 'inspection.visitedAt', kind: 'required' },
      { label: 'Inspected by', source: 'inspection.inspector', kind: 'required' },
    ],
  },
  ...extra,
  {
    heading: 'Valuation',
    fields: [
      { label: 'Method', source: 'valuation.method', kind: 'required' },
      { label: 'Adopted area', source: 'valuation.adoptedAreaSqm', kind: 'required' },
      { label: 'Area basis', source: 'valuation.areaBasis', kind: 'required' },
      { label: 'Why this area is adopted', source: 'valuation.adoptedAreaSource', kind: 'required' },
      { label: 'Assessed value', source: 'valuation.totalValue', kind: 'required' },
    ],
  },
];

const spec = (title: string, requiredAnnexures: TemplateSpec['requiredAnnexures']): TemplateSpec => ({
  title,
  sections: common([]),
  limitations: LIMITATIONS,
  requiredAnnexures,
  requirePhotos: true,
});

export const DEFAULT_TEMPLATES: { name: string; propertyClass: PropertyClass; spec: TemplateSpec }[] = [
  { name: 'Standard valuation report – flat', propertyClass: 'FLAT', spec: spec('Valuation Report – Flat / Apartment', ['SALE_DEED']) },
  { name: 'Standard valuation report – house', propertyClass: 'HOUSE', spec: spec('Valuation Report – Independent House', ['SALE_DEED', 'APPROVED_PLAN']) },
  { name: 'Standard valuation report – commercial', propertyClass: 'COMMERCIAL', spec: spec('Valuation Report – Commercial Property', ['SALE_DEED']) },
  { name: 'Standard valuation report – industrial', propertyClass: 'INDUSTRIAL', spec: spec('Valuation Report – Industrial Property', ['SALE_DEED', 'APPROVED_PLAN']) },
  { name: 'Standard valuation report – project', propertyClass: 'MIXED_USE', spec: spec('Valuation Report – Mixed-use / Project', ['APPROVED_PLAN']) },
  { name: 'Standard valuation report – land', propertyClass: 'LAND', spec: spec('Valuation Report – Land', ['REVENUE_RECORD']) },
];
