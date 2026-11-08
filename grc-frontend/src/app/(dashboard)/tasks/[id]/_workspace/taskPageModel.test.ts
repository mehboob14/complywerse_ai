// node --test "src/app/(dashboard)/tasks/*/_workspace/taskPageModel.test.ts"
// The rules of a task's page: who the editors are open to, the body each one sends, what the approval part offers to whom (what the SERVER lets act), the line of facts, the sub-task
// progress, and where an old ?tab= address lands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  anchorOf, approvalRequiredPatch, customFacts, approvalView, detailsDirty, detailsOf, detailsPatch, detailsProblem, duePatch, factsLine, linkIdsOf, linksPatch, ownersPatch, railRights,
  emptySub, recurrencePatch, repeatWords, reviewerPatch, slaDaysPatch, slaDaysProblem, subCreateBody, sortSubTasks, subFormOf, subPatch, subProblem, subTaskProgress,
} from './taskPageModel.ts';

const person = (id: number, name: string) => ({ id, display_name: name, username: name.toLowerCase(), email: `${name.toLowerCase()}@x.test` });
const doc = { source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation', document_request: { request_id: 1 } } as never;
const plain = { source_module: null, source_entity_type: null, document_request: undefined } as never;

test('the editors are open to the people the Edit button was open to; a document request\'s task keeps its person, due date and status; its delete is for administrators', () => {
  const who = { canEdit: true, canDelete: false, isAdmin: false };
  assert.deepEqual(railRights(plain, who), { edit: true, ownersLocked: false, dueLocked: false, statusLocked: false, canDelete: false });
  assert.deepEqual(railRights(plain, { canEdit: false, canDelete: true, isAdmin: false }), { edit: false, ownersLocked: false, dueLocked: false, statusLocked: false, canDelete: true });
  assert.deepEqual(railRights(doc, who), { edit: true, ownersLocked: true, dueLocked: true, statusLocked: true, canDelete: false });
  assert.equal(railRights(doc, { canEdit: false, canDelete: true, isAdmin: false }).canDelete, false, 'the delete right is not enough for a document request');
  assert.equal(railRights(doc, { canEdit: false, canDelete: false, isAdmin: true }).canDelete, true, 'an administrator may');
});

test('the owners are sent as the server\'s canonical list (it keeps the single owner equal to the first); nobody is an empty list', () => {
  assert.deepEqual(ownersPatch(['7', '4']), { assigned_user_ids: [7, 4] });
  assert.deepEqual(ownersPatch([]), { assigned_user_ids: [] });
  assert.deepEqual(ownersPatch(['x', '0', '3']), { assigned_user_ids: [3] });
  assert.deepEqual(reviewerPatch('9'), { reviewer_id: 9 });
  assert.deepEqual(reviewerPatch(null), { reviewer_id: null });
  assert.deepEqual(reviewerPatch(''), { reviewer_id: null });
});

test('a due date goes as the day the input holds, cleared as null; SLA days are a whole number of 1 or more, cleared as null', () => {
  assert.deepEqual(duePatch('2026-11-12'), { due_date: '2026-11-12' });
  assert.deepEqual(duePatch(' '), { due_date: null });
  assert.equal(slaDaysProblem(''), null);
  assert.equal(slaDaysProblem('14'), null);
  for (const bad of ['0', '-3', '1.5', 'abc', '99999']) assert.match(slaDaysProblem(bad) as string, /whole number of days/, bad);
  assert.deepEqual(slaDaysPatch('14'), { sla_days: 14 });
  assert.deepEqual(slaDaysPatch(''), { sla_days: null });
});

test('a repeat: set with its interval (at least 1), cleared by the pattern alone; said in words', () => {
  assert.deepEqual(recurrencePatch('weekly', '2'), { recurrence_pattern: 'weekly', recurrence_interval: 2 });
  assert.deepEqual(recurrencePatch('monthly', ''), { recurrence_pattern: 'monthly', recurrence_interval: 1 });
  assert.deepEqual(recurrencePatch('monthly', '0'), { recurrence_pattern: 'monthly', recurrence_interval: 1 });
  assert.deepEqual(recurrencePatch('', '3'), { recurrence_pattern: null });
  assert.equal(repeatWords('monthly', 1), 'Every month');
  assert.equal(repeatWords('weekly', 2), 'Every 2 weeks');
  assert.equal(repeatWords('quarterly', null), 'Every quarter');
  assert.equal(repeatWords(null, 1), null);
  assert.deepEqual(approvalRequiredPatch(true), { approval_required: true });
});

test('the title, description and notes: only what changed is sent, an emptied one as null, the title trimmed and never empty or over 255', () => {
  const start = detailsOf({ title: 'Patch', description: null, evidence_notes: 'logs' });
  assert.deepEqual(start, { title: 'Patch', description: '', evidence_notes: 'logs' });
  assert.equal(detailsDirty(start, start), false);
  const next = { title: '  Patch ACME ', description: 'Do it', evidence_notes: '' };
  assert.equal(detailsDirty(next, start), true);
  assert.deepEqual(detailsPatch(next, start), { title: 'Patch ACME', description: 'Do it', evidence_notes: null });
  assert.deepEqual(detailsPatch(start, start), {});
  assert.deepEqual(detailsPatch({ ...start, description: '   ' }, { ...start, description: 'x' }), { description: null });
  assert.equal(detailsProblem(start), null);
  assert.match(detailsProblem({ ...start, title: '  ' }) as string, /Enter a title/);
  assert.match(detailsProblem({ ...start, title: 'x'.repeat(256) }) as string, /255 characters at most/);
});

test('the three links: ids as strings, only the ones that changed are sent, cleared as null', () => {
  const start = linkIdsOf({ linked_risk_id: 4, linked_control_id: null, linked_vulnerability_id: 9 });
  assert.deepEqual(start, { risk: '4', control: '', vulnerability: '9' });
  assert.deepEqual(linksPatch(start, start), {});
  assert.deepEqual(linksPatch({ risk: '', control: '12', vulnerability: '9' }, start), { linked_risk_id: null, linked_control_id: 12 });
});

test('approval: Request is offered to anyone who sees the task; Approve and Reject only to the reviewer who is not the owner (what the server lets act); every other case says why', () => {
  const task = (o: Record<string, unknown> = {}) => ({ approval_required: true, approval_status: null, status: 'Under Review', reviewer_id: 7, reviewer: person(7, 'Hina'), assigned_owner_id: 4, ...o }) as never;
  assert.equal(approvalView(task({ approval_required: false }), 1).state, 'not_needed');
  const none = approvalView(task(), 1);
  assert.deepEqual([none.state, none.canRequest, none.requestLabel, none.requestFor, none.canDecide], ['not_requested', true, 'Request approval', 'Completed', false]);
  const pending = (me: number | null, o: Record<string, unknown> = {}) => approvalView(task({ approval_status: 'Pending', ...o }), me);
  assert.deepEqual([pending(7).canDecide, pending(7).canRequest, pending(7).note], [true, false, null], 'the reviewer');
  assert.equal(pending(4).canDecide, false, 'the owner');
  assert.equal(pending(4).note, 'Waiting for Hina to approve it.');
  assert.equal(pending(1).canDecide, false, 'an administrator who is not the reviewer is refused by the server today: no button');
  assert.equal(pending(null).canDecide, false);
  assert.equal(pending(7, { assigned_owner_id: 7 }).canDecide, false, 'the reviewer who also owns it');
  assert.equal(pending(7, { assigned_owner_id: 7 }).note, 'You own this task, so another person has to approve it.');
  assert.equal(pending(1, { reviewer_id: null, reviewer: null }).note, 'No reviewer is set, so nobody can approve it. Choose a reviewer first.');
  const rejected = approvalView(task({ approval_status: 'Rejected' }), 1);
  assert.deepEqual([rejected.state, rejected.canRequest, rejected.requestLabel], ['rejected', true, 'Request approval again']);
  assert.equal(approvalView(task({ approval_status: 'Approved' }), 7).canRequest, false);
  assert.equal(approvalView(task({ status: 'Completed' }), 1).requestFor, 'Verified', 'the next gate');
  assert.equal(approvalView(task({ status: 'In Progress' }), 1).requestFor, undefined);
  assert.equal(approvalView(task({ status: 'Verified' }), 1).canRequest, false, 'a finished task');
});

test('approval follows the router: the owner never approves; the reviewer does; the "or an admin" branch tests an attribute no user has (recorded, not built)', () => {
  const src = readFileSync('../backend/grc/routers/critical_tasks_router.py', 'utf8');
  assert.match(src, /if task\.assigned_owner_id == current_user\.id:\s+raise HTTPException\(status_code=403, detail="Task owner cannot approve their own task"\)/);
  assert.match(src, /task\.reviewer_id != current_user\.id and not getattr\(current_user, 'is_admin', False\)/);
  const user = readFileSync('../backend/grc/models/_04_user_model_extended.py', 'utf8');
  assert.doesNotMatch(user, /\bis_admin\s*=\s*Column/, 'if GRCUser ever gets is_admin, the rule in taskRecord.mayDecide and approvalView must be revisited');
});

test('the line under the title says where it came from, the category, who made it and when, an escalation; nothing when there is nothing', () => {
  const base = { source_module: null, source_entity_type: null, document_request: undefined, linked_regulatory_change_id: null, source_label: null, category: 'Remediation', created_by: person(2, 'Omar'), created_at: '2026-11-04T09:30:00', escalation_level: 0 };
  assert.equal(factsLine(base as never), 'Remediation · Made by Omar on 4 Nov 2026');
  assert.equal(factsLine({ ...base, source_label: 'Vendor finding', source_module: 'vendor_risk', escalation_level: 2 } as never), 'Vendor finding · Remediation · Made by Omar on 4 Nov 2026 · Escalated to level 2');
  assert.equal(factsLine({ ...base, source_module: 'committees' } as never), 'Committee action · Remediation · Made by Omar on 4 Nov 2026');
  assert.equal(factsLine({ ...base, created_by: null, created_at: null } as never), 'Remediation');
  assert.equal(factsLine({ ...base, created_by: null } as never), 'Remediation · Made on 4 Nov 2026');
});

test('sub-task progress counts the ticked ones', () => {
  assert.deepEqual(subTaskProgress([{ status: 'Completed' }, { status: 'Open' }, { status: 'In Progress' }, { status: 'Completed' }]), { done: 2, total: 4, percent: 50 });
  assert.deepEqual(subTaskProgress([]), { done: 0, total: 0, percent: 0 });
  assert.deepEqual(subTaskProgress(undefined), { done: 0, total: 0, percent: 0 });
});

test('the old ?tab= addresses land on the section that holds what the tab held', () => {
  assert.deepEqual(anchorOf('details'), { id: 'task-description' });
  assert.deepEqual(anchorOf('evidence'), { id: 'task-description' });
  assert.deepEqual(anchorOf('subtasks'), { id: 'task-subtasks' });
  assert.deepEqual(anchorOf('comments'), { id: 'task-activity', filter: 'comments' });
  assert.deepEqual(anchorOf('History'), { id: 'task-activity', filter: 'all' });
  assert.equal(anchorOf('nonsense'), null);
  assert.equal(anchorOf(null), null);
});

test('custom fields in words: in the order the organization set, a removed field only while it holds a value, a person by name, yes/no, a date, a list; never an id', () => {
  const field = (o: Record<string, unknown>) => ({ key: 'k', label: 'K', type: 'text', required: false, options: [], help: '', order: 1, ...o }) as never;
  const fields = [
    field({ key: 'b', label: 'Business unit', order: 2 }),
    field({ key: 'a', label: 'Impact', type: 'select', order: 1 }),
    field({ key: 'who', label: 'Sponsor', type: 'user', order: 3 }),
    field({ key: 'ok', label: 'Reviewed', type: 'checkbox', order: 4 }),
    field({ key: 'when', label: 'Go live', type: 'date', order: 5 }),
    field({ key: 'tags', label: 'Tags', type: 'multiselect', order: 6 }),
    field({ key: 'old', label: 'Old field', order: 7, archived: true }),
    field({ key: 'gone', label: 'Gone field', order: 8, archived: true }),
  ];
  const values = { a: 'High', who: 7, ok: false, when: '2026-11-12', tags: ['x', 'y'], old: 'kept' };
  const out = customFacts(fields, values, (id) => (id === 7 ? 'Hina Shah' : null));
  assert.deepEqual(out.map((f) => f.label), ['Impact', 'Business unit', 'Sponsor', 'Reviewed', 'Go live', 'Tags', 'Old field'], 'the removed field without a value is left out');
  assert.deepEqual(out.map((f) => f.text), ['High', null, 'Hina Shah', 'No', '12 Nov 2026', 'x, y', 'kept']);
  assert.equal(out[6].removed, true);
  assert.equal(customFacts(fields, { who: 99 }, () => null).find((f) => f.key === 'who')?.text, null, 'an unknown person is no value, not an id');
  assert.deepEqual(customFacts(undefined, null, () => null), []);
});

test('a sub-task: the owner and the day only when chosen; an update sends what changed, an emptied owner or day as null; the title is checked as a task title is', () => {
  assert.deepEqual(subCreateBody({ title: ' Collect logs ', owner: '', due: '' }), { title: 'Collect logs' });
  assert.deepEqual(subCreateBody({ title: 'Review', owner: '4', due: '2026-11-12' }), { title: 'Review', assigned_owner_id: 4, due_date: '2026-11-12' });
  const start = subFormOf({ title: 'Review', assigned_owner_id: 4, due_date: '2026-11-12T00:00:00' });
  assert.deepEqual(start, { title: 'Review', owner: '4', due: '2026-11-12' });
  assert.deepEqual(subPatch(start, start), {});
  assert.deepEqual(subPatch({ title: ' Review it ', owner: '', due: '' }, start), { title: 'Review it', assigned_owner_id: null, due_date: null });
  assert.deepEqual(subPatch({ ...start, owner: '9' }, start), { assigned_owner_id: 9 });
  assert.match(subProblem(emptySub()) as string, /Enter a sub-task title/);
  assert.match(subProblem({ ...emptySub(), title: 'x'.repeat(256) }) as string, /sub-task title can be 255 characters at most/);
  assert.equal(subProblem({ ...emptySub(), title: 'ok' }), null);
});

test('the checklist keeps the order it was made in: oldest first, a row with no time last, ties by id', () => {
  const rows = [{ id: 3, created_at: '2026-11-04T10:00:00' }, { id: 1, created_at: '2026-11-04T09:00:00' }, { id: 4, created_at: null }, { id: 2, created_at: '2026-11-04T10:00:00' }];
  assert.deepEqual(sortSubTasks(rows).map((r) => r.id), [1, 2, 3, 4]);
  assert.deepEqual(sortSubTasks(undefined), []);
});
