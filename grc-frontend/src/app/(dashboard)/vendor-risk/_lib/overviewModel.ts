// What the Overview works out from the program dashboard's numbers: the counters of the band, the posture card, the breakdowns' rows and slices, and the links each leads to (every one is
// the register, or the findings, filtered the way it counted). Pure, so `node --test` runs overviewModel.test.ts against it. Every P0 key is optional here: an older server gives a page
// of zeros, not a crash. `tiles` keeps its keys: the Performance Overview's vendor row (lib/perf/moduleFeeds.ts) reads them.
//
// ONE number for each thing (vendor-shell, 2026-11-08): "reassessment overdue" is the server's (`reassessment_overdue`, the register's next-action definition: the earlier of a vendor's own
// date and its engagements' dates is before today, vendors in use) and the posture card says that number, not a second one counted from the dates; a residual score is banded on the
// tenant's thresholds (vendorRules.ts); the two coverages have two names ("Critical vendors assessed", "Reviews in window").

import { fmt } from '../_ui/fmt.ts';
import { tierColor, tierLabel } from '../_ui/tiers.ts';
import { TONE, tones } from '../_ui/tones.ts';
import { vendorTier } from '../../../../lib/statuses/vendor.ts';
import type { Tone } from '../../../../lib/status.ts';
import { ATTENTION, attentionLabel, attentionTone } from './attention.ts';
import { DOMAIN_LABELS, titleCase } from './tprmShared.ts';

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
export const INTAKE = '/vendor-risk/intake';

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

export interface Counter { key: string; label: string; value: number; tone: Tone; caption?: string; href: string }

/** What the counters band says: the four tiles and the requests waiting for a decision (the true total, not the four the old card listed). */
export function counters(d: Pick<Dashboard, 'not_tiered' | 'no_owner' | 'reassessment_overdue' | 'kpis' | 'intake_pending'>, scope: Scope): Counter[] {
  return [
    ...tiles(d, scope),
    { key: 'requests', label: 'Requests waiting', value: d.intake_pending?.total ?? 0, tone: 'pending', href: INTAKE },
  ];
}

export interface AttentionRow { code: string; label: string; tone: Tone; count: number; href: string }

/** One row per thing vendors wait on, in the register's order (a code this page does not know comes last, in readable words). */
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

/** The window gauge: how many of the critical and high vendors are inside their reassessment window. */
export function coverageView(c: Dashboard['coverage']): Coverage {
  if (!c || !c.total) return { percent: null, caption: '', outside: 0 };
  return { percent: c.percent ?? Math.round((c.in_window / c.total) * 100), caption: `${c.in_window}/${c.total} critical and high`, outside: Math.max(0, c.total - c.in_window) };
}

export const topResidual = (list: TopVendor[] | undefined, most = 5): TopVendor[] => (list ?? []).slice(0, most);

/** A residual score as the width of its bar: 0 to 100. */
export const barWidth = (score: number | null | undefined): number =>
  typeof score === 'number' && Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;

// ── the posture card ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type Verdict = 'unset' | 'within' | 'approaching' | 'over';

export const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  unset: { label: 'Appetite not set', tone: 'neutral' },
  within: { label: 'Within appetite', tone: 'success' },
  approaching: { label: 'Approaching appetite', tone: 'warning' },
  over: { label: 'Over appetite', tone: 'danger' },
};

/** The board's thirty-second read: over the appetite line, within eight points of it, or inside it; neutral when the tenant set none. */
export function verdictOf(residual: number, appetite: number | null | undefined): Verdict {
  if (typeof appetite !== 'number' || !Number.isFinite(appetite)) return 'unset';
  if (residual > appetite) return 'over';
  return residual >= appetite - 8 ? 'approaching' : 'within';
}

export interface Posture {
  /** whether any vendor has a residual score: without one the portfolio's residual is "not recorded", not a score of 0 */
  scored: boolean;
  verdict: Verdict;
  headline: string;
  /** "3 over the line", "on the line", "5 of headroom"; '' without an appetite */
  gap: string;
  residual: number;
  inherent: number;
  /** the points of risk the controls remove */
  removed: number;
  /** critical vendors with a residual score; null when there is no critical vendor */
  assessed: { percent: number | null; caption: string; tone: Tone };
  window: Coverage;
  reviews: { due: number; overdue: number | null };
}

/** The posture card from the dashboard and the appetite line. */
export function postureView(d: Pick<Dashboard, 'kpis' | 'coverage' | 'reassessment_overdue'> & Partial<Pick<Dashboard, 'top_residual_vendors'>>, appetite: number | null | undefined): Posture {
  const k = d.kpis;
  const residual = k.portfolio_residual ?? 0;
  const inherent = k.portfolio_inherent ?? 0;
  const has = typeof appetite === 'number' && Number.isFinite(appetite);
  const gap = has ? Math.round((residual - (appetite as number)) * 10) / 10 : 0;          // one decimal: 45.8 - 45 is 0.8, not 0.7999999999999972
  const critical = k.critical_count ?? 0;
  return {
    scored: (d.top_residual_vendors ?? []).length > 0,
    verdict: verdictOf(residual, appetite),
    headline: has ? `Portfolio residual ${residual} against an appetite of ${appetite}` : `Portfolio residual ${residual}`,
    gap: !has ? '' : gap > 0 ? `${gap} over the line` : gap === 0 ? 'On the line' : `${Math.abs(gap)} of headroom`,
    residual, inherent, removed: Math.max(0, Math.round(inherent - residual)),
    assessed: critical > 0
      ? { percent: k.critical_coverage, caption: `${k.critical_covered}/${critical} critical vendors have a residual score`, tone: k.critical_coverage >= 90 ? 'success' : 'warning' }
      : { percent: null, caption: 'No critical vendors', tone: 'neutral' },
    window: coverageView(d.coverage),
    reviews: { due: k.reviews_due_30d ?? 0, overdue: typeof d.reassessment_overdue === 'number' ? d.reassessment_overdue : null },
  };
}

// ── the breakdowns ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DomainRow { key: string; label: string; value: number; href: string }

/** Where the open findings gather: the domains with the most first, each leading to the findings of that domain. */
export function domainRows(byDomain: Record<string, number> | undefined, most = 8): DomainRow[] {
  return Object.entries(byDomain ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, most)
    .map(([key, value]) => ({ key, value, label: DOMAIN_LABELS[key] ?? titleCase(key), href: `${FINDINGS}?domain=${encodeURIComponent(key)}` }));
}

export interface SignalRow { id: number; vendorId: number; title: string; meta: string; tone: Tone; severity: string; fresh: boolean }

/** The latest outside-in signals as rows: what, for which vendor, when. */
export function signalRows(feed: Signal[] | undefined, most = 6): SignalRow[] {
  return (feed ?? []).slice(0, most).map((s) => ({
    id: s.id, vendorId: s.vendor_id, fresh: !s.acknowledged, severity: vendorTier.label(s.severity), tone: vendorTier.tone(s.severity),
    title: s.title || titleCase(s.signal_type),
    meta: [s.vendor_name || 'A vendor', titleCase(s.signal_type), fmt.date(s.occurred_at)].join(' · '),
  }));
}

export interface TierGap { tier: string; label: string; inherent: number; residual: number }

/** Inherent against residual by tier, the tiers in the ramp's order. */
export function tierGaps(rows: Dashboard['inherent_vs_residual'] | undefined): TierGap[] {
  const order = ['critical', 'high', 'medium', 'low'];
  return (rows ?? []).slice().sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier)).map((r) => ({ tier: r.tier, label: tierLabel(r.tier), inherent: r.inherent, residual: r.residual }));
}
