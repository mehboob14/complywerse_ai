// node --test "src/app/(dashboard)/erm/_monitoring/mitigationModel.test.ts"
// The mitigation-action register's definition: Overdue is derived (never a status filter that returns nothing), "Due this week" excludes the late ones, the board has every action
// in one column (a workflow's `overdue` status sits in Open), and the order is by date with the dateless last.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress } from '../../../../lib/addressState.ts';
import { groupBoard } from '../../../../components/records/explorerModel.ts';
import { evaluateRegister, indexRegister, sortRows, stateOf } from './registerModel.ts';
import { ACTION_SCHEMA, actionDef, dueThisWeek, type ActionRow } from './mitigationModel.ts';

const a = (id: number, over: Partial<ActionRow>): ActionRow => ({ id, risk_id: 1, title: `Action ${id}`, action_type: 'mitigate', status: 'open', priority: 'medium', ...over });
const now = new Date('2026-11-08T12:00:00Z');
const rows: ActionRow[] = [
  a(1, { due_date: '2026-11-01T00:00:00', owner_id: 7, owner_name: 'Amina', risk_id: 4, risk_title: 'Outage' }),                       // late
  a(2, { due_date: '2026-11-12T00:00:00', status: 'in_progress', priority: 'high' }),                                                // this week
  a(3, { due_date: '2026-12-30T00:00:00', priority: 'critical' }),                                                                   // later
  a(4, { status: 'completed', completed_at: '2026-11-02T00:00:00', due_date: '2026-10-01T00:00:00', evidence_count: 2 }),
  a(5, { status: 'completed', completed_at: '2026-10-02T00:00:00' }),                                                                // completed, no evidence
  a(6, { status: 'cancelled', due_date: '2026-01-01T00:00:00' }),
  a(7, { status: 'overdue' }),                                                                                                       // flagged by a workflow
  a(8, {}),
];
const def = actionDef(7);
const index = indexRegister(def, rows);
const run = (search: string) => evaluateRegister(def, index, stateOf(def, readAddress(ACTION_SCHEMA, search) as Record<string, unknown>), now);

test('P-13: Overdue is a chip that counts what it shows (the status filter of the same name returned nothing while the tile said N)', () => {
  assert.deepEqual(run('?quick=overdue').result.matches.map((r) => r.id), [1, 7]);
  assert.equal(run('').quickCounts.overdue, 2);
  assert.equal(def.facets.find((f) => f.key === 'status')!.options(rows).some((o) => o.value === 'overdue'), false, 'no status option that nothing writes');
});

test('chips: due this week leaves out the late ones, to do is open + in progress, unassigned counts only what is still to do, no evidence is completed with none', () => {
  assert.deepEqual(run('?quick=week').result.matches.map((r) => r.id), [2]);
  assert.equal(dueThisWeek(rows[0], now), false);
  assert.deepEqual(run('?quick=open').result.matches.map((r) => r.id), [1, 2, 3, 8]);
  assert.deepEqual(run('?quick=noowner').result.matches.map((r) => r.id), [2, 3, 7, 8]);
  assert.deepEqual(run('?quick=noevidence').result.matches.map((r) => r.id), [5]);
  assert.deepEqual(run('?quick=mine').result.matches.map((r) => r.id), [1]);
});

test('the board puts every action in one column: a flagged-overdue action is Open', () => {
  const board = groupBoard(rows, def.board!.columns);
  assert.deepEqual(board.map((c) => [c.id, c.rows.map((x) => x.id)]), [['open', [1, 3, 7, 8]], ['in_progress', [2]], ['completed', [4, 5]], ['cancelled', [6]]]);
  assert.equal(board.reduce((n, c) => n + c.rows.length, 0), rows.length);
});

test('by date by default with the dateless last, priority highest first, and the risk and owner facets reach every action', () => {
  assert.deepEqual(sortRows(def, rows, def.defaultSort).map((r) => r.id), [6, 4, 1, 2, 3, 5, 7, 8]);
  assert.deepEqual(sortRows(def, rows, { key: 'priority', dir: 'asc' }).map((r) => r.id).slice(0, 2), [3, 2]);
  assert.deepEqual(def.facets.find((f) => f.key === 'owner')!.options(rows).map((o) => o.label), ['Amina', 'Unassigned']);
  assert.deepEqual(def.facets.find((f) => f.key === 'risk')!.options(rows).map((o) => o.label), ['Outage', 'Risk 1']);
});

test('a "pending" action (what POST /erm/risks/{id}/mitigation-actions writes for every new action) is an open one: to do, overdue when late, in the Open column', () => {
  const more = [...rows, a(9, { status: 'pending', due_date: '2026-11-02T00:00:00' }), a(10, { status: 'pending', due_date: '2026-12-20T00:00:00', owner_id: 7 })];
  const idx = indexRegister(def, more);
  const at = (search: string) => evaluateRegister(def, idx, stateOf(def, readAddress(ACTION_SCHEMA, search) as Record<string, unknown>), now);
  assert.deepEqual(at('?quick=overdue').result.matches.map((r) => r.id), [1, 7, 9]);
  assert.deepEqual(at('?quick=open').result.matches.map((r) => r.id), [1, 2, 3, 8, 9, 10]);
  assert.deepEqual(groupBoard(more, def.board!.columns)[0].rows.map((r) => r.id), [1, 3, 7, 8, 9, 10]);
  assert.equal(def.facets.find((f) => f.key === 'status')!.options(more).some((o) => o.value === 'pending'), true);
  assert.equal(at('?status=pending').result.matches.length, 2);
});
