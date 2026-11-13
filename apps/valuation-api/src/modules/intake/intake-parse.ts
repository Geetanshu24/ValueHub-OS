import type { PropertyClass } from '@value-hub/valuation-shared';

export interface IntakeGuess<T = string> {
  value: T;
  // How much to trust the guess, 0..1. These are pattern matches, never certain.
  confidence: number;
}

export interface IntakeSuggestion {
  bankId?: IntakeGuess;
  purpose?: IntakeGuess;
  address?: IntakeGuess;
  propertyClass?: IntakeGuess<PropertyClass>;
  instructionDate?: IntakeGuess;
  borrowerName?: IntakeGuess;
}

const PURPOSES: [RegExp, string][] = [
  [/loan\s+against\s+(?:property|mortgage)|\bLAP\b/i, 'Loan Against Property (LAP)'],
  [/home\s+loan|housing\s+loan|purchase\s+of\s+(?:a\s+)?(?:flat|house|property)/i, 'Home Loan'],
  [/construction\s+loan|under\s+construction/i, 'Construction Loan'],
  [/balance\s+transfer|take[\s-]?over/i, 'Balance Transfer'],
  [/\bOD\b|overdraft|cash\s+credit|working\s+capital/i, 'Working Capital / OD'],
  [/mortgage|collateral|security\s+valuation/i, 'Mortgage / Collateral Valuation'],
  [/re-?valuation|periodic\s+valuation/i, 'Revaluation'],
];

const CLASSES: [RegExp, PropertyClass][] = [
  [/\b(?:flat|apartment|builder\s+floor)\b/i, 'FLAT'],
  [/\b(?:industrial|factory|plant\s+and\s+machinery)\b/i, 'INDUSTRIAL'],
  [/\b(?:shop|showroom|office|commercial)\b/i, 'COMMERCIAL'],
  [/\b(?:house|kothi|villa|residential\s+building)\b/i, 'HOUSE'],
  [/\b(?:vacant\s+land|agricultural|plot\s+of\s+land|open\s+plot|\bland\b)\b/i, 'LAND'],
];

const ADDRESS_RE = /(?:property\s+address|address\s+of\s+(?:the\s+)?property|address\s+of\s+(?:the\s+)?security|property\s+(?:situated|located)\s+at|location\s+of\s+(?:the\s+)?property|security\s+address)\s*[:\-–]?\s*([^\n]{8,240}(?:\n(?![A-Z][A-Za-z ]{2,30}\s*[:\-–])[^\n]{3,120}){0,2})/i;
const NAME_RE = /(?:name\s+of\s+(?:the\s+)?(?:borrower|applicant|customer)|borrower(?:'s)?(?:\s+name)?|applicant(?:'s)?(?:\s+name)?|customer\s+name)\s*[:\-–]\s*((?:M\/s\.?\s*)?[A-Za-z][A-Za-z.&' ]{2,70}?)(?=\s{2,}|\n|,|\(|$| (?:residing|r\/o|s\/o|w\/o|d\/o)\b)/i;
const DATE_RE = /(?:date(?:d)?|instruction\s+date|letter\s+date|dt\.?)\s*[:\-–]?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i;
const ANY_DATE_RE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/;

function isoDate(d: string, m: string, y: string): string | undefined {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d);
  return valid ? date.toISOString().slice(0, 10) : undefined;
}

const clean = (value: string) => value.replace(/\s+/g, ' ').replace(/[\s,;:.-]+$/, '').trim();

// Reads a bank's instruction letter for the facts needed to start an
// assignment. Everything returned is a *suggestion* for a person to confirm.
export function parseInstruction(text: string, banks: { id: string; name: string }[]): IntakeSuggestion {
  const out: IntakeSuggestion = {};
  const flat = text.replace(/[ \t]+/g, ' ');

  // Longest bank names first, so "State Bank of India" wins over "Bank".
  const lower = flat.toLowerCase();
  const bank = [...banks].sort((a, b) => b.name.length - a.name.length).find((b) => lower.includes(b.name.toLowerCase()));
  if (bank) out.bankId = { value: bank.id, confidence: 0.7 };

  const purpose = PURPOSES.find(([re]) => re.test(flat));
  if (purpose) out.purpose = { value: purpose[1], confidence: 0.55 };

  const address = ADDRESS_RE.exec(flat);
  if (address) {
    const value = clean(address[1]);
    if (value.length >= 8) out.address = { value, confidence: 0.55 };
  }

  // The property type is judged from the address when there is one, so the
  // word "commercial" in a letterhead does not decide it.
  const subject = out.address?.value ?? flat;
  const kind = CLASSES.find(([re]) => re.test(subject)) ?? (out.address ? CLASSES.find(([re]) => re.test(flat)) : undefined);
  if (kind) out.propertyClass = { value: kind[1], confidence: out.address ? 0.5 : 0.35 };

  const dated = DATE_RE.exec(flat);
  const date = dated ? isoDate(dated[1], dated[2], dated[3]) : (() => { const m = ANY_DATE_RE.exec(flat); return m ? isoDate(m[1], m[2], m[3]) : undefined; })();
  if (date) out.instructionDate = { value: date, confidence: dated ? 0.55 : 0.3 };

  const name = NAME_RE.exec(flat);
  if (name) {
    const value = clean(name[1]);
    if (value.length >= 3) out.borrowerName = { value, confidence: 0.5 };
  }
  return out;
}

export type DeedAreaUnit = 'Sq.Yd' | 'Sq.Ft' | 'Sq.M' | 'Acre';

export interface DeedSuggestion {
  borrowerName?: IntakeGuess;
  fatherName?: IntakeGuess;
  propertyClass?: IntakeGuess<PropertyClass>;
  area?: IntakeGuess<{ value: number; unit: DeedAreaUnit }>;
  address?: IntakeGuess;
  khasra?: IntakeGuess;
  locality?: IntakeGuess;
  district?: IntakeGuess;
}

const PERSON_RE = /((?:Sh\.?|Shri|Smt\.?|Shrimati|Mr\.?|Mrs\.?|Ms\.?|Km\.?)\s*[A-Za-z][A-Za-z.' ]{2,60}?)\s*,?\s*(?:S\/o|W\/o|D\/o|C\/o|Son\s+of|Wife\s+of|Daughter\s+of)\s*:?\s*((?:Late\s+|Sh\.?\s+|Shri\s+|Smt\.?\s+|Mr\.?\s+)*[A-Za-z][A-Za-z.' ]{2,60}?)(?=\s*,|\s+R\/o|\s+resident|\s+residing|\s+aged|\s+age\b|\n|$)/gi;
const BUYER_RE = /hereinafter[^]{0,120}?(?:vendee|purchaser|buyer)/gi;
const AREA_RE = /(?:measuring|admeasuring|area\s+(?:of|measuring)|covered\s+area|plot\s+area)[^\d]{0,40}(\d[\d,]*(?:\.\d+)?)\s*(sq(?:uare)?\.?\s*(?:yards?|yds?|mtrs?|metres?|meters?|m\b|feet|foot|ft)|gaj|acres?)/i;
const DEED_ADDRESS_RE = /(?:(?:property|land|plot|house|flat|shop)\s+bearing\s+|(?:property|land|plot|house|flat|shop)\s+(?:being|situated|located)[^:\n]{0,60}?\s+(?:at|in)\s+|situated\s+at\s+|schedule\s+of\s+(?:the\s+)?property\s*[:\-–]?)\s*([^]{15,320}?)(?=\.\s+(?=[A-Z])|\n\n|\bmeasuring\b|\badmeasuring\b|\bwhich\b|\bhereinafter\b|$)/i;

const KHASRA_RE = /(?:khasra|khasara|khewat|plot)\s*(?:no\.?|number|nos\.?)?\s*[:\-–]?\s*(\d[\w/-]*(?:\s*(?:,|and|&)\s*\d[\w/-]*)*)/i;
const LOCALITY_RE = /\b([Ss]ector\s*-?\s*\d+[a-z]?|[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?\s+(?:Colony|Nagar|Vihar|Enclave|Extension|Puram|Park|Garden|Apartments?))\b/;
const DISTRICT_RE = /\b(?:district|distt?\.?)\s*[:,\-–]?\s*([A-Za-z][A-Za-z ]{2,35}?)(?=\s*[,.\n(]|\s+(?:and|state|pin)\b|$)/i;

function areaUnit(raw: string): DeedAreaUnit {
  const unit = raw.toLowerCase();
  if (unit.startsWith('acre')) return 'Acre';
  if (/feet|foot|ft/.test(unit)) return 'Sq.Ft';
  if (/yard|yd|gaj/.test(unit)) return 'Sq.Yd';
  return 'Sq.M';
}

// Reads a sale deed for the buyer (vendee), their father or husband, the
// property type, the land area and the address. As with an instruction
// letter, every value is only a suggestion for a person to confirm.
export function parseDeed(text: string): DeedSuggestion {
  const out: DeedSuggestion = {};
  const flat = text.replace(/[ \t]+/g, ' ');

  // The buyer is the party described just before "hereinafter called the Vendee".
  for (const mark of flat.matchAll(BUYER_RE)) {
    const before = flat.slice(Math.max(0, (mark.index ?? 0) - 450), mark.index ?? 0);
    const people = [...before.matchAll(PERSON_RE)];
    const last = people[people.length - 1];
    if (last) {
      out.borrowerName = { value: clean(last[1]), confidence: 0.6 };
      out.fatherName = { value: clean(last[2]), confidence: 0.55 };
      break;
    }
  }

  const area = AREA_RE.exec(flat);
  if (area) {
    const value = Number(area[1].replace(/,/g, ''));
    if (value > 0) out.area = { value: { value, unit: areaUnit(area[2]) }, confidence: 0.55 };
  }

  const address = DEED_ADDRESS_RE.exec(flat);
  if (address) {
    const value = clean(address[1]);
    if (value.length >= 10) out.address = { value, confidence: 0.5 };
  }

  // Khasra, colony and district are read from the address first, then from the rest of the deed.
  const where = out.address?.value ?? flat;
  const khasra = KHASRA_RE.exec(flat);
  if (khasra) out.khasra = { value: clean(khasra[1]).replace(/\s*(?:and|&)\s*/gi, ', '), confidence: 0.5 };
  const locality = LOCALITY_RE.exec(where) ?? LOCALITY_RE.exec(flat);
  if (locality) out.locality = { value: clean(locality[1]), confidence: 0.5 };
  const district = DISTRICT_RE.exec(flat);
  if (district) out.district = { value: clean(district[1]), confidence: 0.5 };

  // The words that introduce the address ("residential house bearing") count too.
  const subject = address ? flat.slice(Math.max(0, address.index - 40), address.index + address[0].length) : flat;
  // With no address to judge from, a deed that calls the plot residential is not industrial because
  // some other clause mentions a factory.
  const residential = !address && /\bresidential\s+(?:plot|colony|house|site|building|property)/i.test(flat);
  const kind = residential ? CLASSES.find(([, c]) => c === 'HOUSE') : CLASSES.find(([re]) => re.test(subject));
  if (kind) out.propertyClass = { value: kind[1], confidence: out.address ? 0.5 : 0.35 };
  return out;
}
