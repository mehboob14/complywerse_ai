// What the Issue & Incident Overview's charts draw, apart from React so `node --test` pins it (chartModel.test.ts). Everything is worked out from the three lists the page already holds
// (issues, corrective actions, incidents) under the registers' own rules, so a figure here is the figure the register shows after the click. Nothing here asks the server for anything.
//
// HISTORY is DERIVED, never stored: the issue list carries `created_at` and `closed_at`, so "raised in a month" and "closed in a month" are exact counts of those two dates, and "open at the end
// of a month" is every issue raised by then that was not yet closed. Two kinds of issue have no date to place them with: one that is cancelled or closed with no closing date (the server
// stamps none for a cancellation), and one with no raised date. They are left out of the open history and counted (`unplaced`), and the card says how many. An issue reopened after a closure
// has lost its closing date, so it counts as open since it was raised.
import { openOf, personName, type IssueRow } from '../../../../lib/issues/issueDef.ts';
import { isActionOverdue, statusOf, type ActionRow } from '../../../../lib/issues/actionDef.ts';
import { ISSUE_SEVERITIES, OPEN_STATES, isSerious, sourceWord } from '../../../../lib/issues/words.ts';
import { isOpenIncident } from '../../../../lib/erm/incident.ts';
import { issueSeverity, issueState } from '../../../../lib/statuses/issues.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import type { IncidentRow } from '../../erm/_monitoring/incidentModel.ts';
import type { AgeMatrix } from './overviewModel.ts';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ms = (iso?: string | null): number | null => parseUtc(iso)?.getTime() ?? null;
const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0);

/** The colour a part takes, by NAME: a state hue of the chart kit (palette.ts STATUS), or `other` for what has no state. The component turns it into a colour; no colour is written here. */
export type Hue = 'good' | 'bad' | 'warn' | 'progress' | 'pending' | 'neutral' | 'other';

/** An issue's severity is read as the severity pills read it (lib/statuses/issues.ts): critical red, high amber, medium blue, low grey; informational and "none" are the lighter grey. */
export const SEVERITY_HUE: Readonly<Record<string, Hue>> = { critical: 'bad', high: 'warn', medium: 'progress', low: 'neutral', informational: 'other', none: 'other' };
export const hueOfSeverity = (s?: string | null): Hue => SEVERITY_HUE[(s || 'none').toLowerCase()] ?? 'other';
/** An issue's state, as the state pills tone it. */
export const STATE_HUE: Readonly<Record<string, Hue>> = { new: 'neutral', triage: 'pending', in_progress: 'progress', resolution: 'progress', closure_review: 'warn', closed: 'good', cancelled: 'neutral' };
/** A corrective action's status, as its pills tone it. */
export const ACTION_HUE: Readonly<Record<string, Hue>> = { planned: 'pending', in_progress: 'progress', blocked: 'warn', completed: 'good', verified: 'good', cancelled: 'neutral' };

// ── the months ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MonthSlot {
  /** "2026-11" */
  key: string;
  /** "Nov", and "Jan 26" where the year changes (and on the first, so a year is always in view) */
  label: string;
  /** the first instant of the month (UTC, like the server's times) and the first instant after the slot: the next month, or just after now for the month so far */
  start: number;
  end: number;
  /** the month so far */
  partial: boolean;
}

/** The last `count` calendar months, oldest first, the last one being the month so far (it ends at `now`). */
export function monthSlots(now: Date, count = 12): MonthSlot[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const out: MonthSlot[] = [];
  for (let k = count - 1; k >= 0; k -= 1) {
    const start = Date.UTC(y, m - k, 1);
    const d = new Date(start);
    const month = d.getUTCMonth();
    out.push({
      key: `${d.getUTCFullYear()}-${String(month + 1).padStart(2, '0')}`,
      label: month === 0 || k === count - 1 ? `${MONTHS[month]} ${String(d.getUTCFullYear()).slice(2)}` : MONTHS[month],
      start,
      end: k === 0 ? now.getTime() + 1 : Date.UTC(y, m - k + 1, 1),
      partial: k === 0,
    });
  }
  return out;
}

// ── issues over time ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether an issue was open at the instant `t`; null when its rows cannot say (no raised date, or ended with no closing date). */
function openAtMs(row: IssueRow, t: number): boolean | null {
  const created = ms(row.created_at);
  if (created === null) return null;
  if (openOf(row)) return created <= t;
  const closed = ms(row.closed_at);
  if (closed === null) return null;
  return created <= t && closed > t;
}

/** How many issues were open at the instant `t` (those the dates can place). */
export const openAt = (rows: readonly IssueRow[], t: number): number => rows.filter((r) => openAtMs(r, t) === true).length;

export interface IssueHistory {
  slots: MonthSlot[];
  /** per month: issues raised in it, issues closed in it (by their closing date), issues open at its end (at `now` for the month so far) */
  raised: number[];
  closed: number[];
  open: number[];
  /** issues left out of `open` for want of a date */
  unplaced: number;
}

export function issueHistory(rows: readonly IssueRow[], now: Date, count = 12): IssueHistory {
  const slots = monthSlots(now, count);
  const created = rows.map((r) => ms(r.created_at));
  const closed = rows.map((r) => ms(r.closed_at));
  const within = (t: number | null, s: MonthSlot): boolean => t !== null && t >= s.start && t < s.end;
  return {
    slots,
    raised: slots.map((s) => created.filter((t) => within(t, s)).length),
    closed: slots.map((s) => closed.filter((t) => within(t, s)).length),
    open: slots.map((s) => openAt(rows, s.end - 1)),
    unplaced: rows.filter((r) => openAtMs(r, now.getTime()) === null).length,
  };
}

export interface Flow { last: number; before: number }
/** Issues raised (by their raised date) and closed (by their closing date) in the last `days` days, and in the same number of days before that: so a change is like for like. */
export function flowOf(rows: readonly IssueRow[], now: Date, days = 30): { raised: Flow; closed: Flow } {
  const t = now.getTime();
  const a = t - days * DAY;
  const b = t - 2 * days * DAY;
  const count = (key: 'created_at' | 'closed_at', from: number, to: number): number => rows.filter((r) => { const v = ms(r[key]); return v !== null && v >= from && v < to; }).length;
  return {
    raised: { last: count('created_at', a, t + 1), before: count('created_at', b, a) },
    closed: { last: count('closed_at', a, t + 1), before: count('closed_at', b, a) },
  };
}

/** The scorecard's "Closed on time" (its formula: closed on or before the target date / closed issues that had a target): the issues that are closed, have a closing date and a target date. */
export function closedOnTime(rows: readonly IssueRow[]): { onTime: number; of: number } {
  let of = 0;
  let onTime = 0;
  rows.forEach((r) => {
    if (r.workflow_state !== 'closed') return;
    const closed = ms(r.closed_at);
    const target = ms(r.target_closure_date);
    if (closed === null || target === null) return;
    of += 1;
    if (closed <= target) onTime += 1;
  });
  return { onTime, of };
}

/** Open issues by severity: critical and high (the two the scorecard calls serious) apart. */
export function seriousSplit(rows: readonly IssueRow[]): { critical: number; high: number } {
  const open = rows.filter(openOf);
  return { critical: open.filter((i) => i.severity === 'critical').length, high: open.filter((i) => i.severity === 'high').length };
}

// ── the parts of the cards ───────────────────────────────────────────────────────────────────────────────────────────────

export interface Part { key: string; label: string; value: number; hue: Hue; href?: string }

const REGISTER = '/issues/register';
/** Open issues by severity, worst first (a severity none has is left out): a part opens the open issues of that severity. */
export function severityParts(rows: readonly IssueRow[]): Part[] {
  const open = rows.filter(openOf);
  const keys = (ISSUE_SEVERITIES as readonly string[]).concat('none');
  return keys
    .map((k) => ({ k, n: open.filter((i) => ((i.severity || '').toLowerCase() || 'none') === k).length }))
    .filter((x) => x.n > 0)
    .map((x) => ({ key: x.k, label: x.k === 'none' ? 'No severity' : issueSeverity.label(x.k), value: x.n, hue: hueOfSeverity(x.k), ...(x.k === 'none' ? {} : { href: `${REGISTER}?quick=open&severity=${x.k}` }) }));
}

/** The five open states in the order of the life cycle (every one, even with none), each opening the issues in that state. */
export function stageParts(rows: readonly IssueRow[]): Part[] {
  return OPEN_STATES.map((s) => ({
    key: s,
    label: issueState.label(s),
    value: rows.filter((i) => (i.workflow_state || 'new') === s).length,
    hue: STATE_HUE[s],
    href: `${REGISTER}?state=${s}`,
  }));
}

/** The whole register as three parts: open (every open state), closed, cancelled. */
export function wholeParts(rows: readonly IssueRow[]): Part[] {
  const open = rows.filter(openOf).length;
  const closed = rows.filter((i) => i.workflow_state === 'closed').length;
  const cancelled = rows.filter((i) => i.workflow_state === 'cancelled').length;
  return [
    { key: 'open', label: 'Open', value: open, hue: 'progress', href: `${REGISTER}?quick=open` },
    { key: 'closed', label: 'Closed', value: closed, hue: 'good', href: `${REGISTER}?state=closed` },
    { key: 'cancelled', label: 'Cancelled', value: cancelled, hue: 'neutral', href: `${REGISTER}?state=cancelled` },
  ];
}

// ── severity by age ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The four age columns (the buckets of ageMatrix), short enough for a heatmap's header. */
export const AGE_COLS = ['0–7 d', '8–30 d', '31–90 d', '90+ d'] as const;
/** The cells that mean trouble: a critical or high issue open for more than 30 days (an old medium is not drawn as one). */
export const oldSerious = (severity: string, bucket: number): boolean => isSerious(severity) && bucket >= 2;
export interface AgeHeat { rows: string[]; severities: string[]; cells: number[][]; total: number }
export function ageHeat(m: AgeMatrix): AgeHeat {
  return { rows: m.rows.map((r) => r.label), severities: m.rows.map((r) => r.severity), cells: m.rows.map((r) => r.cells), total: m.total };
}

// ── impact by urgency (the severity matrix) ─────────────────────────────────────────────────────────────────────────────

export const LEVELS = ['high', 'medium', 'low'] as const;
export type MatrixRow = IssueRow & { impact?: string | null; urgency?: string | null };
export interface MatrixCellLike { impact: string; urgency: string; severity: string }
export interface MatrixHeat {
  /** impact down ("High impact"), urgency across ("High"), high first, as the Severity matrix in the settings shows it */
  rows: string[];
  cols: string[];
  cells: number[][];
  /** the severity the tenant's matrix gives each cell; null when the matrix could not be read */
  severity: Array<Array<string | null>>;
  /** open issues counted, and open issues with no impact or urgency (in no cell) */
  placed: number;
  unrated: number;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const level = (v?: string | null): (typeof LEVELS)[number] | null => { const s = (v || '').trim().toLowerCase(); return (LEVELS as readonly string[]).includes(s) ? (s as (typeof LEVELS)[number]) : null; };

export function matrixHeat(rows: readonly MatrixRow[], matrix: readonly MatrixCellLike[] | undefined): MatrixHeat {
  const counts = LEVELS.map(() => LEVELS.map(() => 0));
  let unrated = 0;
  rows.filter(openOf).forEach((i) => {
    const imp = level(i.impact);
    const urg = level(i.urgency);
    if (!imp || !urg) { unrated += 1; return; }
    counts[LEVELS.indexOf(imp)][LEVELS.indexOf(urg)] += 1;
  });
  return {
    rows: LEVELS.map((l) => `${cap(l)} impact`),
    cols: LEVELS.map((l) => cap(l)),
    cells: counts,
    severity: LEVELS.map((imp) => LEVELS.map((urg) => matrix?.find((c) => c.impact === imp && c.urgency === urg)?.severity ?? null)),
    placed: sum(counts.flat()),
    unrated,
  };
}

// ── who holds them ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const OWNER_SERIES = ['critical', 'high', 'medium', 'low', 'informational', 'none'] as const;
export interface OwnerRow { key: string; label: string; cells: Record<string, number>; total: number; href?: string }

const sevKey = (i: IssueRow): string => { const s = (i.severity || '').toLowerCase(); return (OWNER_SERIES as readonly string[]).includes(s) ? s : 'none'; };

/** Open issues by the person they are assigned to, the most loaded first, split by severity: the `max` busiest people, everyone else as one "Others" row (no link: it is not one filter) and
 *  "Unassigned" last (it is always its own row: nobody holds them). */
export function ownerLoad(rows: readonly IssueRow[], max = 7): OwnerRow[] {
  const by = new Map<string, OwnerRow>();
  rows.filter(openOf).forEach((i) => {
    const key = i.assignee ? String(i.assignee.id) : 'none';
    const cur = by.get(key) ?? { key, label: i.assignee ? personName(i.assignee) || `User ${i.assignee.id}` : 'Unassigned', cells: {}, total: 0, href: `${REGISTER}?quick=open&assignee=${encodeURIComponent(key)}` };
    cur.cells[sevKey(i)] = (cur.cells[sevKey(i)] ?? 0) + 1;
    cur.total += 1;
    by.set(key, cur);
  });
  const people = Array.from(by.values()).filter((r) => r.key !== 'none').sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const head = people.slice(0, max);
  const tail = people.slice(max);
  const out: OwnerRow[] = head.slice();
  if (tail.length > 0) {
    const cells: Record<string, number> = {};
    tail.forEach((r) => Object.entries(r.cells).forEach(([k, v]) => { cells[k] = (cells[k] ?? 0) + v; }));
    out.push({ key: '__others', label: `${tail.length} other ${tail.length === 1 ? 'person' : 'people'}`, cells, total: sum(tail.map((r) => r.total)) });
  }
  const unassigned = by.get('none');
  if (unassigned) out.push(unassigned);
  return out;
}

// ── raised from ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RankRow { key: string; label: string; value: number; note?: string; href?: string }
/** Open issues by the place they were raised from, the biggest first: the `max` biggest, the rest as one "Other places" row (no link). */
export function sourceRank(rows: readonly IssueRow[], max = 6): RankRow[] {
  const by = new Map<string, { label: string; value: number; critical: number; high: number }>();
  rows.filter(openOf).forEach((i) => {
    const k = i.source_type || 'manual';
    const cur = by.get(k) ?? { label: sourceWord(k), value: 0, critical: 0, high: 0 };
    cur.value += 1;
    if (i.severity === 'critical') cur.critical += 1;
    if (i.severity === 'high') cur.high += 1;
    by.set(k, cur);
  });
  const ranked = Array.from(by.entries()).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const say = (v: { critical: number; high: number }): string | undefined => [v.critical > 0 ? `${v.critical} critical` : '', v.high > 0 ? `${v.high} high` : ''].filter(Boolean).join(', ') || undefined;
  const keep = ranked.length <= max + 1 ? ranked : ranked.slice(0, max);
  const rest = ranked.length <= max + 1 ? [] : ranked.slice(max);
  const out: RankRow[] = keep.map((r) => ({ key: r.key, label: r.label, value: r.value, note: say(r), href: `${REGISTER}?quick=open&source=${encodeURIComponent(r.key)}` }));
  if (rest.length > 0) out.push({ key: '__other', label: 'Other places', value: sum(rest.map((r) => r.value)), note: say({ critical: sum(rest.map((r) => r.critical)), high: sum(rest.map((r) => r.high)) }) });
  return out;
}

// ── corrective actions ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface ActionProgress {
  /** completed or verified, and every action but the cancelled ones: the scorecard's "Actions completed" (completed or verified actions / all actions excluding cancelled) */
  done: number;
  live: number;
  /** whole percent; null with no action */
  pct: number | null;
  late: number;
}
export function actionProgress(rows: readonly ActionRow[], now: Date): ActionProgress {
  const live = rows.filter((a) => statusOf(a) !== 'cancelled');
  const done = live.filter((a) => statusOf(a) === 'completed' || statusOf(a) === 'verified').length;
  return { done, live: live.length, pct: live.length ? Math.round((done / live.length) * 100) : null, late: rows.filter((a) => isActionOverdue(a, now)).length };
}

// ── incidents ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface IncidentHistory { slots: MonthSlot[]; reported: number[]; resolved: number[] }
/** Incidents reported (by the incident date) and resolved (by the resolution date) in each of the last 12 months. */
export function incidentHistory(rows: readonly IncidentRow[], now: Date, count = 12): IncidentHistory {
  const slots = monthSlots(now, count);
  const happened = rows.map((r) => ms(r.incident_date));
  const resolved = rows.map((r) => ms(r.resolved_at));
  const within = (t: number | null, s: MonthSlot): boolean => t !== null && t >= s.start && t < s.end;
  return { slots, reported: slots.map((s) => happened.filter((t) => within(t, s)).length), resolved: slots.map((s) => resolved.filter((t) => within(t, s)).length) };
}

const INCIDENT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
/** Open incidents by severity, worst first, each opening the open incidents of that severity. */
export function incidentSeverityParts(rows: readonly IncidentRow[]): Part[] {
  const open = rows.filter((i) => isOpenIncident(i.status));
  return INCIDENT_SEVERITIES
    .map((s) => ({ s, n: open.filter((i) => i.severity === s).length }))
    .filter((x) => x.n > 0)
    .map((x) => ({ key: x.s, label: issueSeverity.label(x.s), value: x.n, hue: hueOfSeverity(x.s), href: `/erm/incidents?quick=open&severity=${x.s}` }));
}

// ── a card's state ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type CardState = 'loading' | 'error' | 'empty' | 'ready';
/** What a card says while its list is on the way, has failed, or has nothing for it. A failed list is never an empty chart; a list that failed on a refresh keeps what it had. */
export function cardState(feed: { state: 'loading' | 'error' | 'ready' }, hasContent: boolean): CardState {
  if (feed.state === 'loading') return 'loading';
  if (feed.state === 'error') return 'error';
  return hasContent ? 'ready' : 'empty';
}
