// What the meeting workspace decides about RUNNING a meeting, apart from React so `node --test src/lib/meetingRun.test.ts` can pin it: the order of the sections
// (they follow the work: prepare, run, closed), what the roll and the quorum say, the questions asked before a meeting starts or ends, the roll call's payloads and
// the rules for an agenda item's outcome. The server owns every rule (committees.py: the state machine of start and end, quorum from the roll, the four outcome words);
// these functions only decide what the screen offers and how it says what the server answered.
//   scheduled -> in_progress -> completed (cancelled is the raw PUT, API only). A past meeting still "scheduled" can be ended without being started.
//   The roll: present and late count toward quorum, absent does not, an observer is on the roll and never counts. quorum_present is a COUNT, quorum_met is derived
//   (null: no threshold, or no roll). Ending a meeting with no roll leaves quorum empty, and the Governance overview's quorum measure counts that against the score.
import { formatCount, formatDateTime, type DateInput } from './format.ts';
import { parseUtc } from './serverTime.ts';

export type MeetingState = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type OutlineKey = 'attendance' | 'agenda' | 'minutes' | 'actions' | 'papers';
export type RollWord = 'present' | 'late' | 'absent';

// ── the outline ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The sections of the workspace, in the order of the work: before it starts (the agenda and papers first), while it runs (who is here, then the agenda), once it is over
 *  (what was decided, the minutes, the actions). A status nobody knows reads as closed. */
export function outlineOrder(status: string | null | undefined): OutlineKey[] {
  if (status === 'scheduled') return ['agenda', 'papers', 'attendance', 'actions', 'minutes'];
  if (status === 'in_progress') return ['attendance', 'agenda', 'minutes', 'actions', 'papers'];
  return ['agenda', 'minutes', 'actions', 'attendance', 'papers'];
}

const LABELS: Record<OutlineKey, string> = { attendance: 'Attendance', agenda: 'Agenda and votes', minutes: 'Minutes', actions: 'Actions', papers: 'Papers' };

/** What a section is called: the first one is the invitees before the meeting, the roll after; the agenda is "Decisions" once the meeting is over. */
export function outlineLabel(key: OutlineKey, status: string | null | undefined): string {
  if (key === 'attendance' && status === 'scheduled') return 'Invitees';
  if (key === 'agenda' && status === 'completed') return 'Decisions';
  return LABELS[key];
}

/** Which section is the one being read: the last whose top has passed `line` (the scroll position, in the same units as the tops). The first when none has. */
export function sectionInView(tops: ReadonlyArray<{ key: OutlineKey; top: number }>, line: number): OutlineKey | null {
  if (tops.length === 0) return null;
  let current = tops[0].key;
  for (const { key, top } of tops) if (top <= line) current = key;
  return current;
}

// ── the roll and the quorum ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface RollMember {
  user_id: number;
  user_name: string | null;
  user_email?: string | null;
  role: string;
  counts_toward_quorum: boolean;
  /** present | late | absent; null = not marked yet */
  status: string | null;
  is_active_member: boolean;
}

/** GET and PUT /committees/meetings/{id}/attendance. */
export interface Roll {
  meeting_id: number;
  committee_id: number;
  meeting_status: string;
  quorum_required: number | null;
  quorum_present: number | null;
  quorum_met: boolean | null;
  /** false until the first mark; then every active member has a row */
  recorded: boolean;
  voting_members: number;
  members: RollMember[];
}

export interface QuorumReading {
  /** "3 of 4 required present", "5 present", "No roll recorded" */
  text: string;
  /** the word on the pill */
  label: 'Quorum met' | 'Quorum not met' | 'No quorum set' | 'Not recorded';
  tone: 'success' | 'warning' | 'neutral';
  /** how far from the threshold, 0 to 1; null when there is none to measure against */
  fraction: number | null;
}

/** What the quorum bar says. `required` is the threshold (null or under 1: none was set), `present` the server's count (null: no roll was taken), `met` the server's own verdict. */
export function quorumReading({ required, present, met, recorded }: { required: number | null | undefined; present: number | null | undefined; met: boolean | null | undefined; recorded: boolean }): QuorumReading {
  if (!recorded || present == null) return { text: 'No roll recorded', label: 'Not recorded', tone: 'neutral', fraction: null };
  const threshold = typeof required === 'number' && required >= 1 ? required : null;
  if (threshold === null) return { text: `${formatCount(present)} present`, label: 'No quorum set', tone: 'neutral', fraction: null };
  const fraction = Math.max(0, Math.min(1, present / threshold));
  // "3 of 4 required present" while short of it; "5 present, 4 required" once past it (5 of 4 reads wrongly)
  const text = present >= threshold ? `${formatCount(present)} present, ${formatCount(threshold)} required` : `${formatCount(present)} of ${formatCount(threshold)} required present`;
  return met === false || (met == null && present < threshold)
    ? { text, label: 'Quorum not met', tone: 'warning', fraction }
    : { text, label: 'Quorum met', tone: 'success', fraction };
}

/** The quorum reading of a roll (the meeting page's roll call and its live bar). */
export const rollQuorum = (roll: Pick<Roll, 'quorum_required' | 'quorum_present' | 'quorum_met' | 'recorded'>): QuorumReading =>
  quorumReading({ required: roll.quorum_required, present: roll.quorum_present, met: roll.quorum_met, recorded: roll.recorded });

/** The quorum reading of a meeting row (a lane: GET /{id}/meetings), which carries the same three fields but no roll. */
export const meetingQuorum = (m: { quorum_required?: number | null; quorum_present?: number | null; quorum_met?: boolean | null }): QuorumReading =>
  quorumReading({ required: m.quorum_required, present: m.quorum_present, met: m.quorum_met, recorded: m.quorum_present != null });

export interface RollCount { present: number; late: number; absent: number; notMarked: number; observers: number }

/** How many members stand where on the roll. */
export function rollCount(members: readonly RollMember[]): RollCount {
  const count: RollCount = { present: 0, late: 0, absent: 0, notMarked: 0, observers: 0 };
  for (const m of members) {
    if (m.role === 'observer') count.observers += 1;
    if (m.status === 'present') count.present += 1;
    else if (m.status === 'late') count.late += 1;
    else if (m.status === 'absent') count.absent += 1;
    else count.notMarked += 1;
  }
  return count;
}

/** The roll's members whose name or role says `query` (case does not matter); a blank query keeps them all. */
export function rollFilter(members: readonly RollMember[], query: string): RollMember[] {
  const q = query.trim().toLowerCase();
  return q ? members.filter((m) => (m.user_name ?? '').toLowerCase().includes(q) || (m.user_email ?? '').toLowerCase().includes(q) || m.role.toLowerCase().includes(q)) : members.slice();
}

/** PUT /attendance for one member: the body saveAttendance takes. */
export const markOne = (userId: number, status: RollWord): Array<{ user_id: number; status: RollWord }> => [{ user_id: userId, status }];

/** "Everyone present": every member of the roll who is not already (at most 200: the server's limit), so a press that changes nothing sends nothing. */
export function markEveryone(members: readonly RollMember[], status: RollWord = 'present'): Array<{ user_id: number; status: RollWord }> {
  return members.filter((m) => m.is_active_member && m.status !== status).slice(0, 200).map((m) => ({ user_id: m.user_id, status }));
}

/** Whether pressing the member's own word again would change nothing (the server ignores a repeat; the screen does not send it). */
export const alreadyMarked = (member: Pick<RollMember, 'status'>, word: RollWord): boolean => member.status === word;

// ── start and end ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MeetingLike { status: string; scheduled_date: DateInput; title?: string }

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** The meeting's own day has come (today or earlier, in the viewer's calendar) and nobody started it: the bar then asks to start it. */
export function dueToStart(m: MeetingLike, now: Date = new Date()): boolean {
  const at = parseUtc(m.scheduled_date);
  return m.status === 'scheduled' && !!at && startOfDay(at) <= startOfDay(now);
}

/** A meeting still "scheduled" whose time has passed: nobody started it and nobody closed it (the lanes say "Not closed"). */
export function notClosed(m: MeetingLike, now: Date = new Date()): boolean {
  const at = parseUtc(m.scheduled_date);
  return m.status === 'scheduled' && !!at && at.getTime() < now.getTime();
}

/** The bar under the page head: while the meeting runs ('live'), or when it is time to start it and the person may ('due'); otherwise there is none. */
export function barKind(m: MeetingLike, canRun: boolean, now: Date = new Date()): 'live' | 'due' | null {
  if (m.status === 'in_progress') return 'live';
  return m.status === 'scheduled' && canRun && dueToStart(m, now) ? 'due' : null;
}

export interface RunPlan {
  title: string;
  confirmLabel: string;
  tone: 'default' | 'danger';
  /** the lines under the question: what will happen, and what the person should know first */
  lines: Array<{ tone: 'ok' | 'warn' | 'muted'; text: string }>;
}

const shortTitle = (title: string | undefined, max = 80): string => {
  const t = (title ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The question before a meeting starts. */
export function startPlan(m: MeetingLike): RunPlan {
  return {
    title: 'Start this meeting?',
    confirmLabel: 'Start meeting',
    tone: 'default',
    lines: [
      { tone: 'ok', text: `“${shortTitle(m.title)}” becomes In progress.` },
      { tone: 'muted', text: 'You can then take the roll call and record what was decided on each agenda item.' },
    ],
  };
}

/** The question before a meeting ends: what is complete and what is not, said before it is too late to say it. `roll` is null while it could not be read (no claim is made). */
export function endPlan({ meeting, roll, openItems, hasMinutes }: {
  meeting: MeetingLike;
  roll: Pick<Roll, 'quorum_required' | 'quorum_present' | 'quorum_met' | 'recorded'> | null;
  /** agenda items nobody decided (no outcome, still pending) */
  openItems: number;
  hasMinutes: boolean;
}): RunPlan {
  const never = meeting.status === 'scheduled';
  const lines: RunPlan['lines'] = [
    { tone: 'ok', text: never ? `“${shortTitle(meeting.title)}” was never started: ending it records it as held.` : `“${shortTitle(meeting.title)}” becomes Completed.` },
  ];
  let caution = false;
  if (roll) {
    const q = rollQuorum(roll);
    if (!roll.recorded) {
      lines.push({ tone: 'warn', text: 'No roll was recorded. Attendance and quorum stay empty, which counts against the Governance quorum measure until the roll is taken. You can still record it after the meeting ends.' });
      caution = true;
    } else if (q.label === 'Quorum met') lines.push({ tone: 'ok', text: `Quorum met: ${q.text}.` });
    else if (q.label === 'Quorum not met') { lines.push({ tone: 'warn', text: `Quorum not met: ${q.text}.` }); caution = true; }
    else lines.push({ tone: 'muted', text: `${q.text}. No quorum was set for this meeting.` });
  }
  if (openItems > 0) lines.push({ tone: 'warn', text: `${formatCount(openItems)} agenda ${openItems === 1 ? 'item has' : 'items have'} no outcome yet. You can still record them after the meeting ends.` });
  lines.push(hasMinutes ? { tone: 'ok', text: 'Minutes are drafted.' } : { tone: 'muted', text: 'No minutes yet: draft them after the meeting ends.' });
  return { title: 'End this meeting?', confirmLabel: caution ? 'End anyway' : 'End meeting', tone: caution ? 'danger' : 'default', lines };
}

// ── the agenda ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface AgendaLike { id: number; item_number: number; status: string; outcome?: string | null }

/** The item the meeting is on: the first one nobody has decided, while the meeting runs. null when none is left (or the meeting is not running). */
export function currentItem<T extends AgendaLike>(items: readonly T[], meetingStatus: string): T | null {
  if (meetingStatus !== 'in_progress') return null;
  const open = items.filter((it) => !it.outcome && it.status === 'pending').sort((a, b) => a.item_number - b.item_number || a.id - b.id);
  return open[0] ?? null;
}

/** Agenda items with no outcome and still pending. */
export const undecidedItems = (items: readonly AgendaLike[]): number => items.filter((it) => !it.outcome && it.status === 'pending').length;

export const OUTCOMES = ['Approved', 'Rejected', 'Deferred', 'Noted'] as const;
export type Outcome = typeof OUTCOMES[number];
export const DEFAULT_OUTCOME: Outcome = 'Approved';
/** The server's limit on the text of a decision. */
export const DECISION_MAX = 10_000;

/** An outcome the server would accept, in its own spelling; null for anything else (an item decided through the raw API with another word). */
export function outcomeWord(value: string | null | undefined): Outcome | null {
  const word = (value ?? '').trim().toLowerCase();
  return OUTCOMES.find((o) => o.toLowerCase() === word) ?? null;
}

/** The body of PUT .../agenda/{id}/outcome: the word, and the decision text trimmed (empty clears it, as the server reads it). */
export function outcomeBody(outcome: Outcome, decision: string): { outcome: Outcome; decision_made: string | null } {
  return { outcome, decision_made: decision.trim() || null };
}

/** Whether the screen offers to record or correct an outcome: while the meeting runs, or after it ended (a correction, audited), and not once the minutes are approved
 *  (the server does not lock; nothing on these screens can approve minutes, so this only holds back a meeting whose minutes were approved elsewhere). */
export function canRecordOutcome(meetingStatus: string | null | undefined, minutesStatus: string | null | undefined): boolean {
  return (meetingStatus === 'in_progress' || meetingStatus === 'completed') && minutesStatus !== 'approved';
}

/** A short line for the roll's heading while it is on screen: "4 present, 1 late, 2 absent" (the words of a roll nobody took are left out). */
export function rollLine(count: RollCount): string {
  const parts = [`${formatCount(count.present)} present`];
  if (count.late > 0) parts.push(`${formatCount(count.late)} late`);
  if (count.absent > 0) parts.push(`${formatCount(count.absent)} absent`);
  if (count.notMarked > 0) parts.push(`${formatCount(count.notMarked)} not marked`);
  return parts.join(', ');
}

/** "12 Nov 2026, 10:00" for the meeting's own time (naive UTC read as the viewer's clock). */
export const meetingTime = (value: DateInput): string => formatDateTime(value);
