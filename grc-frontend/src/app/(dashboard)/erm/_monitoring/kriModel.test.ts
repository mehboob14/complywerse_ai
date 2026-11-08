// node --test "src/app/(dashboard)/erm/_monitoring/kriModel.test.ts"
// The KRI register's definition on a mixed register: states from the one KRI rule, the quick chips (what the Overview counts as red; due), facet options that reach every
// record, the board puts every KRI in exactly one column, and the sort puts the worst first.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress } from '../../../../lib/addressState.ts';
import { evaluateRegister, indexRegister, sortRows, stateOf } from '../../../../components/records/registerModel.ts';
import { groupBoard } from '../../../../components/records/explorerModel.ts';
import { KRI_SCHEMA, kriDef, type KriRow } from './kriModel.ts';

const k = (id: number, over: Partial<KriRow>): KriRow => ({
  id, name: `KRI ${id}`, kind: 'kri', current_value: 1, current_status: null, green_threshold: 5, amber_threshold: 10, threshold_direction: 'lower_is_better', frequency: 'monthly',
  is_live: false, owner_id: null, risk_id: null, ...over,
});
const rows: KriRow[] = [
  k(1, { current_value: 20, owner_id: 7, owner_name: 'Amina', risk_id: 3, risk_title: 'Phishing', category: 'Cyber' }),     // red
  k(2, { current_value: 7 }),                                                                                              // amber
  k(3, { current_value: 1, is_live: true, module_label: 'Vulnerabilities', category: 'Cyber' }),                         // green
  k(4, { current_value: null, next_due_date: '2026-11-01T00:00:00' }),                                                    // no value, due
  k(5, { current_value: 3, amber_threshold: null }),                                                                       // not rated
  k(6, { current_value: 80, threshold_direction: 'higher_is_better', green_threshold: 80, amber_threshold: 50, owner_id: 8, owner_name: 'Bilal' }),   // green
];
const now = new Date(2026, 10, 8);
const def = kriDef(7);
const run = (search: string) => evaluateRegister(def, indexRegister(def, rows), stateOf(def, readAddress(KRI_SCHEMA, search) as Record<string, unknown>), now);

test('every KRI has one state, from the one rule, and the status facet counts them', () => {
  const counts = run('').result.counts.status;
  assert.deepEqual(['red', 'amber', 'green', 'unrated', 'no_value'].map((s) => counts.get(s) ?? 0), [1, 1, 2, 1, 1]);
});

test('the quick chips: Off target is the Overview\'s red, Due is a manual KRI past its day, Mine is the person\'s, and the counts are what each would show', () => {
  assert.deepEqual(run('').quickCounts, { all: 6, off: 1, watch: 1, due: 1, novalue: 1, mine: 1 });
  assert.deepEqual(run('?quick=off').result.matches.map((r) => r.id), [1]);
  assert.deepEqual(run('?quick=due').result.matches.map((r) => r.id), [4]);
  assert.deepEqual(run('?quick=mine').result.matches.map((r) => r.id), [1], 'the chip is one the address may name even though the schema is built once');
  assert.equal(kriDef(null).quick.some((c) => c.key === 'mine'), false, 'no Mine chip when the person is not known');
});

test('the facets reach every KRI: unassigned, unlinked and uncategorised have an option', () => {
  const opts = (key: string) => def.facets.find((f) => f.key === key)!.options(rows);
  assert.deepEqual(opts('owner').map((o) => o.label), ['Amina', 'Bilal', 'Unassigned']);
  assert.deepEqual(opts('risk').map((o) => o.label), ['Phishing', 'Not linked to a risk']);
  assert.deepEqual(opts('category').map((o) => o.label), ['Cyber', 'No category']);
  assert.deepEqual(run('?owner=none').result.matches.map((r) => r.id), [2, 3, 4, 5]);
  assert.deepEqual(run('?source=live').result.matches.map((r) => r.id), [3]);
});

test('the board has every KRI in exactly one column, worst states first', () => {
  const board = groupBoard(rows, def.board!.columns);
  assert.deepEqual(board.map((c) => [c.id, c.rows.length]), [['red', 1], ['amber', 1], ['green', 2], ['none', 2]]);
  assert.equal(board.reduce((n, c) => n + c.rows.length, 0), rows.length);
});

test('the default order is worst first and ties keep their order; value sorts high to low on a first press', () => {
  assert.deepEqual(sortRows(def, rows, def.defaultSort).map((r) => r.id), [1, 2, 3, 6, 5, 4]);
  assert.deepEqual(sortRows(def, rows, { key: 'value', dir: 'desc' }).map((r) => r.id), [6, 1, 2, 5, 3, 4]);
  assert.equal(def.sorts.find((s) => s.key === 'value')!.firstDir, 'desc');
});
