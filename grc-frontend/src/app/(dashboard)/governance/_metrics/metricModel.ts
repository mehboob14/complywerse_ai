// The KPI / KRI report's rules apart from React, so `node --test` can pin them (metricModel.test.ts): the words and order of a status, how a value
// is written, what a sparkline draws and says, when a measurement is due, which metrics a search and a status keep, what the create / edit form
// holds and sends, and what a measurement sends. Everything here is what MetricReport.tsx did inline before it moved to the design-system kit; the
// calculations themselves (the RAG of a value, the live value, the history) are the server's and are not repeated here.
import { EMPTY } from '../../../../lib/format.ts';

export type Rag = 'green' | 'amber' | 'red' | 'unknown';
export type Kind = 'kpi' | 'kri';
export type Source = 'live' | 'manual';

export interface Point { date: string | null; value: number | null }
export interface Metric {
  id: number; name: string; description?: string | null; kind: Kind;
  category?: string | null; formula?: string | null; target?: number | null;
  current_value: number | null; current_status: Rag | null;
  unit?: string | null; green_threshold: number | null; amber_threshold: number | null;
  threshold_direction: string; frequency: string; next_due_date?: string | null;
  metric_key?: string | null; is_live: boolean; module_label?: string | null; history?: Point[];
}
export interface Summary { total: number; green: number; amber: number; red: number; unknown: number; live: number; manual: number; breached: number }
export interface CategoryRow { category: string; total: number; green: number; amber: number; red: number; unknown: number }
export interface MetricOption { key: string; label: string; module_label: string; unit: string; direction: string; definition: string; suggested_target: number | null; suggested_warn: number | null }
export interface Template { key: string; name: string; kind: Kind; category: string; unit: string; threshold_direction: string; target: number; green_threshold: number; amber_threshold: number; frequency: string; formula: string }

export const KIND_META: Record<Kind, { noun: string; plural: string; title: string; blurb: string }> = {
  kri: { noun: 'KRI', plural: 'KRIs', title: 'KRI Report', blurb: 'Key Risk Indicators — early-warning signals of risk exposure, RAG-rated against thresholds and appetite.' },
  kpi: { noun: 'KPI', plural: 'KPIs', title: 'KPI Report', blurb: 'Key Performance Indicators — how the programme is performing against its targets, period over period.' },
};

// ── status ───────────────────────────────────────────────────────────────────
const RAGS: readonly Rag[] = ['green', 'amber', 'red', 'unknown'];
/** The server's `current_status` as one of the four words; a missing or unexpected word is "unknown" (it used to crash the card: RAG[word] was undefined). */
export const ragOf = (status: string | null | undefined): Rag => (RAGS.indexOf(status as Rag) >= 0 ? (status as Rag) : 'unknown');

/** Worst first, so a first click on the Status header puts what needs attention on top. */
export const RAG_RANK: Record<Rag, number> = { red: 0, amber: 1, green: 2, unknown: 3 };

export type StatusFilter = 'all' | Rag;

// ── values ───────────────────────────────────────────────────────────────────
const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** A value as the report writes it: one decimal at most, "%" / "d" for a percentage / days, thousands separators for a plain count (the same text for every
 *  viewer: no toLocaleString), "—" when there is none. -0 is 0 and a value too big to round stays as it is. */
export function formatMetricValue(v: number | null | undefined, unit?: string | null): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  const rounded = Math.round(v * 10) / 10;
  const r = Number.isFinite(rounded) ? rounded || 0 : v;
  if (unit === 'pct' || unit === '%') return `${r}%`;
  if (unit === 'days') return `${r}d`;
  if (unit === 'score') return `${r}`;
  return GROUPED.format(Number.isInteger(v) ? v : r);
}

// ── the trend ────────────────────────────────────────────────────────────────
const usable = (points?: Point[] | null): { date: string | null; value: number }[] =>
  (points || []).filter((p): p is { date: string | null; value: number } => p.value != null && Number.isFinite(p.value));

export interface Spark { line: string; area: string; last: { x: number; y: number } }

/** What the sparkline draws: the line through the measurements (one per step along, scaled to their range with 15% room), the area under it and the last
 *  point. null with fewer than two measurements (nothing to draw). The same numbers the report always drew. */
export function sparkGeometry(points?: Point[] | null, W = 120, H = 36): Spark | null {
  const pts = usable(points);
  if (pts.length < 2) return null;
  const ys = pts.map((p) => p.value);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.15;
  lo -= pad;
  hi += pad;
  const x = (i: number) => (W * i) / (pts.length - 1);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return { line, area: `${line} L${W},${H} L0,${H} Z`, last: { x: x(pts.length - 1), y: y(pts[pts.length - 1].value) } };
}

/** The sparkline in words, for a screen reader and the tooltip: how many measurements, where it began and ended and which way it went. Moves smaller than
 *  what is written (one decimal) read as steady. */
export function describeTrend(points?: Point[] | null, unit?: string | null): string {
  const pts = usable(points);
  if (pts.length < 2) return 'Not enough measurements for a trend yet';
  const first = pts[0].value;
  const last = pts[pts.length - 1].value;
  const [a, b] = [Math.round(first * 10), Math.round(last * 10)];
  const move = b > a ? 'rising' : b < a ? 'falling' : 'steady';
  return `Trend over ${pts.length} measurements: ${move}, from ${formatMetricValue(first, unit)} to ${formatMetricValue(last, unit)}`;
}

// ── due ──────────────────────────────────────────────────────────────────────
/** A manual metric is due from the start of the day its next measurement is due on: `next_due_date` is a day that arrives as a DateTime ("2026-10-31T00:00:00",
 *  naive), so the day is the date as written and it is compared with the viewer's own today. (The report used to read the text as a local moment, which is the
 *  same thing from midnight on, and shifted it by the server's own clock when that was not UTC.) A live-fed metric is never due: nobody measures it. */
export function isDue(nextDue: string | null | undefined, live: boolean, now: Date = new Date()): boolean {
  if (!nextDue || live) return false;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(nextDue.trim());
  if (!ymd) return false;
  return Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) <= Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

// ── search, status filter, sort ──────────────────────────────────────────────
/** The words of a metric a search looks in: its name, category, where its value comes from ("Manual", or "Live" and the module) and its definition. */
const haystack = (m: Metric): string =>
  [m.name, m.category, m.is_live ? `live ${m.module_label ?? ''}` : 'manual', m.formula].filter(Boolean).join('\n').toLowerCase();

export function filterMetrics(metrics: readonly Metric[], { q, status }: { q: string; status: StatusFilter }): Metric[] {
  const needle = q.trim().toLowerCase();
  return metrics.filter((m) => (status === 'all' || ragOf(m.current_status) === status) && (!needle || haystack(m).indexOf(needle) >= 0));
}

export type MetricSortKey = 'name' | 'status' | 'value' | 'target' | 'category' | 'due';

/** What a sortable column holds for tableModel.sortRows: numbers by value, text in natural order, an empty value last. */
export function sortValue(m: Metric, key: string): string | number | null {
  switch (key as MetricSortKey) {
    case 'name': return m.name;
    case 'status': return RAG_RANK[ragOf(m.current_status)];
    case 'value': return m.current_value;
    case 'target': return m.target ?? null;
    case 'category': return m.category || null;
    case 'due': return m.next_due_date ? m.next_due_date.slice(0, 10) : null;
    default: return null;
  }
}

/** Creation order, so the list does not reshuffle when a row is edited (the server sends no order and Postgres moves an updated row to the end). */
export const byCreation = (metrics: readonly Metric[]): Metric[] => metrics.slice().sort((a, b) => a.id - b.id);

// ── the create / edit form ───────────────────────────────────────────────────
export interface MetricFormState {
  name: string; description: string; category: string; formula: string; metric_key: string; unit: string;
  target: string; green_threshold: string; amber_threshold: string; threshold_direction: string; frequency: string; next_due_date: string;
}

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'annual'] as const;
/** The longest each text field may be: the columns of grc_risk_kris (a longer text used to fail on the server with no message). */
export const LIMITS = { name: 255, category: 100, unit: 50, period: 40 } as const;

export const defaultDirection = (kind: Kind): string => (kind === 'kpi' ? 'higher_is_better' : 'lower_is_better');
const numText = (v: number | null | undefined): string => (v == null ? '' : String(v));
const num = (v: string): number | null => (v === '' ? null : Number(v));

export const blankForm = (kind: Kind): MetricFormState => ({
  name: '', description: '', category: '', formula: '', metric_key: '', unit: '', target: '', green_threshold: '', amber_threshold: '',
  threshold_direction: defaultDirection(kind), frequency: 'monthly', next_due_date: '',
});

export const sourceOf = (m: Metric | null | undefined): Source => (m && m.metric_key ? 'live' : 'manual');

export const formFromMetric = (m: Metric, kind: Kind): MetricFormState => ({
  name: m.name, description: m.description || '', category: m.category || '', formula: m.formula || '', metric_key: m.metric_key || '', unit: m.unit || '',
  target: numText(m.target), green_threshold: numText(m.green_threshold), amber_threshold: numText(m.amber_threshold),
  threshold_direction: m.threshold_direction || defaultDirection(kind), frequency: m.frequency || 'monthly',
  next_due_date: m.next_due_date ? m.next_due_date.slice(0, 10) : '',
});

/** Typed input the drawer would throw away: any field, or the value source, differs from what the form opened with. */
export function formDirty(opened: { form: MetricFormState; source: Source }, now: { form: MetricFormState; source: Source }): boolean {
  if (opened.source !== now.source) return true;
  return (Object.keys(opened.form) as (keyof MetricFormState)[]).some((k) => opened.form[k] !== now.form[k]);
}

/** "Start from a template": the template's definition fills the form (its value source becomes manual, the caller sets it). */
export const applyTemplate = (f: MetricFormState, t: Template): MetricFormState => ({
  ...f, name: t.name, category: t.category, formula: t.formula, unit: t.unit, target: numText(t.target),
  green_threshold: numText(t.green_threshold), amber_threshold: numText(t.amber_threshold),
  threshold_direction: t.threshold_direction, frequency: t.frequency, metric_key: '',
});

/** Picking a platform metric to feed the value: its unit, direction and suggested target / warning fill the form (the suggested target is also the green threshold). */
export const pickMetric = (f: MetricFormState, key: string, option: MetricOption | undefined): MetricFormState => ({
  ...f, metric_key: key, unit: option?.unit || f.unit,
  threshold_direction: option ? (option.direction === 'up_good' ? 'higher_is_better' : 'lower_is_better') : f.threshold_direction,
  target: option?.suggested_target != null ? String(option.suggested_target) : f.target,
  green_threshold: option?.suggested_target != null ? String(option.suggested_target) : f.green_threshold,
  amber_threshold: option?.suggested_warn != null ? String(option.suggested_warn) : f.amber_threshold,
});

/** What POST / PUT /erm/kris takes, exactly as the report has always sent it (a day goes as UTC midnight; a manual metric has no metric key). */
export function toPayload(form: MetricFormState, source: Source, kind: Kind) {
  return {
    name: form.name.trim(), description: form.description || null, kind,
    category: form.category || null, formula: form.formula || null, target: num(form.target),
    metric_key: source === 'live' ? (form.metric_key || null) : null, unit: form.unit || null,
    green_threshold: num(form.green_threshold), amber_threshold: num(form.amber_threshold),
    threshold_direction: form.threshold_direction, frequency: form.frequency,
    next_due_date: form.next_due_date ? new Date(form.next_due_date).toISOString() : null,
  };
}

/** The Save button asks for a name; the drawer says so on the field. */
export const nameError = (form: MetricFormState): string | undefined => (form.name.trim() ? undefined : 'Enter a name.');

// ── a measurement ────────────────────────────────────────────────────────────
export interface MeasureInput { value: string; period: string; notes: string }

export const measureDirty = (i: MeasureInput): boolean => i.value !== '' || i.period !== '' || i.notes !== '';
export const valueError = (i: MeasureInput): string | undefined => (i.value !== '' && Number.isFinite(Number(i.value)) ? undefined : 'Enter a number.');

/** What POST /erm/kris/{id}/measure takes. A manual measurement is recorded as APPROVED at once (no review step): that is what the report has always sent
 *  (and what the server does when it is left out), and it is a workflow question for the product owner, not a visual one. */
export const measurePayload = (i: MeasureInput) => ({
  value: Number(i.value), period_label: i.period || undefined, notes: i.notes || undefined, review_status: 'approved',
});
