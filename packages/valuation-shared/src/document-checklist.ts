import type { DocumentType } from './documents.js';
import type { PropertyClass } from './property-class.js';

export type ChecklistLevel = 'required' | 'recommended';

export interface ChecklistEntry {
  type: DocumentType;
  level: ChecklistLevel;
  hint: string;
}

// What a valuer normally needs on file before inspecting a property. The API
// only hard-requires one document; the rest guide the person doing the work.
export function documentChecklist(propertyClass: PropertyClass): ChecklistEntry[] {
  const built = propertyClass !== 'LAND';
  return [
    { type: 'BANK_INSTRUCTION', level: 'required', hint: 'The bank’s valuation instruction letter' },
    { type: 'SALE_DEED', level: 'required', hint: 'Title deed or registered sale deed' },
    { type: 'APPROVED_PLAN', level: built ? 'required' : 'recommended', hint: 'Sanctioned building plan or layout' },
    { type: 'REVENUE_RECORD', level: built ? 'recommended' : 'required', hint: 'Jamabandi, khasra or khatauni extract' },
    { type: 'TAX_RECEIPT', level: 'recommended', hint: 'Latest property tax or utility receipt' },
  ];
}

// Facts a person can record from a document, with the labels shown to users.
export const FACT_LABELS: Record<string, string> = {
  plot_area_sqm: 'Plot area (sq. m)',
  built_up_area_sqm: 'Built-up area (sq. m)',
  carpet_area_sqm: 'Carpet area (sq. m)',
  area_mentioned_sqm: 'Area mentioned (sq. m)',
  plot_number: 'Plot number',
  khasra_numbers: 'Khasra numbers',
  document_date: 'Document date',
  party_name: 'Party name',
  owner_name: 'Owner name',
  registration_number: 'Registration number',
  boundary_north: 'Boundary: north',
  boundary_south: 'Boundary: south',
  boundary_east: 'Boundary: east',
  boundary_west: 'Boundary: west',
  property_address: 'Property address',
  seller_name: 'Seller / vendor',
  buyer_name: 'Buyer / vendee',
  floor_number: 'Floor located on',
  total_floors: 'Floors in building',
  legal_restriction: 'Legal right / restriction',
  accommodation: 'Accommodation',
  dimensions: 'Dimensions',
  sale_consideration: 'Sale consideration (Rs)',
  registration_date: 'Sale registration date',
  sub_registrar_office: 'Sub-registrar office (SRO)',
  plot_area_sqyd: 'Plot area (sq. yd)',
  village: 'Village',
  tehsil: 'Tehsil',
  district: 'District',
  state: 'State',
  pin_code: 'PIN code',
  project_name: 'Colony / project',
  dimension_north: 'Dimension: north',
  dimension_south: 'Dimension: south',
  dimension_east: 'Dimension: east',
  dimension_west: 'Dimension: west',
  ownership_type: 'Freehold / leasehold',
  land_use: 'Land use',
  approving_authority: 'Approving authority',
  approved_plan_details: 'Approved plan details',
  oc_details: 'Occupation certificate',
  electricity_consumer_no: 'Electricity consumer no.',
  property_tax_id: 'Property tax ID',
  water_connection_no: 'Water connection no.',
  developer_name: 'Developer',
};

export const factLabel = (key: string): string =>
  FACT_LABELS[key] ?? key.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());
