// What the Performance Overview decides, apart from React so `node --test` pins it (perfModel.test.ts): the row of each area from the state of its request, the counters
// of each area (the lit ones, most serious first), and Overall readiness with the words that define it. Every score, grade and target is the module's scorecard's
// (lib/perf/moduleFeeds.ts reads them); the page's own arithmetic is the mean in Overall readiness and the difference to a target. A request that failed or has not
// answered is a state of its own, never 0 and never "no data".
import { canRetry } from '../../../../components/ui/ds/reportOutcome.ts';
import { AREAS, gradeOf, readArea, type Area, type Counter, type Grade, type ModuleRead } from '../../../../lib/perf/moduleFeeds.ts';
import { formatCount } from '../../../../lib/format.ts';
import type { Tone } from '../../../../lib/status.ts';
import { isRefusal, type Load } from './overviewModel.ts';

// ── one row per area ─────────────────────────────────────────────────────────
export interface Feed { load: Load; data?: unknown; error?: unknown }

/** `loading`: waiting; `error`: failed or unreadable (Retry may help); `denied`: the server refused it; `ready`: read; `link`: an area this page only links to. */
export type RowState = 'loading' | 'error' | 'denied' | 'ready' | 'link';

export interface AreaRow {
  area: Area;
  state: RowState;
  read: ModuleRead | null;
  error?: unknown;
}

export function rowOf(area: Area, feed: Feed | undefined): AreaRow {
  if (area.kind === 'link' || !feed) return { area, state: area.kind === 'link' ? 'link' : 'loading', read: null };
  if (feed.load === 'loading') return { area, state: 'loading', read: null };
  if (feed.load === 'error') return { area, state: isRefusal(feed.error) ? 'denied' : 'error', read: null, error: feed.error };
  const read = readArea(area, feed.data);
  if (!read) return { area, state: 'error', read: null, error: new Error('The answer was not in the shape this page reads.') };
  return { area, state: 'ready', read };
}

const hasScore = (r: AreaRow): boolean => r.state === 'ready' && r.read?.score != null;

/** The order of the cards: the scored areas with a score, the weakest first; then the scored areas that have none (or have not answered); then the areas with a headline;
 *  then the links. Inside a group the areas keep the order they are defined in. */
export function orderRows(rows: readonly AreaRow[]): AreaRow[] {
  const rank = (r: AreaRow): number => (r.area.kind === 'link' ? 3 : r.area.kind === 'count' ? 2 : hasScore(r) ? 0 : 1);
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rank(a.row) - rank(b.row) || (rank(a.row) === 0 ? (a.row.read?.score as number) - (b.row.read?.score as number) : 0) || a.i - b.i)
    .map((x) => x.row);
}

/** What a person with a screen reader and what the eye reads next to a score: "13 below", "4 above", "On target"; '' when there is no score or no target. */
export function againstTarget(score: number | null | undefined, target: number | null | undefined): string {
  if (typeof score !== 'number' || typeof target !== 'number') return '';
  const gap = Math.round(score) - Math.round(target);
  return gap === 0 ? 'On target' : gap > 0 ? `${formatCount(gap)} above` : `${formatCount(-gap)} below`;
}

/** The same in a sentence for the one big number: "13 below the target of 85", "On the target of 85"; nothing recorded says so. */
export function vsTargetText(score: number | null | undefined, target: number | null | undefined): string {
  if (typeof target !== 'number') return 'No target recorded';
  const gap = againstTarget(score, target);
  return gap === '' ? '' : gap === 'On target' ? `On the target of ${Math.round(target)}` : `${gap} the target of ${Math.round(target)}`;
}

// ── what needs attention ─────────────────────────────────────────────────────
const TONE_RANK: Record<Tone, number> = { danger: 0, warning: 1, pending: 2, progress: 3, success: 4, neutral: 5 };

/** The counters of one area that have something in them, the most serious first (then the biggest). */
export function litCounters(read: ModuleRead | null): Counter[] {
  return (read?.counters ?? [])
    .filter((c) => typeof c.value === 'number' && c.value > 0)
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || (b.value as number) - (a.value as number));
}

// ── Overall readiness ────────────────────────────────────────────────────────
export interface Member { key: string; label: string; score: number; target: number | null }
export interface Overall {
  state: 'loading' | 'none' | 'ready';
  score: number | null;
  grade: Grade | null;
  /** the mean of the members' targets, only when every member has one */
  target: number | null;
  members: Member[];
  /** shown scored areas that did not answer (failed or still loading): named, so the number says what it leaves out */
  leftOut: string[];
  /** the scored areas this person may open, of all scored areas */
  shown: number;
  of: number;
  atTarget: number;
}

const mean = (xs: readonly number[]): number => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
export const SCORED_AREAS: number = AREAS.filter((a) => a.kind === 'score').length;

/** Overall readiness: the equal-weight mean of the scores of the scored areas this person may open and that answered. Not a server number: the sentence under it says what it is. */
export function overallOf(rows: readonly AreaRow[]): Overall {
  const scored = rows.filter((r) => r.area.kind === 'score');
  // in the order the areas are defined in, so the sentence names the same ones first for everybody
  const members: Member[] = scored
    .filter(hasScore)
    .sort((a, b) => AREAS.indexOf(a.area) - AREAS.indexOf(b.area))
    .map((r) => ({ key: r.area.key, label: r.area.label, score: r.read!.score as number, target: r.read!.target }));
  const leftOut = scored.filter((r) => r.state === 'loading' || r.state === 'error').map((r) => r.area.label);
  const base = { members, leftOut, shown: scored.filter((r) => r.state !== 'denied').length, of: SCORED_AREAS };
  const none = { score: null, grade: null, target: null, atTarget: 0 };
  if (members.length === 0) return { ...base, ...none, state: scored.some((r) => r.state === 'loading') ? 'loading' : 'none' };
  const score = mean(members.map((m) => m.score));
  const targets = members.map((m) => m.target);
  const target = targets.every((t): t is number => t !== null) ? mean(targets) : null;
  return { ...base, state: 'ready', score, grade: gradeOf(score), target, atTarget: members.filter((m) => m.target !== null && m.score >= m.target).length };
}

/** "Average of Governance, Compliance and 5 more (7 of 7 scored areas)." The names are the members', so two people never see the same number under different words. */
export function overallDefinition(o: Overall): string {
  if (o.members.length === 0) return 'No scored area has answered yet.';
  const names = o.members.length <= 3
    ? o.members.map((m) => m.label).join(o.members.length === 2 ? ' and ' : ', ')
    : `${o.members.slice(0, 2).map((m) => m.label).join(', ')} and ${o.members.length - 2} more`;
  return `The average of ${names}: ${o.members.length} of ${o.of} scored areas, each counting the same.`;
}

/** What the average leaves out, in words: the areas that did not answer, and the ones this person is not shown. */
export function overallLeaves(o: Overall): string {
  const parts: string[] = [];
  if (o.leftOut.length > 0) parts.push(`${o.leftOut.join(', ')} ${o.leftOut.length === 1 ? 'has' : 'have'} not answered`);
  if (o.shown < o.of) parts.push(`you can open ${o.shown} of the ${o.of} scored areas`);
  return parts.join('; ');
}

/** Retry only where asking again can help. */
export const retryable = (r: AreaRow): boolean => r.state === 'error' && canRetry(r.error);
