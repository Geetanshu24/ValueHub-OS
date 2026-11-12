import type { AiService } from '../ai/ai.service.js';
import { imageBlock } from '../ai/images.js';
import type { Suggestion } from './suggest.js';

// The facts a bank report asks for that a property document can state. The keys are the ones the
// report forms are filled from (see reports/boi-prefill.ts), so a fact read here lands in its boxes.
export const AI_FACTS: Record<string, string> = {
  owner_name: 'Current owner(s) of the property after this document, with relation if given, e.g. "Naresh Kumar S/o Mahabir Prashad". For a sale or conveyance deed this is the buyer.',
  buyer_name: 'Buyer / vendee / transferee / allottee.',
  seller_name: 'Seller / vendor / transferor, with company name if a company.',
  property_address: 'Address or location of the PROPERTY itself (plot, sector, colony, city). Not the postal address of a person or the seller.',
  plot_number: 'Plot, flat or unit number of the property, e.g. "F-139".',
  khasra_numbers: 'Khasra / killa / survey numbers, comma separated.',
  village: 'Village or revenue estate.',
  tehsil: 'Tehsil / sub-tehsil / taluka.',
  district: 'District.',
  state: 'State.',
  pin_code: 'PIN code of the property.',
  project_name: 'Colony, society, project or licence name the property is in.',
  plot_area_sqm: 'Area of the plot / land in square metres, number only. Convert nothing: give it only if the document states square metres.',
  plot_area_sqyd: 'Area of the plot / land in square yards (gaj), number only, only if stated.',
  built_up_area_sqm: 'Built-up / covered area in square metres, number only, only if stated.',
  carpet_area_sqm: 'Carpet area in square metres, number only, only if stated.',
  registration_number: 'Registration / document / memo / vasika number of the deed.',
  document_date: 'Date of registration or execution of the deed, as YYYY-MM-DD.',
  sub_registrar_office: 'Sub-registrar / registration office name.',
  sale_consideration: 'Sale price / transaction value in rupees, digits only.',
  boundary_north: 'Adjoining property or road on the NORTH side as per the document.',
  boundary_south: 'Adjoining property or road on the SOUTH side as per the document.',
  boundary_east: 'Adjoining property or road on the EAST side as per the document.',
  boundary_west: 'Adjoining property or road on the WEST side as per the document.',
  dimension_north: 'Length of the NORTH side with unit, e.g. "20.900 m".',
  dimension_south: 'Length of the SOUTH side with unit.',
  dimension_east: 'Length of the EAST side with unit.',
  dimension_west: 'Length of the WEST side with unit.',
  floor_number: 'Floor on which the flat / unit is located.',
  total_floors: 'Total number of floors in the building, e.g. "S+4" or "GF+FF".',
  accommodation: 'Rooms and accommodation, e.g. "3 Bedrooms, 1 Drawing/Dining, 1 Kitchen, 2 Toilets".',
  ownership_type: 'Freehold or leasehold, if stated.',
  land_use: 'Permitted / approved use (residential, commercial ...).',
  legal_restriction: 'Any mortgage, lien, charge, encumbrance, lease, easement, litigation or restriction on transfer that the document mentions about THIS property (not general boilerplate).',
  approving_authority: 'Authority that approved the map / plan or issued the occupation certificate (e.g. HSVP, DTCP, MCG).',
  approved_plan_details: 'Approved map / plan number, date and validity, if stated.',
  oc_details: 'Occupation certificate number and date, if the document is or mentions one.',
  electricity_consumer_no: 'Electricity connection / consumer number, if the document is an electricity bill.',
  property_tax_id: 'Property tax ID / assessment number, if the document is a tax receipt.',
  water_connection_no: 'Water connection / consumer number, if the document is a water bill.',
  developer_name: 'Developer / builder / colonizer.',
  road_width: 'Width of the approach road with its unit, e.g. "30 ft" or "9 m".',
  construction_year: 'Year the building was constructed or completed, if stated.',
  market_listing_1: 'From a property-website or dealer screenshot: one comparable listing, written "dealer or project | contact number | size | price or rate | location".',
  market_listing_2: 'A second comparable listing, same format.',
  market_listing_3: 'A third comparable listing, same format.',
  market_rate_range: 'The range of rates per unit area seen on the page, e.g. "Rs 230000 to Rs 250000 per Syd".',
  guideline_rate: 'From a circle rate / guideline / collector rate list: the rate for the area of this property, with its unit and year, as printed.',
};

export const AI_FACT_KEYS = Object.keys(AI_FACTS);

const MAX_CHARS_PER_CALL = 70_000;
const MAX_CALLS = 6;
const MAX_CONFIDENCE = 0.8;

const SYSTEM = `You read Indian property documents (sale deeds, conveyance deeds, approved maps, occupation certificates, jamabandi / revenue records, shajra plans, tax, electricity and water bills, magistrate and patwari reports) for a property valuer. The text was read from scans by OCR and may be garbled, partly in Hindi, and may contain stamp-paper cover pages with tables.

Return the facts the document states, using only the field keys offered.
- Copy what is written. Never guess, infer, calculate or fill in a typical value. If a fact is not stated, leave it out.
- Names and places in Hindi are written in English letters.
- Give one entry per fact; if the same fact appears on several pages, give the clearest one and its page.
- page_number is the page where you found it. confidence is 0 to 1: how sure you are that the OCR text really says this.`;

const schema = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field_key: { type: 'string', enum: AI_FACT_KEYS },
          value: { type: 'string' },
          page_number: { type: 'integer' },
          confidence: { type: 'number' },
        },
        required: ['field_key', 'value', 'page_number', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['facts'],
  additionalProperties: false,
} as const;

// Pages are sent in groups that fit one request, each page marked so the model can say where a fact is.
export function groupPages(pages: string[]): { first: number; text: string }[] {
  const groups: { first: number; text: string }[] = [];
  let current = { first: 1, text: '' };
  pages.forEach((page, index) => {
    const block = `=== PAGE ${index + 1} ===\n${page}\n`;
    if (current.text && current.text.length + block.length > MAX_CHARS_PER_CALL) {
      groups.push(current);
      current = { first: index + 1, text: '' };
    }
    current.text += block;
  });
  if (current.text) groups.push(current);
  return groups;
}

// Turns the model's answer into suggestions, dropping anything not offered, empty, or on a page that does not exist.
export function parseFacts(raw: string, pageCount: number): Suggestion[] {
  let parsed: { facts?: { field_key?: string; value?: string; page_number?: number; confidence?: number }[] };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return [];
  }
  const out: Suggestion[] = [];
  for (const f of parsed.facts ?? []) {
    const value = typeof f.value === 'string' ? f.value.trim() : '';
    if (!f.field_key || !(f.field_key in AI_FACTS) || !value || value.length > 600) continue;
    const page = Number.isInteger(f.page_number) && (f.page_number as number) >= 1 && (f.page_number as number) <= pageCount ? (f.page_number as number) : 1;
    const confidence = Math.min(MAX_CONFIDENCE, Math.max(0.1, Number(f.confidence) || 0.5));
    out.push({ fieldKey: f.field_key, value, pageNumber: page, confidence: Math.round(confidence * 100) / 100 });
  }
  return out;
}

// Reads the facts out of a document. `images` are the pages as pictures, used when the OCR text cannot be trusted
// (Hindi records, photographed screens); the text is still sent along as a hint.
export async function aiSuggest(pages: string[], documentLabel: string, ai: Pick<AiService, 'json'>, images?: string[]): Promise<Suggestion[]> {
  const field_list = AI_FACT_KEYS.map((key) => `- ${key}: ${AI_FACTS[key]}`).join('\n');
  const intro = `Document type: ${documentLabel}\n\nField keys you may use:\n${field_list}\n\n`;
  if (images && images.length > 0) {
    const content = [
      { type: 'text' as const, text: `${intro}The document is attached as ${images.length} picture(s), one per page in order. Read the pictures; the OCR text below is only a hint and may be wrong.\n\nOCR text:\n${pages.join('\n').slice(0, 20_000)}` },
      ...images.flatMap((data, i) => [{ type: 'text' as const, text: `=== PAGE ${i + 1} ===` }, imageBlock(data)]),
    ];
    const result = await ai.json<{ facts: unknown }>({ system: SYSTEM, content, schema });
    return parseFacts(JSON.stringify(result), Math.max(pages.length, images.length));
  }
  const groups = groupPages(pages);
  if (groups.length > MAX_CALLS) throw new Error(`Document is too long to read with AI (${pages.length} pages)`);
  const all: Suggestion[] = [];
  for (const group of groups) {
    const result = await ai.json<{ facts: unknown }>({ system: SYSTEM, content: [{ type: 'text', text: `${intro}Document text:\n${group.text}` }], schema });
    all.push(...parseFacts(JSON.stringify(result), pages.length));
  }
  return all;
}
