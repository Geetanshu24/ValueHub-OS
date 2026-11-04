export interface Suggestion {
  fieldKey: string;
  value: string;
  pageNumber: number;
  // How much to trust the guess, 0..1. These are pattern matches, never certain.
  confidence: number;
}

const SQM_PER_SQFT = 0.09290304;
const SQM_PER_SQYD = 0.83612736;
const MAX_SUGGESTIONS = 100;

const round2 = (n: number) => Math.round(n * 100) / 100;

const UNIT = String.raw`(sq\.?\s*(?:m|mtr|mt|metres?|meters?)\b|sq\.?\s*(?:ft|feet)\b|sq\.?\s*(?:yd|yds|yards?)\b|square\s+(?:metres?|meters?|feet|foot|yards?)|gaj\b)`;
const AREA_RE = new RegExp(String.raw`(\d[\d,]*(?:\.\d+)?)\s*${UNIT}`, 'gi');

function toSqm(amount: number, unit: string): { sqm: number; converted: boolean } {
  const u = unit.toLowerCase().replace(/\s+/g, ' ');
  if (/ft|feet|foot/.test(u)) return { sqm: amount * SQM_PER_SQFT, converted: true };
  if (/yd|yard|gaj/.test(u)) return { sqm: amount * SQM_PER_SQYD, converted: true };
  return { sqm: amount, converted: false };
}

// Which fact an area figure is about, judged from the words just before it.
function classifyArea(before: string): { key: string; confidence: number } {
  const text = before.toLowerCase();
  if (/(built[\s-]*up|constructed|covered)/.test(text)) return { key: 'built_up_area_sqm', confidence: 0.65 };
  if (/carpet/.test(text)) return { key: 'carpet_area_sqm', confidence: 0.65 };
  if (/(plot|land|site|total)\s*(area|measuring|admeasuring)|admeasuring|measuring|plot|land/.test(text)) return { key: 'plot_area_sqm', confidence: 0.6 };
  return { key: 'area_mentioned_sqm', confidence: 0.3 };
}

const REF_RE = /\b(khasra|khasara|killa|kila|survey|plot)\s*(?:no\.?|number|#)?\s*[:-]?\s*(\d+(?:\s*[/-]\s*\d+)*(?:\s*(?:,|and|&)\s*\d+(?:\s*[/-]\s*\d+)*)*)/gi;
const DATE_RE = /dated\s+(?:the\s+)?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/gi;
// A side runs to the end of its line, or to the next compass word. Full stops are kept so "Plot No. 124" is not cut short.
const BOUNDARY_RE = /\b(east|west|north|south)(?:ern)?(?:\s+side)?\s*[:-]\s*([^\n;]{3,80}?)(?=\s+(?:east|west|north|south)(?:ern)?(?:\s+side)?\s*[:-]|\n|;|$)/gi;
const NAME_RE = /\b(?:Sh\.?|Shri|Smt\.?|Mr\.?|Mrs\.?|Ms\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g;

const NAME = String.raw`(?:Sh\.?|Shri|Smt\.?|Mr\.?|Mrs\.?|Ms\.?|M/s\.?)?\s*([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})`;
// "Name ... (hereinafter called the Vendor)" or "Vendor: Name"
const roleRe = (roles: string) => [
  new RegExp(String.raw`${NAME}[^.\n]{0,160}?\(\s*hereinafter[^)]{0,60}?\b(?:${roles})\b`, 'g'),
  new RegExp(String.raw`\b(?:${roles})s?\s*(?:name)?\s*[:-]\s*${NAME}`, 'gi'),
];
const SELLER_RES = roleRe('Vendor|Seller|Transferor|First Party');
const BUYER_RES = roleRe('Vendee|Purchaser|Buyer|Transferee|Second Party');
const OWNER_RE = new RegExp(String.raw`\b(?:owner|owned by|registered owner|in the name of|khewatdar|owner/occupier)\b\s*(?:name)?\s*[:-]?\s*${NAME}`, 'gi');
const ADDRESS_RE = /\b(?:situated|situate|located|lying)\s+(?:at|in)\s+([^\n]{10,160}?)(?=\.\s|\n|;|\s+(?:East|West|North|South|bounded)\b|$)|\baddress\s*[:-]\s*([^\n]{10,160})/gi;
const FLOOR_ON_RE = /\b(ground|first|second|third|fourth|fifth|top|\d{1,2}(?:st|nd|rd|th))\s+floor\b/gi;
const TOTAL_FLOORS_RE = /\bG\s*\+\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:-\s*)?(?:storey(?:ed)?|stor[ie]es|floors)\b|\btotal\s+(?:no\.?\s+of\s+)?floors?\s*[:-]?\s*(\d{1,2})/gi;
const RESTRICTION_RE = /[^.\n]{0,80}\b(?:mortgage[d]?|lien|encumbrance|encumbered|attachment|litigation|lis pendens|easement|right of way|lease(?:hold)?|restriction|restrictive covenant|charge|NOC required|not transferable|freehold)\b[^.\n]{0,100}/gi;
const ROOM_WORDS = String.raw`(?:bed\s*rooms?|drawing|dining|living|kitchen|bath(?:room)?s?|toilets?|w\.?c\.?|store|pooja|balcon(?:y|ies)|garage|parking|verandah|hall|lobby|terrace|study|servant)`;
const BHK_RE = /\b(\d(?:\.\d)?)\s*BHK\b/gi;
const ACCOMMODATION_RE = new RegExp(String.raw`\b(?:consist(?:s|ing)?\s+of|compris(?:es|ing)|accommodation|containing)\s*[:-]?\s*([^\n]{0,200}?${ROOM_WORDS}[^\n]{0,160}?)(?=\.\s|\n|$)`, 'gi');
const DIM_RE = /\b(\d+(?:\.\d+)?)\s*(ft|feet|mtrs?|meters?|metres?|m|')?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(ft|feet|mtrs?|meters?|metres?|m|')\b/gi;
const CONSIDERATION_RE = /\b(?:sale\s+)?(?:consideration|sale price|sale amount|total price)[^\d\n]{0,40}?(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d+)?(?:\s*\/-)?)/gi;
const REG_NO_RE = /\b(?:registration|regd\.?|registered|document)\s*(?:no\.?|number|#)\s*[:-]?\s*([A-Za-z0-9][A-Za-z0-9/-]{1,24})/gi;
const REG_DATE_RE = /\b(?:registered|registration|regd\.?)\s+(?:on|dated?|date)\s*[:-]?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/gi;
const SRO_RE = /\b(?:[Ss]ub[\s-]*[Rr]egistrar(?:'s)?(?:\s+office)?|S\.?R\.?O\.?)\s*(?:,|at|of|[:-])?\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})/g;

// The role patterns are case-insensitive, so a captured "name" can be ordinary prose.
const NOT_NAME = /\b(?:agreement|deed|plot|property|buyer|seller|vendor|vendee|said|record|whereof|shall|and|the|of|office|ip)\b/i;
const looksLikeName = (v: string) => v.length > 3 && /^[A-Z]/.test(v) && v.split(' ').every((w) => /^[A-Z]/.test(w)) && !NOT_NAME.test(v);

const validDate = (d: string, m: string, y: string): string | null => {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === year && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d) ? date.toISOString().slice(0, 10) : null;
};
const tidy = (v: string) => v.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');

// Reads likely facts out of page text. Everything returned is a *suggestion*
// for a person to confirm; none of it is stored as verified.
export function suggestFields(pages: string[]): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (s: Suggestion) => {
    const id = `${s.fieldKey}|${s.value}|${s.pageNumber}`;
    if (seen.has(id) || out.length >= MAX_SUGGESTIONS) return;
    seen.add(id);
    out.push(s);
  };

  pages.forEach((raw, index) => {
    const pageNumber = index + 1;
    const text = raw.replace(/[ \t]+/g, ' ');

    // The words that describe a figure are the ones since the previous figure.
    let previousEnd = 0;
    for (const match of text.matchAll(AREA_RE)) {
      const start = match.index ?? 0;
      const context = text.slice(Math.max(previousEnd, start - 80), start);
      previousEnd = start + match[0].length;
      const amount = Number(match[1].replace(/,/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const { sqm, converted } = toSqm(amount, match[2]);
      const { key, confidence } = classifyArea(context);
      add({ fieldKey: key, value: String(round2(sqm)), pageNumber, confidence: round2(converted ? confidence * 0.9 : confidence) });
    }

    for (const match of text.matchAll(REF_RE)) {
      const kind = match[1].toLowerCase();
      const numbers = match[2].replace(/\s+/g, '').replace(/and|&/gi, ',');
      add({ fieldKey: kind === 'plot' ? 'plot_number' : 'khasra_numbers', value: numbers, pageNumber, confidence: kind === 'plot' ? 0.5 : 0.6 });
    }

    for (const match of text.matchAll(DATE_RE)) {
      const [, d, m, y] = match;
      const year = y.length === 2 ? 2000 + Number(y) : Number(y);
      const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d)) {
        add({ fieldKey: 'document_date', value: date.toISOString().slice(0, 10), pageNumber, confidence: 0.55 });
      }
    }

    for (const match of text.matchAll(BOUNDARY_RE)) {
      add({ fieldKey: `boundary_${match[1].toLowerCase()}`, value: match[2].trim().replace(/[.,]+$/, ''), pageNumber, confidence: 0.5 });
    }

    for (const match of text.matchAll(NAME_RE)) {
      add({ fieldKey: 'party_name', value: match[1].trim(), pageNumber, confidence: 0.35 });
    }

    const named = (res: RegExp[], fieldKey: string, confidence: number) => {
      for (const re of res) for (const m of text.matchAll(re)) { const v = tidy(m[1] ?? '').replace(/^(?:Sh|Shri|Smt|Mr|Mrs|Ms|M\/s)\.?\s+/i, ''); if (looksLikeName(v)) add({ fieldKey, value: v, pageNumber, confidence }); }
    };
    named(SELLER_RES, 'seller_name', 0.45);
    named(BUYER_RES, 'buyer_name', 0.45);
    named([OWNER_RE], 'owner_name', 0.4);

    for (const m of text.matchAll(ADDRESS_RE)) add({ fieldKey: 'property_address', value: tidy(m[1] ?? m[2]), pageNumber, confidence: 0.4 });
    for (const m of text.matchAll(FLOOR_ON_RE)) add({ fieldKey: 'floor_number', value: m[1].toLowerCase(), pageNumber, confidence: 0.4 });
    for (const m of text.matchAll(TOTAL_FLOORS_RE)) {
      const n = m[1] ? Number(m[1]) + 1 : Number(m[2] ?? m[3]);
      if (n > 0 && n < 100) add({ fieldKey: 'total_floors', value: String(n), pageNumber, confidence: 0.4 });
    }
    for (const m of text.matchAll(RESTRICTION_RE)) add({ fieldKey: 'legal_restriction', value: tidy(m[0]), pageNumber, confidence: 0.3 });
    for (const m of text.matchAll(BHK_RE)) add({ fieldKey: 'accommodation', value: `${m[1]} BHK`, pageNumber, confidence: 0.5 });
    for (const m of text.matchAll(ACCOMMODATION_RE)) add({ fieldKey: 'accommodation', value: tidy(m[1]), pageNumber, confidence: 0.4 });
    for (const m of text.matchAll(DIM_RE)) add({ fieldKey: 'dimensions', value: `${m[1]} x ${m[3]} ${m[4] === "'" ? 'ft' : m[4]}`, pageNumber, confidence: 0.45 });
    for (const m of text.matchAll(CONSIDERATION_RE)) add({ fieldKey: 'sale_consideration', value: tidy(m[1]).replace(/\s*\/-$/, ''), pageNumber, confidence: 0.5 });
    for (const m of text.matchAll(REG_NO_RE)) if (/\d/.test(m[1])) add({ fieldKey: 'registration_number', value: tidy(m[1]), pageNumber, confidence: 0.45 });
    for (const m of text.matchAll(REG_DATE_RE)) {
      const iso = validDate(m[1], m[2], m[3]);
      if (iso) add({ fieldKey: 'registration_date', value: iso, pageNumber, confidence: 0.5 });
    }
    for (const m of text.matchAll(SRO_RE)) if (!/^office$/i.test(m[1])) add({ fieldKey: 'sub_registrar_office', value: tidy(m[1]), pageNumber, confidence: 0.45 });
  });
  return out;
}
