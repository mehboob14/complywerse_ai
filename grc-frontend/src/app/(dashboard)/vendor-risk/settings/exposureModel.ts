// The exposure model's definitions and rules, apart from React so `node --test` pins them (settingsModel.test.ts): the figures that put a money range on every supplier. Each input is a range
// (the lowest you would expect, the most likely, the highest): a range that does not go up in that order is refused with its name in the save bar. The editor is _Exposure.tsx.

export type Triple = [number, number, number];
export interface Quant {
  currency: string; iterations: number;
  breach_per_year: Record<string, Triple>; outage_per_year: Record<string, Triple>; records: Record<string, Triple>;
  outage_cost_per_hour: Record<string, Triple>; cost_per_record: Triple; response_cost: Triple; outage_hours: Triple;
  control_effect: Record<string, number>;
}
export type GroupKey = 'breach_per_year' | 'outage_per_year' | 'records' | 'outage_cost_per_hour';
export type SingleKey = 'cost_per_record' | 'response_cost' | 'outage_hours';
export type Unit = 'rate' | 'records' | 'money' | 'money_hour' | 'hours';

export const TIER_BANDS: Record<string, string> = { critical: 'Critical-tier supplier', high: 'High-tier supplier', medium: 'Medium-tier supplier', low: 'Low-tier supplier' };
export const ACCESS_BANDS: Record<string, string> = {
  none: 'No access to our data', public: 'Public data only', internal: 'Internal data', confidential: 'Confidential data',
  restricted: 'Restricted data', regulated: 'Regulated data',
};
export const PROCESS_BANDS: Record<string, string> = {
  critical: 'A critical process stops', high: 'A high-criticality process stops', medium: 'A medium-criticality process stops',
  low: 'A low-criticality process stops',
};
export const GROUPS: Array<{ key: GroupKey; title: string; help: string; bands: Record<string, string>; unit: Unit }> = [
  { key: 'breach_per_year', title: 'How often a supplier exposes our data', unit: 'rate', bands: TIER_BANDS,
    help: 'Incidents a year at one supplier, by its tier. 0.1 means about once in ten years; 1 means about once a year.' },
  { key: 'outage_per_year', title: 'How often a supplier’s service stops', unit: 'rate', bands: TIER_BANDS,
    help: 'Outages a year at one supplier, by its tier.' },
  { key: 'records', title: 'How many of our records one incident exposes', unit: 'records', bands: ACCESS_BANDS,
    help: 'By the most sensitive data the supplier can reach, as recorded on the supplier.' },
  { key: 'outage_cost_per_hour', title: 'What an hour of outage costs us', unit: 'money_hour', bands: PROCESS_BANDS,
    help: 'By the most critical business process that depends on the supplier, from business continuity planning.' },
];
export const SINGLES: Array<{ key: SingleKey; title: string; unit: Unit }> = [
  { key: 'cost_per_record', title: 'Cost for each record exposed', unit: 'money' },
  { key: 'response_cost', title: 'Cost of handling one incident: investigation, notification, legal', unit: 'money' },
  { key: 'outage_hours', title: 'How long an outage lasts', unit: 'hours' },
];
export const RATING_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', unrated: 'Not yet rated' };
export const COLUMNS = ['Lowest', 'Most likely', 'Highest'] as const;

export const num = (v: number): string => Number(v).toLocaleString('en-GB', { maximumFractionDigits: 3 });
export const ordered = (t: Triple): boolean => t[0] <= t[1] && t[1] <= t[2] && t[0] >= 0;

/** What the most likely figure of a range means, in words. */
export function inWords(unit: Unit, t: Triple, currency: string): string {
  const m = Number(t[1]) || 0;
  switch (unit) {
    case 'rate':
      if (m <= 0) return 'most likely never';
      if (m < 1) return `most likely about once every ${num(Math.round(1 / m))} years`;
      return m === 1 ? 'most likely about once a year' : `most likely about ${num(m)} times a year`;
    case 'records': return m ? `most likely ${num(m)} records` : 'most likely none';
    case 'money': return `most likely ${currency} ${num(m)}`;
    case 'money_hour': return `most likely ${currency} ${num(m)} an hour`;
    default: return `most likely ${num(m)} hours`;
  }
}

/** Ranges that do not go up from lowest to highest, by name, for the save bar. */
export function exposureProblems(q: Quant): string[] {
  const out: string[] = [];
  GROUPS.forEach((g) => Object.entries(q[g.key]).forEach(([band, t]) => { if (!ordered(t)) out.push(`${g.bands[band] || band}: ${g.title.toLowerCase()}`); }));
  SINGLES.forEach((s) => { if (!ordered(q[s.key])) out.push(s.title); });
  return out;
}

export const exposureSummary = (q: Quant): string =>
  `${q.currency} · ${Number(q.iterations).toLocaleString('en-GB')} simulated years · incidents, outages, records and costs as ranges`;
