import { prefillBoi, type PrefillInput } from './boi-prefill.js';

// The Punjab National Bank form asks for the same facts under some keys of its own; the common
// suggestions already cover them, and its realizable and distress values are fixed fractions too.
export function prefillPnb(input: PrefillInput): Record<string, string> {
  const out = prefillBoi(input);
  out.dec_2 = `Valuation for loan purpose and appointing authority of ${input.assignment.bankName}${input.assignment.branchName ? `, ${input.assignment.branchName}` : ''}`;
  if (input.facts.guideline_rate) out.val_circle_rate = input.facts.guideline_rate;
  return out;
}
