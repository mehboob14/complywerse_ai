// What the committee pages (Governance > Committees, a committee, a meeting, Oversight Actions) say about their numbers, lists and dates, apart from React so
// `node --test src/lib/committees.test.ts` can pin it. Nothing here computes a score: the formulas are the server's (committees.py, /overview), these
// functions only decide what the page may CLAIM about what the server sent.
//
// NOT RECORDED. A tile whose source cannot be set today does not show 0% or an empty bar, it says "Not recorded" and, from an (i), what is missing.
// The meeting lifecycle is separate work: no screen can mark a meeting completed or enter attendance and quorum (committeeApi.updateMeeting and
// updateMinutes have no callers), so the measures that read those (attendance, quorum met, minutes recorded, meetings held) have no data on any tenant
// today. The reasons below are derived from the numbers the API returns (completed meetings, meetings with quorum data, the metric's denominator), so they
// stay true on the day the lifecycle exists: they stop being said when there is data.
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
/** Said beside every measure that needs a held meeting. True of these screens today (the meeting lifecycle is separate work); the counts that precede it are the API's. */
const NO_LIFECYCLE = 'These screens cannot mark a meeting completed or record who attended yet.';

const plural = (n: number, one: string, many: string = `${one}s`): string => `${formatCount(n)} ${n === 1 ? one : many}`;

/** A measure has something behind it when the server scored it from at least one record. (The server scores "Action health" 100 when nothing is open,
 *  and the score then rests on a default, not on a record: denominator 0.) */
export const measureHasData = (m: OverviewMetric): boolean => m.score != null && m.denominator > 0;

const MEASURE_REASON: Record<string, string> = {
  action_health: 'No action is open, so it counts as 100% instead of being measured.',
  action_completion: NO_ACTIONS,
  meeting_cadence: 'There is no active committee.',
  minutes_discipline: 'No meeting has been marked completed in the last 180 days.',
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
  if (completed === 0) return `No meeting has been marked completed. ${NO_LIFECYCLE}`;
  return `${plural(completed, 'meeting')} marked completed, none with quorum and attendance recorded. ${NO_LIFECYCLE}`;
}

/** "Attendance": the average share of members present at held meetings; not recorded while no held meeting has quorum data. */
export function attendanceReading(k: OverviewKpis): Reading {
  if (k.avg_attendance_pct == null) return { value: null, why: attendanceWhy(k), note: '' };
  const quorum = k.quorum_meetings ?? 0;
  return { value: formatPercent(Math.round(k.avg_attendance_pct)), why: '', note: quorum ? `Quorum met in ${formatCount(k.quorum_met ?? 0)} of ${formatCount(quorum)}` : '' };
}

/** The chart's "Meetings held" line counts meetings marked completed. While none is, the line is left out and this is why. */
export function meetingsHeldReading(k: OverviewKpis): { recorded: boolean; why: string } {
  return k.meetings_completed > 0 ? { recorded: true, why: '' } : { recorded: false, why: `No meeting has been marked completed. ${NO_LIFECYCLE}` };
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
/** The tabs of a committee, the way they have always been named; the open one is in the address (?tab=members). Meetings is the default. */
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

/** Deleting a committee: what the server removes (committees.py delete_committee: the ORM cascade over members, charters, meetings with their agenda, minutes
 *  and attached documents, and actions; the actions' Task Management copies are dropped first). Plan, not a change: G4_committee_deactivation_plan.md. */
export function deleteCommitteePlan(name: string): ConfirmPlan {
  return {
    title: `Delete ${name}?`,
    message: 'This permanently deletes the committee with its members, charters, meetings (agendas, minutes and attached documents) and actions, and the copies of those actions in Task Management. It cannot be undone.',
    confirmLabel: 'Delete committee',
  };
}

// ── forms ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Whether a form holds typed input that its opening state did not: what makes a drawer ask "Discard changes?". Plain values, arrays and flat objects. */
export function formChanged(initial: unknown, current: unknown): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}
