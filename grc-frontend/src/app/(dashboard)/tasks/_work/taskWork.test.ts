// node --test "src/app/(dashboard)/tasks/_work/taskWork.test.ts"
// My work (taskWork.ts): the person's tasks are the ones they are on or review (and the decisions asked of them), the five numbers of the band are LINKS into All tasks and the register shows
// exactly the tasks each one counted, the list is in the order a person should do it, a row has its one next step (and the reason when it has none), and the load adds up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate } from '../../../../components/records/facetEngine.ts';
import { readAddress } from '../../../../lib/addressState.ts';
import { REGISTER_SCHEMA, pageOf, type RegisterAddress } from '../_register/taskAddress.ts';
import { chosenOf, indexTasks, ruleOf } from '../_register/taskFacets.ts';
import { isOverdue, nextStep, type RegisterTask } from '../taskRecord.ts';
import { countersOf, emptyKind, isOpenMine, isWork, joinWork, loadOf, orderWork, recentDone, rowOf, waitsForMyDecision } from './taskWork.ts';

const NOW = new Date('2026-11-10T09:30:00Z');
const ME = 5;
const person = (id: number) => ({ id, display_name: `Person ${id}` });

function task(id: number, over: Partial<RegisterTask> = {}): RegisterTask {
  return {
    id, title: `Task ${id}`, source: 'Manual', source_module: null, source_entity_type: null, priority: 'Medium', status: 'Open', category: 'Other',
    assigned_owner_id: ME, assigned_owner: person(ME), assigned_user_ids: [ME], assignees: [person(ME)], reviewer_id: null, reviewer: null,
    created_by_id: 2, created_by: person(2), due_date: null, sla_status: 'No SLA', completed_at: null, created_at: '2026-10-01T08:00:00', updated_at: null,
    approval_required: false, approval_status: null, ...over,
  };
}

/** a spread of tasks: mine and not, every status, every due bucket, approvals, documents, a recurring one, my own creations */
function make(n: number): RegisterTask[] {
  const statuses = ['Open', 'In Progress', 'Under Review', 'Completed', 'Verified', 'Reopened', 'planned'];
  const priorities = ['Critical', 'High', 'Medium', 'Low', 'high', 'Informational'];
  const dues = [null, '2026-11-01T00:00:00', '2026-11-10T09:00:00', '2026-11-10T18:00:00', '2026-11-12T00:00:00', '2026-11-30T00:00:00', '2027-02-01T00:00:00'];
  const rows: RegisterTask[] = [];
  for (let i = 1; i <= n; i += 1) {
    const owners = i % 5 === 0 ? [] : i % 4 === 0 ? [ME, 2] : [(i % 8) + 1];
    const approval = i % 6 === 0;
    rows.push(task(i, {
      priority: priorities[i % priorities.length], status: statuses[i % statuses.length], due_date: dues[i % dues.length],
      assigned_owner_id: owners[0] ?? null, assigned_owner: owners.length ? person(owners[0]) : null, assigned_user_ids: owners, assignees: owners.map(person),
      reviewer_id: i % 3 === 0 ? ME : i % 7 === 0 ? 3 : null, reviewer: i % 3 === 0 ? person(ME) : i % 7 === 0 ? person(3) : null,
      created_by_id: i % 9 === 0 ? ME : (i % 4) + 1, created_by: person(i % 9 === 0 ? ME : (i % 4) + 1),
      approval_required: approval, approval_status: approval ? (['Pending', 'Approved', 'Rejected', null] as const)[i % 4] : null,
      completed_at: ['Completed', 'Verified'].includes(statuses[i % statuses.length]) ? `2026-${i % 2 ? '11-03' : '09-20'}T08:00:00` : null,
    }));
  }
  return rows;
}
const ROWS = make(400);

test('the tasks of the three requests are joined by id: a task the person is on and reviews is one task', () => {
  const a = [task(1), task(2)];
  const b = [task(2, { title: 'again' }), task(3)];
  assert.deepEqual(joinWork([a, b, []]).map((t) => t.id), [1, 2, 3]);
  assert.equal(joinWork([a, b])[1].title, 'Task 2', 'the first answer of a task wins');
  assert.deepEqual(joinWork([]), []);
});

test('open mine is open work they are on or review; a decision asked of them stays theirs even when the task is Completed', () => {
  assert.equal(isOpenMine(task(1), ME), true);
  assert.equal(isOpenMine(task(1, { status: 'Completed' }), ME), false);
  assert.equal(isOpenMine(task(1, { assigned_owner_id: 9, assigned_owner: person(9), assigned_user_ids: [9], assignees: [person(9)] }), ME), false, 'someone else\'s');
  assert.equal(isOpenMine(task(1, { assigned_owner_id: 9, assigned_owner: person(9), assigned_user_ids: [9], assignees: [person(9)], reviewer_id: ME }), ME), true, 'a task they review');
  assert.equal(isOpenMine(task(1), null), false, 'nobody signed in reads no work');
  const verify = task(2, { status: 'Completed', assigned_owner_id: 9, assigned_owner: person(9), assigned_user_ids: [9], assignees: [person(9)], reviewer_id: ME, approval_required: true, approval_status: 'Pending' });
  assert.equal(waitsForMyDecision(verify, ME), true);
  assert.equal(isOpenMine(verify, ME), false);
  assert.equal(isWork(verify, ME), true, 'the decision is work');
  assert.equal(waitsForMyDecision({ ...verify, assigned_owner_id: ME, assigned_owner: person(ME), assigned_user_ids: [ME], assignees: [person(ME)] }, ME), false, 'never the owner of the task they would approve (the server refuses it)');
});

test('the band has five numbers, in the order a person reads them', () => {
  const c = countersOf(ROWS, ME, NOW);
  assert.deepEqual(c.map((x) => x.key), ['overdue', 'week', 'approve', 'open', 'created']);
  assert.deepEqual(c.map((x) => x.label), ['Overdue', 'Due this week', 'To approve', 'Open', 'Created by me']);
  assert.ok(c.every((x) => x.value >= 0 && x.href.startsWith('/tasks?tab=all&')));
  assert.ok(c.find((x) => x.key === 'overdue')!.value > 0 && c.find((x) => x.key === 'approve')!.value > 0, 'the fixture has some of each');
});

test('EVERY number of the band is the register\'s own count: its link, read by the register, shows exactly the tasks the number counted', () => {
  const ctx = { me: ME, now: NOW };
  const index = indexTasks(ROWS, ctx);
  for (const counter of countersOf(ROWS, ME, NOW)) {
    const page = pageOf(readAddress(REGISTER_SCHEMA, counter.href.slice(counter.href.indexOf('?'))) as RegisterAddress);
    const shown = evaluate(index, chosenOf(page.filters), ruleOf(page.filters, ctx)).matches.length;
    assert.equal(shown, counter.value, `${counter.key}: ${counter.href}`);
  }
  for (const p of loadOf(ROWS, ME, NOW).byPriority.filter((x) => x.href)) {
    const page = pageOf(readAddress(REGISTER_SCHEMA, (p.href as string).slice((p.href as string).indexOf('?'))) as RegisterAddress);
    assert.equal(evaluate(index, chosenOf(page.filters), ruleOf(page.filters, ctx)).matches.length, p.count, `priority ${p.word}`);
  }
});

test('Overdue is the server\'s Breached: an open task of theirs whose due moment has passed, however the status is spelled', () => {
  const late = ROWS.filter((t) => isOpenMine(t, ME) && isOverdue(t, NOW));
  assert.equal(countersOf(ROWS, ME, NOW)[0].value, late.length);
  assert.ok(late.every((t) => (t.due_date ?? '') < '2026-11-10T09:30'));
});

test('the load adds up: the priorities and "Other" are the open work, and the last 30 days count only what they finished in them', () => {
  const rows = ROWS.concat([task(9001, { priority: 'Informational' })]);
  const load = loadOf(rows, ME, NOW);
  assert.equal(load.byPriority.reduce((n, p) => n + p.count, 0), load.open);
  assert.deepEqual(load.byPriority.slice(0, 4).map((p) => p.word), ['Critical', 'High', 'Medium', 'Low']);
  const other = load.byPriority.find((p) => p.word === 'Other');
  assert.ok(other && other.href === null && other.count > 0, 'Informational is none of the four and has no filter value to link to');
  const done = rows.filter((t) => ['Completed', 'Verified'].includes(t.status) && (t.assigned_user_ids?.includes(ME) || t.reviewer_id === ME));
  assert.ok(done.some((t) => t.completed_at!.startsWith('2026-09')) && done.some((t) => t.completed_at!.startsWith('2026-11')));
  assert.equal(load.done30, done.filter((t) => t.completed_at!.startsWith('2026-11')).length, 'September is more than 30 days ago');
  assert.equal(loadOf([task(1, { status: 'Completed', completed_at: null })], ME, NOW).done30, 0, 'no completion moment, no claim');
});

test('Do next: late first (the longest late first), then the decisions asked of them, then by due date, then undated; severity breaks ties', () => {
  const rows = [
    task(1, { title: 'undated medium' }),
    task(2, { title: 'undated critical', priority: 'Critical' }),
    task(3, { title: 'due soon', due_date: '2026-11-12T00:00:00' }),
    task(4, { title: 'due later', due_date: '2026-12-12T00:00:00' }),
    task(5, { title: 'late a day', due_date: '2026-11-09T00:00:00' }),
    task(6, { title: 'late a week', due_date: '2026-11-03T00:00:00' }),
    task(7, { title: 'decision', status: 'Under Review', assigned_owner_id: 9, assigned_owner: person(9), assigned_user_ids: [9], assignees: [person(9)], reviewer_id: ME, approval_required: true, approval_status: 'Pending' }),
    task(8, { title: 'late, high', due_date: '2026-11-03T00:00:00', priority: 'High' }),
    task(9, { title: 'finished', status: 'Completed' }),
    task(10, { title: 'not mine', assigned_owner_id: 9, assigned_owner: person(9), assigned_user_ids: [9], assignees: [person(9)] }),
  ];
  assert.deepEqual(orderWork(rows, ME, NOW).map((t) => t.title), ['late, high', 'late a week', 'late a day', 'decision', 'due soon', 'due later', 'undated critical', 'undated medium']);
  assert.deepEqual(orderWork(rows, ME, NOW).map((t) => t.title), orderWork(rows.slice().reverse(), ME, NOW).map((t) => t.title), 'the order does not depend on how the answer came');
  assert.equal(orderWork(ROWS, ME, NOW).length, ROWS.filter((t) => isWork(t, ME)).length);
});

test('a row: the pill says what it is, the context what and where from, ONE next step', () => {
  const r = rowOf(task(1, { title: 'Update the register', priority: 'High', status: 'In Progress', category: 'Review', source_label: 'Vendor finding', sub_task_total: 5, sub_task_done: 2, due_date: '2026-11-07T00:00:00' }), ME, NOW);
  assert.deepEqual([r.id, r.title, r.href, r.kind.label, r.overdue], [1, 'Update the register', '/tasks/1', 'In progress', true]);
  assert.equal(r.context, 'High priority · Vendor finding · Review · 2 of 5 sub-tasks');
  assert.equal(r.requester, undefined, 'who made an ordinary task is on its page: a worklist row names only who asks for a decision');
  assert.deepEqual([r.action?.label, r.action?.step?.id, r.action?.step?.to], ['Send for review', 'review', 'Under Review']);
  assert.equal(rowOf(task(4, { priority: '' }), ME, NOW).context, 'Other', 'no priority is not "undefined priority"');
});

test('the row of a decision: To approve, Asked by the owner, Approve is the step; the owner and the others get no Approve, and the row says what it waits for', () => {
  const ask = { status: 'Under Review', assigned_owner_id: 9, assigned_owner: person(9), assigned_user_ids: [9], assignees: [person(9)], reviewer_id: ME, reviewer: person(ME), approval_required: true, approval_status: 'Pending' };
  const mine = rowOf(task(1, ask), ME, NOW);
  assert.deepEqual([mine.kind.label, mine.kind.tone, mine.action?.label, mine.action?.step?.id, mine.requester?.name], ['To approve', 'pending', 'Approve', 'approve', 'Person 9']);
  const owner = rowOf(task(2, { ...ask, assigned_owner_id: ME, assigned_owner: person(ME), assigned_user_ids: [ME], assignees: [person(ME)], reviewer_id: 3, reviewer: person(3) }), ME, NOW);
  assert.equal(owner.action, null, 'the owner waits');
  assert.match(owner.context, /Waiting for the reviewer to approve$/);
  const unasked = rowOf(task(3, { status: 'Under Review', approval_required: true, approval_status: null }), ME, NOW);
  assert.equal(unasked.action?.label, 'Request approval');
  assert.equal(nextStep(task(3, { status: 'Under Review', approval_required: true, approval_status: null }), ME)?.id, 'request_approval');
});

test('a document request has no status step: its own step in the document is the action, for the person asked only', () => {
  const doc = (userId: number) => task(1, {
    source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation', title: 'Acknowledge the policy',
    document_request: { request_id: 4, kind: 'acknowledgement', document_id: 7, document_title: 'Policy', version: '2.0', status: 'pending', user_id: userId, due_date: null, done_at: null, overdue: false, open_href: '/governance/documents/7', action_href: '/governance/documents/7?act=ack', action_label: 'Acknowledge' },
  });
  const mine = rowOf(doc(ME), ME, NOW);
  assert.deepEqual([mine.kind.label, mine.action?.label, mine.action?.href, mine.action?.step], ['Document', 'Acknowledge', '/governance/documents/7?act=ack', undefined]);
  assert.equal(rowOf(doc(99), ME, NOW).action, null, 'someone else\'s step is not a button');
});

test('why the list is empty: nothing at all is assigned, or everything is finished', () => {
  assert.equal(emptyKind([], ME), 'none');
  assert.equal(emptyKind([task(1, { assigned_owner_id: 9, assigned_owner: person(9), assigned_user_ids: [9], assignees: [person(9)] })], ME), 'none', 'tasks that are not theirs');
  assert.equal(emptyKind([task(1, { status: 'Completed' })], ME), 'caught-up');
  assert.equal(emptyKind([task(1)], ME), null);
});

test('recently completed: the latest ten they finished, the most recent first', () => {
  const rows = make(400).map((t, i) => (['Completed', 'Verified'].includes(t.status) ? { ...t, completed_at: `2026-10-${String((i % 27) + 1).padStart(2, '0')}T0${i % 9}:00:00` } : t));
  const recent = recentDone(rows, ME);
  assert.equal(recent.length, 10);
  const at = recent.map((t) => Date.parse(`${t.completed_at}Z`));
  assert.deepEqual(at.slice().sort((a, b) => b - a), at);
  assert.ok(recent.every((t) => ['Completed', 'Verified'].includes(t.status)));
});
