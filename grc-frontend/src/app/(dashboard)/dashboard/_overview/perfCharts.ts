// What the graphical part of the Performance Overview decides, apart from React so `node --test` pins it (perfCharts.test.ts): the bars of "Score against target" (one per scored
// area, weakest first), the ranked bars of "Needs attention" (one per counter of every area that answered, the biggest first), the two history charts (the Governance score by month,
// the tasks created and completed by month) and the figures of the tiles. Every number is perfModel.ts's or the module's own (lib/perf/moduleFeeds.ts); nothing is computed here that
// a module did not compute except counting areas ("3 of 7 at target") and the change between the last two months. A request that failed or has not answered is a state of its own,
// never a 0 and never an empty chart. Colours are named here as the palette's keys (good / bad / warn ...): the components turn them into hex through palette.ts.
import { changeOf, deltaOf, trendText } from '../../../../components/overview/charts/chartModel.ts';
import type { StatusColor } from '../../../../components/overview/charts/palette.ts';
import { gradeOf, type Grade } from '../../../../lib/perf/moduleFeeds.ts';
import type { Tone } from '../../../../lib/status.ts';
import { gradeStatus } from '../../../../lib/statuses/dashboard.ts';
import { againstTarget, type AreaRow, type WeakArea } from './perfModel.ts';
import type { KpiCounts, PanelState } from './kpiModel.ts';

// ── colours as the palette's keys ────────────────────────────────────────────
const TONE_STATUS: Record<Tone, StatusColor> = { success: 'good', danger: 'bad', warning: 'warn', progress: 'progress', pending: 'pending', neutral: 'neutral' };

/** The colour of a counter: its tone (a state is never a categorical hue). */
export const statusOfTone = (tone: Tone): StatusColor => TONE_STATUS[tone];

/** The colour of a grade: excellent and good are good, fair is a warning, poor is bad; the grade's word is always printed beside it. */
export const statusOfGrade = (grade: Grade | null | undefined): StatusColor => (grade === 'excellent' || grade === 'good' ? 'good' : grade === 'fair' ? 'warn' : grade === 'poor' ? 'bad' : 'neutral');

/** Names for a sentence: all of them up to three, then two and a count ("Governance, Compliance and 13 more"), so a page where everything failed does not print a paragraph of names. */
export function nameList(names: readonly string[]): string {
  if (names.length <= 3) return names.join(names.length === 2 ? ' and ' : ', ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

/** "13 below target", "5 above target", "On target"; "No target recorded" when there is none. */
export function gapText(score: number, target: number | null): string {
  if (target === null) return 'No target recorded';
  const gap = againstTarget(score, target);
  return gap === 'On target' ? gap : `${gap} target`;
}

// ── score against target ─────────────────────────────────────────────────────
export interface ScoreBar {
  key: string;
  label: string;
  href: string;
  score: number;
  target: number | null;
  grade: Grade;
  status: StatusColor;
  gap: string;
}

export type CardState = 'loading' | 'error' | 'empty' | 'ready';

export interface ScoreView {
  state: CardState;
  /** the scored areas that have a score, in the order given (the table's: weakest first) */
  bars: ScoreBar[];
  /** the scored areas that answered and have no score yet: named, never drawn as 0 */
  noScore: Array<{ key: string; label: string; href: string }>;
  /** the scored areas that did not answer (failed, or still loading): named, so the picture says what it leaves out */
  leftOut: string[];
}

/** One bar per scored area that has a score. The areas the person may not open are not asked about (their rows are `denied`) and are not here. */
export function scoreView(rows: readonly AreaRow[]): ScoreView {
  const scored = rows.filter((r) => r.area.kind === 'score' && r.state !== 'denied');
  const answered = scored.filter((r) => r.state === 'ready' && r.read);
  const bars: ScoreBar[] = [];
  const noScore: ScoreView['noScore'] = [];
  answered.forEach((r) => {
    const read = r.read!;
    if (read.score === null) { noScore.push({ key: r.area.key, label: r.area.label, href: r.area.href }); return; }
    const grade = read.grade ?? (gradeOf(read.score) as Grade);
    bars.push({ key: r.area.key, label: r.area.label, href: r.area.href, score: read.score, target: read.target, grade, status: statusOfGrade(grade), gap: gapText(read.score, read.target) });
  });
  const waiting = scored.some((r) => r.state === 'loading');
  const leftOut = scored.filter((r) => r.state === 'loading' || r.state === 'error').map((r) => r.area.label);
  const state: CardState = scored.length === 0 ? 'empty' : answered.length === 0 ? (waiting ? 'loading' : 'error') : bars.length === 0 ? 'empty' : 'ready';
  return { state, bars, noScore, leftOut };
}

/** The sentence an empty "score against target" card says. */
export function scoreEmptyText(view: ScoreView, anyScoredShown: boolean): string {
  if (!anyScoredShown) return 'None of the scored areas are open to your account.';
  return view.noScore.length > 0 ? 'No area has a score yet. A score appears once the area has records to score.' : 'No scored area is available.';
}

// ── the weakest sections, as bars ────────────────────────────────────────────
export interface WeakBar { key: string; label: string; value: number; valueText: string; note: string; href: string; status: StatusColor }

/** The rows of the "weakest sections" bars: the section, its score, the module and its grade word (and the module's target) as the note, and where it opens. */
export function weakBars(weak: readonly WeakArea[]): WeakBar[] {
  return weak.map((w) => ({
    key: w.key,
    label: w.label,
    value: w.score,
    valueText: `${Math.round(w.score)}%`,
    note: `${w.module} · ${gradeStatus.label(w.grade)}${w.target !== null ? ` · target ${Math.round(w.target)}` : ''}`,
    href: w.href,
    status: statusOfGrade(w.grade),
  }));
}

// ── what needs attention, ranked ─────────────────────────────────────────────
export interface AttentionBar { key: string; label: string; area: string; value: number; tone: Tone; status: StatusColor; href: string }
export interface QuietCounter { key: string; label: string; area: string; href: string; tone: Tone }

export interface AttentionView {
  state: CardState;
  /** every counter with something in it, the biggest first (then the most serious, then the order the areas are defined in) */
  bars: AttentionBar[];
  /** the counters that answered 0: still one press away */
  quiet: QuietCounter[];
  /** counters the answer carried no number for (a dash, never 0) */
  unreported: number;
  failed: AreaRow[];
  waiting: number;
  /** the areas that answered and have counters, and how many of them have something in a counter */
  reporting: number;
  withItems: number;
}

const TONE_RANK: Record<Tone, number> = { danger: 0, warning: 1, pending: 2, progress: 3, success: 4, neutral: 5 };

export function attentionView(rows: readonly AreaRow[]): AttentionView {
  const bars: Array<AttentionBar & { i: number }> = [];
  const quiet: QuietCounter[] = [];
  let unreported = 0;
  let reporting = 0;
  let withItems = 0;
  let i = 0;
  rows.forEach((r) => {
    if (r.state !== 'ready' || !r.read || r.read.counters.length === 0) return;
    reporting++;
    let lit = false;
    r.read.counters.forEach((c) => {
      i++;
      if (c.value === null) { unreported++; return; }
      if (c.value === 0) { quiet.push({ key: c.key, label: c.label, area: r.area.label, href: c.href, tone: c.tone }); return; }
      lit = true;
      bars.push({ key: c.key, label: c.label, area: r.area.label, value: c.value, tone: c.tone, status: statusOfTone(c.tone), href: c.href, i });
    });
    if (lit) withItems++;
  });
  bars.sort((a, b) => b.value - a.value || TONE_RANK[a.tone] - TONE_RANK[b.tone] || a.i - b.i);
  const failed = rows.filter((r) => r.state === 'error');
  const waiting = rows.filter((r) => r.state === 'loading').length;
  const state: CardState = reporting > 0 ? 'ready' : waiting > 0 ? 'loading' : failed.length > 0 ? 'error' : 'empty';
  return { state, bars: bars.map(({ i: _i, ...bar }) => bar), quiet, unreported, failed, waiting, reporting, withItems };
}

// ── history ──────────────────────────────────────────────────────────────────
export interface MonthPoint { label: string; value: number }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** "Nov", "2026" -> "Nov 26": the year is there so twelve months across a new year do not repeat a name. */
const monthLabel = (month: unknown, year: unknown): string => {
  const m = String(month ?? '').trim();
  const y = String(year ?? '').trim();
  return y.length >= 2 ? `${m} ${y.slice(-2)}` : m;
};

/** The Governance score by month: `performance.health_trend` of the Governance scorecard, oldest first (the server keeps one point a month, from the visits that kept it). */
export function governanceTrend(payload: unknown): MonthPoint[] {
  const list = (payload as { performance?: { health_trend?: unknown } } | null | undefined)?.performance?.health_trend;
  if (!Array.isArray(list)) return [];
  return list
    .filter((p): p is { label: string; year?: string; value: number } => !!p && typeof p === 'object' && finite((p as { value?: unknown }).value))
    .map((p) => ({ label: monthLabel(p.label, p.year), value: p.value }));
}

/** What the Governance tile says about the history: the change since the previous month (words, arrow, tone: up is good), the points of its sparkline, and the words for a screen reader. */
export function governanceDelta(points: readonly MonthPoint[]) {
  const values = points.map((p) => p.value);
  return {
    delta: deltaOf(changeOf(values), 'up', [' point', ' points']),
    values,
    summary: trendText('Governance score', points),
  };
}

export interface TaskMonth { label: string; created: number | null; completed: number | null }
export interface TaskTrend { rows: TaskMonth[]; /** something was created or completed in some month */ busy: boolean; /** `mine`: only the tasks the person may see are counted */ scope: 'all' | 'mine' | null }

/** The tasks created and completed by calendar month, the last twelve: `trend_data` of the tasks summary (counted from the tasks' own dates, so it has a history from day one). */
export function tasksTrend(payload: unknown): TaskTrend {
  const d = payload as { trend_data?: unknown; scope?: unknown } | null | undefined;
  const list = Array.isArray(d?.trend_data) ? (d!.trend_data as Array<Record<string, unknown>>) : [];
  const rows = list.map((p) => {
    const m = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(String(p?.month ?? '').trim());
    return { label: m ? monthLabel(m[1].slice(0, 3), m[2]) : String(p?.month ?? ''), created: finite(p?.created) ? p.created : null, completed: finite(p?.completed) ? p.completed : null };
  });
  return { rows, busy: rows.some((r) => (r.created ?? 0) > 0 || (r.completed ?? 0) > 0), scope: d?.scope === 'all' || d?.scope === 'mine' ? d.scope : null };
}

// ── the tiles ────────────────────────────────────────────────────────────────
/** "3 of 7": the share, for a tile's bar (0 to 100). */
export const shareOf = (n: number, of: number): number => (of > 0 ? Math.round((n / of) * 100) : 0);

export interface KpiTileFigure { state: 'loading' | 'error' | 'none' | 'value'; on?: number; live?: number; failedLive?: boolean }

/** The "Cyber KPIs on target" tile from the KPI strip's own states: loading; failed; no report or no live KPI (nothing recorded); the live values not loaded (said); else the count. */
export function kpiFigure(panel: PanelState, counts: KpiCounts | null): KpiTileFigure {
  if (panel.state === 'loading') return { state: 'loading' };
  if (panel.state === 'error') return { state: 'error' };
  if (panel.state === 'absent' || panel.state === 'empty') return { state: 'none' };
  if (panel.liveFailed) return { state: 'none', failedLive: true };
  if (!counts || counts.live === 0) return { state: 'none' };
  return { state: 'value', on: counts.onTarget, live: counts.live };
}
