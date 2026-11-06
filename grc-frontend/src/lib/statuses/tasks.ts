// The status words of Task Management (`app/(dashboard)/tasks`, `my-work`), one registry per kind of word, on the same tone model as lib/status.ts (kept in a file
// of its own so the Tasks pass and the Governance registries never touch the same lines). The words are the ones the server writes into `grc_critical_tasks`
// (routers/critical_tasks_router.py: VALID_TRANSITIONS, _calc_sla_status, the approval routes); statuses/tasks.test.ts re-reads that file, so a word the server starts
// writing fails a test until it is registered here. A word nobody registered (a task a module wrote with its own word, e.g. "planned") is neutral with its own readable
// label, never a guess; status and priority are always words, never a colour alone.
// Tones: pending = waiting for someone, progress = moving, success = done, warning = needs a look, danger = late, breached or refused, neutral = at rest.
// REVIEWER TO CONFIRM: In Progress was amber and Under Review teal before the kit; here moving work is blue and work waiting for a reviewer is purple, as in Governance.
import { defineStatuses } from '../status.ts';

/** CriticalTask.status: the six words of the workflow (VALID_TRANSITIONS in the router). */
export const taskStatus = defineStatuses('task', {
  open: 'neutral',
  in_progress: 'progress',
  under_review: 'pending',
  completed: 'success',
  verified: 'success',
  reopened: 'warning',
});

/** CriticalTask.priority: Critical, High, Medium, Low (the form's list; the scale is the Governance one: critical danger, high amber, medium blue, low neutral). */
export const taskPriority = defineStatuses('task priority', {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'neutral',
});

/** `sla_status` of a task, worked out by the server (_calc_sla_status): Completed once the task is, No SLA without a due date, else Breached (due moment passed),
 *  At Risk (within 3 days) or On Track. */
export const taskSla = defineStatuses('task SLA', {
  on_track: 'success',
  at_risk: 'warning',
  breached: 'danger',
  completed: 'neutral',
  no_sla: { tone: 'neutral', label: 'No SLA' },
});

/** `approval_status` of a task that needs approval: Pending, Approved, Rejected, or nothing yet ("Not requested": the page's own word for null). */
export const taskApproval = defineStatuses('task approval', {
  not_requested: 'neutral',
  pending: 'pending',
  approved: 'success',
  rejected: 'danger',
});

/** A sub-task's status: the page writes Open and Completed; the server stores whatever word it is given. */
export const subTaskStatus = defineStatuses('sub-task', {
  open: 'neutral',
  in_progress: 'progress',
  completed: 'success',
});

/** The SLA levels of the SLA page (tasks/slaConfig.ts): the four priorities and Informational. */
export const slaLevel = defineStatuses('task SLA level', {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'neutral',
  info: { tone: 'neutral', label: 'Informational' },
});

/** What a task's `sla_status` or any other word of these registries reads as in one place: `statusPill(taskSla, word)` from lib/status.ts gives the pill's props. */
export const TASK_REGISTRIES = { taskStatus, taskPriority, taskSla, taskApproval, subTaskStatus, slaLevel } as const;
