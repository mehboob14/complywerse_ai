// The task as a RECORD, apart from React so `node --test` pins it (taskRecord.test.ts): what kind of task a row is (a plain task, a document request, a committee action ...), when it is due
// in words the pages share, who is on it, what the next step for a person is, and where the task came from. Every Task Management screen reads these (the All tasks register, the My work
// cockpit, the task page, the Insights drill-through), so "overdue", "mine" and "next step" mean ONE thing everywhere. Nothing here decides who may do what: the server does. Where a rule
// copies the server's (the SLA state, the approval gate, who may approve) the copy says so and a test re-reads the router.
import { isDocumentTask, type DocumentRequest } from '../../../lib/documentTasks.ts';
import { norm } from '../../../lib/status.ts';
import { parseUtc } from '../../../lib/serverTime.ts';

// ── the row ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TaskPerson { id: number; display_name?: string | null; username?: string | null; email?: string | null }

/** A record a task is linked to, with its title (the server resolves it: GET /critical-tasks?lean=1 and GET /critical-tasks/{id}). `href` is null when the record has no page of its own. */
export interface LinkedRecord { kind: 'risk' | 'control' | 'vulnerability' | 'framework' | 'requirement' | 'issue'; id: number; title: string | null; href: string | null }

/** A task as the register reads it: the fields of `GET /critical-tasks?lean=1` (a row of the full list has all of them except the three counts and the labels, which are optional here). */
export interface RegisterTask {
  id: number;
  title: string;
  source: string;
  source_module: string | null;
  source_entity_type: string | null;
  priority: string;
  severity?: string | null;
  status: string;
  category: string;
  assigned_owner_id: number | null;
  assigned_owner: TaskPerson | null;
  /** everyone on the task (the owner is the first) */
  assignees?: TaskPerson[];
  assigned_user_ids?: number[];
  reviewer_id: number | null;
  reviewer: TaskPerson | null;
  created_by_id: number | null;
  created_by: TaskPerson | null;
  due_date: string | null;
  sla_days?: number | null;
  /** worked out by the server: Completed, No SLA, Breached, At Risk, On Track */
  sla_status: string;
  escalation_level?: number;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  approval_required?: boolean;
  /** Pending, Approved, Rejected or null */
  approval_status?: string | null;
  recurrence_pattern?: string | null;
  recurrence_interval?: number | null;
  parent_task_id?: number | null;
  linked_regulatory_change_id?: number | null;
  document_request?: DocumentRequest | null;
  /** the sub-tasks and comments of the task (true counts) */
  sub_task_total?: number;
  sub_task_done?: number;
  comment_count?: number;
  /** where the task came from, in words, and the page it opens ("Vendor finding", "/vendor-risk/vendors/3"); null for a task made by hand */
  source_label?: string | null;
  source_href?: string | null;
  links?: LinkedRecord[];
}

// ── kind ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const KINDS = ['task', 'document', 'committee', 'regulatory', 'vendor', 'issue', 'workflow'] as const;
export type TaskKind = (typeof KINDS)[number];
export const KIND_LABEL: Record<TaskKind, string> = {
  task: 'Task', document: 'Document request', committee: 'Committee action', regulatory: 'Regulatory task', vendor: 'Vendor', issue: 'Issue action', workflow: 'Workflow',
};

/** `source_module` as the modules write it (backend: doc_lifecycle.py, committee_tasks.py, regulatory_tasks.py, tpra/findings.py + service.py, issue_management/routers/actions.py,
 *  workflow_engine/services/action_handlers.py); taskRecord.test.ts re-reads those files, so a module that starts writing its own word fails a test until it is listed here. */
export const MODULE_KIND: Readonly<Record<string, TaskKind>> = {
  document_lifecycle: 'document',
  committees: 'committee',
  regulatory_changes: 'regulatory',
  vendor_risk: 'vendor',
  issue_management: 'issue',
  workflow_engine: 'workflow',
};

type KindFields = Pick<RegisterTask, 'source_module' | 'source_entity_type' | 'document_request'> & { linked_regulatory_change_id?: number | null };

/** What kind of task this is. A task made by hand, and one whose module wrote a word nobody listed, is a plain task; a document word with no request behind it is a plain task too
 *  (the server treats it as one: lib/documentTasks.isDocumentTask). */
export function kindOf(t: KindFields): TaskKind {
  if (isDocumentTask(t)) return 'document';
  const kind = t.source_module ? MODULE_KIND[t.source_module] : undefined;
  if (kind && kind !== 'document') return kind;
  return t.linked_regulatory_change_id ? 'regulatory' : 'task';
}

// ── done, due ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const isDoneStatus = (status: string | null | undefined): boolean => norm(status) === 'completed' || norm(status) === 'verified';

export type DueBucket = 'overdue' | 'today' | 'week' | 'month' | 'later' | 'none' | 'done';
export const DUE_BUCKETS: readonly DueBucket[] = ['overdue', 'today', 'week', 'month', 'later', 'none', 'done'];
export const DUE_LABEL: Record<DueBucket, string> = { overdue: 'Overdue', today: 'Due today', week: 'Due in 7 days', month: 'Due in 30 days', later: 'Due later', none: 'No due date', done: 'Done' };

const DAY = 86_400_000;

/** The due moment as the server holds it (naive UTC; a date with no time is midnight UTC), or null. */
export function dueMoment(due: string | null | undefined): Date | null {
  return parseUtc(due);
}

/** Whole days from `now` to the due moment, rounded DOWN as the server's `(due - now).days` is: negative once the moment has passed (-1 is "less than a day late", -3 "three days late"). */
export function dueDays(t: Pick<RegisterTask, 'due_date'>, now: Date): number | null {
  const due = dueMoment(t.due_date);
  return due ? Math.floor((due.getTime() - now.getTime()) / DAY) : null;
}

/**
 * Where a task stands against its due date. OVERDUE is exactly the server's Breached (`_calc_sla_status`: the due moment has passed and the task is not done), so every count of
 * "overdue" on every page agrees with My Tasks and the Reports. A task due today with a time later than now is "today"; a date with no time is midnight UTC, so it is overdue from the
 * first moment of its day (the server's rule, recorded as a finding for the owner, not changed here).
 */
export function dueBucket(t: Pick<RegisterTask, 'due_date' | 'status'>, now: Date): DueBucket {
  if (isDoneStatus(t.status)) return 'done';
  const due = dueMoment(t.due_date);
  if (!due) return 'none';
  const ms = due.getTime() - now.getTime();
  if (ms < 0) return 'overdue';
  if (due.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return 'today';
  if (ms <= 7 * DAY) return 'week';
  if (ms <= 30 * DAY) return 'month';
  return 'later';
}

/** Overdue: not done and past due. Equal to the server's `sla_status === 'Breached'` for a task read a moment ago (see the test that holds the two together). */
export const isOverdue = (t: Pick<RegisterTask, 'due_date' | 'status'>, now: Date): boolean => dueBucket(t, now) === 'overdue';

// ── people ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Everyone on the task, the owner first: the ids the Owner facet and "Mine" read (the server's own owner filter looks at the first owner only). An older answer without the list has the owner alone. */
export function peopleOf(t: Pick<RegisterTask, 'assigned_owner_id' | 'assigned_user_ids' | 'assignees'>): number[] {
  const ids: number[] = [];
  const add = (id: number | null | undefined) => { if (typeof id === 'number' && id > 0 && ids.indexOf(id) < 0) ids.push(id); };
  add(t.assigned_owner_id);
  (t.assigned_user_ids ?? (t.assignees ?? []).map((a) => a.id)).forEach(add);
  return ids;
}

/** The task is the person's own: they are on it, review it, or made it (the board's "mine" scope, which also holds tasks you created). */
export const isMine = (t: Pick<RegisterTask, 'assigned_owner_id' | 'assigned_user_ids' | 'assignees' | 'reviewer_id' | 'created_by_id'>, me: number | null): boolean =>
  me != null && (peopleOf(t).indexOf(me) >= 0 || t.reviewer_id === me || t.created_by_id === me);

/** The task is the person's to DO: they are on it (My Tasks' rule is on it or reviewing it). */
export const isAssignedTo = (t: Pick<RegisterTask, 'assigned_owner_id' | 'assigned_user_ids' | 'assignees'>, me: number | null): boolean => me != null && peopleOf(t).indexOf(me) >= 0;

// ── the next step ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type StepId = 'start' | 'review' | 'complete' | 'verify' | 'request_approval' | 'approve';
export interface NextStep {
  id: StepId;
  /** the button's words */
  label: string;
  /** the status the step moves the task to (a transition); absent for an approval */
  to?: string;
}

/** Whether moving to `to` needs an approval that is not given: the server refuses Under Review -> Completed and Completed -> Verified on a task that needs approval until it is Approved. */
export function approvalGate(t: Pick<RegisterTask, 'status' | 'approval_required' | 'approval_status'>, to: string): boolean {
  const from = norm(t.status);
  const gated = (from === 'under_review' && norm(to) === 'completed') || (from === 'completed' && norm(to) === 'verified');
  return gated && !!t.approval_required && t.approval_status !== 'Approved';
}

/** Whether the server lets this person approve or refuse: the task's reviewer, and never its owner (`approve_task` / `reject_task` also test an `is_admin` attribute no user has, so an
 *  administrator who is not the reviewer is refused today: recorded for the owner, the screen follows the server). */
export const mayDecide = (t: Pick<RegisterTask, 'reviewer_id' | 'assigned_owner_id'>, me: number | null): boolean => me != null && t.reviewer_id === me && t.assigned_owner_id !== me;

/**
 * The one thing this person does next on the task, from the fields the row carries (the workflow's one-step map): Start, Send for review, Complete, Verify; when the step needs an approval
 * that is not given: Request approval for the people on the task, Approve for the reviewer while it is Pending. A document request has none (its own link is its step); a finished
 * or unknown status has none. `null` is "nothing for you to press": see `waitingFor` for why.
 */
export function nextStep(t: Pick<RegisterTask, 'status' | 'approval_required' | 'approval_status' | 'reviewer_id' | 'assigned_owner_id' | 'source_module' | 'source_entity_type' | 'document_request'>, me: number | null): NextStep | null {
  if (isDocumentTask(t)) return null;
  const status = norm(t.status);
  const approval = (to: string): NextStep | null => {
    if (t.approval_status === 'Pending') return mayDecide(t, me) ? { id: 'approve', label: 'Approve' } : null;
    return { id: 'request_approval', label: t.approval_status === 'Rejected' ? 'Request approval again' : 'Request approval', to };
  };
  if (status === 'open' || status === 'reopened') return { id: 'start', label: 'Start', to: 'In Progress' };
  if (status === 'in_progress') return { id: 'review', label: 'Send for review', to: 'Under Review' };
  if (status === 'under_review') return approvalGate(t, 'Completed') ? approval('Completed') : { id: 'complete', label: 'Complete', to: 'Completed' };
  if (status === 'completed') return approvalGate(t, 'Verified') ? approval('Verified') : { id: 'verify', label: 'Verify', to: 'Verified' };
  return null;
}

/** Why a task that needs a step has no button for this person, in words, or null: "Waiting for approval", "Needs a reviewer to approve". */
export function waitingFor(t: Pick<RegisterTask, 'status' | 'approval_required' | 'approval_status' | 'reviewer_id' | 'assigned_owner_id' | 'source_module' | 'source_entity_type' | 'document_request'>, me: number | null): string | null {
  if (isDocumentTask(t) || nextStep(t, me)) return null;
  const status = norm(t.status);
  const gate = (status === 'under_review' && approvalGate(t, 'Completed')) || (status === 'completed' && approvalGate(t, 'Verified'));
  if (gate && t.approval_status === 'Pending') return t.reviewer_id ? 'Waiting for the reviewer to approve' : 'Waiting for approval, and no reviewer is set';
  return null;
}

// ── where it came from ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface SourceLink { label: string; href: string | null }

/** Where the task came from: the server's label and page when it sends them; else what the row itself says (a regulatory change links to it, a document request to its document). A task
 *  made by hand has none. */
export function sourceLink(t: Pick<RegisterTask, 'source_module' | 'source_entity_type' | 'document_request' | 'linked_regulatory_change_id' | 'source_label' | 'source_href'>): SourceLink | null {
  if (t.source_label) return { label: t.source_label, href: t.source_href ?? null };
  const kind = kindOf(t);
  if (kind === 'task') return null;
  if (kind === 'regulatory' && t.linked_regulatory_change_id) return { label: KIND_LABEL.regulatory, href: `/governance/regulatory-changes/${t.linked_regulatory_change_id}?tab=tasks` };
  if (kind === 'document') return { label: KIND_LABEL.document, href: t.document_request?.open_href ?? null };
  return { label: KIND_LABEL[kind], href: null };
}
