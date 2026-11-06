// What the committee pages (Governance > Committees, a committee, a meeting, Oversight Actions) say about their numbers, lists and dates, apart from React so
// `node --test src/lib/committees.test.ts` can pin it. Nothing here computes a score: the formulas are the server's (committees.py, /overview), these
// functions only decide what the page may CLAIM about what the server sent.
//
// NOT RECORDED. A tile whose source has no data does not show 0% or an empty bar, it says "Not recorded" and, from an (i), what is missing.
// A meeting can now be started and ended and its roll taken (the meeting page: committeeApi.startMeeting, endMeeting, saveAttendance), so the measures that read those
// (attendance, quorum met, minutes recorded, meetings held) have data once a meeting has been run. Until then the reasons below say what to do, derived from the numbers
// the API returns (completed meetings, meetings with quorum data, the metric's denominator): they stop being said when there is data.
import { formatCount, formatDate, formatDateTime, formatPercent, formatRelative, statusLabel, type DateInput } from './format.ts';
import { parseUtc } from './serverTime.ts';

// ── what the overview endpoint sends (GET /governance/committees/overview) ────────────────────────────────────────────────────────────────────
export interface OverviewMetric {
  key: string;
  label: string;
  weight: number;
  score: number | null;
  numerator: number;
  denominator: number;
  formula: string;
  inverse?: boolean;
  target: number;
}

export interface OverviewKpis {
  total_committees: number;
  active_committees: number;
  meetings_upcoming: number;
  meetings_completed: number;
  meetings_this_quarter: number;
  actions: { open: number; in_progress: number; overdue: number; completed: number; total: number; pct_done: number };
  avg_attendance_pct: number | null;
  quorum_met?: number;
  quorum_meetings?: number;
  quorum_met_rate_pct?: number | null;
  charters_active: number;
  performance?: { score: number | null; grade: string | null; metrics: OverviewMetric[] };
}

export interface OverviewCommittee {
  id: number;
  name: string;
  committee_type: string;
  is_active: boolean;
  members_count: number;
  next_meeting_date: string | null;
  last_meeting: { date: string; status: string } | null;
  open_actions: number;
  in_progress_actions: number;
  overdue_actions: number;
  completed_actions: number;
  total_actions: number;
  // the health strip (committees.py _committee_health): the same values GET /committees/{id} carries
  attendance_pct?: number | null;
  next_meeting?: { id: number; date: string; title: string; has_agenda: boolean; papers_count: number; invitees_count: number } | null;
  charter_in_force?: { id: number; version: string; expires_on: string | null } | null;
  meetings_in_progress?: number;
}

export interface OverviewMeeting {
  id: number;
  title: string;
  committee_id: number;
  committee_name: string | null;
  scheduled_date: string | null;
  status: string;
}

export interface OverviewPerformer {
  user_id: number;
  name: string;
  assigned: number;
  completed: number;
  on_time: number;
  completion_pct: number;
  on_time_pct: number;
}

export interface OverviewMonth {
  month: string;
  meetings_held: number;
  actions_completed: number;
  completion_pct: number | null;
}

export interface Overview {
  kpis: OverviewKpis;
  committees: OverviewCommittee[];
  upcoming_meetings: OverviewMeeting[];
  top_performers: OverviewPerformer[];
  progress_over_time: OverviewMonth[];
}

// ── Not recorded ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const NOT_RECORDED = 'Not recorded';

/** What a tile says: `value` is the text of the number, or null when nothing is recorded (the tile then says "Not recorded" and `why` is its (i)). */
export interface Reading {
  value: string | null;
  /** what is missing; empty when something is recorded */
  why: string;
  /** the line under the number */
  note: string;
}

const NO_ACTIONS = 'No oversight action has been recorded yet.';
/** Said beside every measure that needs a held meeting: how to get one (start the meeting, take the roll call, end it). The counts that precede it are the API's. */
const NO_LIFECYCLE = 'Start a meeting, take the roll call and end it to record one.';

const plural = (n: number, one: string, many: string = `${one}s`): string => `${formatCount(n)} ${n === 1 ? one : many}`;

/** A measure has something behind it when the server scored it from at least one record. (The server scores "Action health" 100 when nothing is open,
 *  and the score then rests on a default, not on a record: denominator 0.) */
export const measureHasData = (m: OverviewMetric): boolean => m.score != null && m.denominator > 0;

const MEASURE_REASON: Record<string, string> = {
  action_health: 'No action is open, so it counts as 100% instead of being measured.',
  action_completion: NO_ACTIONS,
  meeting_cadence: 'There is no active committee.',
  minutes_discipline: 'No meeting has been completed in the last 180 days.',
  quorum_rate: 'No completed meeting has quorum and attendance recorded.',
};

/** Why a measure with no data has none. */
export function measureReason(m: OverviewMetric): string {
  return MEASURE_REASON[m.key] ?? 'No records in this area yet.';
}

export interface PerformanceReading {
  /** the server's score; null when no measure has data */
  score: number | null;
  grade: string | null;
  withData: number;
  total: number;
  /** the measures that have nothing behind them */
  left: OverviewMetric[];
  /** "3 of 5 measures have data"; empty when all have */
  note: string;
  /** for the (i): what is left out and why */
  why: string;
}

/** The performance score, said only as far as the data goes: "3 of 5 measures have data" when some have none. The score itself is the server's. */
export function performanceReading(perf: OverviewKpis['performance']): PerformanceReading {
  const metrics = perf?.metrics ?? [];
  const left = metrics.filter((m) => !measureHasData(m));
  const withData = metrics.length - left.length;
  if (!perf || perf.score == null || withData === 0) {
    return { score: null, grade: null, withData, total: metrics.length, left, note: '', why: 'None of the five measures has data yet.' };
  }
  return {
    score: perf.score,
    grade: perf.grade,
    withData,
    total: metrics.length,
    left,
    note: left.length ? `${withData} of ${metrics.length} measures have data` : '',
    why: left.map((m) => `${m.label}: ${measureReason(m)}`).join(' '),
  };
}

/** The tone of the grade the server gives the score (excellent, good, fair, poor); a grade it does not know is neutral. */
export function gradeTone(grade: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  switch ((grade ?? '').toLowerCase()) {
    case 'excellent': case 'good': return 'success';
    case 'fair': return 'warning';
    case 'poor': return 'danger';
    default: return 'neutral';
  }
}

/** "Actions done": the share completed. With no action at all it is not 0%, it is not recorded. */
export function actionsDoneReading(k: OverviewKpis): Reading {
  if (k.actions.total === 0) return { value: null, why: NO_ACTIONS, note: '' };
  return { value: formatPercent(k.actions.pct_done), why: '', note: `${formatCount(k.actions.completed)} of ${formatCount(k.actions.total)} done` };
}

/** "Overdue": a count of records; with no action at all there is nothing to be overdue, which is not the same as none being late. */
export function overdueReading(k: OverviewKpis): Reading {
  if (k.actions.total === 0) return { value: null, why: NO_ACTIONS, note: '' };
  return { value: formatCount(k.actions.overdue), why: '', note: `${plural(k.actions.open + k.actions.in_progress, 'action')} still open` };
}

/** Why no attendance is recorded, from the counts the API sends: no meeting completed, or some completed and none with quorum data. */
export function attendanceWhy(k: OverviewKpis): string {
  const completed = k.meetings_completed;
  if (completed === 0) return `No meeting has been completed. ${NO_LIFECYCLE}`;
  return `${plural(completed, 'meeting')} completed, none with quorum and attendance recorded. Take the roll call of a meeting to record them.`;
}

/** "Attendance": the average share of members present at held meetings; not recorded while no held meeting has quorum data. */
export function attendanceReading(k: OverviewKpis): Reading {
  if (k.avg_attendance_pct == null) return { value: null, why: attendanceWhy(k), note: '' };
  const quorum = k.quorum_meetings ?? 0;
  return { value: formatPercent(Math.round(k.avg_attendance_pct)), why: '', note: quorum ? `Quorum met in ${formatCount(k.quorum_met ?? 0)} of ${formatCount(quorum)}` : '' };
}

/** The chart's "Meetings held" line counts meetings marked completed. While none is, the line is left out and this is why. */
export function meetingsHeldReading(k: OverviewKpis): { recorded: boolean; why: string } {
  return k.meetings_completed > 0 ? { recorded: true, why: '' } : { recorded: false, why: `No meeting has been completed. ${NO_LIFECYCLE}` };
}

// ── counts that come from a capped list ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** "Showing the first 100 of 300 actions." when the list is cut; '' when everything is there. `total` is the API's `total`, never the length of what came back. */
export function cutNotice({ shown, total, noun }: { shown: number; total: number | null | undefined; noun: string }): string {
  if (total == null || !Number.isFinite(total) || shown >= total) return '';
  return `Showing the first ${formatCount(shown)} of ${formatCount(total)} ${noun}.`;
}

/** What a list API sends: `{ items, total }`, or a bare array (older routes). `total` is the length of a bare array. */
export function listOf<T>(payload: unknown): { items: T[]; total: number } {
  if (Array.isArray(payload)) return { items: payload as T[], total: payload.length };
  const body = (payload ?? {}) as { items?: unknown; total?: unknown };
  const items = Array.isArray(body.items) ? (body.items as T[]) : [];
  const total = typeof body.total === 'number' && Number.isFinite(body.total) ? body.total : items.length;
  return { items, total: Math.max(total, items.length) };
}

// ── dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// A meeting's time is a moment the server stamps in naive UTC: it reads as the viewer's own day and clock (a meeting at 23:30 in Karachi is that evening
// there, in Los Angeles another). A due date is a DAY however it was stored (a date picked, or "N days from raising" with a time on it): the day as written.
export const meetingDay = (value: DateInput): string => formatDate(value);
export const meetingWhen = (value: DateInput): string => formatDateTime(value);
export const dueDay = (value: DateInput): string => formatDate(value, { calendar: true });
export const dueRelative = (value: DateInput, today: Date = new Date()): string => formatRelative(value, today, { calendar: true });
export const meetingRelative = (value: DateInput, today: Date = new Date()): string => formatRelative(value, today);

export interface MeetingLike { scheduled_date: string | null; status: string }

/** The meetings still to come, soonest first: after `now` (read as UTC, as the server writes it) and not cancelled. */
export function upcomingMeetings<T extends MeetingLike>(items: readonly T[], now: number = Date.now()): T[] {
  return items
    .map((m) => ({ m, at: parseUtc(m.scheduled_date)?.getTime() ?? NaN }))
    .filter(({ m, at }) => !Number.isNaN(at) && at >= now && m.status !== 'cancelled')
    .sort((a, b) => a.at - b.at)
    .map(({ m }) => m);
}

// ── tabs of a committee ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The tabs the old committee page had, the way they were named (?tab=members): the address of that page still works, and lib/committeeHome.ts legacyCommitteeAddress says
 *  where each one lands now (the management sheet's tabs and the lanes of the filtered home). */
export const COMMITTEE_TABS = ['members', 'charters', 'meetings', 'actions', 'settings'] as const;
export type CommitteeTab = typeof COMMITTEE_TABS[number];
export const DEFAULT_COMMITTEE_TAB: CommitteeTab = 'meetings';

// ── oversight actions ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ActionLike { status: string; is_overdue?: boolean }

/** Overdue the way the API means it: `is_overdue` (open or in progress and past its due date, committees.py serialize_action), or a row saved literally as
 *  "overdue" (a stored status no screen writes; the overview counts it too). A status of "overdue" alone was the old test and was almost never true. */
export const isOverdueAction = (a: ActionLike): boolean => a.is_overdue === true || a.status === 'overdue';

/** Oversight Actions opens already filtered to the overdue ones when the address says `?overdue=1` (the Governance Overview's counter links there). */
export function overdueFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('overdue') === '1';
}

export interface ActionListFilters { status: string; committee: string; overdueOnly: boolean }

export const ACTION_PAGE_SIZE = 100;
export const ACTION_PAGE_SIZES: readonly number[] = [25, 50, 100];

/** The query of GET /governance/committees/actions: the filters as the page has always sent them, and `skip` / `limit` only when they are not the server's own
 *  defaults (page 1 of 100), so the first page asks for exactly what it always did. */
export function actionListParams(f: ActionListFilters, page: number = 1, pageSize: number = ACTION_PAGE_SIZE): {
  status?: string; committee_id?: number; overdue_only?: boolean; skip?: number; limit?: number;
} {
  const params: { status?: string; committee_id?: number; overdue_only?: boolean; skip?: number; limit?: number } = {
    status: f.status || undefined,
    committee_id: f.committee ? parseInt(f.committee, 10) : undefined,
    overdue_only: f.overdueOnly || undefined,
  };
  const skip = Math.max(0, (Math.max(1, Math.floor(page)) - 1) * pageSize);
  if (skip > 0) params.skip = skip;
  if (pageSize !== ACTION_PAGE_SIZE) params.limit = pageSize;
  return params;
}

/** Where an action stands against Task Management's SLA (the `sla` the API sends with every action; services/module_settings.sla_state). */
export interface SlaLike {
  state: 'on_track' | 'due_soon' | 'breached' | 'paused' | 'closed' | 'no_due_date';
  days_overdue: number | null;
  due_in_days: number | null;
  target_days: number | null;
  implied_due_date: boolean;
  escalated: boolean;
}

/** The SLA as a pill: the words the SLA badge has always said ("Overdue 6d · escalated", "Due in 7d", "On track · 14d"), with a tone for each. null when there
 *  is nothing to say (no SLA, or the action is closed): the cell then shows the dash. */
export function slaPill(sla: SlaLike | null | undefined): { tone: 'success' | 'danger' | 'warning' | 'neutral'; label: string; title?: string } | null {
  if (!sla || sla.state === 'closed') return null;
  const title = sla.target_days != null ? `SLA ${sla.target_days} days${sla.implied_due_date ? ', counted from when it was raised' : ''}` : undefined;
  switch (sla.state) {
    case 'breached': return { tone: 'danger', label: `Overdue ${sla.days_overdue}d${sla.escalated ? ' · escalated' : ''}`, title };
    case 'due_soon': return { tone: 'warning', label: sla.due_in_days ? `Due in ${sla.due_in_days}d` : 'Due today', title };
    case 'on_track': return { tone: 'success', label: `On track · ${sla.due_in_days}d`, title };
    case 'paused': return { tone: 'neutral', label: 'Paused', title };
    default: return { tone: 'neutral', label: 'No SLA', title };
  }
}

/** The 18 types an action can have (the first four were the original ones); one list for every form and every label. */
export const ACTION_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'follow_up', label: 'Follow up' },
  { value: 'policy_approval', label: 'Policy approval' },
  { value: 'risk_review', label: 'Risk review' },
  { value: 'audit_response', label: 'Audit response' },
  { value: 'corrective_action', label: 'Corrective action' },
  { value: 'preventive_action', label: 'Preventive action' },
  { value: 'investigation', label: 'Investigation' },
  { value: 'escalation', label: 'Escalation' },
  { value: 'decision_record', label: 'Decision record' },
  { value: 'recommendation', label: 'Recommendation' },
  { value: 'training', label: 'Training' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'vendor_review', label: 'Vendor review' },
  { value: 'incident_review', label: 'Incident review' },
  { value: 'compliance_review', label: 'Compliance review' },
  { value: 'communication', label: 'Communication' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'other', label: 'Other' },
];

/** The label of an action type; a type nobody listed reads as its own words, never as "Follow up". */
export function actionTypeLabel(type: string | null | undefined): string {
  const hit = ACTION_TYPES.find((t) => t.value === type);
  return hit ? hit.label : statusLabel(type);
}

// ── committee types ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TYPE_SHORT: Record<string, string> = { board: 'Board', risk_committee: 'Risk', audit_committee: 'Audit', compliance_committee: 'Compliance', it_steering: 'IT steering', custom: 'Committee' };
const TYPE_LONG: Record<string, string> = { board: 'Board', risk_committee: 'Risk committee', audit_committee: 'Audit committee', compliance_committee: 'Compliance committee', it_steering: 'IT steering', custom: 'Custom' };

/** The committee's type as a word: short in a list ("Risk"), long on its own page ("Risk committee"). */
export function committeeTypeLabel(type: string | null | undefined, form: 'short' | 'long' = 'short'): string {
  const table = form === 'short' ? TYPE_SHORT : TYPE_LONG;
  return Object.prototype.hasOwnProperty.call(table, type ?? '') ? table[type as string] : statusLabel(type);
}

/** The committees whose name or type says `query` (case does not matter); a blank query keeps them all. */
export function matchesCommittee(c: { name: string; committee_type: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || c.name.toLowerCase().includes(q) || committeeTypeLabel(c.committee_type).toLowerCase().includes(q);
}

// ── asking before a change that cannot be taken back ─────────────────────────────────────────────────────────────────────────────────────────────
export interface ConfirmPlan { title: string; message: string; confirmLabel: string }

/** Removing a member. The server clears the committee's Chair or Secretary when that person is removed (committees.py remove_committee_member), and nobody
 *  takes the role over: the question says so. The membership is kept as a past one (left_at), so what the person did stays. */
export function removeMemberPlan(
  member: { user_id: number; user_name: string; role: string },
  committee: { name: string; chair_id?: number | null; secretary_id?: number | null },
): ConfirmPlan & { vacates: 'Chair' | 'Secretary' | null } {
  const who = member.user_name || `User ${member.user_id}`;
  const vacates = member.role === 'chair' && committee.chair_id === member.user_id ? 'Chair'
    : member.role === 'secretary' && committee.secretary_id === member.user_id ? 'Secretary' : null;
  return {
    title: `Remove ${who} from ${committee.name}?`,
    message: vacates
      ? `${who} is the committee's ${vacates}. Removing them also clears the ${vacates}, and nobody takes the role over: choose a new one afterwards.`
      : `${who} stops being a member. Their votes and the actions assigned to them are kept.`,
    confirmLabel: 'Remove member',
    vacates,
  };
}

// ── a committee that is switched off ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The screens only DEACTIVATE a committee (G4_committee_deactivation_plan.md, D43 for departments): POST /committees/{id}/deactivate sets is_active false and
// removes nothing; /reactivate sets it back. While it is off the server hides it from the pickers and answers 400 to a new meeting, action or member. The
// hard DELETE /committees/{id} stays for API clients (an administrator's delete) and no page calls it. The right to do either is governance:committees:delete,
// asked of the person on the screen and of the server.
// A missing or null flag is ACTIVE, as committees.py reads it (_is_active): nothing writes NULL, and two readers used to disagree about it.
export const isActiveCommittee = (c: { is_active?: boolean | null }): boolean => c.is_active !== false;

export type CommitteeStatusFilter = 'active' | 'inactive' | 'all';
export const COMMITTEE_STATUS_VALUES: readonly CommitteeStatusFilter[] = ['active', 'inactive', 'all'];
/** The list opens on the committees people work with; an inactive one is one press away (and the tiles above keep counting every committee). */
export const DEFAULT_COMMITTEE_STATUS: CommitteeStatusFilter = 'active';

export function matchesStatus(c: { is_active?: boolean | null }, filter: CommitteeStatusFilter): boolean {
  return filter === 'all' || (filter === 'active') === isActiveCommittee(c);
}

export function statusCounts(list: ReadonlyArray<{ is_active?: boolean | null }>): Record<CommitteeStatusFilter, number> {
  const active = list.filter(isActiveCommittee).length;
  return { active, inactive: list.length - active, all: list.length };
}

/** The three choices of the list's filter, each with how many committees it holds ("Active (5)"). */
export function statusOptions(counts: Record<CommitteeStatusFilter, number>): Array<{ value: CommitteeStatusFilter; label: string }> {
  return [
    { value: 'active', label: `Active (${formatCount(counts.active)})` },
    { value: 'inactive', label: `Inactive (${formatCount(counts.inactive)})` },
    { value: 'all', label: `All (${formatCount(counts.all)})` },
  ];
}

/** What the table says when the filter and the search leave it empty. `switchTo` is the filter that would show something, offered as a button. null: the
 *  search itself found nothing (the page's own "No committee matches"). */
export function emptyListReading(
  filter: CommitteeStatusFilter, counts: Record<CommitteeStatusFilter, number>, search: string,
): { title: string; description: string; switchTo: CommitteeStatusFilter | null } | null {
  if (search.trim()) return null;
  if (filter === 'active' && counts.active === 0) {
    return { title: 'No active committees', description: `${plural(counts.inactive, 'committee is', 'committees are')} inactive. Reactivate one to use it again.`, switchTo: 'inactive' };
  }
  if (filter === 'inactive' && counts.inactive === 0) {
    return { title: 'No inactive committees', description: 'A committee you deactivate is kept here, with everything it holds.', switchTo: 'active' };
  }
  return null;
}

/** The committees a new meeting or action can go to: the active ones (the server refuses an inactive committee with a 400). */
export function activeCommittees<T extends { is_active?: boolean | null }>(list: readonly T[]): T[] {
  return list.filter(isActiveCommittee);
}

/** A committee's name where an inactive one must still be findable (the Oversight Actions filter lists the actions of a deactivated committee too). */
export function committeeChoiceLabel(c: { name: string; is_active?: boolean | null }): string {
  return isActiveCommittee(c) ? c.name : `${c.name} (inactive)`;
}

/** The one line an inactive committee's page carries. The way back ("Reactivate it") is said only to someone who can take it: the delete right. */
export const inactiveNote = (canReactivate: boolean): string => `Inactive: kept for the record, no new meetings, actions or members.${canReactivate ? ' Reactivate it to use it again.' : ''}`;

/** What stays exactly as it is when a committee is deactivated: its open actions (open, in progress, overdue) and the meetings still to come. null: the count
 *  could not be read, and the question then says so without a number. */
export interface WhatStays { openActions: number | null; scheduledMeetings: number | null }

/** The counts from the two replies the page asked for: the committee itself (`pending_actions_count`, the server's count of open, in-progress and overdue
 *  actions) and its scheduled, not yet past meetings (the list's `total`, never the length of what came back). null in place of a reply that failed. */
export function whatStays(committee: unknown, scheduledMeetings: unknown): WhatStays {
  const pending = (committee as { pending_actions_count?: unknown } | null)?.pending_actions_count;
  return {
    openActions: typeof pending === 'number' && Number.isFinite(pending) ? pending : null,
    scheduledMeetings: scheduledMeetings == null ? null : listOf(scheduledMeetings).total,
  };
}

function staysClause({ openActions, scheduledMeetings }: WhatStays): string {
  if (openActions == null || scheduledMeetings == null) return 'its open actions and scheduled meetings stay as they are';
  if (openActions === 0 && scheduledMeetings === 0) return 'it has no open actions and no scheduled meetings';
  return `${plural(openActions, 'open action')} and ${plural(scheduledMeetings, 'scheduled meeting')} stay as they are`;
}

/** Deactivating a committee: asked once, in the words of the plan, with the numbers that stay as they are. Nothing is removed, and it can be undone. */
export function deactivateCommitteePlan(name: string, stays: WhatStays): ConfirmPlan {
  return {
    title: `Deactivate ${name}?`,
    message: `It stops appearing in committee pickers and takes no new meetings, actions or members. Its members, charters, meetings, agendas, minutes and actions stay and can still be read; ${staysClause(stays)}. You can reactivate it at any time.`,
    confirmLabel: 'Deactivate',
  };
}

/** The toasts, once the server has answered. */
export const deactivatedLine = (name: string): string => `${name} is deactivated.`;
export const reactivatedLine = (name: string): string => `${name} is active again.`;

// ── forms ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Whether a form holds typed input that its opening state did not: what makes a drawer ask "Discard changes?". Plain values, arrays and flat objects. */
export function formChanged(initial: unknown, current: unknown): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}
