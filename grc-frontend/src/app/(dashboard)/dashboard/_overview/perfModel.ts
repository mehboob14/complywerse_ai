// What the Performance Overview decides, apart from React so `node --test` pins it (perfModel.test.ts): the row of each area from the state of its request, the counters
// of the band, the weakest areas ("Where to act first"), and Overall readiness with the words that define it. Every score, grade and target is the module's scorecard's
// (lib/perf/moduleFeeds.ts reads them); the page's own arithmetic is the mean in Overall readiness and the difference to a target. A request that failed or has not
// answered is a state of its own, never 0 and never "no data".
import { canRetry } from '../../../../components/ui/ds/reportOutcome.ts';
import { AREAS, GRADE_LINES, gradeOf, readArea, type Area, type Counter, type Grade, type ModuleRead } from '../../../../lib/perf/moduleFeeds.ts';
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

/** The order of the table: the scored areas with a score, the weakest first; then the scored areas that have none (or have not answered); then the areas with a headline;
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

/** The sentence under a row's target: whose target it is, in words. */
export function targetNote(read: ModuleRead): string {
  if (read.target === null) return 'No target is recorded for this area.';
  if (read.customized === true) return `Target ${Math.round(read.target)}, set by your organisation.`;
  if (read.customized === false) return `Target ${Math.round(read.target)}, the default.`;
  return `Target ${Math.round(read.target)}.`;
}

// ── what needs attention ─────────────────────────────────────────────────────
const TONE_RANK: Record<Tone, number> = { danger: 0, warning: 1, pending: 2, progress: 3, success: 4, neutral: 5 };

/** The counters of one area that have something in them, the most serious first (then the biggest). */
export function litCounters(read: ModuleRead | null): Counter[] {
  return (read?.counters ?? [])
    .filter((c) => typeof c.value === 'number' && c.value > 0)
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || (b.value as number) - (a.value as number));
}

export interface Attention {
  /** the thing to look at first: "12 Overdue reviews" */
  top: Counter | null;
  /** how many other counters of the area have something in them */
  more: number;
  /** every counter of the area answered and none has anything in it */
  clear: boolean;
}

export function attentionOf(read: ModuleRead | null): Attention {
  const lit = litCounters(read);
  const counters = read?.counters ?? [];
  return { top: lit[0] ?? null, more: Math.max(0, lit.length - 1), clear: counters.length > 0 && counters.every((c) => c.value === 0) };
}

export type ChipState = 'ready' | 'loading' | 'error' | 'none';
export interface BandChip {
  key: string;
  label: string;
  href: string;
  tone: Tone;
  state: ChipState;
  value?: number;
  /** the area whose request a failed chip asks again */
  areaKey?: string;
}

/** The chips of the band: one per counter of each area that answered (a counter the answer does not carry is a dash), one "unavailable" chip for an area that failed, and ONE
 *  loading chip while any are waiting (a chip per area would be a dozen skeletons). An area the server refused has no chip: the person was never offered it. The serious
 *  ones first, each group in the order the areas are defined in. */
export function bandChips(rows: readonly AreaRow[]): BandChip[] {
  const chips: BandChip[] = [];
  rows.forEach((r) => {
    if (r.state === 'error') chips.push({ key: `${r.area.key}:error`, label: r.area.label, href: r.area.href, tone: 'neutral', state: 'error', areaKey: r.area.key });
    if (r.state !== 'ready' || !r.read) return;
    r.read.counters.forEach((c) => chips.push({
      key: c.key, label: c.label, href: c.href, tone: c.tone, state: c.value === null ? 'none' : 'ready', value: c.value === null ? undefined : c.value, areaKey: r.area.key,
    }));
  });
  const waiting = rows.filter((r) => r.state === 'loading').length;
  const serious = (c: BandChip) => (c.state === 'ready' && c.tone === 'danger' ? 0 : 1);
  const ordered = chips.map((c, i) => ({ c, i })).sort((a, b) => serious(a.c) - serious(b.c) || a.i - b.i).map((x) => x.c);
  if (waiting > 0) ordered.push({ key: 'loading', label: waiting === 1 ? 'Loading 1 area' : `Loading ${waiting} areas`, href: '#modules', tone: 'neutral', state: 'loading' });
  return ordered;
}

/** Every area that was asked failed: said once instead of once per chip. */
export const everyAreaFailed = (rows: readonly AreaRow[]): boolean => {
  const asked = rows.filter((r) => r.area.kind !== 'link' && r.state !== 'denied');
  return asked.length > 0 && asked.every((r) => r.state === 'error');
};

// ── where to act first ───────────────────────────────────────────────────────
export interface WeakArea {
  key: string;
  areaKey: string;
  module: string;
  label: string;
  score: number;
  target: number | null;
  grade: Grade;
  /** where it opens: the area's own page for the sections that have one, else the area's Overview (sections have no address) */
  href: string;
}

/** A section is below its target when the server's target says so; with no target recorded it is below the line the server calls good. */
export const belowTarget = (score: number, target: number | null): boolean => (target !== null ? score < target : score < GRADE_LINES.good);

/** The weakest sections across the scored areas, lowest first, up to `max`, and how many there are below target in all. An area with no score of its own is left out whatever its
 *  sections say (the page always did). */
export function weakestAreas(rows: readonly AreaRow[], max = 10): { rows: WeakArea[]; total: number } {
  const found: WeakArea[] = [];
  rows.forEach((r) => {
    if (r.state !== 'ready' || !r.read || r.read.score === null) return;
    r.read.sections.forEach((s) => {
      if (s.score === null || !belowTarget(s.score, r.read!.target)) return;
      found.push({
        key: `${r.area.key}:${s.key}`, areaKey: r.area.key, module: r.area.label, label: s.label, score: s.score, target: r.read!.target,
        grade: gradeOf(s.score) as Grade, href: r.area.sectionHref?.(s.key) ?? r.area.href,
      });
    });
  });
  found.sort((a, b) => a.score - b.score);
  return { rows: found.slice(0, max), total: found.length };
}

/** The three weakest sections of an area, for its expanded row (any score, below target or not). */
export function weakestThree(read: ModuleRead | null): Array<{ key: string; label: string; score: number }> {
  return (read?.sections ?? [])
    .filter((s): s is { key: string; label: string; score: number } => s.score !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
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
  const members: Member[] = scored
    .filter(hasScore)
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
export const failedRows = (rows: readonly AreaRow[]): AreaRow[] => rows.filter((r) => r.state === 'error' || r.state === 'denied');

/** The "N waiting for you" button of the head: the shared inbox's badge in words. */
export type WaitingBadge = { kind: 'count'; n: number } | { kind: 'none' } | { kind: 'loading' } | { kind: 'unknown' };
export function waitingText(badge: WaitingBadge): string {
  if (badge.kind === 'count') return `${formatCount(badge.n)} waiting for you`;
  if (badge.kind === 'none') return 'Nothing waiting for you';
  return 'Needs my action';
}
