// What the graphical part of the Compliance Overview draws, apart from React so `node --test` pins it (graphModel.test.ts): the series of every chart and the figure of every tile,
// each worked out from an answer the page already has (the scorecard, the journeys list with its `progress`, the evidence summary, the compliance history). Nothing here works out
// a compliance percentage of its own: every Ready / Implemented figure is lib/journeyModel.ts's, every area score and measure is the server's, a status mix is counts. A request that
// failed or has not answered is a state of its own upstream, never 0 here; a key missing from an answer is "no data", never a bar of 0.
import { formatCount, formatPercent } from '../../../lib/format.ts';
import { journeyNumbers, readinessBand, type JourneyNumbers } from '../../../lib/journeyModel.ts';
import type { Tone } from '../../../lib/status.ts';
import { statusOf } from '../../ui/ds/reportOutcome.ts';
import { areaBand } from '../../../lib/statuses/complianceStatements.ts';
import { evidenceStatus } from '../../../lib/statuses/evidence.ts';
import { journeyStatus, readinessBandWords } from '../../../lib/statuses/frameworkJourney.ts';
import { changeOf, deltaOf } from '../../overview/charts/chartModel.ts';
import { OTHER, STATUS, type StatusColor } from '../../overview/charts/palette.ts';
import {
  SECTION_HREF, SECTION_ORDER, areaWord, journeyRows, sectionRows,
  type EvidenceSummaryLite, type JourneyListItem, type JourneyRow, type SectionRow,
} from './overviewModel.ts';

// ── what a card is doing ─────────────────────────────────────────────────────────────────────────────────────────────────

export type FeedState = 'loading' | 'denied' | 'error' | 'empty' | 'ready';

/** The state of a card from its request: loading, "No access" (the server refused: 403), failed (only when there is no earlier answer to show: a refresh that fails keeps what the person has), nothing
 *  to show, or the chart. A failed or refused request is never "empty" and never a chart of zeros. */
export function feedState(q: { isPending: boolean; isError: boolean; error: unknown; data: unknown }, hasContent: boolean): FeedState {
  if (q.isPending) return 'loading';
  if (q.isError && q.data === undefined) return statusOf(q.error) === 403 ? 'denied' : 'error';
  return hasContent ? 'ready' : 'empty';
}

// ── colours of states ────────────────────────────────────────────────────────────────────────────────────────────────────

const COLOR_OF: Record<Tone, StatusColor> = { success: 'good', danger: 'bad', warning: 'warn', progress: 'progress', pending: 'pending', neutral: 'neutral' };
/** The colour a state is drawn in: the status pills' own dot, so a bar and a pill of one word agree. */
export const toneColor = (tone: Tone): string => STATUS[COLOR_OF[tone]];

/** What a ranked bar or a legend part is (the kit's BarRow and Slice, said here so the model needs no React file). */
export interface BarItem { key: string; label: string; value: number; valueText?: string; color?: string; note?: string; href?: string }
export interface PartItem { key: string; label: string; value: number; color?: string; href?: string }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const whole = (n: unknown): number | null => (finite(n) ? n : null);

// ── the six areas of the score ───────────────────────────────────────────────────────────────────────────────────────────

/** The areas as ranked bars, the weakest first (an area with no score last, as "No data", never as a bar of 0): the server's score, the band the dashboards always used (80 strong,
 *  60 fair) in the colour of its pill and in words, and the share of the module score it carries. */
export function areaBars(rows: readonly SectionRow[]): BarItem[] {
  const ranked = rows.slice().sort((a, b) => Number(a.score === null) - Number(b.score === null) || (a.score ?? 0) - (b.score ?? 0) || b.weight - a.weight);
  return ranked.map((r) => {
    const word = areaWord(r.score);
    return {
      key: r.key, label: r.label, value: r.score ?? 0, valueText: r.score === null ? 'No data' : String(Math.round(r.score)),
      color: toneColor(areaBand.tone(word)), note: `${areaBand.label(word)} · ${Math.round(r.weight * 100)}% of the score`, href: SECTION_HREF[r.key],
    };
  });
}

export interface MetricLite { key?: string; label?: string; score?: number | null; numerator?: number | null; denominator?: number | null; inverse?: boolean }
export interface SectionLite { key?: string; label?: string; weight?: number; score?: number | null; metrics?: readonly MetricLite[] }
export interface MeasureGroup { key: string; label: string; score: number | null; word: ReturnType<typeof areaWord>; href: string; rows: BarItem[] }

/** The measure of the Evidence area that reads the stored "stale" flag, which nothing sets (a lapsed file is worked out from its dates: the Evidence freshness card). It would read 100% beside
 *  35 lapsed files, so it is not drawn. Everything else the server measures is. */
export const LEFT_OUT = new Set(['evidence:freshness']);

/** One group per area that is in the answer, in the order the score lists them; each measure is a bar at the server's own score (0 to 100) with its numerator and denominator in words.
 *  A measure with no score is "No data". A measure that is the opposite of a count (tests on schedule: 1 minus overdue) has no "x of y": the bar says it. */
export function measureGroups(sections: Record<string, SectionLite> | null | undefined): MeasureGroup[] {
  const out: MeasureGroup[] = [];
  for (const key of SECTION_ORDER) {
    const s = sections?.[key];
    if (!s) continue;
    const rows: BarItem[] = [];
    (s.metrics ?? []).forEach((m, i) => {
      const id = m.key ?? String(i);
      if (LEFT_OUT.has(`${key}:${id}`)) return;
      const score = whole(m.score);
      const num = whole(m.numerator);
      const den = whole(m.denominator);
      rows.push({
        key: `${key}:${id}`, label: m.label ?? id, value: score ?? 0, valueText: score === null ? 'No data' : `${Math.round(score)}%`,
        note: score !== null && !m.inverse && num !== null && den !== null && den > 0 ? `${formatCount(num)} of ${formatCount(den)}` : undefined,
      });
    });
    const score = whole(s.score);
    out.push({ key, label: s.label ?? key, score, word: areaWord(score), href: SECTION_HREF[key] ?? '/compliance', rows });
  }
  return out;
}

// ── the journeys ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where the Frameworks hub lists the journeys that are late or due within 30 days. */
export const ATTENTION_HREF = '/frameworks?quick=attention';

const STAGES = ['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'] as const;
const stageColor = (k: string): string => (k === 'cancelled' ? OTHER : toneColor(journeyStatus.tone(k)));

/** Journeys by stage, in the order a journey goes through them (a stage nobody is in is left out). */
export function stageParts(list: readonly JourneyListItem[] | null | undefined): PartItem[] {
  const counts = new Map<string, number>();
  (list ?? []).forEach((j) => { const k = String(j.status ?? '').trim().toLowerCase() || 'in_progress'; counts.set(k, (counts.get(k) ?? 0) + 1); });
  const known = STAGES.filter((k) => counts.has(k));
  const other = Array.from(counts.keys()).filter((k) => !(STAGES as readonly string[]).includes(k)).sort();
  return [...known, ...other].map((k) => ({ key: k, label: journeyStatus.label(k), value: counts.get(k) as number, color: stageColor(k) }));
}

/** The journeys that still have work in them, by their target date: late, within 30 days (the line the hub uses), later, none set. */
export function dueParts(rows: readonly JourneyRow[]): PartItem[] {
  const active = rows.filter((r) => r.active);
  const n = (state: JourneyRow['target']['state']): number => active.filter((r) => r.target.state === state).length;
  return [
    { key: 'overdue', label: 'Overdue', value: n('overdue'), color: STATUS.bad, href: ATTENTION_HREF },
    { key: 'soon', label: 'Due in 30 days', value: n('soon'), color: STATUS.warn, href: ATTENTION_HREF },
    { key: 'later', label: 'Later', value: n('later'), color: STATUS.progress },
    { key: 'none', label: 'No date set', value: n('none'), color: STATUS.neutral },
  ];
}

/** Late or due within 30 days, over the journeys that still have work in them (the hub's "Due in 30 days" tile says the same). */
export function dueCounts(rows: readonly JourneyRow[]): { due: number; overdue: number } {
  const active = rows.filter((r) => r.active);
  const overdue = active.filter((r) => r.target.state === 'overdue').length;
  return { due: overdue + active.filter((r) => r.target.state === 'soon').length, overdue };
}

/** A journey with work in it and figures to draw: its row (the order of the table: the most urgent first) and its numbers (the journey model's). */
export interface Figure { row: JourneyRow; n: JourneyNumbers; domains: ReadonlyArray<{ name: string; total: number; inProgress: number; notStarted: number }> }

export function figuresOf(list: readonly JourneyListItem[] | null | undefined, today: Date = new Date()): Figure[] {
  const byId = new Map((list ?? []).map((j) => [j.id, j]));
  const out: Figure[] = [];
  journeyRows(list, today).forEach((row) => {
    if (!row.active) return;
    const progress = byId.get(row.id)?.progress;
    const n = journeyNumbers(progress);
    if (!n) return;
    const domains = (progress?.by_domain ?? []).map((d) => ({
      name: (d.domain_name ?? '').trim() || 'General', total: whole(d.total) ?? 0, inProgress: whole(d.in_progress) ?? 0, notStarted: whole(d.not_started) ?? 0,
    }));
    out.push({ row, n, domains });
  });
  return out;
}

/** The work left over every journey that is drawn: requirements not started and requirements in progress (out-of-scope ones are not counted at all). */
export function openWork(figures: readonly Figure[]): { open: number; toStart: number; inProgress: number } {
  const toStart = figures.reduce((s, f) => s + f.n.toStart, 0);
  const inProgress = figures.reduce((s, f) => s + f.n.inProgress, 0);
  return { open: toStart + inProgress, toStart, inProgress };
}

export interface StackCategoryItem { key: string; label: string; cells: Record<string, number>; href: string }
export const STACK_LIMIT = 8;

/** Requirements by status per journey, the most urgent journeys first: implemented (the verified ones counted once, as the journey model says), in progress, not started. Out-of-scope
 *  requirements are left out, as in every percentage. Counts, not shares. */
export function requirementStack(figures: readonly Figure[], limit: number = STACK_LIMIT): { categories: StackCategoryItem[]; shown: number; of: number } {
  const shown = figures.slice(0, limit);
  return {
    categories: shown.map((f) => ({ key: String(f.row.id), label: f.row.name, cells: { implemented: f.n.implemented, inProgress: f.n.inProgress, toStart: f.n.toStart }, href: f.row.href })),
    shown: shown.length, of: figures.length,
  };
}

/** Ready by journey, the lowest first: the journey model's Ready %, in the colour and the word of its band (75 strong, 50 building, 25 early), Implemented in the note. */
export function readyBars(figures: readonly Figure[]): BarItem[] {
  return figures
    .slice()
    .sort((a, b) => a.n.readyPct - b.n.readyPct || a.row.name.localeCompare(b.row.name))
    .map((f) => {
      const band = readinessBand(f.n.readyPct);
      return {
        key: String(f.row.id), label: f.row.name, value: f.n.readyPct, valueText: formatPercent(f.n.readyPct), color: toneColor(readinessBandWords.tone(band)),
        note: `${readinessBandWords.label(band)} · Implemented ${formatPercent(f.n.implementedPct)}`, href: f.row.href,
      };
    });
}

export const DOMAIN_LIMIT = 8;

/** Where the open work is: the domains of the journeys, the most requirements still to do first. A domain is told apart by its journey when there are several. */
export function domainBars(figures: readonly Figure[], limit: number = DOMAIN_LIMIT): { rows: BarItem[]; of: number } {
  const several = figures.length > 1;
  const all: BarItem[] = [];
  figures.forEach((f) => f.domains.forEach((d, i) => {
    const open = d.inProgress + d.notStarted;
    if (open <= 0) return;
    all.push({
      key: `${f.row.id}:${i}`, label: d.name, value: open, valueText: `${formatCount(open)} open`,
      note: `${several ? `${f.row.name} · ` : ''}${formatCount(d.inProgress)} in progress · ${formatCount(d.notStarted)} not started`, href: f.row.href,
    });
  }));
  all.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  return { rows: all.slice(0, limit), of: all.length };
}

// ── the history ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TrendPointLite { label: string; completion: number; readiness: number }
export const PERIODS = [{ value: '30', label: '30 days', days: 30 }, { value: '90', label: '90 days', days: 90 }, { value: '365', label: 'Year', days: 365 }] as const;
export const DEFAULT_PERIOD = '90';
export const HERO_DAYS = 90;

export const daysOf = (value: string): number => PERIODS.find((p) => p.value === value)?.days ?? HERO_DAYS;

/** The platform's own daily record (controls-weighted, over every journey that has been snapshotted): Implemented and Ready, as the Frameworks hub draws them. Fewer than two days is no trend. */
export function trendRows(points: readonly TrendPointLite[] | null | undefined): Array<{ label: string; implemented: number; ready: number }> {
  const real = (points ?? []).filter((p) => finite(p.completion) && finite(p.readiness));
  return real.length < 2 ? [] : real.map((p) => ({ label: p.label, implemented: p.completion, ready: p.readiness }));
}

/** A tile's sparkline and its words: the series, how it went between the last two snapshots (up is good), and the sentence a screen reader gets. */
export function sparkOf(rows: ReadonlyArray<{ label: string; implemented: number; ready: number }>, key: 'implemented' | 'ready', name: string): {
  values: number[]; summary: string; delta: ReturnType<typeof deltaOf>;
} | null {
  if (rows.length < 2) return null;
  const values = rows.map((r) => r[key]);
  const first = rows[0];
  const last = rows[rows.length - 1];
  return {
    values,
    summary: `${name}: from ${formatPercent(first[key])} on ${first.label} to ${formatPercent(last[key])} on ${last.label}.`,
    delta: deltaOf(changeOf(values.map((v) => Math.round(v))), 'up', [' point', ' points']),      // whole points, as the tile says its figure (the kit prints a delta as a whole number)
  };
}

// ── evidence ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const STATUS_ORDER = ['approved', 'pending_review', 'draft', 'rejected', 'expired', 'archived'];

/** Every file by its status, the way a person reads them (approved first): the status pills' colours; a file put away (archived) is the quiet grey. */
export function evidenceParts(summary: EvidenceSummaryLite | null | undefined): PartItem[] {
  const by = summary?.by_status;
  if (!by) return [];
  const keys = [...STATUS_ORDER.filter((k) => finite(by[k])), ...Object.keys(by).filter((k) => !STATUS_ORDER.includes(k) && finite(by[k])).sort()];
  return keys.map((k) => ({
    key: k, label: evidenceStatus.label(k), value: by[k], color: k === 'archived' ? OTHER : toneColor(evidenceStatus.tone(k)), href: `/evidence?status=${k}`,
  }));
}

/** Where the files stand against their dates, as counts on one scale (every file): in force (approved and in date), ending within 30 days, lapsed, waiting for a decision. They overlap
 *  (a file in force can end within 30 days), so the bars are not parts of a whole. A count the answer did not carry is left out, never 0. */
export function freshnessBars(summary: EvidenceSummaryLite | null | undefined): { rows: BarItem[]; max: number } {
  const s = summary;
  const defs: Array<[string, string, number | null, string, string | undefined]> = [
    ['in_force', 'In force', whole(s?.in_force_count), STATUS.good, undefined],       // no list of its own: approved AND in date is not one filter of the library
    ['expiring', 'Expiring in 30 days', whole(s?.expiring_soon_count), STATUS.warn, '/evidence?fresh=expiring'],
    ['lapsed', 'Lapsed', whole(s?.lapsed_count) ?? whole(s?.stale_count), STATUS.bad, '/evidence?fresh=lapsed'],
    ['waiting', 'Waiting for review', whole(s?.pending_review_count), STATUS.pending, '/evidence?quick=waiting'],
  ];
  const rows = defs.filter((d) => d[2] !== null).map(([key, label, value, color, href]) => ({ key, label, value: value as number, color, href }));
  return { rows, max: Math.max(1, whole(s?.total_count) ?? 0, ...rows.map((r) => r.value)) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-06" as "Jun"; a January, and the first month of a window that crosses into a new year, say their year ("Jan 2027"), so a window across a new year reads. */
export function monthLabel(month: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month).trim());
  if (!m) return String(month);
  const name = MONTHS[Number(m[2]) - 1];
  return !name ? String(month) : withYear || m[2] === '01' ? `${name} ${m[1]}` : name;
}

/** Files uploaded and files approved, per month, for the months the server counted (the last six). A month the answer did not count is a gap, not a 0. */
export function evidenceFlow(summary: EvidenceSummaryLite | null | undefined): Array<{ label: string; uploaded: number | null; approved: number | null }> {
  const months = summary?.by_month ?? [];
  const crosses = new Set(months.map((m) => String(m.month).slice(0, 4))).size > 1;
  return months.map((m, i) => ({ label: monthLabel(m.month, crosses && i === 0), uploaded: whole(m.uploaded), approved: whole(m.approved) }));
}

/** The figure of the evidence tile: files approved in the month the server is in (so far), with the six months as its shape. */
export function approvedThisMonth(summary: EvidenceSummaryLite | null | undefined): { value: number; previous: number | null; label: string; values: Array<number | null> } | null {
  const months = summary?.by_month;
  if (!months || months.length === 0) return null;
  const last = months[months.length - 1];
  const value = whole(last.approved);
  if (value === null) return null;
  const before = months.length > 1 ? whole(months[months.length - 2].approved) : null;
  return { value, previous: before, label: monthLabel(last.month), values: months.map((m) => whole(m.approved)) };
}

// ── the tiles ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KpiToneName = 'default' | 'success' | 'warning' | 'danger';
/** The colour of the score's figure: the grade's tone (excellent and good are success, fair warning, poor danger). */
export const scoreTone = (tone: Tone | null): KpiToneName => (tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : 'default');
