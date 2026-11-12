export const RATE_UNITS = ['SQ_FT', 'SQ_YD', 'SQ_M'] as const;
export type RateUnit = (typeof RATE_UNITS)[number];
export const RATE_KINDS = ['TRANSACTION', 'ASKING', 'CIRCLE'] as const;

const SQM_PER_UNIT: Record<RateUnit, number> = { SQ_M: 1, SQ_FT: 0.09290304, SQ_YD: 0.83612736 };

// A rate quoted per sq ft or sq yd, restated per sq m so rates quoted differently can be set side by side.
export const perSqm = (rate: number, unit: RateUnit): number => Math.round((rate / SQM_PER_UNIT[unit]) * 100) / 100;
export const perSqft = (ratePerSqm: number): number => Math.round(ratePerSqm * 0.09290304 * 100) / 100;

export interface TrendPoint {
  month: string;
  // Average rate per sq ft that month, and how many entries it is made from.
  average: number;
  count: number;
}

// The average rate per month over the last `months`, oldest first. A month with no entry is left out, not shown as zero.
export function monthlyTrend(rows: { observedOn: Date; ratePerSqm: number }[], months = 12, now = new Date()): TrendPoint[] {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    if (r.observedOn < from) continue;
    const key = r.observedOn.toISOString().slice(0, 7);
    buckets.set(key, [...(buckets.get(key) ?? []), r.ratePerSqm]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, values]) => ({ month, average: perSqft(values.reduce((t, v) => t + v, 0) / values.length), count: values.length }));
}

export interface PlaceSummary {
  locality: string;
  classes: string[];
  count: number;
  freshestOn: string;
  low: number;
  high: number;
  // The middle rate per sq ft, which is steadier than the average when one entry is odd.
  benchmark: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// The places with most rates first. Circle rates are the government's, so they are left out of the market range.
export function summarisePlaces(rows: { locality: string; propertyClass: string; ratePerSqm: number; observedOn: Date; kind: string }[]): PlaceSummary[] {
  const byPlace = new Map<string, typeof rows>();
  for (const r of rows) if (r.kind !== 'CIRCLE') byPlace.set(r.locality, [...(byPlace.get(r.locality) ?? []), r]);
  return [...byPlace.entries()]
    .map(([locality, list]) => {
      const rates = list.map((r) => perSqft(r.ratePerSqm));
      return { locality, classes: [...new Set(list.map((r) => r.propertyClass))], count: list.length, freshestOn: list.map((r) => r.observedOn).sort((a, b) => b.getTime() - a.getTime())[0].toISOString().slice(0, 10), low: Math.min(...rates), high: Math.max(...rates), benchmark: Math.round(median(rates) * 100) / 100 };
    })
    .sort((a, b) => b.count - a.count);
}
