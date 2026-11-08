// The words and rules of Issue & Incident Management that every issue screen shares, apart from React so `node --test` pins them (words.test.ts): the states in the order
// of the life cycle, ONE definition of "open" (new, triage, in progress, resolution, closure review: the rule by-source, BCM and auto-create already use), the guided next
// steps (the server's ALLOWED_TRANSITIONS without the unguarded "closed"), what is late, the options of every select and the sentence for each. The tones and labels of the words
// themselves are lib/statuses/issues.ts. A word nobody listed reads as itself with a readable label, never as a guess.
import { statusLabel } from '../format.ts';
import { parseUtc } from '../serverTime.ts';
import { actionStatus, actionType, issueCategory, issueSeverity, issueSource, issueState, issueType } from '../statuses/issues.ts';

type Registry = { words: readonly string[]; label: (w: string) => string };
const optionsOf = (registry: Registry, only?: readonly string[]): Array<{ value: string; label: string }> =>
  (only ?? registry.words).map((value) => ({ value, label: registry.label(value) }));

// ── issues: states, open, late ──
/** The life cycle of an issue, in order. */
export const ISSUE_STATES = ['new', 'triage', 'in_progress', 'resolution', 'closure_review', 'closed', 'cancelled'] as const;
/** ONE definition of "open": an issue that is not closed or cancelled. Closure review is open (somebody still has to approve it) and has its own count, "Awaiting closure". */
export const OPEN_STATES = ['new', 'triage', 'in_progress', 'resolution', 'closure_review'] as const;
export const TERMINAL_STATES = ['closed', 'cancelled'] as const;
/** An issue the server wrote without a state is a new one (the serializer says the same). */
export const stateOf = (workflowState?: string | null): string => workflowState || 'new';
export const isOpenIssue = (workflowState?: string | null): boolean => (OPEN_STATES as readonly string[]).includes(stateOf(workflowState));
export const isAwaitingClosure = (workflowState?: string | null): boolean => stateOf(workflowState) === 'closure_review';

export const ISSUE_SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'] as const;
/** worst first; a word nobody listed goes last */
export const SEVERITY_RANK: Readonly<Record<string, number>> = { critical: 0, high: 1, medium: 2, low: 3, informational: 4 };
export const severityRank = (s?: string | null): number => SEVERITY_RANK[String(s ?? '').toLowerCase()] ?? 9;
/** "Critical or high" is what the scorecard and the attention list count; the open "critical" alone is a smaller number, so a screen that shows one says which. */
export const isSerious = (s?: string | null): boolean => severityRank(s) <= 1;

export const ISSUE_TYPE_OPTIONS = optionsOf(issueType);
export const ISSUE_CATEGORY_OPTIONS = optionsOf(issueCategory);
export const SEVERITY_OPTIONS = optionsOf(issueSeverity);
export const STATE_OPTIONS = optionsOf(issueState);
/** Impact and urgency are the matrix's two inputs: three levels. */
export const LEVELS = ['high', 'medium', 'low'] as const;
export const LEVEL_OPTIONS = LEVELS.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));

/** "Vulnerability", "Raised by hand", "Continuity finding": the place an issue came from. No source is a hand-raised issue (the server writes "manual"). */
export const sourceWord = (sourceType?: string | null): string => issueSource.label(sourceType || 'manual');

// ── lateness ──
const DAY = 86_400_000;
/** Whole days a date is behind `now` (1 or more), or null when it is not behind or there is no date. Times from the server are naive UTC. */
export function daysLate(iso: string | null | undefined, now: Date = new Date()): number | null {
  const at = parseUtc(iso);
  if (!at) return null;
  const days = Math.floor((now.getTime() - at.getTime()) / DAY);
  return at.getTime() < now.getTime() ? Math.max(1, days) : null;
}
/** An issue is late when its target date has passed and it is not closed or cancelled: the rule the workflow's SLA trigger uses, read when it is asked for (nothing stores it). */
export const isIssueLate = (workflowState: string | null | undefined, target: string | null | undefined, now: Date = new Date()): boolean =>
  !!target && !(TERMINAL_STATES as readonly string[]).includes(stateOf(workflowState)) && daysLate(target, now) !== null;
export const lateWord = (days: number): string => `${days} ${days === 1 ? 'day' : 'days'} late`;

// ── the guided steps ──
/** One thing a person can do to an issue's state. `close` asks for the closure notes (POST /close) and `reopen` for the reason (POST /reopen); a `move` is POST /transition. */
export interface IssueStep {
  key: string;
  to: string;
  label: string;
  kind: 'move' | 'close' | 'reopen';
  /** the step the issue is expected to take next: at most one per state */
  primary?: boolean;
  danger?: boolean;
}
/** The server's ALLOWED_TRANSITIONS (routers/issues.py) with the verb for each. "closed" is not a plain move: closing needs the notes, so it is the `close` step. */
const STEPS: Record<string, IssueStep[]> = {
  new: [
    { key: 'triage', to: 'triage', label: 'Start triage', kind: 'move', primary: true },
    { key: 'work', to: 'in_progress', label: 'Start work', kind: 'move' },
    { key: 'cancel', to: 'cancelled', label: 'Cancel issue', kind: 'move', danger: true },
  ],
  triage: [
    { key: 'work', to: 'in_progress', label: 'Start work', kind: 'move', primary: true },
    { key: 'cancel', to: 'cancelled', label: 'Cancel issue', kind: 'move', danger: true },
  ],
  in_progress: [
    { key: 'resolution', to: 'resolution', label: 'Move to resolution', kind: 'move', primary: true },
    { key: 'review', to: 'closure_review', label: 'Send for closure review', kind: 'move' },
    { key: 'cancel', to: 'cancelled', label: 'Cancel issue', kind: 'move', danger: true },
  ],
  resolution: [
    { key: 'review', to: 'closure_review', label: 'Send for closure review', kind: 'move', primary: true },
    { key: 'back', to: 'in_progress', label: 'Back to in progress', kind: 'move' },
    { key: 'cancel', to: 'cancelled', label: 'Cancel issue', kind: 'move', danger: true },
  ],
  closure_review: [
    { key: 'approve', to: 'closed', label: 'Approve closure', kind: 'close', primary: true },
    { key: 'back', to: 'in_progress', label: 'Send back to work', kind: 'move' },
  ],
  closed: [{ key: 'reopen', to: 'in_progress', label: 'Reopen', kind: 'reopen' }],
  cancelled: [{ key: 'restore', to: 'new', label: 'Reopen as new', kind: 'move' }],
};
/** The steps open to an issue in this state, the expected one first. */
export const stepsFrom = (workflowState?: string | null): IssueStep[] => (STEPS[stateOf(workflowState)] ?? []).slice();
/** The states every step leads to, for the test that pins this table to the server's. */
export const stepTargets = (): Record<string, string[]> => Object.fromEntries(Object.keys(STEPS).map((s) => [s, STEPS[s].map((x) => x.to)]));

// ── corrective actions ──
export const ACTION_STATUSES = ['planned', 'in_progress', 'blocked', 'completed', 'verified', 'cancelled'] as const;
/** Work still to do: the scorecard's open actions. */
export const OPEN_ACTION_STATUSES = ['planned', 'in_progress', 'blocked'] as const;
export const DONE_ACTION_STATUSES = ['completed', 'verified'] as const;
export const ACTION_TYPES = ['corrective', 'preventive', 'containment', 'verification'] as const;
export const isOpenAction = (status?: string | null): boolean => (OPEN_ACTION_STATUSES as readonly string[]).includes(status || 'planned');
/** Done and waiting for somebody to confirm it worked. */
export const awaitsVerification = (status?: string | null): boolean => status === 'completed';
/** An action is late when it is still open and its due date has passed (the scorecard's "overdue" action). */
export const isActionLate = (status: string | null | undefined, due: string | null | undefined, now: Date = new Date()): boolean => isOpenAction(status) && !!due && daysLate(due, now) !== null;
/** One thing a person can do to a corrective action's status. `verify` is POST /verify (it stamps who confirmed it worked); the rest are a PATCH of the status. */
export interface ActionStep { key: string; to: string; label: string; kind: 'patch' | 'verify'; primary?: boolean; danger?: boolean }
const ACTION_STEPS: Record<string, ActionStep[]> = {
  planned: [
    { key: 'start', to: 'in_progress', label: 'Start work', kind: 'patch', primary: true },
    { key: 'block', to: 'blocked', label: 'Mark blocked', kind: 'patch' },
    { key: 'complete', to: 'completed', label: 'Mark completed', kind: 'patch' },
    { key: 'cancel', to: 'cancelled', label: 'Cancel action', kind: 'patch', danger: true },
  ],
  in_progress: [
    { key: 'complete', to: 'completed', label: 'Mark completed', kind: 'patch', primary: true },
    { key: 'block', to: 'blocked', label: 'Mark blocked', kind: 'patch' },
    { key: 'back', to: 'planned', label: 'Back to planned', kind: 'patch' },
    { key: 'cancel', to: 'cancelled', label: 'Cancel action', kind: 'patch', danger: true },
  ],
  blocked: [
    { key: 'resume', to: 'in_progress', label: 'Resume work', kind: 'patch', primary: true },
    { key: 'complete', to: 'completed', label: 'Mark completed', kind: 'patch' },
    { key: 'cancel', to: 'cancelled', label: 'Cancel action', kind: 'patch', danger: true },
  ],
  completed: [
    { key: 'verify', to: 'verified', label: 'Verify it worked', kind: 'verify', primary: true },
    { key: 'reopen', to: 'in_progress', label: 'Reopen work', kind: 'patch' },
  ],
  verified: [{ key: 'reopen', to: 'in_progress', label: 'Reopen work', kind: 'patch' }],
  cancelled: [{ key: 'restore', to: 'planned', label: 'Restore', kind: 'patch' }],
};
/** The steps open to an action in this status (a status nobody listed is a planned one), the expected one first. */
export const actionStepsFrom = (status?: string | null): ActionStep[] => (ACTION_STEPS[status || 'planned'] ?? []).slice();
export const ACTION_STATUS_OPTIONS = optionsOf(actionStatus);
export const ACTION_TYPE_OPTIONS = optionsOf(actionType);

// ── "issues linked to a record" ──
/** What the register's `linked=risk:7` can name: the records an issue links to (by-source's table, and a task). The word is what the chip says. */
export const LINKED_KINDS: Readonly<Record<string, string>> = {
  risk: 'this risk',
  vulnerability: 'this vulnerability',
  asset: 'this asset',
  evidence: 'this evidence',
  vendor: 'this vendor',
  is_project: 'this IS project',
  governance_document: 'this document',
  policy_statement: 'this policy statement',
  control_internal: 'this control',
  control_framework: 'this control',
  control_parsed: 'this control',
  control_normalized: 'this control',
  task: 'this task',
};
export interface LinkedRecord { type: string; id: number }
/** `risk:7` -> { type: 'risk', id: 7 }; anything else (an unknown kind, a bad number) is no filter. */
export function parseLinked(value: string | null | undefined): LinkedRecord | null {
  const m = /^([a-z_]+):(\d{1,9})$/.exec(String(value ?? '').trim());
  if (!m || !Object.prototype.hasOwnProperty.call(LINKED_KINDS, m[1]) || Number(m[2]) < 1) return null;
  return { type: m[1], id: Number(m[2]) };
}
export const linkedValue = (r: LinkedRecord): string => `${r.type}:${r.id}`;

// ── the activity feed, in a line ──
const EVENT_WORDS: Record<string, string> = {
  created: 'Raised the issue',
  auto_created: 'Raised automatically',
  updated: 'Edited the details',
  severity_change: 'Changed the severity',
  status_change: 'Moved the issue',
  approved: 'Approved the closure',
  reopened: 'Reopened the issue',
  cancelled: 'Cancelled the issue',
  commented: 'Added a comment',
  action_added: 'Added a corrective action',
  action_updated: 'Edited a corrective action',
  action_status_changed: 'Moved a corrective action',
  action_completed: 'Completed a corrective action',
  action_verified: 'Verified a corrective action',
  action_deleted: 'Deleted a corrective action',
  action_promoted_to_task: 'Sent an action to Task Management',
  linked: 'Linked a record',
  linked_on_create: 'Linked records when it was raised',
  unlinked: 'Unlinked a record',
  register_created: 'Added to the audit register',
  register_edit: 'Edited the register columns',
  register_deleted: 'Deleted from the register',
  register_restored: 'Restored to the register',
  validation_submitted: 'Submitted for validation',
  validation_decision: 'Recorded the validation decision',
  extension_requested: 'Requested an extension',
  extension_decided: 'The Audit Committee decided the extension',
  extension_regulator_notified: 'Recorded that the regulator was told',
  regulator_status: 'Changed the regulator status',
};
/** What an activity row says in one line: "Moved to Closure review", "Approved the closure". A type nobody listed reads as itself, in words. */
export function eventLine(type: string, payload?: Record<string, unknown> | null): string {
  if (type === 'status_change' && payload && typeof payload.to === 'string') return `Moved to ${issueState.label(payload.to)}`;
  return EVENT_WORDS[type] ?? statusLabel(type);
}
