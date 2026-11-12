// What the graphical part of the Third-Party Vendor Risk Overview draws, as decisions apart from React so `node --test` pins them (chartsModel.test.ts): the six figures of the hero row with
// their history (the last one, Needs attention, is ONE number and a thin bar of how urgent), and the data of every chart card (tier and risk band, the review calendar, the review stages,
// findings by status and by age, the contract timeline, concentration, signals by month). Every list is at most five rows (the rest is "See all"), and every part opens the register,
// the findings or the module's page, filtered where that page can filter (Overview v2, R4 and R6). Nothing here is a number the server did not say: a chart's figures are the dashboard's, the overview-charts endpoint's, the 12-month trend's,
// the contracts register's and the concentration read's, arranged; a month with no record is a gap (null), never a 0. Colours are the chart kit's palette (a tier or a band is a state of
// risk: STATUS, always with its word beside it).
import { RAMP, STATUS } from '../../../../components/overview/charts/palette.ts';
import { changeOf, trendText, type DeltaTone, type Direction, type Slice } from '../../../../components/overview/charts/chartModel.ts';
import type { BarRow, StackCategory, StackSeries } from '../../../../components/overview/charts/index.ts';
import { formatCount } from '../../../../lib/format.ts';
import type { Tone } from '../../../../lib/status.ts';
import { attentionRows, postureView, registerHref, FINDINGS, REGISTER, type Dashboard, type Scope } from '../_lib/overviewModel.ts';
import { residualBand, type Bands } from '../_lib/vendorRules.ts';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const num = (n: unknown): number => (finite(n) ? n : 0);

// ── the answers of the requests that are new on this page ────────────────────────────────────────────────────────────────

export interface TrendPointRaw {
  month: string; inherent: number | null; residual: number | null;
  open_findings?: number | null; critical_findings?: number | null; vendor_count?: number | null;
}
export interface TrendAnswer { appetite: number | null; series: TrendPointRaw[] }

type Grid = Record<string, Record<string, number>>;
export interface OverviewCharts {
  scope: string;
  as_of: string;
  thresholds: Bands;
  risk_matrix: { tiers: string[]; bands: string[]; cells: Grid };
  reviews: { buckets: string[]; tiers: string[]; cells: Grid; apart: number };
  stages: { items: Array<{ key: string; label: string; count: number }>; not_started: number };
  findings: { severities: string[]; statuses: string[]; matrix: Grid; ages: string[]; age: Grid; overdue: Record<string, number> };
  signals: { months: Array<{ month: string } & Record<string, number | string>>; waiting: Record<string, number> };
}

/** A row of GET vendor-risk/contracts (the fields the timeline reads). */
export interface ContractLike {
  id: number; status: string; state: string; ends_on: string | null;
  vendor: { id: number; name: string; tier: string | null; owner_id: number | null };
}
export interface ContractsAnswer { items: ContractLike[]; counts?: Record<string, number> }
export interface PlatformLike { platform: string; vendor_count: number; critical_count: number }

// ── tiers, bands, tones ──────────────────────────────────────────────────────────────────────────────────────────────────

export const TIER_ROWS = ['critical', 'high', 'medium', 'low', 'not_tiered'] as const;
export type TierRow = (typeof TIER_ROWS)[number];
export const BAND_COLS = ['critical', 'high', 'medium', 'low', 'none'] as const;
export const TIER_LABEL: Record<TierRow, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', not_tiered: 'Not tiered' };
export const BAND_LABEL: Record<(typeof BAND_COLS)[number], string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', none: 'Not scored' };
/** a tier, a severity and a residual band are one ramp: red, amber, blue, green; the untiered and the unscored are the quiet grey */
export const TIER_COLOR: Record<TierRow, string> = { critical: STATUS.bad, high: STATUS.warn, medium: STATUS.progress, low: STATUS.good, not_tiered: STATUS.neutral };
export const BAND_COLOR: Record<(typeof BAND_COLS)[number], string> = { critical: STATUS.bad, high: STATUS.warn, medium: STATUS.progress, low: STATUS.good, none: STATUS.neutral };
const TONE_COLOR: Record<Tone, string> = { success: STATUS.good, danger: STATUS.bad, warning: STATUS.warn, progress: STATUS.progress, pending: STATUS.pending, neutral: STATUS.neutral };
export const toneColor = (tone: Tone): string => TONE_COLOR[tone] ?? STATUS.neutral;

export const tierKey = (tier: string | null | undefined): TierRow => {
  const t = String(tier ?? '').trim().toLowerCase();
  return (TIER_ROWS as readonly string[]).includes(t) && t !== 'not_tiered' ? (t as TierRow) : 'not_tiered';
};

export const CONTRACTS = '/vendor-risk/contracts';
export const MONITORING = '/vendor-risk/monitoring';
export const DEPENDENCIES = '/vendor-risk/dependencies';
export const QUEUE = '/vendor-risk/attention';
/** The most rows any list of the Overview shows before "See all". */
export const MOST = 5;

const tierHref = (tier: TierRow, scope: Scope): string => (tier === 'not_tiered' ? registerHref({ attention: 'not_tiered' }, scope) : registerHref({ tier }, scope));

// ── the 12 months ────────────────────────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export interface MonthSlot { key: string; label: string }

/** The `n` calendar months ending with the one of `now` (UTC), oldest first. The label carries the year where it changes: "Dec 25", "Jan 26", "Feb". */
export function windowMonths(now: Date, n = 12): MonthSlot[] {
  const out: MonthSlot[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const m = at.getUTCMonth();
    out.push({ key: `${at.getUTCFullYear()}-${String(m + 1).padStart(2, '0')}`, label: i === n - 1 || m === 0 ? `${MONTHS[m]} ${String(at.getUTCFullYear()).slice(2)}` : MONTHS[m] });
  }
  return out;
}

export interface TrendPoint {
  key: string; label: string;
  residual: number | null; inherent: number | null;
  /** the points of risk the controls remove (inherent less residual, whole points, as the posture says it) */
  removed: number | null;
  open: number | null; critical: number | null;
}

/** The trend as one point per month of the window: a month with no snapshot is null in every field (a gap in the line), never 0. */
export function trendPoints(series: readonly TrendPointRaw[] | undefined, now: Date, n = 12): TrendPoint[] {
  const byMonth = new Map((series ?? []).map((s) => [String(s.month).slice(0, 7), s]));
  return windowMonths(now, n).map(({ key, label }) => {
    const s = byMonth.get(key);
    const inherent = s && finite(s.inherent) ? s.inherent : null;
    const residual = s && finite(s.residual) ? s.residual : null;
    return {
      key, label, inherent, residual,
      removed: inherent !== null && residual !== null ? Math.max(0, Math.round(inherent - residual)) : null,
      open: s && finite(s.open_findings) ? s.open_findings : null,
      critical: s && finite(s.critical_findings) ? s.critical_findings : null,
    };
  });
}

/** The sparkline and the change of one figure, from its recorded months: nothing under two recorded months. The change is in the figure's own precision (`decimals`: 1 for a score, 0 for a count), says which month it is against, and
 *  is "No change" only when the figure did not move at that precision. */
export function kpiTrend(
  points: readonly TrendPoint[], pick: (p: TrendPoint) => number | null, name: string, goodWhen?: 'up' | 'down', unit: string | readonly [string, string] = '', decimals = 0,
) {
  const step = 10 ** decimals;
  const values = points.map((p) => { const v = pick(p); return finite(v) ? Math.round(v * step) / step : null; });
  const seen = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (seen.length < 2) return { spark: null, delta: null };
  const change = changeOf(values);
  let delta: { text: string; direction: Direction; tone: DeltaTone; since: string } | null = null;
  if (change) {
    const diff = Math.round(change.change * step) / step;
    const direction: Direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const size = Math.abs(diff);
    const word = typeof unit === 'string' ? unit : size === 1 ? unit[0] : unit[1];
    delta = {
      text: direction === 'flat' ? 'No change' : `${direction === 'up' ? 'Up' : 'Down'} ${Number.isInteger(size) ? formatCount(size) : String(size)}${word}`,
      direction, tone: direction === 'flat' || !goodWhen ? 'neutral' : direction === goodWhen ? 'good' : 'bad', since: `since ${points[seen[seen.length - 2]].label}`,
    };
  }
  return { spark: { values, label: `${name}, last 12 months`, summary: trendText(name, points.map((p, i) => ({ label: p.label, value: values[i] }))) }, delta };
}

// ── the hero row ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TileTone = 'default' | 'success' | 'warning' | 'danger';
export interface TileSpec {
  key: string;
  label: string;
  /** null: not recorded */
  value: string | null;
  unit?: string;
  note?: string;
  tone: TileTone;
  /** every tile opens the page it counts */
  href: string;
  linkLabel: string;
  progress?: number | null;
  /** a thin bar of how the figure splits (the Needs attention tile) */
  bar?: Slice[];
  spark: ReturnType<typeof kpiTrend>['spark'];
  delta: ReturnType<typeof kpiTrend>['delta'];
}

const VERDICT_TONE = { unset: 'default', within: 'success', approaching: 'warning', over: 'danger' } as const;

/** The three kinds of next step, as the register colours them: already late, something missing, someone working on it. */
const URGENCY = [
  { key: 'late', label: 'Urgent', color: STATUS.bad, tones: ['danger'] },
  { key: 'missing', label: 'To fix', color: STATUS.warn, tones: ['warning'] },
  { key: 'moving', label: 'In hand', color: STATUS.progress, tones: ['progress', 'pending', 'neutral', 'success'] },
] as const;

/** The vendors that wait on a next step, as ONE figure and a thin bar of how urgent they are (the register's own tones). The Work queue is the list it opens. */
export function attentionFacts(counts: Record<string, number> | undefined, scope: Scope): { total: number; urgent: number; parts: Slice[]; href: string } {
  const rows = attentionRows(counts, scope);
  const parts = URGENCY.map((u) => ({ key: u.key, label: u.label, color: u.color, value: rows.filter((r) => (u.tones as readonly string[]).includes(r.tone)).reduce((n, r) => n + r.count, 0), href: scope === 'mine' ? `${QUEUE}?scope=mine` : QUEUE }));
  return { total: parts.reduce((n, p) => n + p.value, 0), urgent: parts[0].value, parts, href: scope === 'mine' ? `${QUEUE}?scope=mine` : QUEUE };
}

/** The six figures the page leads with, from the dashboard and (for their history) the 12-month trend. The history is the whole portfolio's, so in My vendors the tiles have none. */
export function heroTiles(d: Dashboard, trend: TrendAnswer | undefined, scope: Scope, now: Date = new Date(), trendLoading = false): TileSpec[] {
  const p = postureView(d, trend?.appetite ?? null);
  const points = scope === 'portfolio' && trend ? trendPoints(trend.series, now) : [];
  const none = { spark: null, delta: null } as const;
  const history = (pick: (x: TrendPoint) => number | null, name: string, goodWhen: 'up' | 'down', unit: string | readonly [string, string] = '', decimals = 0) => (points.length ? kpiTrend(points, pick, name, goodWhen, unit, decimals) : none);
  const open = num(d.findings_posture?.open) + num(d.findings_posture?.in_remediation);
  const critical = num(d.kpis.open_critical_findings);
  const added = num(d.kpis.onboarded_this_period);
  const wait = attentionFacts(d.attention_counts, scope);
  const outside = p.window.outside;
  return [
    {
      key: 'vendors', label: 'Vendors in use', value: formatCount(d.kpis.active_vendors), tone: 'default', href: registerHref({}, scope), linkLabel: `Open the vendor register, ${formatCount(d.kpis.active_vendors)} vendors in use`,
      note: added > 0 ? `${formatCount(added)} added in 30 days` : undefined, ...none,
    },
    {
      key: 'residual', label: 'Residual risk', value: p.scored ? String(p.residual) : null, unit: p.scored ? '/ 100' : undefined, tone: p.scored ? VERDICT_TONE[p.verdict] : 'default', ...history((x) => x.residual, 'Residual risk', 'down', [' point', ' points'], 1),
      href: registerHref({ sort: 'risk:asc' }, scope), linkLabel: `Open the vendor register, highest risk first${p.scored ? `. Residual risk ${p.residual} out of 100` : ''}`,
      note: !p.scored ? undefined : trendLoading ? undefined : !trend ? 'Appetite unavailable' : p.verdict === 'unset' ? 'No appetite set' : `${p.gap}. Appetite ${trend.appetite}`,
    },
    {
      key: 'findings', label: 'Open findings', value: formatCount(open), tone: critical > 0 ? 'danger' : 'default', href: FINDINGS, linkLabel: `Open the findings register, ${formatCount(open)} open findings`,
      ...history((x) => x.open, 'Open findings', 'down', [' finding', ' findings']),
      note: critical > 0 ? `${formatCount(critical)} critical` : undefined,
    },
    {
      key: 'assessed', label: 'Critical vendors assessed', value: p.assessed.percent === null ? null : `${p.assessed.percent}%`, tone: p.assessed.tone === 'success' ? 'success' : 'warning',
      progress: p.assessed.percent, note: p.assessed.percent === null ? undefined : p.assessed.caption.replace(' critical vendors have a residual score', ''), ...none,
      href: registerHref({ tier: 'critical' }, scope), linkLabel: `Open the critical vendors${p.assessed.percent === null ? '' : `, ${p.assessed.percent} percent assessed`}`,
    },
    {
      key: 'window', label: 'Reviews in window', value: p.window.percent === null ? null : `${p.window.percent}%`, tone: p.window.percent !== null && p.window.percent >= 85 ? 'success' : 'warning',
      progress: p.window.percent, note: p.window.percent === null ? undefined : `${p.window.caption.replace(' critical and high', '')}${outside > 0 ? `, ${outside} outside` : ''}`, ...none,
      href: outside > 0 ? registerHref({ attention: 'reassessment_overdue' }, scope) : registerHref({ sort: 'next_reassessment:asc' }, scope),
      linkLabel: outside > 0 ? `Open the ${outside} vendors outside their review window` : 'Open the vendor register, next review first',
    },
    {
      key: 'attention', label: 'Needs attention', value: formatCount(wait.total), unit: wait.total === 1 ? 'vendor' : 'vendors', tone: wait.urgent > 0 ? 'danger' : 'default', href: wait.href,
      linkLabel: `Open the Work queue, ${formatCount(wait.total)} vendors need attention${wait.urgent > 0 ? `, ${formatCount(wait.urgent)} urgent` : ''}`,
      note: wait.urgent > 0 ? `${formatCount(wait.urgent)} urgent` : undefined, bar: wait.total > 0 ? wait.parts : undefined, ...none,
    },
  ];
}

// ── the trend card ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TrendCardData { rows: Array<{ label: string; residual: number | null; inherent: number | null }>; recorded: number }

/** The 12-month line: residual and inherent against the appetite; `recorded` is how many months have a score (0: the card says it builds up). */
export function trendCard(trend: TrendAnswer | undefined, now: Date = new Date()): TrendCardData {
  const points = trendPoints(trend?.series, now);
  return { rows: points.map((p) => ({ label: p.label, residual: p.residual, inherent: p.inherent })), recorded: points.filter((p) => p.residual !== null || p.inherent !== null).length };
}

// ── distributions ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Vendors by tier, the untiered apart; each opens the register on that tier. Colours are the tier ramp. */
export function tierDonut(counts: Record<string, number> | undefined, scope: Scope): Slice[] {
  return TIER_ROWS.map((t) => ({ key: t, label: TIER_LABEL[t], value: num(counts?.[t]), color: TIER_COLOR[t], href: tierHref(t, scope) })).filter((s) => s.value > 0);
}

export interface HeatData { rows: string[]; cols: string[]; cells: number[][]; rowKeys: TierRow[]; total: number }

/** Tier by residual band. Every row and column is there, zeros included; the rows add up to the tier counts of the dashboard. */
export function heatData(m: OverviewCharts['risk_matrix'] | undefined): HeatData {
  const cells = TIER_ROWS.map((t) => BAND_COLS.map((b) => num(m?.cells?.[t]?.[b])));
  return { rows: TIER_ROWS.map((t) => TIER_LABEL[t]), cols: BAND_COLS.map((b) => BAND_LABEL[b]), cells, rowKeys: [...TIER_ROWS], total: cells.flat().reduce((a, b) => a + b, 0) };
}

/** Where a cell with something in it opens: the register on its tier (the band is not a register filter). */
export const heatHref = (rowKey: TierRow, scope: Scope): string => tierHref(rowKey, scope);

/** The highest residual scores as bars on the tenant's bands, each a link to the vendor; the word of the band is beside the figure (a colour is never alone). */
export function topResidualBars(list: Dashboard['top_residual_vendors'] | undefined, bands: Bands, most = MOST): BarRow[] {
  return (list ?? []).filter((v) => finite(v.residual)).slice(0, most).map((v) => {
    const band = residualBand(v.residual, bands);
    return { key: String(v.id), label: v.name, value: v.residual as number, valueText: `${v.residual} ${BAND_LABEL[band]}`, color: BAND_COLOR[band], href: `${REGISTER}/${v.id}` };
  });
}

/** `most` rows and how many more there are: a list on the Overview never runs past five, the rest is "See all". */
export function topFive<T extends { value: number }>(rows: readonly T[], most = MOST): { rows: T[]; total: number } {
  return { rows: [...rows].sort((a, b) => b.value - a.value).slice(0, most), total: rows.length };
}

/** The one thing each vendor waits on, the five most common as bars in the colour of their urgency; each opens the register on those vendors. */
export function nextStepBars(counts: Record<string, number> | undefined, scope: Scope): { rows: BarRow[]; total: number } {
  const all = attentionRows(counts, scope).map((r) => ({ key: r.code, label: r.label, value: r.count, color: toneColor(r.tone), href: r.href }));
  return topFive(all);
}

// ── the review calendar and the stages ───────────────────────────────────────────────────────────────────────────────────

/** Short, so six columns fit a third of the page: In 30 d is within 30 days, In 60 d is 31 to 60, In 90 d is 61 to 90 (the card's (i) says so). */
export const BUCKET_LABEL: Record<string, string> = { overdue: 'Overdue', d30: 'In 30 d', d60: 'In 60 d', d90: 'In 90 d', later: 'Later', none: 'No date' };
export const BUCKET_ORDER = ['overdue', 'd30', 'd60', 'd90', 'later', 'none'] as const;
export const TIER_SERIES: StackSeries[] = TIER_ROWS.map((t) => ({ key: t, label: TIER_LABEL[t], color: TIER_COLOR[t] }));

const total = (cats: readonly StackCategory[]): number => cats.reduce((a, c) => a + Object.values(c.cells).reduce<number>((x, v) => x + num(v), 0), 0);
export const stackTotal = total;

/** When the next review falls, by tier. Overdue opens the register on those vendors (the tile's own filter); the other columns open it with the next review first. */
export function reviewCategories(reviews: OverviewCharts['reviews'] | undefined, scope: Scope): StackCategory[] {
  return BUCKET_ORDER.map((b) => ({
    key: b, label: BUCKET_LABEL[b], cells: Object.fromEntries(TIER_ROWS.map((t) => [t, num(reviews?.cells?.[b]?.[t])])),
    href: b === 'overdue' ? registerHref({ attention: 'reassessment_overdue' }, scope) : registerHref({ sort: 'next_reassessment:asc' }, scope),
  }));
}

/** The stage names the way a bar can hold them (the server's are whole phrases); a stage this page does not know keeps the server's name. */
export const STAGE_SHORT: Record<string, string> = {
  intake: 'Intake', tiering: 'Tiering', dd_planning: 'Planning', questionnaire: 'Questionnaire', scoring: 'Scoring', findings: 'Findings',
  contracting: 'Contracting', approval: 'Approval', onboarding: 'Onboarding', monitoring: 'Monitoring', reassessment: 'Reassessment',
};

/** Where each vendor is in its review: the five stages with most vendors (the vendors with no review started count as one), each opening the register on that stage. */
export function stageBars(stages: OverviewCharts['stages'] | undefined, scope: Scope): { rows: BarRow[]; total: number } {
  if (!stages) return { rows: [], total: 0 };
  const all = [
    ...stages.items.map((s) => ({ key: s.key, label: STAGE_SHORT[s.key] ?? s.label, value: num(s.count), href: registerHref({ stage: s.key }, scope) })),
    { key: 'not_started', label: 'Not started', value: num(stages.not_started), color: STATUS.neutral, href: registerHref({ stage: 'not_started' }, scope) },
  ];
  return topFive(all.filter((r) => r.value > 0));
}

// ── findings ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const STATUS_SERIES: StackSeries[] = [
  { key: 'open', label: 'Open', color: STATUS.bad }, { key: 'in_remediation', label: 'In remediation', color: STATUS.warn },
  { key: 'accepted', label: 'Accepted', color: STATUS.neutral }, { key: 'closed', label: 'Closed', color: STATUS.good },
];
export const AGE_SERIES: StackSeries[] = [
  { key: 'd30', label: '0 to 30 days', color: RAMP[1] }, { key: 'd60', label: '31 to 60 days', color: RAMP[2] },
  { key: 'd90', label: '61 to 90 days', color: RAMP[3] }, { key: 'older', label: 'Over 90 days', color: RAMP[4] },
];
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

/** Findings by severity, split by status (`status`: the bar counts closed ones too, so it opens all of them) or, for the open ones, by age (`age`). A severity opens the findings of that severity. */
export function findingCategories(f: OverviewCharts['findings'] | undefined, view: 'status' | 'age'): StackCategory[] {
  const grid = view === 'status' ? f?.matrix : f?.age;
  const keys = (view === 'status' ? STATUS_SERIES : AGE_SERIES).map((s) => s.key);
  return SEVERITIES.map((s) => ({ key: s, label: TIER_LABEL[s], cells: Object.fromEntries(keys.map((k) => [k, num(grid?.[s]?.[k])])), href: `${FINDINGS}?severity=${s}${view === 'status' ? '&scope=all' : ''}` }));
}

// ── signals, contracts, concentration ────────────────────────────────────────────────────────────────────────────────────

export const SEVERITY_SERIES: StackSeries[] = SEVERITIES.map((s) => ({ key: s, label: TIER_LABEL[s], color: TIER_COLOR[s] }));

/** Monitoring signals by month, split by severity; the months are the server's (the last six), a month with none is 0 because the server counted it. */
export function signalCategories(signals: OverviewCharts['signals'] | undefined): StackCategory[] {
  return (signals?.months ?? []).map((m) => {
    const [y, mm] = String(m.month).split('-').map(Number);
    return { key: String(m.month), label: Number.isFinite(mm) ? MONTHS[mm - 1] + (mm === 1 ? ` ${String(y).slice(2)}` : '') : String(m.month), cells: Object.fromEntries(SEVERITIES.map((s) => [s, num(m[s])])), href: MONITORING };
  });
}

export interface ContractFacts { lapsed: number; decide: number; total: number }

/** Active contracts by the month they end (or renew), the next twelve, and the ones already past their end apart as the first column; split by the vendor's tier. In My vendors only the contracts of vendors the person owns. */
export function contractCategories(items: readonly ContractLike[] | undefined, scope: Scope, meId: number | null, now: Date = new Date(), n = 12): { categories: StackCategory[]; facts: ContractFacts } {
  const mine = (c: ContractLike) => scope === 'portfolio' || (meId !== null && c.vendor.owner_id === meId);
  const live = (items ?? []).filter((c) => c.status === 'active' && c.ends_on && mine(c));
  const slots = windowMonths(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n - 1, 1)), n);   // the n months from this one
  const cell = (): Record<string, number> => Object.fromEntries(TIER_ROWS.map((t) => [t, 0]));
  const lapsed: StackCategory = { key: 'lapsed', label: 'Lapsed', cells: cell() };
  const byMonth = new Map(slots.map((s) => [s.key, { key: s.key, label: s.label, cells: cell() } as StackCategory]));
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  let counted = 0;
  for (const c of live) {
    const end = String(c.ends_on).slice(0, 10);
    const t = tierKey(c.vendor.tier);
    if (end < today) { lapsed.cells[t] = num(lapsed.cells[t]) + 1; counted += 1; continue; }
    const m = byMonth.get(end.slice(0, 7));
    if (m) { m.cells[t] = num(m.cells[t]) + 1; counted += 1; }
  }
  return {
    categories: [lapsed, ...Array.from(byMonth.values())].map((c) => ({ ...c, href: `${CONTRACTS}?sort=ends:asc` })),
    facts: { lapsed: live.filter((c) => c.state === 'lapsed').length, decide: live.filter((c) => c.state === 'decide').length, total: counted },
  };
}

/** The platforms several vendors rely on, most shared first (five, and how many there are), each opening what suppliers run on it. One line a row: the critical dependencies are on the Dependencies page. */
export function platformBars(platforms: readonly PlatformLike[] | undefined): { rows: BarRow[]; total: number } {
  const all = (platforms ?? []).map((p) => ({
    key: p.platform, label: p.platform, value: num(p.vendor_count), href: `${DEPENDENCIES}?view=technology&q=${encodeURIComponent(p.platform)}`,
  }));
  return { rows: all.slice(0, MOST), total: all.length };
}
