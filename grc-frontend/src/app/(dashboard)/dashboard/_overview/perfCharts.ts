// What the graphical part of the Performance Overview decides, apart from React so `node --test` pins it (perfCharts.test.ts): the bars of "Score against target" (one per scored
// area, weakest first, each with the one count that needs attention), the small multiples of the other areas (one tile each: its top count in its status colour), the one
// "Needs attention" tile (areas by their worst count), the two history charts (the Governance score by month, the tasks created and completed by month) and the figures of the tiles.
// Every number is perfModel.ts's or the module's own (lib/perf/moduleFeeds.ts); nothing is computed here that a module did not compute except counting areas ("3 of 7 at target")
// and the change between the last two months. A request that failed or has not answered is a state of its own, never a 0 and never an empty chart. Colours are named here as the
// palette's keys (good / bad / warn ...): the components turn them into hex through palette.ts.
import { changeOf, deltaOf, trendText } from '../../../../components/overview/charts/chartModel.ts';
import type { StatusColor } from '../../../../components/overview/charts/palette.ts';
import { gradeOf, type Grade } from '../../../../lib/perf/moduleFeeds.ts';
import { formatCount } from '../../../../lib/format.ts';
import type { Tone } from '../../../../lib/status.ts';
import { againstTarget, litCounters, retryable, type AreaRow } from './perfModel.ts';
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
  /** null: the area answered and has no score yet (drawn as a neutral "Not scored" bar, never as 0) */
  score: number | null;
  target: number | null;
  grade: Grade | null;
  status: StatusColor;
  /** "13 below target": in the tooltip and the link's name, not drawn */
  gap: string;
  /** the one count of this area that needs attention (its most serious), which opens the records it counts */
  attention: { text: string; href: string; status: StatusColor } | null;
}

export type CardState = 'loading' | 'error' | 'empty' | 'ready';

export interface ScoreView {
  state: CardState;
  /** the scored areas that answered, in the order given (weakest first, the ones without a score last) */
  bars: ScoreBar[];
  /** the scored areas that did not answer (failed, or still loading): named, so the picture says what it leaves out */
  leftOut: string[];
}

/** "99 overdue tasks": a count's number and its own words, the first word in lower case unless it is an acronym ("SLA-breached issues"). The labels are plural phrases, so one of them
 *  is said as "Overdue tasks: 1" (never "1 overdue tasks"). */
export function countText(value: number, label: string): string {
  if (value === 1) return `${label}: 1`;
  const word = /^[A-Z][a-z]/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
  return `${formatCount(value)} ${word}`;
}

/** One bar per scored area that answered. The areas the person may not open are not asked about (their rows are `denied`) and are not here. */
export function scoreView(rows: readonly AreaRow[]): ScoreView {
  const scored = rows.filter((r) => r.area.kind === 'score' && r.state !== 'denied');
  const answered = scored.filter((r) => r.state === 'ready' && r.read);
  const bars: ScoreBar[] = answered.map((r) => {
    const read = r.read!;
    const top = litCounters(read)[0];
    const attention = top ? { text: countText(top.value as number, top.label), href: top.href, status: statusOfTone(top.tone) } : null;
    if (read.score === null) return { key: r.area.key, label: r.area.label, href: r.area.href, score: null, target: read.target, grade: null, status: 'neutral' as const, gap: 'Not scored yet', attention };
    const grade = read.grade ?? (gradeOf(read.score) as Grade);
    return { key: r.area.key, label: r.area.label, href: r.area.href, score: read.score, target: read.target, grade, status: statusOfGrade(grade), gap: gapText(read.score, read.target), attention };
  });
  const waiting = scored.some((r) => r.state === 'loading');
  const leftOut = scored.filter((r) => r.state === 'loading' || r.state === 'error').map((r) => r.area.label);
  const anyScore = bars.some((b) => b.score !== null);
  const state: CardState = scored.length === 0 ? 'empty' : answered.length === 0 ? (waiting ? 'loading' : 'error') : !anyScore ? 'empty' : 'ready';
  return { state, bars, leftOut };
}

/** The sentence an empty "score against target" card says. */
export function scoreEmptyText(view: ScoreView, anyScoredShown: boolean): string {
  if (!anyScoredShown) return 'None of the scored areas are open to your account.';
  return view.bars.length > 0 ? 'No area has a score yet. A score appears once the area has records to score.' : 'No scored area is available.';
}

/** The words a bar says for a screen reader and in its tooltip: "Open Governance: 72 out of 100, good, 13 below target". */
export function barName(b: Pick<ScoreBar, 'label' | 'score' | 'grade' | 'gap'>): string {
  return b.score === null ? `Open ${b.label}: not scored yet` : `Open ${b.label}: ${Math.round(b.score)} out of 100${b.grade ? `, ${b.grade}` : ''}, ${b.gap}`;
}

// ── what needs attention: the one tile ───────────────────────────────────────
export interface AttentionView {
  state: CardState;
  failed: AreaRow[];
  waiting: number;
  /** the areas that answered and have counters, and how many of them have something in a counter */
  reporting: number;
  withItems: number;
  /** by the worst count of the area: a danger count (overdue, lapsed, breached, critical), any other lit count, none lit */
  act: number;
  watch: number;
  clear: number;
}

export function attentionView(rows: readonly AreaRow[]): AttentionView {
  let reporting = 0;
  let act = 0;
  let watch = 0;
  rows.forEach((r) => {
    if (r.state !== 'ready' || !r.read || r.read.counters.length === 0) return;
    reporting++;
    const lit = litCounters(r.read);
    if (lit.some((c) => c.tone === 'danger')) act++;
    else if (lit.length > 0) watch++;
  });
  const failed = rows.filter((r) => r.state === 'error');
  const waiting = rows.filter((r) => r.state === 'loading').length;
  const state: CardState = reporting > 0 ? 'ready' : waiting > 0 ? 'loading' : failed.length > 0 ? 'error' : 'empty';
  return { state, failed, waiting, reporting, withItems: act + watch, act, watch, clear: reporting - act - watch };
}

/** The line under the figure of the "Needs attention" tile: the words of the colours of its bar (how many areas to act on now, how many to watch), then what the figure leaves out
 *  (areas still loading, areas that could not be read), so a failed area never hides the words of the colours. "All clear" when nothing is lit. */
export function attentionNote(v: Pick<AttentionView, 'act' | 'watch' | 'withItems' | 'waiting'> & { failed: readonly AreaRow[] }): string {
  const parts = [
    v.act > 0 ? `${v.act} act now` : '',
    v.watch > 0 ? `${v.watch} watch` : '',
    v.waiting > 0 ? `${v.waiting} still loading` : '',
    v.failed.length > 0 ? `${nameList(v.failed.map((r) => r.area.label))} could not be read` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : v.withItems === 0 ? 'All clear' : '';
}

export interface SeverityPart { key: 'act' | 'watch' | 'clear'; label: string; value: number; status: StatusColor }

/** The thin bar of the tile: the areas by their worst count, each with the word its colour carries. */
export const severityParts = (v: Pick<AttentionView, 'act' | 'watch' | 'clear'>): SeverityPart[] => [
  { key: 'act', label: 'Act now', value: v.act, status: 'bad' },
  { key: 'watch', label: 'Watch', value: v.watch, status: 'warn' },
  { key: 'clear', label: 'Clear', value: v.clear, status: 'good' },
];

// ── the other areas: one tile each ───────────────────────────────────────────
export interface OtherTile {
  key: string;
  label: string;
  state: 'ready' | 'loading' | 'error' | 'denied' | 'link';
  /** where the tile opens: the records of its top count, else the area; null when the tile is not a link (waiting, failed, refused) */
  href: string | null;
  status: StatusColor;
  /** the line under the name, in the status colour (a colour never stands alone): "99 overdue tasks", "All clear", "12 active vendors", "Open" */
  line: string;
  /** the link's name: "Open Task Management: 99 overdue tasks, and 1 more count" */
  name: string;
  retry: boolean;
}

/** One tile for each area that has no score of its own (a headline and counts, or a link). The most serious lit count is its figure; a headline is neutral; every count at 0 is "All clear". */
export function otherTiles(rows: readonly AreaRow[]): OtherTile[] {
  return rows.filter((r) => r.area.kind !== 'score').map((r): OtherTile => {
    const base = { key: r.area.key, label: r.area.label, retry: false };
    if (r.state === 'loading') return { ...base, state: 'loading', href: null, status: 'neutral', line: 'Loading', name: `${r.area.label}: loading` };
    if (r.state === 'error') return { ...base, state: 'error', href: null, status: 'bad', line: "Couldn't load", name: `${r.area.label}: could not be loaded`, retry: retryable(r) };
    if (r.state === 'denied') return { ...base, state: 'denied', href: null, status: 'neutral', line: 'No access', name: `${r.area.label}: no access` };
    if (r.state === 'link' || !r.read) return { ...base, state: 'link', href: r.area.href, status: 'neutral', line: 'Open', name: `Open ${r.area.label}` };
    const lit = litCounters(r.read);
    if (lit.length > 0) {
      const top = lit[0];
      const text = countText(top.value as number, top.label);
      const more = lit.length - 1;
      return { ...base, state: 'ready', href: top.href, status: statusOfTone(top.tone), line: text, name: `Open ${r.area.label}: ${text}${more > 0 ? `, and ${more} more ${more === 1 ? 'count' : 'counts'}` : ''}` };
    }
    const clear = r.read.counters.length > 0 && r.read.counters.every((c) => c.value === 0);
    if (clear) return { ...base, state: 'ready', href: r.area.href, status: 'good', line: 'All clear', name: `Open ${r.area.label}: all clear` };
    const line = r.read.headline ?? 'Open';
    return { ...base, state: 'ready', href: r.area.href, status: 'neutral', line, name: `Open ${r.area.label}: ${line}` };
  });
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
