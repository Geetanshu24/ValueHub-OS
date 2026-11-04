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
