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
import type { AreaTileItem, AreaTone } from '../../overview/charts/areaModel.ts';
import { OTHER, STATUS, type StatusColor } from '../../overview/charts/palette.ts';
import {
  SECTION_HREF, areaWord, journeyRows,
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

const AREA_TONE = { strong: 'good', fair: 'warn', weak: 'bad', no_data: 'neutral' } as const satisfies Record<ReturnType<typeof areaWord>, AreaTone>;

/** The words of the area tiles' colours: the band the dashboards always used (80 strong, 60 fair, below weak) and "No data" for an area with no score. */
export const AREA_WORDS = { good: 'Strong', warn: 'Fair', bad: 'Weak', neutral: 'No data' } as const;

/** What is wrong inside an area, in a few words, from the answers the page has (the four buckets the old "Needs attention" band counted): they ride on the tile's tooltip and its accessible name,
 *  never drawn as text. A count of 0, and a count the answer did not carry, is no note. */
export function areaNotes(queue: Record<string, unknown> | null | undefined, evidence: EvidenceSummaryLite | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const say = (key: string, n: unknown, one: string, many: string) => { if (finite(n) && n > 0) out[key] = `${formatCount(n)} ${n === 1 ? one : many}`; };
  say('controls', queue?.controls_without_evidence, 'control without evidence', 'controls without evidence');
  say('effectiveness', queue?.overdue_control_tests, 'overdue test', 'overdue tests');
  say('evidence', evidence?.lapsed_count ?? evidence?.stale_count, 'lapsed file', 'lapsed files');
  say('regulatory', queue?.regulatory_overdue_tasks, 'overdue task', 'overdue tasks');
  return out;
}

/** The areas as small multiples, the weakest first (an area with no score last, "No data", never a ring at 0): the server's score, the band's colour, the weight and the area's attention note in
 *  the tooltip, and the page the area is worked on. */
export function areaTiles(rows: readonly SectionRow[], notes: Record<string, string> = {}): AreaTileItem[] {
  const ranked = rows.slice().sort((a, b) => Number(a.score === null) - Number(b.score === null) || (a.score ?? 0) - (b.score ?? 0) || b.weight - a.weight);
  return ranked.map((r) => ({
    key: r.key, label: r.label, value: r.score, tone: AREA_TONE[areaWord(r.score)], href: SECTION_HREF[r.key],
    note: [`${Math.round(r.weight * 100)}% of the score`, notes[r.key]].filter(Boolean).join(' · '),
  }));
}

export interface MetricLite { key?: string; label?: string; score?: number | null; numerator?: number | null; denominator?: number | null; inverse?: boolean }
export interface SectionLite { key?: string; label?: string; weight?: number; score?: number | null; metrics?: readonly MetricLite[] }

/** The three measures that say where the controls stand, each the server's own score of it (not worked out here): controls with approved evidence and controls independently verified (Controls area),
 *  controls tested on schedule (Control Effectiveness area). In the colour of the band of its score, with its word; a measure the answer lacks is "No data" and a bar of nothing, never a 0. */
export const CONTROL_MEASURES = [
  { section: 'controls', metric: 'evidence_coverage', label: 'With evidence', href: '/controls' },
  { section: 'controls', metric: 'verified', label: 'Verified', href: '/controls' },
  { section: 'effectiveness', metric: 'test_coverage', label: 'Tested', href: '/control-library/assurance' },
] as const;

export function controlBars(sections: Record<string, SectionLite> | null | undefined): BarItem[] {
  const out: BarItem[] = [];
  CONTROL_MEASURES.forEach((def) => {
    const section = sections?.[def.section];
    if (!section) return;
    const m = (section.metrics ?? []).find((x) => x.key === def.metric);
    const score = whole(m?.score);
    out.push({
      key: `${def.section}:${def.metric}`, label: def.label, value: score ?? 0, valueText: score === null ? 'No data' : `${Math.round(score)}%`,
      color: toneColor(areaBand.tone(areaWord(score))), href: def.href,
    });
  });
  return out;
}

// ── the journeys ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where the Frameworks hub lists the journeys that are late or due within 30 days. */
export const ATTENTION_HREF = '/frameworks?quick=attention';

/** Late or due within 30 days, over the journeys that still have work in them (the hub's "Due in 30 days" tile says the same). */
export function dueCounts(rows: readonly JourneyRow[]): { due: number; overdue: number } {
  const active = rows.filter((r) => r.active);
  const overdue = active.filter((r) => r.target.state === 'overdue').length;
  return { due: overdue + active.filter((r) => r.target.state === 'soon').length, overdue };
}

/** A journey with work in it and figures to draw: its row (the order of the table: the most urgent first) and its numbers (the journey model's). */
export interface Figure { row: JourneyRow; n: JourneyNumbers }

export function figuresOf(list: readonly JourneyListItem[] | null | undefined, today: Date = new Date()): Figure[] {
  const byId = new Map((list ?? []).map((j) => [j.id, j]));
  const out: Figure[] = [];
  journeyRows(list, today).forEach((row) => {
    if (!row.active) return;
    const n = journeyNumbers(byId.get(row.id)?.progress);
    if (!n) return;
    out.push({ row, n });
  });
  return out;
}

/** The work left over every journey that is drawn: requirements not started and requirements in progress (out-of-scope ones are not counted at all). */
export function openWork(figures: readonly Figure[]): { open: number; toStart: number; inProgress: number } {
  const toStart = figures.reduce((s, f) => s + f.n.toStart, 0);
  const inProgress = figures.reduce((s, f) => s + f.n.inProgress, 0);
  return { open: toStart + inProgress, toStart, inProgress };
}

/** Where every requirement of the journeys with work in them stands: implemented (the verified ones counted once, as the journey model says), in progress, not started. Out-of-scope
 *  requirements are left out, as in every percentage. Counts, not shares. The Frameworks hub lists journeys, not requirements, so every part opens it. */
export function requirementParts(figures: readonly Figure[]): PartItem[] {
  if (figures.length === 0) return [];
  const { toStart, inProgress } = openWork(figures);
  const implemented = figures.reduce((s, f) => s + f.n.implemented, 0);
  return [
    { key: 'implemented', label: 'Implemented', value: implemented, color: STATUS.good, href: '/frameworks' },
    { key: 'in_progress', label: 'In progress', value: inProgress, color: STATUS.progress, href: '/frameworks' },
    { key: 'not_started', label: 'Not started', value: toStart, color: STATUS.neutral, href: '/frameworks' },
  ];
}

/** The tone of a framework tile: Ready from 75 is strong, from 50 building, below that early (the lines of the whole platform: lib/journeyModel.ts readinessBand). */
const BAND_TONE = { strong: 'good', building: 'warn', early: 'bad', start: 'bad' } as const satisfies Record<ReturnType<typeof readinessBand>, AreaTone>;
export const FRAMEWORK_WORDS = { good: 'Strong', warn: 'Building', bad: 'Early', neutral: 'No figures' } as const;

/** One tile per framework journey, the most urgent first (the order of journeyRows: a target date that has passed, then the lowest Ready; finished journeys last): the journey model's Ready % in
 *  the ring and the figure, its band's colour, Implemented, the stage and the target in the tooltip. A journey whose list sent no progress is "No figures", never a ring at 0. */
export function frameworkTiles(rows: readonly JourneyRow[]): AreaTileItem[] {
  return rows.map((r) => {
    const band = r.ready === null ? null : readinessBand(r.ready);
    return {
      key: String(r.id), label: r.name, value: r.ready, display: r.ready === null ? undefined : formatPercent(r.ready), tone: band ? BAND_TONE[band] : 'neutral', href: r.href,
      note: [journeyStatus.label(r.status), band ? readinessBandWords.label(band) : null, r.implemented === null ? null : `Implemented ${formatPercent(r.implemented)}`].filter(Boolean).join(' · '),
    };
  });
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
    ['in_date', 'In date', whole(s?.in_force_count), STATUS.good, undefined],       // no list of its own: approved AND in date is not one filter of the library
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
