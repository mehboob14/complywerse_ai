// AI usage's rules as pure functions apart from React, so `node --test` can pin them (usageModel.test.ts). The figures themselves come from the server and are never
// recomputed here (share, budget use, the alert at 85 percent, the month-end projection: ai_usage_report.build_overview); this file only says them: tokens as 1.2M, money
// as $4.50, a trend with a direction, the cut-offs at which a budget is "nearing" (70) or "near the limit" (85: the same as the server's alert), the days a period stands
// for, the search over modules and features, and the stacked bars' totals.
//
// The three views are the old Token usage, Usage Monitoring and per-person pages in one: `tokens` (the tenant's own ledger), `people` (the same ledger per person) and
// `activity` (the external tracing view, only where the server has it switched on; it never names the service).
import { oneOf, text } from '../../../../lib/addressState.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';

export const VIEWS = ['tokens', 'people', 'activity'] as const;
export type View = (typeof VIEWS)[number];
export const VIEW_LABELS: Record<View, string> = { tokens: 'Tokens', people: 'By person', activity: 'Activity' };

export const RANGES = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'cycle', label: 'Billing cycle' },
] as const;
export type RangeKey = (typeof RANGES)[number]['value'];
export const RANGE_KEYS: readonly RangeKey[] = RANGES.map((r) => r.value);

/** ?view=&range=&person=&run= — a link to a person's usage is /admin/ai-usage?view=people&person=12. */
export const USAGE_SCHEMA = {
  view: oneOf(VIEWS, 'tokens' as View),
  range: oneOf(RANGE_KEYS, '24h' as RangeKey),
  person: text(),
};

// ── saying numbers ───────────────────────────────────────────────────────────

/** 1,234 -> "1.2K", 1,200,000 -> "1.2M", 3.4e9 -> "3.4B"; under a thousand as it is. */
export function fmtTokens(n: number | null | undefined): string {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const short = (x: number, unit: string) => `${x.toFixed(1).replace(/\.0$/, '')}${unit}`;
  if (a >= 1e9) return short(v / 1e9, 'B');
  if (a >= 1e6) return short(v / 1e6, 'M');
  if (a >= 1e3) return short(v / 1e3, 'K');
  return String(Math.round(v));
}

/** "$4.50"; under a cent "$0.0042" so a small cost is not "$0.00". */
export function money(n: number | null | undefined, { fine = false }: { fine?: boolean } = {}): string {
  const v = Number(n) || 0;
  if (fine && v > 0 && v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The change against the period before: more use is the thing to watch, so up is "more" and down "less"; nothing is "no change". */
export function trendOf(pct: number | null | undefined): { direction: 'more' | 'less' | 'same'; text: string } {
  const v = Number(pct) || 0;
  if (!v) return { direction: 'same', text: 'No change' };
  return { direction: v > 0 ? 'more' : 'less', text: `${Math.abs(v).toFixed(1)}% ${v > 0 ? 'more' : 'less'}` };
}

/** A module's use of its monthly budget: 85 percent and over is the server's alert, 70 and over is worth a look. Registry: budgetUse in lib/statuses/adminAuditAi.ts. */
export function budgetBand(pct: number | null | undefined): 'ok' | 'watch' | 'over' {
  const v = Number(pct) || 0;
  return v >= 85 ? 'over' : v >= 70 ? 'watch' : 'ok';
}

/** The quota bar turns red above 85 percent (the page always did: strictly above). */
export const quotaTone = (cyclePct: number | null | undefined): 'primary' | 'danger' => ((Number(cyclePct) || 0) > 85 ? 'danger' : 'primary');

// ── the periods ──────────────────────────────────────────────────────────────

export const rangeLabel = (key: string): string => RANGES.find((r) => r.value === key)?.label ?? RANGES[0].label;

/** Where the export starts for a range: the last 24 hours, N days back, or the 1st of this month for the billing cycle (the export has no cycle day; the dashboard does). */
export function rangeStart(key: string, now: Date): Date {
  const d = new Date(now.getTime());
  if (key === 'cycle') { d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
  if (key === '24h') { d.setHours(d.getHours() - 24); return d; }
  const days = Number(String(key).replace('d', ''));
  d.setDate(d.getDate() - (Number.isFinite(days) && days > 0 ? days : 30));
  return d;
}

/** The activity view's periods in whole days, ending now. */
export const ACTIVITY_DAYS = [7, 30, 90] as const;
export function periodRange(days: number, now: Date): { start: string; end: string } {
  const start = new Date(now.getTime());
  start.setDate(start.getDate() - days);
  return { start: start.toISOString(), end: now.toISOString() };
}

/** A person's usage periods, as the old page offered them. */
export const PERSON_DAYS = [7, 30, 90] as const;

/** A chart's axis word: the clock hour for the hourly view ("14:00"), the day otherwise ("12 Nov"). Fixed words, not the browser's locale. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function axisLabel(iso: string, granularity: string | undefined): string {
  const at = parseUtc(iso);
  if (!at) return '';
  return granularity === 'hour' ? `${String(at.getHours()).padStart(2, '0')}:00` : `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

// ── the usage by module table and the chart ──────────────────────────────────

interface Feature { feature_key: string; label: string }
interface ModuleRow<F extends Feature = Feature> { module_key: string; label: string; features: F[] }

/** The modules that match a search: a module whose name matches keeps all its features, else only the features that match; no search keeps everything. */
export function searchModules<M extends ModuleRow<Feature>>(modules: readonly M[], query: string): M[] {
  const q = query.trim().toLowerCase();
  if (!q) return modules.slice();
  const out: M[] = [];
  modules.forEach((m) => {
    if (m.label.toLowerCase().includes(q) || m.module_key.toLowerCase().includes(q)) { out.push(m); return; }
    const features = m.features.filter((f) => f.label.toLowerCase().includes(q) || f.feature_key.toLowerCase().includes(q));
    if (features.length) out.push({ ...m, features });
  });
  return out;
}

export interface SeriesPoint { date: string; values: Record<string, number> }

/** The stacked bars: per point the tokens of the modules not switched off, and the tallest bar (never 0, so no division by zero). */
export function stackTotals(series: readonly SeriesPoint[], visibleKeys: readonly string[]): { totals: number[]; max: number } {
  const totals = series.map((pt) => visibleKeys.reduce((sum, key) => sum + (Number(pt.values[key]) || 0), 0));
  return { totals, max: Math.max(1, ...totals) };
}

/** The tokens of each module not switched off, summed: what the chart's text alternative reads out. */
export function chartRows(series: readonly SeriesPoint[], visibleKeys: readonly string[], granularity: string | undefined): Array<[string, number]> {
  return series.map((pt) => [axisLabel(pt.date, granularity), visibleKeys.reduce((sum, key) => sum + (Number(pt.values[key]) || 0), 0)]);
}

// ── the activity view (external tracing) ─────────────────────────────────────

/** A run's duration: "1.4 s"; nothing recorded is a dash. */
export const seconds = (ms: number | null | undefined): string => (ms == null || !Number.isFinite(ms) ? '—' : `${(ms / 1000).toFixed(1)} s`);

/** What a person may be shown of the activity view: the totals and the list to everyone who may open the view; the text of each run (what was asked and answered) only to
 *  the people who also hold the AI governance payload right, as in AI governance (G12 G-6: the server lets `organization:view` through). */
export function mayReadRunText(permissions: { hasPermission: (key: string) => boolean; isAdmin: boolean }): boolean {
  return permissions.isAdmin || permissions.hasPermission('admin:ai_governance:payloads');
}

/** Run text as readable text: a string as it is, anything else as indented JSON; nothing recorded is null. */
export function runText(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** The words for an activity view that has nothing to read: the server says whether the view is on; its own message can name the service, so it is never shown. */
export const ACTIVITY_OFF = {
  title: 'Detailed activity is not switched on',
  message: 'Token totals by module and by person are on the Tokens and By person views. The call-by-call view appears here once it is set up for this organisation.',
} as const;

// ── the budgets form ─────────────────────────────────────────────────────────

/** What the budgets endpoint returns (GET /admin/ai-usage/budgets) and takes back (PUT): quotas are tokens, the form speaks millions of tokens. */
export interface BudgetSource {
  monthly_quota: number;
  blended_rate_per_million: number;
  billing_cycle_day: number;
  modules: ReadonlyArray<{ module_key: string; monthly_budget: number }>;
}
export interface BudgetUpdate {
  monthly_quota: number;
  blended_rate_per_million: number;
  billing_cycle_day: number;
  modules: Array<{ module_key: string; monthly_budget: number }>;
}
/** The form's fields as the person types them (text, so a half-typed number is never turned into 0 under their fingers). */
export interface BudgetForm { quotaM: string; rate: string; cycleDay: string; modules: Record<string, string> }

const toM = (tokens: number): string => String(Math.round(((Number(tokens) || 0) / 1e6) * 1e6) / 1e6);
const num = (text: string): number => (String(text).trim() === '' ? NaN : Number(text));

export function budgetForm(b: BudgetSource): BudgetForm {
  const modules: Record<string, string> = {};
  b.modules.forEach((m) => { modules[m.module_key] = toM(m.monthly_budget); });
  return { quotaM: toM(b.monthly_quota), rate: String(b.blended_rate_per_million ?? 0), cycleDay: String(b.billing_cycle_day ?? 1), modules };
}

export interface BudgetErrors { quotaM?: string; rate?: string; cycleDay?: string; modules: Record<string, string> }

/** The sentences for a form that cannot be saved. The server would clamp the cycle day to 1-28 without a word, so the page says it. */
export function budgetErrors(f: BudgetForm): BudgetErrors {
  const errors: BudgetErrors = { modules: {} };
  const q = num(f.quotaM);
  if (!(q >= 0)) errors.quotaM = 'Enter the quota in millions of tokens, 0 or more.';
  const r = num(f.rate);
  if (!(r >= 0)) errors.rate = 'Enter a rate of 0 or more.';
  const d = num(f.cycleDay);
  if (!(Number.isInteger(d) && d >= 1 && d <= 28)) errors.cycleDay = 'Enter a day from 1 to 28.';
  Object.keys(f.modules).forEach((key) => { if (!(num(f.modules[key]) >= 0)) errors.modules[key] = 'Enter 0 or more.'; });
  return errors;
}
export const hasBudgetErrors = (e: BudgetErrors): boolean => !!(e.quotaM || e.rate || e.cycleDay || Object.keys(e.modules).length);

/** The body of the save: whole tokens (the form is in millions), the module list in the order the server sent it. */
export function budgetPayload(f: BudgetForm, b: BudgetSource): BudgetUpdate {
  const tokens = (text: string) => Math.max(0, Math.round(num(text) * 1e6));
  return {
    monthly_quota: tokens(f.quotaM),
    blended_rate_per_million: Math.max(0, num(f.rate)),
    billing_cycle_day: Math.min(28, Math.max(1, Math.round(num(f.cycleDay)))),
    modules: b.modules.map((m) => ({ module_key: m.module_key, monthly_budget: tokens(f.modules[m.module_key] ?? '0') })),
  };
}
export const budgetDirty = (a: BudgetForm, b: BudgetForm): boolean => JSON.stringify(a) !== JSON.stringify(b);
