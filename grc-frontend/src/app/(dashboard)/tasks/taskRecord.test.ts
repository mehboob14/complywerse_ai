// node --test "src/app/(dashboard)/tasks/taskRecord.test.ts"
// The task as a record (taskRecord.ts): the kind of a task from what the modules write, "overdue" held to the server's Breached on many due moments, who is on a task, the next step for a
// person (including the approval gate and who the server lets approve), and where a task came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  DUE_BUCKETS, KINDS, KIND_LABEL, MODULE_KIND, approvalGate, dueBucket, dueDays, dueWords, isAssignedTo, isDoneStatus, isMine, isMyWork, isOverdue, kindOf, mayDecide, nextStep, peopleOf, sourceLink, waitingFor,
  type RegisterTask,
} from './taskRecord.ts';

const BACKEND = new URL('../../../../../backend/grc/', import.meta.url);
const have = existsSync(new URL('routers/critical_tasks_router.py', BACKEND));
const read = (rel: string) => readFileSync(new URL(rel, BACKEND), 'utf8');

const NOW = new Date('2026-11-10T09:30:00Z');

function task(patch: Partial<RegisterTask> = {}): RegisterTask {
  return {
    id: 1, title: 'T', source: 'Manual', source_module: null, source_entity_type: null, priority: 'High', status: 'Open', category: 'Other',
    assigned_owner_id: 5, assigned_owner: null, reviewer_id: 8, reviewer: null, created_by_id: 2, created_by: null,
    due_date: null, sla_status: 'No SLA', completed_at: null, created_at: null, updated_at: null, ...patch,
  };
}

// ── kind ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('kindOf: a task made by hand is a task; each module that writes tasks has its kind; a document word with no request behind it is a plain task', () => {
  assert.equal(kindOf(task()), 'task');
  assert.equal(kindOf(task({ source_module: 'committees', source_entity_type: 'OversightAction' })), 'committee');
  assert.equal(kindOf(task({ source_module: 'regulatory_changes' })), 'regulatory');
  assert.equal(kindOf(task({ linked_regulatory_change_id: 4 })), 'regulatory');
  assert.equal(kindOf(task({ source_module: 'vendor_risk' })), 'vendor');
  assert.equal(kindOf(task({ source_module: 'issue_management' })), 'issue');
  assert.equal(kindOf(task({ source_module: 'workflow_engine' })), 'workflow');
  assert.equal(kindOf(task({ source_module: 'criticality_assessment' })), 'task', 'a word nobody listed is a plain task');
  const request = { request_id: 1, kind: 'review', document_id: 3, open_href: '/governance/documents/3' } as never;
  assert.equal(kindOf(task({ source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation', document_request: request })), 'document');
  assert.equal(kindOf(task({ source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation', document_request: null })), 'task');
  assert.deepEqual(Object.keys(KIND_LABEL), Array.from(KINDS));
});

test('the modules\' source_module words are the ones the backend writes', { skip: !have }, () => {
  const word = (file: string, name: string): string => {
    const m = new RegExp(`${name}\\s*=\\s*"([a-z_]+)"`).exec(read(file));
    assert.ok(m, `${name} in ${file}`);
    return m[1];
  };
  assert.equal(MODULE_KIND[word('modules/governance/doc_lifecycle.py', 'SOURCE_MODULE')], 'document');
  assert.equal(MODULE_KIND[word('modules/governance/committee_tasks.py', 'SOURCE_MODULE')], 'committee');
  assert.equal(MODULE_KIND[word('modules/governance/regulatory_tasks.py', 'SOURCE_MODULE')], 'regulatory');
  assert.match(read('modules/vendor_risk/tpra/findings.py'), /TWIN_SOURCE, TWIN_MODULE, TWIN_TYPE = "Vendor Finding", "vendor_risk"/);
  assert.equal(MODULE_KIND.vendor_risk, 'vendor');
  assert.match(read('modules/issue_management/routers/actions.py'), /source_module="issue_management"/);
  assert.equal(MODULE_KIND.issue_management, 'issue');
  assert.match(read('modules/workflow_engine/services/action_handlers.py'), /source_module="workflow_engine"/);
  assert.equal(MODULE_KIND.workflow_engine, 'workflow');
});

// ── due ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** the server's `_calc_sla_status` (routers/critical_tasks_router.py), copied: Breached is `(due - now).days < 0`, where Python's `days` rounds a negative timedelta DOWN */
function serverSla(status: string, due: string | null, now: Date): string {
  if (status === 'Completed' || status === 'Verified') return 'Completed';
  if (!due) return 'No SLA';
  const ms = Date.parse(`${due}Z`) - now.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 0) return 'Breached';
  return days <= 3 ? 'At Risk' : 'On Track';
}

test('overdue is exactly the server\'s Breached, on moments either side of now, date-only values and every status', () => {
  const dues = [null, '2026-11-10T09:29:59', '2026-11-10T09:30:00', '2026-11-10T09:30:01', '2026-11-10T00:00:00', '2026-11-10T23:59:59', '2026-11-09T00:00:00', '2026-11-11T00:00:00',
    '2026-11-13T09:30:00', '2026-11-14T09:30:00', '2026-12-10T09:30:00', '2026-12-11T09:30:00', '2025-01-01T00:00:00', '2027-01-01T00:00:00'];
  for (const due of dues) {
    for (const status of ['Open', 'In Progress', 'Under Review', 'Completed', 'Verified', 'Reopened', 'planned']) {
      const t = { due_date: due, status };
      assert.equal(isOverdue(t, NOW), serverSla(status, due, NOW) === 'Breached', `${status} due ${due}`);
    }
  }
});

test('dueBucket: done, none, overdue, today, the next 7 days, the next 30, later', () => {
  const at = (due: string | null, status = 'Open') => dueBucket({ due_date: due, status }, NOW);
  assert.equal(at('2026-11-01T00:00:00', 'Completed'), 'done');
  assert.equal(at('2026-11-01T00:00:00', 'verified'), 'done');
  assert.equal(at(null), 'none');
  assert.equal(at('2026-11-09T12:00:00'), 'overdue');
  assert.equal(at('2026-11-10T00:00:00'), 'overdue', 'a date with no time is midnight UTC, so it is overdue from the first moment of its day (the server\'s rule)');
  assert.equal(at('2026-11-10T18:00:00'), 'today');
  assert.equal(at('2026-11-11T09:00:00'), 'week');
  assert.equal(at('2026-11-17T09:30:00'), 'week');
  assert.equal(at('2026-11-17T09:31:00'), 'month');
  assert.equal(at('2026-12-10T09:30:00'), 'month');
  assert.equal(at('2026-12-10T09:31:00'), 'later');
  assert.equal(at('2026-11-10'), 'overdue', 'a bare date');
  assert.deepEqual(Array.from(DUE_BUCKETS).sort(), ['done', 'later', 'month', 'none', 'overdue', 'today', 'week']);
});

test('dueDays counts whole days the way the server does: -1 is less than a day late', () => {
  assert.equal(dueDays({ due_date: null }, NOW), null);
  assert.equal(dueDays({ due_date: '2026-11-10T09:00:00' }, NOW), -1);
  assert.equal(dueDays({ due_date: '2026-11-07T09:30:00' }, NOW), -3);
  assert.equal(dueDays({ due_date: '2026-11-10T12:00:00' }, NOW), 0);
  assert.equal(dueDays({ due_date: '2026-11-13T09:30:00' }, NOW), 3);
});

test('dueWords: days late in full days, today, days to go; nothing for a done task or no date', () => {
  const w = (due: string | null, status = 'Open') => dueWords({ due_date: due, status }, NOW);
  assert.deepEqual(w('2026-11-10T09:00:00'), { text: 'Overdue', late: true }, 'less than a day late');
  assert.deepEqual(w('2026-11-09T09:00:00'), { text: '1 d overdue', late: true }, 'a day and a half late is one full day');
  assert.deepEqual(w('2026-11-09T10:00:00'), { text: 'Overdue', late: true }, 'twenty-three and a half hours late is not yet a full day');
  assert.deepEqual(w('2026-11-07T09:30:00'), { text: '2 d overdue', late: true });
  assert.deepEqual(w('2026-11-10T18:00:00'), { text: 'Due today', late: false });
  assert.deepEqual(w('2026-11-14T09:30:00'), { text: 'in 4 d', late: false });
  assert.deepEqual(w('2026-11-11T02:00:00'), { text: 'in 1 d', late: false });
  assert.equal(w(null), null);
  assert.equal(w('2026-11-01T00:00:00', 'Completed'), null);
});

test('a done status is Completed or Verified in any spelling', () => {
  for (const s of ['Completed', 'completed', 'Verified', ' VERIFIED ']) assert.equal(isDoneStatus(s), true, s);
  for (const s of ['Open', 'In Progress', 'Under Review', 'Reopened', '', null, undefined]) assert.equal(isDoneStatus(s), false, String(s));
});

// ── people ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('peopleOf: the owner first, then every other assignee, once; an older answer without the list has the owner alone', () => {
  assert.deepEqual(peopleOf(task({ assigned_owner_id: 5, assigned_user_ids: [7, 5, 9] })), [5, 7, 9]);
  assert.deepEqual(peopleOf(task({ assigned_owner_id: null, assigned_user_ids: [7, 9] })), [7, 9]);
  assert.deepEqual(peopleOf(task({ assigned_owner_id: 5, assigned_user_ids: undefined, assignees: [{ id: 5 }, { id: 6 }] })), [5, 6]);
  assert.deepEqual(peopleOf(task({ assigned_owner_id: 5 })), [5]);
  assert.deepEqual(peopleOf(task({ assigned_owner_id: null })), []);
});

test('isMine holds the tasks you are on, review or made; isAssignedTo only the first', () => {
  const t = task({ assigned_owner_id: 5, assigned_user_ids: [5, 6], reviewer_id: 8, created_by_id: 2 });
  for (const me of [5, 6, 8, 2]) assert.equal(isMine(t, me), true, String(me));
  assert.equal(isMine(t, 99), false);
  assert.equal(isMine(t, null), false);
  assert.equal(isAssignedTo(t, 6), true);
  assert.equal(isAssignedTo(t, 8), false);
  assert.equal(isAssignedTo(t, 2), false);
  // the list of work (My Tasks' rule): on it or reviewing it, not having made it
  assert.equal(isMyWork(t, 6), true);
  assert.equal(isMyWork(t, 8), true);
  assert.equal(isMyWork(t, 2), false);
  assert.equal(isMyWork(t, null), false);
});

// ── the next step ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('nextStep walks the workflow one step for a task with no approval', () => {
  const step = (status: string) => nextStep(task({ status }), 5);
  assert.deepEqual(step('Open'), { id: 'start', label: 'Start', to: 'In Progress' });
  assert.deepEqual(step('Reopened'), { id: 'start', label: 'Start', to: 'In Progress' });
  assert.deepEqual(step('In Progress'), { id: 'review', label: 'Send for review', to: 'Under Review' });
  assert.deepEqual(step('Under Review'), { id: 'complete', label: 'Complete', to: 'Completed' });
  assert.deepEqual(step('Completed'), { id: 'verify', label: 'Verify', to: 'Verified' });
  assert.equal(step('Verified'), null);
  assert.equal(step('planned'), null, 'a word the workflow does not know has no step');
});

test('nextStep with an approval: the people on the task ask, the reviewer (not the owner) approves, everyone else waits', () => {
  const review = { status: 'Under Review', approval_required: true, reviewer_id: 8, assigned_owner_id: 5 };
  assert.deepEqual(nextStep(task({ ...review, approval_status: null }), 5), { id: 'request_approval', label: 'Request approval', to: 'Completed' });
  assert.deepEqual(nextStep(task({ ...review, approval_status: 'Rejected' }), 5), { id: 'request_approval', label: 'Request approval again', to: 'Completed' });
  assert.deepEqual(nextStep(task({ ...review, approval_status: 'Pending' }), 8), { id: 'approve', label: 'Approve' });
  assert.equal(nextStep(task({ ...review, approval_status: 'Pending' }), 5), null, 'the owner waits');
  assert.equal(nextStep(task({ ...review, approval_status: 'Pending' }), 1), null, 'a person who is not the reviewer waits, an administrator included: the server refuses them today');
  assert.deepEqual(nextStep(task({ ...review, approval_status: 'Approved' }), 5), { id: 'complete', label: 'Complete', to: 'Completed' });
  // the same person owning and reviewing: the server refuses the owner, so no Approve
  assert.equal(nextStep(task({ ...review, assigned_owner_id: 8, approval_status: 'Pending' }), 8), null);
  // a completed task that needs approval is verified through a second approval
  const done = { status: 'Completed', approval_required: true, reviewer_id: 8, assigned_owner_id: 5 };
  assert.deepEqual(nextStep(task({ ...done, approval_status: null }), 5), { id: 'request_approval', label: 'Request approval', to: 'Verified' });
  assert.deepEqual(nextStep(task({ ...done, approval_status: 'Approved' }), 5), { id: 'verify', label: 'Verify', to: 'Verified' });
  // an approval that is not needed for the step is not asked for: Start and Send for review are not gated
  assert.equal(nextStep(task({ status: 'In Progress', approval_required: true, approval_status: null }), 5)?.id, 'review');
});

test('waitingFor says why a person has no button: the approval is pending', () => {
  const pending = task({ status: 'Under Review', approval_required: true, approval_status: 'Pending', reviewer_id: 8, assigned_owner_id: 5 });
  assert.equal(waitingFor(pending, 5), 'Waiting for the reviewer to approve');
  assert.equal(waitingFor(pending, 8), null, 'the reviewer has the Approve button');
  assert.equal(waitingFor({ ...pending, reviewer_id: null }, 5), 'Waiting for approval, and no reviewer is set');
  assert.equal(waitingFor(task({ status: 'Verified' }), 5), null);
});

test('a document request has no next step: its own link in the document is its step', () => {
  const request = { request_id: 1, kind: 'review', document_id: 3 } as never;
  const doc = task({ source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation', document_request: request });
  assert.equal(nextStep(doc, 5), null);
  assert.equal(waitingFor(doc, 5), null);
});

test('the approval gate and who may decide are the server\'s: the router says the same', { skip: !have }, () => {
  const router = read('routers/critical_tasks_router.py');
  assert.match(router, /\(task\.status == "Under Review" and new_status == "Completed"\) or\s+\(task\.status == "Completed" and new_status == "Verified"\)/);
  assert.match(router, /task\.assigned_owner_id == current_user\.id:\s+raise HTTPException\(status_code=403, detail="Task owner cannot approve their own task"\)/);
  assert.match(router, /task\.reviewer_id != current_user\.id and not getattr\(current_user, 'is_admin', False\)/);
  const t = { status: 'Under Review', approval_required: true, approval_status: 'Pending' };
  assert.equal(approvalGate(t, 'Completed'), true);
  assert.equal(approvalGate({ ...t, approval_status: 'Approved' }, 'Completed'), false);
  assert.equal(approvalGate(t, 'In Progress'), false);
  assert.equal(approvalGate({ ...t, approval_required: false }, 'Completed'), false);
  assert.equal(approvalGate({ ...t, status: 'Completed' }, 'Verified'), true);
  assert.equal(mayDecide({ reviewer_id: 8, assigned_owner_id: 5 }, 8), true);
  assert.equal(mayDecide({ reviewer_id: 8, assigned_owner_id: 8 }, 8), false);
  assert.equal(mayDecide({ reviewer_id: null, assigned_owner_id: 5 }, 1), false);
  assert.equal(mayDecide({ reviewer_id: 8, assigned_owner_id: 5 }, null), false);
});

// ── where it came from ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('sourceLink: the server\'s label and page win; else what the row says; a task made by hand has none', () => {
  assert.equal(sourceLink(task()), null);
  assert.deepEqual(sourceLink(task({ source_label: 'Vendor finding', source_href: '/vendor-risk/vendors/3' })), { label: 'Vendor finding', href: '/vendor-risk/vendors/3' });
  assert.deepEqual(sourceLink(task({ source_label: 'Workflow' })), { label: 'Workflow', href: null });
  assert.deepEqual(sourceLink(task({ source_module: 'regulatory_changes', linked_regulatory_change_id: 12 })), { label: 'Regulatory task', href: '/governance/regulatory-changes/12?tab=tasks' });
  const request = { request_id: 1, kind: 'review', document_id: 3, open_href: '/governance/documents/3' } as never;
  assert.deepEqual(sourceLink(task({ source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation', document_request: request })), { label: 'Document request', href: '/governance/documents/3' });
  assert.deepEqual(sourceLink(task({ source_module: 'committees' })), { label: 'Committee action', href: null });
});
