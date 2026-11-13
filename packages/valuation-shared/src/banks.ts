// The banks the app has a report format for. Other bank names are not offered when a case is made.
export const SUPPORTED_BANK_PATTERNS: RegExp[] = [
  /(?<!state\s)bank\s+of\s+india|\bboi\b/i,
  /punjab\s+national|\bpnb\b/i,
  /state\s+bank\s+of\s+india|\bsbi\b/i,
];

export const isSupportedBank = (name: string): boolean => SUPPORTED_BANK_PATTERNS.some((p) => p.test(name));
