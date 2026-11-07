// node --test "src/app/(dashboard)/erm/_monitoring/incidentModel.test.ts"
// The incident register's definition: chips that count the Overview's way (open = not resolved or closed; critical-or-high open), a board with every incident in one column
// (the model's `contained` with `mitigating`), and a default order of newest first.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress } from '../../../../lib/addressState.ts';
import { groupBoard } from '../../../../components/records/explorerModel.ts';
import { evaluateRegister, indexRegister, sortRows, stateOf } from './registerModel.ts';
import { INCIDENT_SCHEMA, incidentDef, linked, type IncidentRow } from './incidentModel.ts';

const i = (id: number, over: Partial<IncidentRow>): IncidentRow => ({ id, title: `Incident ${id}`, incident_date: '2026-11-01T00:00:00', severity: 'medium', status: 'open', ...over });
const rows: IncidentRow[] = [
  i(1, { severity: 'critical', status: 'open', assigned_to: 7, assignee_name: 'Amina', risk_id: 4, risk_title: 'Outage', tags: ['payments'], link_counts: { assets: 2, risks: 1 } }),
  i(2, { severity: 'high', status: 'investigating', incident_date: '2026-11-05T00:00:00' }),
  i(3, { severity: 'low', status: 'resolved', resolved_at: '2026-11-03T08:00:00', assigned_to: 8, assignee_name: 'Bilal', incident_date: '2026-10-20T00:00:00' }),
  i(4, { severity: 'high', status: 'closed', resolved_at: '2026-09-03T08:00:00' }),
  i(5, { severity: 'medium', status: 'contained' }),
  i(6, { severity: 'critical', status: 'mystery' }),
];
const now = new Date(2026, 10, 8);
const def = incidentDef(7);
const index = indexRegister(def, rows);
const run = (search: string) => evaluateRegister(def, index, stateOf(def, readAddress(INCIDENT_SCHEMA, search) as Record<string, unknown>), now);

test('the chips: Open is everything not resolved or closed, critical-or-high is the Overview\'s, resolved counts this month only', () => {
  assert.deepEqual(run('').quickCounts, { all: 6, open: 4, severe: 3, investigating: 1, resolved: 1, unassigned: 4, mine: 1 });
  assert.deepEqual(run('?quick=severe').result.matches.map((r) => r.id), [1, 2, 6]);
  assert.deepEqual(run('?quick=resolved').result.matches.map((r) => r.id), [3]);
  assert.deepEqual(run('?quick=mine').result.matches.map((r) => r.id), [1]);
});

test('facets reach every incident, tags are many-valued, and a count is what choosing it would show', () => {
  const r = run('?severity=high');
  assert.equal(r.result.counts.status.get('investigating'), 1);
  assert.equal(r.result.counts.status.get('open') ?? 0, 0, 'a zero stays in the list');
  assert.deepEqual(run('?tag=payments').result.matches.map((x) => x.id), [1]);
  assert.deepEqual(run('?assignee=none').result.matches.map((x) => x.id), [2, 4, 5, 6]);
  assert.deepEqual(def.facets.find((f) => f.key === 'assignee')!.options(rows).map((o) => o.label), ['Amina', 'Bilal', 'Unassigned']);
});

test('the board has every incident in one column: contained with mitigating, an unknown word with the closed ones', () => {
  const board = groupBoard(rows, def.board!.columns);
  assert.deepEqual(board.map((c) => [c.id, c.rows.map((x) => x.id)]), [['open', [1]], ['investigating', [2]], ['mitigating', [5]], ['resolved', [3]], ['closed', [4, 6]]]);
  assert.equal(board.reduce((n, c) => n + c.rows.length, 0), rows.length);
});

test('newest first by default, worst severity first on request, and the linked total is the sum of the server\'s counts', () => {
  assert.deepEqual(sortRows(def, rows, def.defaultSort).map((x) => x.id), [2, 1, 4, 5, 6, 3]);
  assert.deepEqual(sortRows(def, rows, { key: 'severity', dir: 'asc' }).map((x) => x.id), [1, 6, 2, 4, 5, 3]);
  assert.equal(linked(rows[0]), 3);
  assert.equal(linked(rows[1]), 0);
});
