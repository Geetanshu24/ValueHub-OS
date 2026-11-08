import { DOCUMENT_TYPE_LABELS, PROPERTY_CLASS_LABELS, type DocumentType, type PropertyClass } from '@value-hub/valuation-shared';

const SQYD_PER_SQM = 1 / 0.83612736;
const SQFT_PER_SQM = 10.7639104;
const LAKH = 100_000;

export interface PrefillInput {
  today: Date;
  firmName: string;
  valuerName: string;
  assignment: { code: string; purpose: string; valuationDate: Date; receivedAt: Date; instructionDate: Date | null; borrowerName: string | null; bankName: string; branchName: string | null };
  property: {
    propertyClass: PropertyClass;
    addressLine: string;
    unitDetail: string | null;
    locality: string | null;
    village: string | null;
    tehsil: string | null;
    district: string | null;
    state: string | null;
    pinCode: string | null;
    latitude: number | null;
    longitude: number | null;
    boundaries: Partial<Record<'north' | 'south' | 'east' | 'west', string>> | null;
  };
  inspection: { observations?: Record<string, string>; visitedAt: Date; latitude: number | null; longitude: number | null } | null;
  valuation: { totalValue: number; adoptedAreaSqm: number } | null;
  // Best known value for each documented fact (reviewed value if there is one).
  facts: Record<string, string>;
  documents: { type: DocumentType; fileName: string; registrationNumber?: string; documentDate?: string }[];
}

export const formatDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
const isoToDotted = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso);
const lakh = (rupees: number) => `Rs. ${(rupees / LAKH).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Lakh`;
const num = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

function degrees(value: number, positive: string, negative: string): string {
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1)}"${value >= 0 ? positive : negative}`;
}

// What can be filled in from records the system already holds. Everything here
// is a starting point for the valuer to check, never a finished answer.
export function prefillBoi(input: PrefillInput): Record<string, string> {
  const { assignment: a, property: p, facts, inspection, valuation } = input;
  const out: Record<string, string> = {};
  const set = (key: string, value: string | undefined | null) => {
    if (value && value.trim()) out[key] = value.trim();
  };

  const inspected = inspection ? formatDate(inspection.visitedAt) : '';
  set('report_ref', a.code);
  set('report_date', formatDate(input.today));
  set('place', facts.district ?? p.district ?? undefined);
  set('valuer_name', input.valuerName);
  set('purpose', a.purpose);
  set('inspection_date', inspected);
  set('valuation_date', formatDate(a.valuationDate));

  set(
    'documents_list',
    input.documents
      .map((d) => {
        const bits = [`Copy of ${DOCUMENT_TYPE_LABELS[d.type]}`];
        if (d.registrationNumber) bits.push(`no. ${d.registrationNumber}`);
        if (d.documentDate) bits.push(`dated ${isoToDotted(d.documentDate)}`);
        return `${bits.join(' ')} (${d.fileName})`;
      })
      .join('\n'),
  );

  // On a sale deed the person now holding the property is the buyer.
  const owner = facts.owner_name ?? facts.buyer_name ?? a.borrowerName ?? undefined;
  set('owner_details', owner);

  const sqm = Number(facts.plot_area_sqm ?? valuation?.adoptedAreaSqm ?? NaN);
  const extent = Number.isFinite(sqm) && sqm > 0 ? `${num(sqm * SQYD_PER_SQM)} Syd (${num(sqm)} sq m)` : '';
  const kind = PROPERTY_CLASS_LABELS[p.propertyClass];
  set('property_description', `${kind}${extent ? `, measuring ${extent}` : ''}${p.locality ? `, ${p.locality}` : ''}`);
  set('plot_no', [p.unitDetail ?? facts.plot_number, p.locality].filter(Boolean).join(', '));
  // What the drafter read from the documents comes first; the property record fills what the papers do not say.
  set('village', facts.village ?? p.village);
  set('ward', facts.tehsil ?? p.tehsil);
  set('district', facts.district ?? p.district);
  set('postal_address', [facts.property_address || p.addressLine, facts.pin_code ?? p.pinCode].filter(Boolean).join(' '));
  set('city', facts.district ?? p.district);
  set('area_residential', p.propertyClass === 'COMMERCIAL' || p.propertyClass === 'INDUSTRIAL' ? 'No' : 'Residential');

  for (const side of ['north', 'south', 'east', 'west'] as const) set(`boundary_${side}_deed`, facts[`boundary_${side}`] ?? p.boundaries?.[side]);

  for (const side of ['north', 'south', 'east', 'west'] as const) set(`dimension_${side}_deed`, facts[`dimension_${side}`]);

  const lat = inspection?.latitude ?? p.latitude;
  const lon = inspection?.longitude ?? p.longitude;
  if (lat !== null && lon !== null) set('coordinates', `${degrees(lat, 'N', 'S')} ${degrees(lon, 'E', 'W')}`);

  set('extent_site', extent);
  set('extent_considered', extent);
  set('land_extent', extent);
  set('land_size', extent);

  if (facts.floor_number || facts.total_floors) {
    set('b_floors', [facts.total_floors && `${facts.total_floors} floor(s)`, facts.floor_number && `located on ${facts.floor_number} floor`].filter(Boolean).join(', '));
  }

  const total = valuation?.totalValue;
  if (total) {
    if (p.propertyClass === 'LAND') {
      set('land_value', lakh(total));
      set('abs_land', lakh(total));
    }
    set('abs_total', lakh(total));
    set('abs_realizable', lakh(total * 0.9));
    set('abs_distress', lakh(total * 0.8));
  }

  set('dec_2', `Valuation of ${kind.toLowerCase()} for authority of ${a.bankName}${a.branchName ? `, Branch ${a.branchName}` : ''}`);
  set('dec_3', input.valuerName);
  set('dec_5_appointment', formatDate(a.instructionDate ?? a.receivedAt));
  set('dec_5_visit', inspected);
  set('dec_5_report', formatDate(input.today));
  set('inv_client', owner);
  set('inv_date', formatDate(input.today));

  // The same facts under the other banks' keys.
  set('branch_name', a.branchName ?? undefined);
  set('bank_address', [a.bankName, a.branchName].filter(Boolean).join('\n'));
  set('bank_name', `${a.bankName}${a.branchName ? `, Branch \u2013 ${a.branchName}` : ''}`);
  set('title_deed', b_first(out.documents_list));
  set('lg_1', out.documents_list);
  set('lg_2', out.owner_details);
  set('area_type', out.area_residential);
  set('area_doc', out.extent_site);
  set('num_floors', out.b_floors);
  set('valuer_reg_line', input.valuerName);
  set('valuer_name_row', input.valuerName);
  set('approved_land_use', out.area_residential);
  set('property_type', p.propertyClass === 'FLAT' ? 'Residential Flat' : kind);
  if (Number.isFinite(sqm) && sqm > 0) {
    const detail = `${num(sqm * SQYD_PER_SQM)} Sq Yds i.e. ${num(sqm)} Sq Mtrs`;
    set('area_site', detail);
    set('area_saleable', detail);
    set('val_market_area', `${num(sqm * SQYD_PER_SQM)} Syd`);
  }
  const built = Number(facts.built_up_area_sqm ?? NaN);
  if (Number.isFinite(built) && built > 0) set('area_covered', `${num(built * SQFT_PER_SQM)} Sq Ft i.e. ${num(built)} Sq Mtrs`);
  if (facts.accommodation) set('num_rooms', facts.accommodation);
  if (facts.floor_number) set('floor_located', facts.floor_number);
  if (facts.total_floors) set('total_floors', facts.total_floors);
  if (lat !== null && lon !== null) set('google_map_link', `https://www.google.com/maps?q=${lat},${lon}`);
  const deed = input.documents.find((d) => d.type === 'SALE_DEED');
  if (deed?.documentDate) set('od_purchase_date', isoToDotted(deed.documentDate));
  if (facts.sale_consideration) set('od_purchase_price', `Rs ${facts.sale_consideration}`);
  if (total) {
    set('tot_market', lakh(total));
    set('tot_realizable', lakh(total * 0.9));
    set('tot_distress', lakh(total * 0.8));
    set('od_realizable', lakh(total * 0.9));
    set('od_distress', lakh(total * 0.8));
    set('val_market_amount', lakh(total));
  }
  // What the supporting documents say about legal status, approvals and dues.
  set('lg_15', facts.legal_restriction);
  set('site_restriction', facts.legal_restriction);
  set('lg_7', facts.ownership_type ? facts.ownership_type.replace(/^free\s*-?\s*hold$/i, 'Free Hold') : undefined);
  set('tp_3', facts.approving_authority);
  set('approving_authority', facts.approving_authority);
  set('b_map_authority', facts.approving_authority);
  set('tp_2', facts.approved_plan_details);
  set('b_map_validity', facts.approved_plan_details);
  set('tp_16', facts.oc_details);
  set('building_plan', facts.oc_details);
  set('tp_1', facts.land_use);
  set('approved_land_use', facts.land_use);
  set('survey_no', facts.khasra_numbers);
  set('developer', facts.developer_name);
  if (facts.electricity_consumer_no) set('lg_13a', `Consumer no. ${facts.electricity_consumer_no}`);
  if (facts.property_tax_id) set('lg_13b', `Property tax ID ${facts.property_tax_id}`);
  if (facts.water_connection_no) set('lg_13c', `Connection no. ${facts.water_connection_no}`);
  // Comparable listings and rates read from screenshots.
  for (const n of [1, 2, 3]) {
    const [dealer, contact, size, rate, place] = (facts[`market_listing_${n}`] ?? '').split('|').map((x) => x.trim());
    if (!dealer && !rate) continue;
    set(`broker${n}_name`, [dealer, contact].filter(Boolean).join('   '));
    set(`broker${n}_size`, size);
    set(`broker${n}_range`, rate);
    set(`broker${n}_location`, place);
  }
  // What the inspector found on site, for the "as per actual" boxes.
  const site = inspection?.observations ?? {};
  for (const side of ['north', 'south', 'east', 'west'] as const) set(`boundary_${side}_actual`, site[`site_boundary_${side}`]);
  set('occupancy', site.occupancy);
  set('landmark', site.landmark);
  set('person_met_name', site.occupant_name);
  set('site_flooding', site.flood_prone);
  // Construction, as read from the documents.
  const builtAny = Number(facts.built_up_area_sqm ?? facts.flat_area_sqm ?? facts.shop_area_sqm ?? facts.floor_area_sqm ?? NaN);
  if (Number.isFinite(builtAny) && builtAny > 0) {
    const plinth = `${num(builtAny * SQFT_PER_SQM)} Sq Ft i.e. ${num(builtAny)} Sq Mtrs`;
    set('b_plinth', plinth);
    set('plinth_floorwise', plinth);
    set('vl_plinth', plinth);
    if (!out.area_covered) set('area_covered', plinth);
  }
  const builtYear = facts.year_of_construction?.match(/\d{4}/)?.[0];
  if (builtYear) {
    set('b_year', facts.year_of_construction);
    set('year_construction', facts.year_of_construction);
    const age = input.today.getUTCFullYear() - Number(builtYear);
    if (age >= 0 && age < 300) {
      for (const key of ['b_age', 'vl_age', 'en_5', 'approx_age']) set(key, `${age} years`);
    }
  }
  set('building_details', facts.construction_details);
  set('num_floors', facts.total_floors);
  set('f51_3', facts.accommodation);
  // The neighbours named in the documents, for the formats that ask "adjoining property".
  for (const side of ['north', 'south', 'east', 'west'] as const) set(`adj_${side}`, facts[`boundary_${side}`]);
  set('land_guideline_rate', facts.guideline_rate);
  set('gl_rate', facts.guideline_rate);
  set('land_market_rate', facts.market_rate_range);
  set('le_date', out.dec_5_appointment);
  set('le_place', out.place);
  set('le_purpose', a.purpose);
  return out;
}

const b_first = (list: string | undefined) => list?.split('\n')[0];
