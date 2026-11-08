// node --test "src/lib/issues/actionDef.test.ts"
// The corrective-action register's definition: late means still open and past due (the scorecard's rule), "awaiting verification" is a completed action, a promoted action is
// managed in Tasks, the board has every action in one column, and the default order puts what needs attention first.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress } from '../addressState.ts';
import { groupBoard } from '../../components/records/explorerModel.ts';
import { evaluateRegister, indexRegister, sortRows, stateOf } from '../../components/records/registerModel.ts';
import { ACTION_SCHEMA, actionCounts, actionDef, actionLateDays, isManagedInTasks, issueLine, type ActionRow } from './actionDef.ts';

const now = new Date('2026-11-08T12:00:00Z');
const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().replace('Z', '');
const a = (id: number, over: Partial<ActionRow>): ActionRow => ({ id, issue_id: 10 + (id % 2), issue_code: `ISS-${10 + (id % 2)}`, issue_title: id % 2 ? 'Weak TLS' : 'Unpatched gateway', title: `Action ${id}`, action_type: 'corrective', status: 'planned', created_at: day(-10 + id), ...over });
const rows: ActionRow[] = [
  a(1, { status: 'in_progress', due_date: day(-4), assignee_id: 7, assignee_name: 'Amina' }),
  a(2, { status: 'completed', due_date: day(-6), assignee_id: 8, assignee_name: 'Bilal' }),
  a(3, { status: 'verified', due_date: day(-9), assignee_id: 7, assignee_name: 'Amina' }),
  a(4, { status: 'planned', due_date: day(3) }),
  a(5, { status: 'blocked', due_date: day(-1), assignee_id: 8, assignee_name: 'Bilal', linked_critical_task_id: 31, action_type: 'containment' }),
  a(6, { status: 'cancelled', due_date: day(-2) }),
  a(7, { status: null, due_date: null, action_type: null }),
];
const def = actionDef(7);
const index = indexRegister(def, rows);
const run = (search: string) => evaluateRegister(def, index, stateOf(def, readAddress(ACTION_SCHEMA, search) as Record<string, unknown>), now);
const ids = (search: string) => run(search).result.matches.map((r) => r.id);

test('the chips: late is open and past due (a completed, verified or cancelled action is not), awaiting verification is completed, mine is open and yours', () => {
  assert.deepEqual(run('').quickCounts, { all: 7, open: 4, mine: 1, late: 2, verify: 1, unassigned: 2, tasks: 1 });
  assert.deepEqual(ids('?quick=open'), [1, 4, 5, 7], 'an action with no status is a planned one');
  assert.deepEqual(ids('?quick=late'), [1, 5]);
  assert.deepEqual(ids('?quick=verify'), [2]);
  assert.deepEqual(ids('?quick=mine'), [1]);
  assert.deepEqual(ids('?quick=unassigned'), [4, 7]);
  assert.deepEqual(ids('?quick=tasks'), [5]);
});

test('the head\'s numbers are the same rules, and the late days are whole days past due', () => {
  assert.deepEqual(actionCounts(rows, now), { total: 7, open: 4, late: 2, verify: 1 });
  assert.equal(actionLateDays(rows[0], now), 4);
  assert.equal(actionLateDays(rows[1], now), null);
  assert.equal(actionLateDays(rows[3], now), null);
});

test('a promoted action is managed in Tasks, and an action is named by its issue', () => {
  assert.equal(isManagedInTasks(rows[4]), true);
  assert.equal(isManagedInTasks(rows[0]), false);
  assert.equal(issueLine(rows[0]), 'ISS-11 Weak TLS');
  assert.equal(issueLine({ id: 1, issue_id: 9, title: 'x' }), 'ISS-9');
});

test('facets reach every action, a zero count stays in the list, and the issue facet lists each issue once', () => {
  assert.deepEqual(ids('?status=blocked,verified'), [3, 5]);
  assert.deepEqual(ids('?type=none'), [7]);
  assert.deepEqual(ids('?assignee=none'), [4, 6, 7]);
  assert.deepEqual(def.facets.find((f) => f.key === 'issue')!.options(rows).map((o) => o.label), ['ISS-10 Unpatched gateway', 'ISS-11 Weak TLS']);
  assert.deepEqual(ids('?issue=10'), [2, 4, 6]);
  assert.equal(run('?type=containment').result.counts.status.get('planned') ?? 0, 0);
  assert.deepEqual(ids('?q=bilal'), [2, 5]);
  assert.deepEqual(ids('?q=iss-10'), [2, 4, 6]);
});

test('the board has every action in one column, in the life cycle\'s order', () => {
  const board = groupBoard(rows, def.board!.columns);
  assert.deepEqual(board.map((c) => c.id), ['planned', 'in_progress', 'blocked', 'completed', 'verified', 'cancelled']);
  assert.equal(board.reduce((n, c) => n + c.rows.length, 0), rows.length);
});

test('the default order: open first, the most overdue on top, undated after dated, finished ones last', () => {
  assert.deepEqual(sortRows(def, rows, def.defaultSort).map((x) => x.id), [1, 5, 4, 7, 2, 3, 6]);
  assert.deepEqual(sortRows(def, rows, { key: 'due', dir: 'asc' }).map((x) => x.id), [3, 2, 1, 6, 5, 4, 7]);
  assert.deepEqual(sortRows(def, rows, { key: 'status', dir: 'asc' }).map((x) => x.id), [4, 7, 1, 5, 2, 3, 6]);
});
