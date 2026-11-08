// node --test "src/app/(dashboard)/governance/regulatory-changes/_lib/regulatoryModel.test.ts"
// What the Regulatory Changes screens decide: which statuses are open and which finished, the one reading of "late", how a due day is said, what a row needs attention for, the rule for
// closing a change (the server's), the obligation filters, the figures of one change and the six steps of its journey.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUCKETS, REGULATORS, attentionOf, bucketOf, closeState, controlStateOf, dayNumber, daysUntil, dueWords, effectiveOf, figuresOf, filterObligations, isFinished, isOpen, isTaskLate,
  journeyOf, linksByObligation, numberOf, regulatorName, taskShare, toCheckOf, NO_OBLIGATION_FILTERS,
} from './regulatoryModel.ts';
import type { ChangeRow, Obligation, RegLink, Task } from './types.ts';

const TODAY = new Date(2026, 10, 8, 15, 30);                       // 8 Nov 2026, the viewer's afternoon
const change = (over: Partial<ChangeRow> = {}): ChangeRow => ({ id: 1, title: 'Cyber resilience', source: 'SBP', status: 'under_assessment', priority: 'high', created_at: '2026-11-01T00:00:00', ...over });
const ob = (id: number, over: Partial<Obligation> = {}): Obligation => ({
  id, ref: null, quote: null, summary: `Duty ${id}`, obligation_type: 'requirement', applies_to: [], deadline: null, deadline_text: null, priority: 'medium', verified: true, match_score: null,
  compliance_status: 'not_assessed', owner_id: null, owner_name: null, department: null, notes: null, source: 'ai', ...over,
});
const task = (id: number, over: Partial<Task> = {}): Task => ({ id, title: `Task ${id}`, task_type: 'process_change', status: 'pending', ...over });
const link = (id: number, obligation: number, status: RegLink['status']): RegLink => ({ id, obligation_id: obligation, target_type: 'control', target_id: id, target_ref: null, target_label: null, rationale: null, score: null, status, source: 'manual', decided_by: null });

test('open and finished: Completed and Closed are both a change that is over; an unknown word is treated as identified on the board', () => {
  assert.deepEqual(['identified', 'under_assessment', 'implementation'].map(isOpen), [true, true, true]);
  assert.deepEqual(['completed', 'closed', 'not_applicable', undefined].map(isOpen), [false, false, false, false]);
  assert.deepEqual(['completed', 'closed'].map(isFinished), [true, true]);
  assert.equal(bucketOf('closed'), 'done');
  assert.equal(bucketOf('completed'), 'done');
  assert.equal(bucketOf('something_new'), 'identified');
  assert.deepEqual(BUCKETS.map((b) => bucketOf(b === 'done' ? 'completed' : b)), BUCKETS.slice());
});

test('a day is the date as written, whatever the time after it: an effective date at midnight UTC is that day for everyone', () => {
  assert.equal(dayNumber('2026-11-08T00:00:00'), dayNumber('2026-11-08'));
  assert.equal(dayNumber('2026-11-08T23:59:59Z'), dayNumber('2026-11-08'));
  assert.equal(dayNumber(null), null);
  assert.equal(dayNumber('soon'), null);
  assert.equal(daysUntil('2026-11-08T00:00:00', TODAY), 0);
  assert.equal(daysUntil('2026-11-13', TODAY), 5);
  assert.equal(daysUntil('2026-11-05', TODAY), -3);
});

test('due words: today, in N days, N days late (singular too); none for no date', () => {
  assert.deepEqual(dueWords('2026-11-08', TODAY), { text: 'today', late: false });
  assert.deepEqual(dueWords('2026-11-09', TODAY), { text: 'in 1 day', late: false });
  assert.deepEqual(dueWords('2026-11-20', TODAY), { text: 'in 12 days', late: false });
  assert.deepEqual(dueWords('2026-11-07', TODAY), { text: '1 day late', late: true });
  assert.deepEqual(dueWords('2026-11-05', TODAY), { text: '3 days late', late: true });
  assert.equal(dueWords(null, TODAY), null);
});

test('late = not completed and the due day has passed: due today is not late, a completed task never is, a task with no date never is', () => {
  assert.equal(isTaskLate({ status: 'pending', due_date: '2026-11-07T00:00:00' }, TODAY), true);
  assert.equal(isTaskLate({ status: 'blocked', due_date: '2026-11-07' }, TODAY), true, 'a blocked task past its day is late: it is not done');
  assert.equal(isTaskLate({ status: 'pending', due_date: '2026-11-08T00:00:00' }, TODAY), false);
  assert.equal(isTaskLate({ status: 'completed', due_date: '2026-10-01' }, TODAY), false);
  assert.equal(isTaskLate({ status: 'pending', due_date: null }, TODAY), false);
});

test('the effective facet: in force, within 30 days (the 30th day included), later, none', () => {
  assert.equal(effectiveOf('2026-11-07', TODAY), 'past');
  assert.equal(effectiveOf('2026-11-08', TODAY), 'soon');
  assert.equal(effectiveOf('2026-12-08', TODAY), 'soon');
  assert.equal(effectiveOf('2026-12-09', TODAY), 'later');
  assert.equal(effectiveOf(null, TODAY), 'none');
});

test('regulators: the twelve the server accepts, with their full names; a code nobody listed reads as itself', () => {
  assert.equal(REGULATORS.length, 12);
  assert.equal(regulatorName('SBP'), 'State Bank of Pakistan');
  assert.equal(regulatorName('XYZ'), 'XYZ');
  assert.equal(regulatorName(null), '—');
});

test('what a row waits for, most urgent first; a finished change waits for nothing; a change with no tasks is told so once it is being assessed', () => {
  const c = change({ analysis: { status: 'running' }, late_task_count: 2, to_check_count: 3, suggestion_count: 1, task_count: 4 });
  assert.deepEqual(attentionOf(c).map((a) => a.label), ['AI is reading', '2 tasks late', '3 to check', '1 suggestion']);
  assert.deepEqual(attentionOf(change({ task_count: 0 })).map((a) => a.key), ['no_tasks']);
  assert.deepEqual(attentionOf(change({ status: 'identified', task_count: 0 })), [], 'a change only just identified has no tasks yet, and that is not news');
  assert.deepEqual(attentionOf(change({ status: 'closed', late_task_count: 3 })), []);
});

test('closing follows the server: only under assessment or in implementation, at least one task, every task completed; no dead end', () => {
  const done = [{ status: 'completed' }, { status: 'completed' }];
  assert.deepEqual(closeState({ status: 'closed' }, done), { kind: 'finished' });
  assert.deepEqual(closeState({ status: 'completed' }, []), { kind: 'finished' });
  assert.equal(closeState({ status: 'identified' }, done).kind, 'wrong_status');
  assert.equal(closeState({ status: 'not_applicable' }, done).kind, 'wrong_status');
  assert.deepEqual(closeState({ status: 'implementation' }, []), { kind: 'no_tasks' }, 'zero tasks: the screen offers "Add a task", it does not say "0 of 0"');
  assert.deepEqual(closeState({ status: 'implementation' }, [{ status: 'completed' }, { status: 'blocked' }, { status: 'pending' }]), { kind: 'open_tasks', open: 2, total: 3 });
  assert.deepEqual(closeState({ status: 'under_assessment' }, done), { kind: 'ready', total: 2 });
});

test('progress of tasks: the share and its percent; none is 0 of 0, not a division by zero', () => {
  assert.deepEqual(taskShare({ task_count: 4, completed_task_count: 1 }), { done: 1, total: 4, pct: 25 });
  assert.deepEqual(taskShare({}), { done: 0, total: 0, pct: 0 });
});

test('control state of an obligation: met beats suggested beats none; a rejected suggestion counts as nothing', () => {
  assert.equal(controlStateOf([]).state, 'none');
  assert.equal(controlStateOf(undefined).state, 'none');
  assert.equal(controlStateOf([{ status: 'rejected' }]).state, 'none');
  assert.equal(controlStateOf([{ status: 'proposed' }]).state, 'review');
  assert.deepEqual(controlStateOf([{ status: 'proposed' }, { status: 'confirmed' }]), { confirmed: 1, proposed: 1, state: 'met' });
});

test('obligation filters: each one narrows, they combine, the number search finds the numbered row, and the numbers do not move when the list narrows', () => {
  const all = [
    ob(10, { summary: 'Report incidents', source: 'ai', verified: false, owner_ids: [7], compliance_status: 'compliant' }),
    ob(11, { summary: 'Keep logs', obligation_type: 'record_keeping', owners: [{ id: 8, display_name: 'Ayesha' }], owner_ids: [8] }),
    ob(12, { summary: 'Appoint an officer', source: 'manual', verified: false }),
  ];
  const by = linksByObligation([link(1, 10, 'confirmed'), link(2, 11, 'proposed')]);
  const n = numberOf(all);
  const run = (f: Partial<typeof NO_OBLIGATION_FILTERS>) => filterObligations(all, { ...NO_OBLIGATION_FILTERS, ...f }, by, n).map((o) => o.id);
  assert.deepEqual(run({}), [10, 11, 12]);
  assert.deepEqual(run({ compliance: 'compliant' }), [10]);
  assert.deepEqual(run({ type: 'record_keeping' }), [11]);
  assert.deepEqual(run({ control: 'met' }), [10]);
  assert.deepEqual(run({ control: 'review' }), [11]);
  assert.deepEqual(run({ control: 'none' }), [12]);
  assert.deepEqual(run({ owner: 'none' }), [12]);
  assert.deepEqual(run({ owner: '8' }), [11]);
  assert.deepEqual(run({ check: true }), [10], 'a hand-entered obligation is never "to check"; the AI one whose quote was not found is');
  assert.deepEqual(run({ q: 'ayesha' }), [11], 'by owner name');
  assert.deepEqual(run({ q: '3' }), [12], 'by item number');
  assert.deepEqual(run({ control: 'none', compliance: 'compliant' }), []);
  assert.equal(n.get(12), 3);
  assert.equal(toCheckOf(all[2]), false);
});

test('the figures of one change are counted from its full lists', () => {
  const obs = [ob(1, { compliance_status: 'compliant', owner_ids: [7] }), ob(2, { source: 'ai', verified: false }), ob(3)];
  const links = [link(1, 1, 'confirmed'), link(2, 2, 'proposed'), link(3, 2, 'proposed')];
  const tasks = [task(1, { status: 'completed' }), task(2, { due_date: '2026-11-01', assignee_ids: [7] }), task(3, { due_date: '2026-11-30' })];
  const f = figuresOf(obs, links, tasks, { gap_count: 2, assessment_count: 5 }, TODAY);
  assert.deepEqual(f, {
    total: 3, compliant: 1, notAssessed: 2, toCheck: 1, met: 1, suggestions: 2, withoutControl: 1, withoutOwner: 2, tasks: 3, tasksDone: 1, late: 1, unassigned: 1, gaps: 2, assessments: 5,
  });
});

test('the journey: six steps for a read circular, five for one entered by hand, the first step not done is the current one, a finished change is all done', () => {
  const none = figuresOf([], [], [], {}, TODAY);
  const fresh = journeyOf(change({ analysis: { status: 'running' } }), none);
  assert.deepEqual(fresh.map((s) => s.key), ['read', 'check', 'map', 'assign', 'track', 'close']);
  assert.equal(fresh[0].state, 'current');
  assert.equal(fresh[0].note, 'The AI is reading');
  const manual = journeyOf(change({ analysis: null }), none);
  assert.deepEqual(manual.map((s) => s.key), ['check', 'map', 'assign', 'track', 'close']);
  assert.equal(manual[0].state, 'current');

  const f = figuresOf([ob(1, { owner_ids: [7] }), ob(2, { owner_ids: [7] })], [link(1, 1, 'confirmed'), link(2, 2, 'confirmed')], [task(1, { status: 'completed', assignee_ids: [7] })], {}, TODAY);
  const ready = journeyOf(change({ analysis: { status: 'done' } }), f);
  assert.deepEqual(ready.map((s) => s.state), ['done', 'done', 'done', 'done', 'done', 'current']);
  assert.equal(ready[5].note, 'Ready');

  const over = journeyOf(change({ status: 'closed', analysis: { status: 'done' } }), none);
  assert.ok(over.every((s) => s.state === 'done'));
  const failed = journeyOf(change({ analysis: { status: 'failed' } }), none);
  assert.equal(failed[0].state, 'failed');
  assert.equal(failed[1].state, 'current', 'a failed reading does not hold the journey: the person can still enter obligations');
});
