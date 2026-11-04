import { prefillBoi, type PrefillInput } from './boi-prefill.js';

const LAKH = 100_000;
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
  const rest = n % 100;
  if (rest > 0) parts.push(rest < 20 ? ONES[rest] : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? ` ${ONES[rest % 10]}` : ''}`);
  return parts.join(' ');
}

// "One Hundred Six Lakh", or "One Hundred Lakh & Seventy Thousand": how the bank's form writes an amount.
export function rupeesInWords(rupees: number): string {
  const rounded = Math.round(rupees / 1000) * 1000;
  const lakhs = Math.floor(rounded / LAKH);
  const thousands = Math.floor((rounded % LAKH) / 1000);
  const parts: string[] = [];
  if (lakhs > 0) parts.push(`${below1000(lakhs)} Lakh`);
  if (thousands > 0) parts.push(`${lakhs > 0 ? '& ' : ''}${below1000(thousands)} Thousand`);
  return `Rupees ${parts.join(' ') || 'Zero'}`;
}

const shortLakh = (rupees: number) => `Rs ${(rupees / LAKH).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Lakh`;

// The State Bank of India form writes realizable value at 95% and distress value at 85%, with the amount in words.
export function prefillSbi(input: PrefillInput): Record<string, string> {
  const out = prefillBoi(input);
  const total = input.valuation?.totalValue;
  if (total) {
    const amounts = { fmv: total, realizable: total * 0.95, distress: total * 0.85 };
    for (const [key, amount] of Object.entries(amounts)) {
      out[key] = `${shortLakh(amount)} (${rupeesInWords(amount)})`;
      out[`${key}_short`] = shortLakh(amount);
    }
    out.mv_total = shortLakh(total);
  }
  out.dec_2 = `Valuation for ${input.assignment.bankName}${input.assignment.branchName ? `, ${input.assignment.branchName}` : ''} bank purpose only`;
  return out;
}
