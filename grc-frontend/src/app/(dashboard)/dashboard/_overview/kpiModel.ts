// The Cyber Security KPI strip of the Performance Overview, without React, so `node --test` checks it (kpiModel.test.ts): which of its states it is in (a
// failed request is said; no KPI report and a report with no KPIs are said too, in one quiet line each), the counts, the KPIs furthest from their target, where
// "Open KPI Report" goes, and the rule that keeps today's value of every live KPI (`POST /kpi-live/snapshot`, once per read). The KPI list, their live values and
// how a workbook row becomes a KPI (buildKpis) are components/dashboard/kpiShared.tsx's, shared with the KPI Report page and left alone.
import type { Kpi } from '../../../../components/dashboard/kpiShared';
import { formatCount, formatPercent } from '../../../../lib/format.ts';
import { statusPill, type Tone } from '../../../../lib/status.ts';
import { kpiTarget } from '../../../../lib/statuses/dashboard.ts';
import type { Load } from './overviewModel.ts';

// ── where the strip's links go ───────────────────────────────────────────────
/** Where a KPI report is uploaded (Assessments > Types, on the KPI report type): the way on when the tenant has none. */
export const UPLOAD_HREF = '/assessments/types?type=kpi_report';

/** The KPI report the strip reads: the newest one (`id`), out of `total` (the server's true count). */
export interface KpiWorkbook { id: number; total: number }

/** "Open KPI Report" opens the report the strip shows, straight (it used to go through a forward that looked the report up again); with none, where one is uploaded. */
export const reportHref = (workbook: KpiWorkbook | null | undefined): string => (workbook ? `/assessments/a/${workbook.id}` : UPLOAD_HREF);

/** Said in the heading when there are several reports (only the newest is read): never silently. '' with one. */
export const newestNote = (workbook: KpiWorkbook | null | undefined): string => (workbook && workbook.total > 1 ? `Newest of ${formatCount(workbook.total)} KPI reports` : '');

// ── the strip's states ───────────────────────────────────────────────────────
/** What the strip's one query answers: the report's rows and the live values; `liveFailed` when only the live values could not be had (the rows still count,
 *  and the strip says why nothing is measured); `workbook` is null when the tenant has no KPI report (an answer, not a failure: never a stored null). */
export interface KpiData { items: unknown[]; metrics: Record<string, unknown>; liveFailed: boolean; workbook: KpiWorkbook | null }

export type PanelState =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'absent' }
  | { state: 'empty'; workbook: KpiWorkbook }
  | { state: 'ready'; liveFailed: boolean; workbook: KpiWorkbook };

/** loading: a skeleton; error: said, with Retry; absent: there is no KPI report yet; empty: there is one with no KPIs in it; else the strip. */
export function panelState(load: Load, data: KpiData | null | undefined): PanelState {
  if (load === 'loading') return { state: 'loading' };
  if (load === 'error') return { state: 'error' };
  const workbook = data?.workbook;
  if (!data || !workbook) return { state: 'absent' };
  if (!Array.isArray(data.items) || data.items.length === 0) return { state: 'empty', workbook };
  return { state: 'ready', liveFailed: !!data.liveFailed, workbook };
}

// ── the counts ───────────────────────────────────────────────────────────────
export interface KpiCounts { live: number; onTarget: number; below: number; notMeasured: number }

/** The old tiles: how many live KPIs, how many are on target, how many are below it (a KPI with nothing measured is neither), and the rest, so the parts add up. */
export function kpiCounts(live: readonly Kpi[]): KpiCounts {
  const onTarget = live.filter((k) => k.onTarget).length;
  const below = live.filter((k) => k.onTarget === false).length;
  return { live: live.length, onTarget, below, notMeasured: live.length - onTarget - below };
}

export interface CountChip { key: 'live' | 'on_target' | 'below_target' | 'not_measured'; label: string; count: number; tone: Tone }

/** The one line of counts. The words are the registry's (lib/statuses/dashboard.ts kpiTarget); "Not measured" appears only when there is one. */
export function countChips(counts: KpiCounts): CountChip[] {
  const word = (w: string) => statusPill(kpiTarget, w);
  const chips: CountChip[] = [
    { key: 'live', label: counts.live === 1 ? 'Live KPI' : 'Live KPIs', count: counts.live, tone: 'neutral' },
    { key: 'on_target', label: word('on_target').label, count: counts.onTarget, tone: word('on_target').tone },
    { key: 'below_target', label: word('below_target').label, count: counts.below, tone: word('below_target').tone },
  ];
  if (counts.notMeasured > 0) chips.push({ key: 'not_measured', label: word('not_measured').label, count: counts.notMeasured, tone: word('not_measured').tone });
  return chips;
}

// ── the KPIs furthest from their target ──────────────────────────────────────
export interface Furthest { key: string; topic: string; domain: string; actual: number; target: number; gap: number; lowerBetter: boolean; href?: string; /** the readings kept so far, oldest first (empty until the snapshots have grown one) */ history: number[] }

/** The readings of a KPI that were kept, oldest first: a day with no number is left out (the sparkline draws what was recorded, never a 0). */
const readings = (k: Kpi): number[] => (k.history ?? []).map((p) => p.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/** The `count` live KPIs furthest below their target (above it, when lower is better), the furthest first, ties by name. A KPI with nothing measured has no distance
 *  and is not ranked. Two rows of the report can map to the same live measure: it is named once (the counts above still count the rows, as the KPI report does). */
export function furthestFromTarget(live: readonly Kpi[], count = 3): Furthest[] {
  const ranked: Furthest[] = [];
  for (const k of live) {
    if (k.onTarget !== false || k.actual == null || k.target == null) continue;
    ranked.push({ key: `${k.domain}|${k.topic}`, topic: k.topic, domain: k.domain, actual: k.actual, target: k.target, gap: k.lowerBetter ? k.actual - k.target : k.target - k.actual, lowerBetter: k.lowerBetter, href: k.href || undefined, history: readings(k) });
  }
  ranked.sort((a, b) => b.gap - a.gap || a.topic.localeCompare(b.topic) || a.domain.localeCompare(b.domain));
  const named = new Set<string>();
  return ranked.filter((f) => { const id = f.topic.trim().toLowerCase(); if (named.has(id)) return false; named.add(id); return true; }).slice(0, count);
}

/** How far a KPI is from its target, in words ("42 points below"); under half a point it is "Just below", never "0 points". Lower-is-better KPIs miss by being above. */
export function gapWords(f: Pick<Furthest, 'gap' | 'lowerBetter'>): string {
  const side = f.lowerBetter ? 'above' : 'below';
  const points = Math.round(f.gap);
  return points < 1 ? `Just ${side}` : `${formatCount(points)} ${points === 1 ? 'point' : 'points'} ${side}`;
}

/** The sparkline of a row in words, for a screen reader: "From 40% to 48% in 12 readings"; '' with fewer than two readings (no line is drawn then). */
export function historyWords(f: Pick<Furthest, 'history'>): string {
  const h = f.history;
  return h.length < 2 ? '' : `From ${formatPercent(h[0])} to ${formatPercent(h[h.length - 1])} in ${formatCount(h.length)} readings`;
}

/** The words of a row: the value, the target and how far. */
export const rowFacts = (f: Furthest): { value: string; target: string; gap: string } => ({ value: formatPercent(f.actual), target: `Target ${formatPercent(f.target)}`, gap: gapWords(f) });

export type StripBody = 'rows' | 'all_on_target' | 'no_live_feed' | 'quiet';

/** What sits under the counts: the rows; "every live KPI is on target"; "none is measured by the platform"; or nothing (some are not measured and none is below: the counts say it). */
export function stripBody(counts: KpiCounts, rows: readonly unknown[]): StripBody {
  if (counts.live === 0) return 'no_live_feed';
  if (rows.length > 0) return 'rows';
  return counts.onTarget === counts.live ? 'all_on_target' : 'quiet';
}

// ── keeping today's value ────────────────────────────────────────────────────
/** `GET /kpi-live` writes nothing; this keeps today's value of each live KPI (one row per KPI and day, asking again the same day replaces it), which is what makes the trend grow. */
export const SNAPSHOT_PATH = '/compliance/assessments/kpi-live/snapshot';

/** The value was read (a report exists and the live values loaded): the condition under which the GET used to write. Without a report nothing was asked of `kpi-live`; with the live values failed there is nothing to keep. */
export const shouldKeepSnapshot = (data: KpiData | null | undefined): boolean => !!data && !!data.workbook && !data.liveFailed;

export interface SnapshotRead { ok: boolean; /** one id per successful read: React Query's `dataUpdatedAt` */ at: number }

/** Asks `post` to keep the values ONCE per read: not when the read is not `ok`; not again for a read it has already kept (a re-render, a strict-mode second effect, a remount
 *  that finds the same cached read); again for the next read. The read is marked kept BEFORE the post, so a failed post is not tried again in a loop. It never waits for the
 *  post and a failure (a rejection, or a throw) is nobody's business: no message, no state, no crash. Returns whether it asked. */
export function snapshotKeeper(post: () => Promise<unknown>): (read: SnapshotRead) => boolean {
  let kept = 0;
  return ({ ok, at }) => {
    if (!ok || !(at > 0) || at === kept) return false;
    kept = at;
    try { Promise.resolve(post()).catch(() => undefined); } catch { /* a synchronous failure of the call is as silent as a rejected one */ }
    return true;
  };
}
