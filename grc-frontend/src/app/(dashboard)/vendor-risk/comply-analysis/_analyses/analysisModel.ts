// Insights > Comply analyses, apart from React (`analysisModel.test.ts`): the register of loss-scenario analyses and the overview cards above it. Every figure (the chance of a loss in a year, the average
// year, the one-in-twenty year, the least liability cap, how a supplier's insurance stands) is the server's (tpra/fair.py: `annual`, `liability_cap`, `cover_state`, the overview); this file filters,
// orders and words them. "Average year" adds up the FINAL analyses only (the server's `average_year`), which the card says.
import { buildSchema, type RegisterDef } from '../../../../../components/records/registerModel.ts';
import { EFFECT_WORDS, ANALYSIS_EFFECTS, analysisCover, analysisRisk, analysisState } from '../../../../../lib/statuses/vendorInsights.ts';
import { vendorTier } from '../../../../../lib/statuses/vendor.ts';
import type { CoverState, FairAnalysis, RiskLevel } from '../../_lib/fair/fairModel.ts';

export type AnalysisRow = FairAnalysis;

export interface Brief {
  id: number; name: string; vendor: { id: number; name: string }; p95: number | null; mean: number | null; chance: number | null; cover: number | null; risk_level: RiskLevel | null; status: string;
}
export interface Overview {
  currency: string; count: number; finals: number; drafts: number; suppliers: number; average_year: number;
  largest: Brief[]; under_insured: Brief[]; no_cover: number; by_effect?: Record<string, number>; by_risk_level: Record<string, number>;
}
export interface ListAnswer { items: AnalysisRow[]; currency: string }

const NONE = 'none';
export const coverOf = (r: Pick<AnalysisRow, 'cover_state'>): CoverState => r.cover_state ?? 'none';
export const tierOf = (r: Pick<AnalysisRow, 'vendor'>): string => (r.vendor.tier ? r.vendor.tier.toLowerCase() : NONE);
export const riskOf = (r: Pick<AnalysisRow, 'risk_level'>): string => r.risk_level ?? NONE;
export const isFinal = (r: Pick<AnalysisRow, 'status'>): boolean => r.status === 'final';

const TIERS = ['critical', 'high', 'medium', 'low'];
const LEVELS: RiskLevel[] = ['critical', 'high', 'medium', 'low'];

export function analysisDef(): RegisterDef<AnalysisRow> {
  return {
    key: 'fair',
    noun: { one: 'analysis', other: 'analyses' },
    idOf: (r) => r.id,
    text: (r) => [r.name, r.vendor.name, EFFECT_WORDS[r.effect] ?? '', r.scenario ?? ''].join(' '),
    facets: [
      { key: 'state', label: 'Status', defaultOpen: true, values: (r) => [r.status], options: () => ['draft', 'final'].map((value) => ({ value, label: analysisState.label(value) })) },
      { key: 'effect', label: 'What goes wrong', defaultOpen: true, values: (r) => [r.effect], options: () => ANALYSIS_EFFECTS.map((value) => ({ value, label: EFFECT_WORDS[value] })) },
      { key: 'cover', label: 'Insurance', values: (r) => [coverOf(r)], options: () => (['covers', 'short', 'none'] as const).map((value) => ({ value, label: analysisCover.label(value) })) },
      {
        key: 'tier', label: 'Supplier tier', values: (r) => [tierOf(r)],
        options: () => [...TIERS.map((value) => ({ value, label: vendorTier.label(value) })), { value: NONE, label: 'Not tiered' }],
      },
      {
        key: 'risk', label: 'AI write-up', values: (r) => [riskOf(r)],
        options: () => [...LEVELS.map((value) => ({ value, label: analysisRisk.label(value) })), { value: NONE, label: 'Not written up' }],
      },
      {
        // the facet is `supplier`, not `vendor`: ?vendor=<id> is the old deep link that opens New analysis for that supplier
        key: 'supplier', label: 'Supplier', searchable: true, limit: 8, values: (r) => [String(r.vendor.id)],
        options: (rows) => Array.from(new Map(rows.map((r) => [r.vendor.id, r.vendor.name])).entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ value: String(id), label: name })),
      },
    ],
    quick: [
      { key: 'final', label: 'Final', test: (r) => isFinal(r), title: 'The analyses the programme adds up' },
      { key: 'draft', label: 'Draft', test: (r) => !isFinal(r) },
      { key: 'short', label: 'Cover falls short', test: (r) => coverOf(r) === 'short', title: 'The supplier’s insurance does not pay for the one-in-twenty year' },
      { key: 'nocover', label: 'No cover recorded', test: (r) => coverOf(r) === 'none', title: 'Record the supplier’s cover to check it' },
    ],
    sorts: [
      { key: 'updated', label: 'Last updated', firstDir: 'desc', value: (r) => r.updated_at },
      { key: 'name', label: 'Analysis', firstDir: 'asc', value: (r) => r.name },
      { key: 'vendor', label: 'Supplier', firstDir: 'asc', value: (r) => r.vendor.name },
      { key: 'chance', label: 'Chance a year', firstDir: 'desc', value: (r) => r.annual?.chance ?? null },
      { key: 'mean', label: 'Average year', firstDir: 'desc', value: (r) => r.annual?.mean ?? null },
      { key: 'p95', label: '1 year in 20', firstDir: 'desc', value: (r) => r.annual?.p95 ?? null },
      { key: 'cap', label: 'Least liability cap', firstDir: 'desc', value: (r) => r.liability_cap ?? null },
    ],
    defaultSort: { key: 'updated', dir: 'desc' },
    pageSize: 25,
  };
}

export const ANALYSIS_SCHEMA = buildSchema(analysisDef());

/** The head's line: how many analyses, how many suppliers, how many are final (the server's overview). */
export function headLine(o: Pick<Overview, 'count' | 'suppliers' | 'finals'>): string {
  const n = (x: number, one: string, other: string) => `${x.toLocaleString('en-GB')} ${x === 1 ? one : other}`;
  return [n(o.count, 'analysis', 'analyses'), n(o.suppliers, 'supplier', 'suppliers'), `${o.finals.toLocaleString('en-GB')} final`].join(' · ');
}

/** The bar width of a "largest year" row against the largest of the five, 0 to 100. */
export const barWidth = (value: number | null | undefined, top: number): number => (top > 0 && value ? Math.min(100, (value / top) * 100) : 0);
