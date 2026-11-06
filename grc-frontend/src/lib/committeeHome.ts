// What the Committees home decides, apart from React so `node --test src/lib/committeeHome.test.ts` can pin it. The home is one cross-committee queue in three lanes
// (Needs action, Meetings, Decisions); a committee is a FILTER of it (a chip, with a health strip and a management sheet). This file holds: the address (the filter,
// the open sheet, the search, Mine), the old committee page's `?tab=` mapped onto it, the chips, the pulse and the strip, the windows of the three action groups (which
// request asks for which rows, so every group has its true total), the grouping of meetings, and the readiness pills. The numbers are the server's (committees.py
// /overview, /{id}, /{id}/meetings, /actions, /decisions); nothing here computes a score.
import { flag, integer, oneOf, text } from './addressState.ts';
import {
  COMMITTEE_STATUS_VALUES, DEFAULT_COMMITTEE_STATUS, NOT_RECORDED, attendanceReading, isActiveCommittee, matchesStatus, meetingDay, meetingRelative, performanceReading,
  type CommitteeStatusFilter, type Overview, type OverviewCommittee, type PerformanceReading, type Reading,
} from './committees.ts';
import { formatCount, formatDate, type DateInput } from './format.ts';
import { parseUtc } from './serverTime.ts';

// ── the address ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const MANAGE_TABS = ['overview', 'members', 'charter', 'settings'] as const;
export type ManageTab = typeof MANAGE_TABS[number];
export const MANAGE_VALUES = ['closed', ...MANAGE_TABS] as const;
export type ManageChoice = typeof MANAGE_VALUES[number];

/** ?committee=3 (the filter), ?status=inactive|all (which committees have a chip; the default is the active ones), ?q= (the topic search), ?mine=1, ?manage=members (the sheet). */
export const HOME_SCHEMA = {
  committee: integer(0, { min: 0 }),
  status: oneOf<CommitteeStatusFilter>(COMMITTEE_STATUS_VALUES, DEFAULT_COMMITTEE_STATUS),
  q: text(),
  mine: flag(),
  manage: oneOf<ManageChoice>(MANAGE_VALUES, 'closed'),
};

/** The address an OLD committee page forwards to. `?tab=members|charters|settings` opens the sheet on that tab (the charter tab was "charters"); `meetings` and `actions` are the
 *  lanes of the filtered home; a value nobody listed is the plain filter. Every other param of the old address is dropped (the old page had none). */
export function legacyCommitteeAddress(id: number | string, tab: string | null | undefined): string {
  const committee = Number.parseInt(String(id), 10);
  const base = '/governance/committees';
  if (!Number.isSafeInteger(committee) || committee < 1) return base;
  const manage: Record<string, ManageTab> = { members: 'members', charters: 'charter', charter: 'charter', settings: 'settings' };
  const word = (tab ?? '').trim().toLowerCase();
  const sheet = Object.prototype.hasOwnProperty.call(manage, word) ? manage[word] : undefined;       // own names only: ?tab=constructor is no tab
  return `${base}?committee=${committee}${sheet ? `&manage=${sheet}` : ''}`;
}

/** The address of the home filtered to a committee (a back link from a meeting). */
export const committeeHomeAddress = (id: number | null | undefined, extra: { manage?: ManageTab } = {}): string =>
  id ? `/governance/committees?committee=${id}${extra.manage ? `&manage=${extra.manage}` : ''}` : '/governance/committees';

// ── the chips ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A committee's name where it must fit a chip: " Committee" off the end, 24 characters at most (the whole name is the chip's tooltip when it is cut). */
export function chipName(name: string, max = 24): string {
  const short = name.replace(/\s+Committee$/i, '').trim() || name.trim();
  return short.length > max ? `${short.slice(0, max - 1)}…` : short;
}

export interface ChipSpec {
  key: string;
  label: string;
  count?: number;
  active: boolean;
  title?: string;
  /** a meeting is in progress */
  live?: boolean;
  flag?: { tone: 'info' | 'danger'; text?: number; label: string };
}

type ChipRow = Pick<OverviewCommittee, 'id' | 'name' | 'is_active' | 'overdue_actions' | 'meetings_in_progress'>;

/** The chips of the row: "All committees" first, then one per committee the status filter shows. A committee with a meeting in progress is marked live; one with overdue
 *  actions carries the number (as a badge: the words are in its name for a screen reader, and "meeting in progress" too when both are true). */
export function committeeChips(rows: readonly ChipRow[], { selectedId, status }: { selectedId: number | null; status: CommitteeStatusFilter }): ChipSpec[] {
  const shown = rows.filter((c) => matchesStatus(c, status));
  const chips: ChipSpec[] = [{ key: 'all', label: 'All committees', count: shown.length, active: !selectedId }];
  for (const c of shown) {
    const overdue = c.overdue_actions ?? 0;
    const live = (c.meetings_in_progress ?? 0) > 0;
    const off = !isActiveCommittee(c);
    chips.push({
      key: String(c.id),
      label: `${chipName(c.name)}${off ? ' (inactive)' : ''}`,
      active: selectedId === c.id,
      title: off ? `${c.name} (inactive)` : undefined,
      live,
      flag: overdue > 0
        ? { tone: 'danger', text: overdue, label: `${formatCount(overdue)} overdue ${overdue === 1 ? 'action' : 'actions'}${live ? ', meeting in progress' : ''}` }
        : live ? { tone: 'info', label: 'Meeting in progress' } : undefined,
    });
  }
  return chips;
}

/** How many committees the status filter does not show, for the "Show inactive 2" chip: the count of the OTHER kind. 0 when there is nothing to reveal. */
export function inactiveHidden(rows: readonly { is_active?: boolean | null }[], status: CommitteeStatusFilter): number {
  if (status === 'active') return rows.filter((c) => !isActiveCommittee(c)).length;
  return 0;
}

// ── the pulse (all committees) and the strip (one committee) ───────────────────────────────────────────────────────────────────────────────────
export interface Pulse {
  overdue: number;
  upcoming: number;
  live: number;
  attendance: Reading;
  performance: PerformanceReading;
}

export function pulseOf(overview: Pick<Overview, 'kpis' | 'committees'>): Pulse {
  const k = overview.kpis;
  return {
    overdue: k.actions.overdue,
    upcoming: k.meetings_upcoming,
    live: overview.committees.reduce((n, c) => n + (c.meetings_in_progress ?? 0), 0),
    attendance: attendanceReading(k),
    performance: performanceReading(k.performance),
  };
}

/** What a committee's row of the overview (and GET /{id}) says about its health. */
export interface Health {
  attendance_pct?: number | null;
  next_meeting?: { id: number; date: string; title: string; has_agenda: boolean; papers_count: number; invitees_count: number } | null;
  charter_in_force?: { id: number; version: string; expires_on: string | null } | null;
  meetings_in_progress?: number;
  open_actions?: number;
  in_progress_actions?: number;
  overdue_actions?: number;
  members_count?: number;
  member_count?: number;
}

export interface StripCell { label: string; value: string; sub: string; tone: 'default' | 'danger' | 'success' | 'warning' | 'muted'; why?: string }

/** The five cells of a committee's strip. `charters` is how many charters it has (GET /{id}); undefined while that is not known, which reads "No charter in force". */
export function stripCells(h: Health, { charters, today = new Date() }: { charters?: number; today?: Date } = {}): StripCell[] {
  const live = (h.meetings_in_progress ?? 0) > 0;
  const next = h.next_meeting ?? null;
  const open = (h.open_actions ?? 0) + (h.in_progress_actions ?? 0);
  const overdue = h.overdue_actions ?? 0;
  const members = h.members_count ?? h.member_count ?? 0;
  const charter = h.charter_in_force ?? null;
  return [
    live
      ? { label: 'Next meeting', value: 'In progress', sub: 'now', tone: 'default' }
      : next
        ? { label: 'Next meeting', value: meetingDay(next.date), sub: meetingRelative(next.date, today), tone: 'default' }
        : { label: 'Next meeting', value: 'None', sub: 'not scheduled', tone: 'warning' },
    h.attendance_pct == null
      ? { label: 'Attendance', value: NOT_RECORDED, sub: 'no roll in 12 months', tone: 'muted', why: 'No meeting held in the last 12 months has a roll call.' }
      : { label: 'Attendance', value: `${Math.round(h.attendance_pct)}%`, sub: '12-month average', tone: 'default' },
    { label: 'Overdue', value: formatCount(overdue), sub: h.open_actions == null ? 'actions' : `of ${formatCount(open)} open ${open === 1 ? 'action' : 'actions'}`, tone: overdue > 0 ? 'danger' : 'default' },
    charter
      ? { label: 'Charter', value: 'In force', sub: `v${charter.version}${charter.expires_on ? `, until ${formatDate(charter.expires_on, { calendar: true })}` : ''}`, tone: 'success' }
      : (charters ?? 0) > 0
        ? { label: 'Charter', value: 'Draft only', sub: 'none in force', tone: 'warning' }
        : { label: 'Charter', value: 'None', sub: 'no charter yet', tone: 'warning' },
    { label: 'Members', value: formatCount(members), sub: '', tone: 'default' },
  ];
}

// ── the Needs action lane: three groups, each with its own request and its true total ─────────────────────────────────────────────────────────────
export type ActionGroup = 'overdue' | 'week' | 'later';
export const OPEN_STATUSES = 'open,in_progress';
export const GROUP_LABEL: Record<ActionGroup, string> = { overdue: 'Overdue', week: 'Due this week', later: 'Later' };
/** Rows a group shows before "Show more", and after it. */
export const GROUP_SHOWN: Record<ActionGroup, number> = { overdue: 5, week: 5, later: 3 };
export const GROUP_MORE = 25;
/** A search reads this many open actions (the API has no text search: the page finds the words among what it holds). */
export const SEARCH_ROWS = 200;

export interface ActionScope { committeeId: number | null; mine: boolean }

export interface ActionQuery {
  status: string;
  committee_id?: number;
  assigned_to?: 'me';
  overdue_only?: boolean;
  due_after?: string;
  due_before?: string;
  skip?: number;
  limit?: number;
}

/** The server's naive UTC clock as a string: the instant "now" for due_after (an action due at or after it is not overdue, one before it is: the two groups never overlap). */
export const naiveUtc = (now: Date): string => now.toISOString().slice(0, 19);

/** The calendar day `days` after the viewer's today, as YYYY-MM-DD: the last day of "Due this week" (a bare date is the whole day on the server). */
export function dayAfter(now: Date, days: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const scoped = (scope: ActionScope): Pick<ActionQuery, 'committee_id' | 'assigned_to'> => ({
  ...(scope.committeeId ? { committee_id: scope.committeeId } : {}),
  ...(scope.mine ? { assigned_to: 'me' as const } : {}),
});

/**
 * The request of one group. Overdue is the server's own test (`overdue_only`); this week runs from now to the end of the day a week ahead; later is everything after those, with
 * the ones that have no due date last, which no range can ask for: it is the same list with `skip` = how many rows the first two groups hold (the order is due date, nulls
 * last, then id, so those rows come first). `skip` is only known once the first two answered.
 */
export function groupQuery(group: ActionGroup, scope: ActionScope, now: Date, { limit, skip = 0 }: { limit: number; skip?: number }): ActionQuery {
  const base = { status: OPEN_STATUSES, ...scoped(scope) };
  if (group === 'overdue') return { ...base, overdue_only: true, limit };
  if (group === 'week') return { ...base, due_after: naiveUtc(now), due_before: dayAfter(now, 7), limit };
  return { ...base, ...(skip > 0 ? { skip } : {}), limit };
}

/** The views of the full Oversight Actions list the lane's groups lead to: every open action, and the three groups of the lane. */
export type ActionView = 'all' | 'overdue' | 'week' | 'later';
export const ACTION_VIEWS: readonly ActionView[] = ['all', 'overdue', 'week', 'later'];

/** The address of the Oversight Actions page for a lane's scope (the committee, Mine) and, if given, one of its views. */
export function actionsListAddress(scope: ActionScope, view: ActionView = 'all'): string {
  const params = new URLSearchParams();
  if (scope.committeeId) params.set('committee', String(scope.committeeId));
  if (scope.mine) params.set('mine', '1');
  if (view !== 'all') params.set('view', view);
  const query = params.toString();
  return `/governance/committees/actions${query ? `?${query}` : ''}`;
}

/** How many open actions are "later": all that are open, less the two groups before them. */
export const laterTotal = (all: number, overdue: number, week: number): number => Math.max(0, all - overdue - week);

export interface ActionLike { id: number; title: string; description?: string | null; due_date: string | null; is_overdue?: boolean; assignee_name?: string | null; assigned_to_name?: string | null; status: string }

/** One search over the actions the page holds: the title, the description and the assignee, every word. */
export function matchesSearch(a: ActionLike, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${a.title} ${a.description ?? ''} ${a.assigned_to_name ?? a.assignee_name ?? ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** While a search is typed the lane holds one page of open actions and groups it here: overdue by the server's flag, the week by the due day, the rest later. */
export function groupActions<T extends ActionLike>(rows: readonly T[], now: Date): Record<ActionGroup, T[]> {
  const week = dayAfter(now, 7);
  const out: Record<ActionGroup, T[]> = { overdue: [], week: [], later: [] };
  for (const a of rows) {
    if (a.is_overdue === true) out.overdue.push(a);
    else if (a.due_date && a.due_date.slice(0, 10) <= week) out.week.push(a);
    else out.later.push(a);
  }
  return out;
}

/** The line under a search that did not read everything: "The search reads the first 200 of 340 open actions." */
export function searchCut(shown: number, total: number): string {
  return total > shown ? `The search reads the first ${formatCount(shown)} of ${formatCount(total)} open actions.` : '';
}

// ── the full list (Oversight Actions): the same views, paged ──────────────────────────────────────────────────────────────────────────────────────
export const VIEW_LABEL: Record<ActionView, string> = { all: 'All', overdue: 'Overdue', week: 'Due this week', later: 'Later' };

/** The address of the Oversight Actions page: the filters it keeps (`?committee=3&mine=1&view=overdue&status=open&q=&page=2&size=50`) and the old `?overdue=1` the Governance
 *  Overview's counter links to, which opens the Overdue view. */
export const ACTIONS_SCHEMA = {
  committee: integer(0, { min: 0 }),
  mine: flag(),
  view: oneOf<ActionView>(ACTION_VIEWS, 'all'),
  overdue: flag(),
  status: oneOf<'' | 'open' | 'in_progress' | 'completed'>(['', 'open', 'in_progress', 'completed'], ''),
  q: text(),
  page: integer(1, { min: 1 }),
  size: integer(100, { min: 1, max: 100 }),
};

/** The view the address asks for: `?view=` wins; the old `?overdue=1` is the Overdue view. */
export const viewOf = (a: { view: ActionView; overdue: boolean }): ActionView => (a.view !== 'all' ? a.view : a.overdue ? 'overdue' : 'all');

export interface ActionFilters { committeeId: number | null; mine: boolean; status: string }

/**
 * The request for one page of the list. "All" is what the page has always asked for (the status, the committee, any status; `skip` and `limit` only when they are not the
 * server's own defaults) plus Mine; Overdue, Due this week and Later are the lane's three groups, so their totals are the same numbers. Later skips the rows the first two
 * hold (`before` = overdue + this week), then pages.
 */
export function viewQuery(view: ActionView, f: ActionFilters, now: Date, { page, size, before }: { page: number; size: number; before: number }): ActionQuery & { limit: number } {
  const skip = Math.max(0, (Math.max(1, Math.floor(page)) - 1) * size);
  const scope = { ...(f.committeeId ? { committee_id: f.committeeId } : {}), ...(f.mine ? { assigned_to: 'me' as const } : {}) };
  if (view === 'all') return { status: f.status || undefined, ...scope, ...(skip > 0 ? { skip } : {}), limit: size } as ActionQuery & { limit: number };
  const base = groupQuery(view, { committeeId: f.committeeId, mine: f.mine }, now, { limit: size, skip: view === 'later' ? before + skip : skip });
  return { ...base, ...(view !== 'later' && skip > 0 ? { skip } : {}), limit: size };
}

// ── the Meetings lane ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MeetingRow {
  id: number;
  committee_id: number;
  committee_name?: string | null;
  title: string;
  meeting_type?: string;
  scheduled_date: string | null;
  status: string;
  quorum_required?: number | null;
  quorum_present?: number | null;
  quorum_met?: boolean | null;
  agenda_item_count?: number;
  papers_count?: number;
  invitees_count?: number;
}

const at = (m: { scheduled_date: string | null }): number => parseUtc(m.scheduled_date)?.getTime() ?? 0;

/** In progress first (pinned), then the ones to come soonest first, then the rest newest first. A meeting still "scheduled" whose time has passed is among the rest. */
export function groupMeetings<T extends MeetingRow>(rows: readonly T[], now: number = Date.now()): { live: T[]; upcoming: T[]; earlier: T[] } {
  const live = rows.filter((m) => m.status === 'in_progress').sort((a, b) => at(a) - at(b));
  const upcoming = rows.filter((m) => m.status === 'scheduled' && at(m) >= now).sort((a, b) => at(a) - at(b));
  const earlier = rows.filter((m) => !live.includes(m) && !upcoming.includes(m)).sort((a, b) => at(b) - at(a));
  return { live, upcoming, earlier };
}

export interface Readiness { label: string; tone: 'success' | 'warning' | 'neutral' }

/** What a meeting still to come says about how ready it is: the agenda (or its absence, as a warning) and the papers. */
export function readiness(m: Pick<MeetingRow, 'agenda_item_count' | 'papers_count'>): Readiness[] {
  const agenda = m.agenda_item_count ?? 0;
  const papers = m.papers_count ?? 0;
  const out: Readiness[] = [agenda > 0 ? { label: `Agenda ${formatCount(agenda)}`, tone: 'success' } : { label: 'No agenda', tone: 'warning' }];
  if (papers > 0) out.push({ label: `Papers ${formatCount(papers)}`, tone: 'success' });
  return out;
}

/** The meetings the page asks for: the active committees (or the chosen one, active or not), at most `cap`, in the order the overview sent them (most attention first). */
export function meetingScope(rows: readonly Pick<OverviewCommittee, 'id' | 'is_active'>[], { selectedId, status }: { selectedId: number | null; status: CommitteeStatusFilter }, cap = 20): { ids: number[]; cut: number } {
  const wanted = selectedId ? rows.filter((c) => c.id === selectedId) : rows.filter((c) => matchesStatus(c, status));
  const ids = wanted.map((c) => c.id);
  return { ids: ids.slice(0, cap), cut: Math.max(0, ids.length - cap) };
}

/** The meeting's time of day in the viewer's clock ("13:22"); the day is in the date box beside it. '' for a date that is no date. */
export function meetingClock(value: DateInput): string {
  const d = parseUtc(value);
  return d ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : '';
}

/** The meeting's date as a day for the date box: "12" over "NOV" (the viewer's calendar). */
export function dateBox(value: DateInput): { day: string; month: string } | null {
  const d = parseUtc(value);
  if (!d) return null;
  return { day: String(d.getDate()), month: new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(d).toUpperCase() };
}

// ── the Decisions lane ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DecisionRow {
  id: number;
  item_number: number;
  title: string;
  outcome: string | null;
  decision_made: string | null;
  committee_id: number;
  committee_name: string;
  committee_is_active: boolean;
  meeting_id: number;
  meeting_title: string;
  meeting_date: string | null;
}

export const DECISIONS_SHOWN = 8;

/** Which committees' decisions the lane lists: a chosen committee's, active or not; otherwise the active ones, unless the status filter shows the inactive too. */
export function decisionScope(selectedId: number | null, status: CommitteeStatusFilter): 'true' | 'false' | 'all' {
  if (selectedId) return 'all';
  return status === 'all' ? 'all' : status === 'inactive' ? 'false' : 'true';
}

/** "12 Nov 2026" of the meeting a decision was taken at. */
export const decisionDay = (d: Pick<DecisionRow, 'meeting_date'>): string => formatDate(d.meeting_date);
