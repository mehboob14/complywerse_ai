// What the Overview works out from the program dashboard's numbers: the four tiles, the cards' rows and slices, and the links each
// leads to (every one is the register, or the findings, filtered the way it counted). Pure, so `node --test` runs
// overviewModel.test.ts against it. Every P0 key is optional here: an older server gives a page of zeros, not a crash.

import { fmt } from '../_ui/fmt.ts';
import { tierColor, tierLabel } from '../_ui/tiers.ts';
import { TONE, tones, type Tone } from '../_ui/tones.ts';
import { ATTENTION, attentionLabel, attentionTone } from './attention.ts';

export type Scope = 'portfolio' | 'mine';

export interface Kpis {
  active_vendors: number; onboarded_this_period: number; critical_coverage: number; critical_count: number; critical_covered: number;
  portfolio_inherent: number; portfolio_residual: number; open_critical_findings: number; open_critical_overdue: number;
  closure_rate: number; reviews_due_30d: number; overdue_reviews: number; new_signals: number;
  attention_open?: number; attention_urgent?: number;
}
export interface Signal {
  id: number; vendor_id: number; vendor_name: string | null; signal_type: string;
  severity: string; title: string | null; occurred_at: string | null; acknowledged: boolean;
}
export interface TopVendor {
  id: number; name: string; tier: string | null; residual: number | null; inherent: number | null; rating: string | null; grade: string | null;
}
export interface PendingRequest {
  id: number; name: string; requested_by: string | null; requested_by_id: number | null; submitted_at: string | null; duplicate: boolean;
}
export interface Dashboard {
  scope: string;
  kpis: Kpis;
  tier_distribution: Record<string, number>;
  inherent_vs_residual: Array<{ tier: string; inherent: number; residual: number }>;
  findings_posture: Record<string, number>;
  findings_severity: Record<string, number>;
  findings_by_domain: Record<string, number>;
  monitoring_feed: Signal[];
  top_residual_vendors: TopVendor[];
  // the register's view of the portfolio (P0)
  not_tiered?: number;
  no_owner?: number;
  reassessment_overdue?: number;
  attention_counts?: Record<string, number>;
  by_status?: Record<string, number>;
  tier_counts?: Record<string, number>;
  coverage?: { in_window: number; total: number; percent: number | null };
  /** tenant-wide, also in "My queue" */
  intake_pending?: { total: number; items: PendingRequest[] };
}

export const REGISTER = '/vendor-risk/vendors';
export const FINDINGS = '/vendor-risk/findings';

/** The register filtered as a tile or card counted. In "My queue" the counts are of the caller's own vendors, so the link says so. */
export function registerHref(filters: Record<string, string>, scope: Scope): string {
  const query = new URLSearchParams(filters);
  if (scope === 'mine' && !query.has('owner')) query.set('owner', 'me');
  const text = query.toString();
  return text ? `${REGISTER}?${text}` : REGISTER;
}

export interface Tile { key: string; label: string; value: number; tone: 'warning' | 'danger'; caption?: string; href: string }

/** Verity's four tiles, each a way into the list it counts. */
export function tiles(d: Pick<Dashboard, 'not_tiered' | 'no_owner' | 'reassessment_overdue' | 'kpis'>, scope: Scope): Tile[] {
  const late = d.kpis.open_critical_overdue ?? 0;
  return [
    { key: 'not_tiered', label: 'Not tiered', value: d.not_tiered ?? 0, tone: 'warning', href: registerHref({ attention: 'not_tiered' }, scope) },
    { key: 'no_owner', label: 'No business owner', value: d.no_owner ?? 0, tone: 'warning', href: registerHref({ owner: 'unassigned' }, scope) },
    { key: 'overdue', label: 'Reassessment overdue', value: d.reassessment_overdue ?? 0, tone: 'danger', href: registerHref({ attention: 'reassessment_overdue' }, scope) },
    {
      key: 'critical', label: 'Critical findings', value: d.kpis.open_critical_findings ?? 0, tone: 'danger',
      caption: late > 0 ? `${late} overdue` : undefined, href: `${FINDINGS}?severity=critical`,
    },
  ];
}

export interface AttentionRow { code: string; label: string; tone: Tone; count: number; href: string }

/** One row per thing vendors wait on, in the register's order (a code this page does not know comes last, in its own words). */
export function attentionRows(counts: Record<string, number> | undefined, scope: Scope): AttentionRow[] {
  const known = ATTENTION.map((a) => a.code);
  const codes = [...known, ...Object.keys(counts ?? {}).filter((c) => !known.includes(c)).sort()];
  return codes
    .filter((code) => (counts?.[code] ?? 0) > 0)
    .map((code) => ({ code, label: attentionLabel(code), tone: attentionTone(code), count: counts![code], href: registerHref({ attention: code }, scope) }));
}

export interface Slice { key: string; label: string; value: number; color: string; href: string }

/** The tiers with someone in them, and those not tiered apart; the untiered slice leads to what needs tiering. */
export function tierSlices(counts: Record<string, number> | undefined, scope: Scope): Slice[] {
  const rows: Slice[] = [
    ...(['critical', 'high', 'medium', 'low'] as const).map((t) => ({
      key: t, label: tierLabel(t), value: counts?.[t] ?? 0, color: tierColor(t), href: registerHref({ tier: t }, scope),
    })),
    { key: 'not_tiered', label: 'Not tiered', value: counts?.not_tiered ?? 0, color: tierColor(null), href: registerHref({ attention: 'not_tiered' }, scope) },
  ];
  return rows.filter((r) => r.value > 0);
}

/** Open findings by severity (open or in remediation only), each leading to the findings of that severity. */
export function severitySlices(open: Record<string, number> | undefined): Slice[] {
  return (['critical', 'high', 'medium', 'low'] as const)
    .map((s) => ({ key: s, label: tierLabel(s), value: open?.[s] ?? 0, color: tierColor(s), href: `${FINDINGS}?severity=${s}` }))
    .filter((r) => r.value > 0);
}

export const sum = (slices: Array<{ value: number }>): number => slices.reduce((n, s) => n + s.value, 0);

export interface StatusBar { key: string; label: string; count: number; percent: number; color: string }

/** A bar per lifecycle status, the biggest first, with its share of the vendors counted. */
export function statusBars(byStatus: Record<string, number> | undefined): StatusBar[] {
  const rows = Object.entries(byStatus ?? {}).filter(([, n]) => n > 0);
  const total = rows.reduce((n, [, c]) => n + c, 0);
  return rows
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({
      key, count, label: key === 'unset' ? 'Not set' : fmt.status(key), percent: total ? Math.round((count / total) * 100) : 0,
      color: TONE[tones.lifecycle(key)].dot,
    }));
}

export interface Coverage { percent: number | null; caption: string; outside: number }

/** The coverage gauge: how many of the critical and high vendors are inside their reassessment window. */
export function coverageView(c: Dashboard['coverage']): Coverage {
  if (!c || !c.total) return { percent: null, caption: '', outside: 0 };
  return { percent: c.percent ?? Math.round((c.in_window / c.total) * 100), caption: `${c.in_window}/${c.total} critical and high`, outside: Math.max(0, c.total - c.in_window) };
}

export interface IntakeRow { id: number; name: string; byline: string; duplicate: boolean }

/** The first requests waiting for a decision: "requester · date". */
export function intakeRows(items: PendingRequest[] | undefined, most = 4): IntakeRow[] {
  return (items ?? []).slice(0, most).map((r) => ({
    id: r.id, name: r.name, duplicate: !!r.duplicate,
    byline: [r.requested_by || 'Unattributed', r.submitted_at ? fmt.date(r.submitted_at) : ''].filter(Boolean).join(' · '),
  }));
}

export const topResidual = (list: TopVendor[] | undefined, most = 5): TopVendor[] => (list ?? []).slice(0, most);

/** A residual score as the width of its bar: 0 to 100. */
export const barWidth = (score: number | null | undefined): number =>
  typeof score === 'number' && Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;

export interface Kpi { key: string; label: string; value: number | string; tone: 'warning' | 'danger' | 'neutral' | 'success' | 'progress'; caption?: string; href?: string }

/** What Compliverse's own headline numbers say, kept under Verity's cards: the attention queue, the portfolio's size, coverage,
 *  the residual score, and the reviews coming up. (The critical findings are the fourth tile.) */
export function kpis(k: Kpis): Kpi[] {
  const urgent = k.attention_urgent ?? 0;
  const removed = Math.max(0, Math.round(k.portfolio_inherent - k.portfolio_residual));
  return [
    { key: 'queue', label: 'Attention queue', value: k.attention_open ?? 0, tone: urgent ? 'danger' : 'success', caption: urgent ? `${urgent} urgent` : undefined, href: '/vendor-risk/attention' },
    { key: 'active', label: 'Active vendors', value: k.active_vendors, tone: 'neutral', caption: k.onboarded_this_period > 0 ? `+${k.onboarded_this_period} onboarded · 30d` : 'No new onboards · 30d' },
    { key: 'coverage', label: 'Critical coverage', value: `${k.critical_coverage}%`, tone: k.critical_coverage >= 90 ? 'success' : 'warning', caption: `${k.critical_covered}/${k.critical_count} critical assessed` },
    { key: 'residual', label: 'Portfolio residual', value: k.portfolio_residual, tone: 'neutral', caption: `${removed} removed vs inherent ${k.portfolio_inherent}` },
    {
      key: 'reviews', label: 'Reviews due ≤30d', value: k.reviews_due_30d, tone: k.overdue_reviews ? 'warning' : 'neutral',
      caption: [k.overdue_reviews > 0 ? `${k.overdue_reviews} overdue` : '', `${k.new_signals} new signals`].filter(Boolean).join(' · '),
    },
  ];
}
