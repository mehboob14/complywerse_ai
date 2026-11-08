// node --test "src/lib/issues/issueDef.test.ts"
// The issue register's definition: one meaning of open and late for the chips, the head and the rows; facets that reach every issue (an unlisted word, no value); a board with
// every issue in exactly one column; a default order that puts what needs attention first; and the address grammar the old tabs' links still land on.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress } from '../addressState.ts';
import { groupBoard } from '../../components/records/explorerModel.ts';
import { evaluateRegister, indexRegister, sortRows, stateOf } from '../../components/records/registerModel.ts';
import { ISSUE_SCHEMA, codeOf, issueCounts, issueDef, lateDays, personName, type IssueRow } from './issueDef.ts';

const now = new Date('2026-11-08T12:00:00Z');
const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().replace('Z', '');
const amina = { id: 7, display_name: 'Amina Khan' };
const bilal = { id: 8, username: 'bilal' };
const i = (id: number, over: Partial<IssueRow>): IssueRow => ({ id, code: `ISS-${id}`, title: `Issue ${id}`, severity: 'medium', workflow_state: 'new', created_at: day(-10 + id), ...over });
const rows: IssueRow[] = [
  i(1, { severity: 'critical', workflow_state: 'in_progress', target_closure_date: day(-3), assignee: amina, owner: bilal, issue_type: 'incident', category: 'security', source_type: 'vulnerability', actions_open: 2, actions_done: 1 }),
  i(2, { severity: 'high', workflow_state: 'closure_review', target_closure_date: day(-1), assignee: bilal, category: 'contract', source_type: 'manual' }),
  i(3, { severity: 'low', workflow_state: 'closed', target_closure_date: day(-20), closed_at: day(-5), assignee: amina, category: 'contract' }),
  i(4, { severity: 'high', workflow_state: 'triage', target_closure_date: day(5) }),
  i(5, { severity: 'medium', workflow_state: 'cancelled', target_closure_date: day(-9), issue_type: 'unheard_of' }),
  i(6, { severity: 'informational', workflow_state: null }),
  i(7, { severity: 'critical', workflow_state: 'new', target_closure_date: null, assignee: amina }),
];
const def = issueDef(7);
const index = indexRegister(def, rows);
const run = (search: string) => evaluateRegister(def, index, stateOf(def, readAddress(ISSUE_SCHEMA, search) as Record<string, unknown>), now);
const ids = (search: string) => run(search).result.matches.map((r) => r.id);

test('the chips count one rule each: open includes closure review, late is open and past its target, mine is open and yours, critical-or-high is open', () => {
  assert.deepEqual(run('').quickCounts, { all: 7, open: 5, mine: 2, late: 2, serious: 4, closing: 1, unassigned: 2, contract: 2 });
  assert.deepEqual(ids('?quick=open'), [1, 2, 4, 6, 7]);
  assert.deepEqual(ids('?quick=late'), [1, 2], 'a closed or cancelled issue past its date is not late; an issue with no date is not late');
  assert.deepEqual(ids('?quick=mine'), [1, 7], 'yours and still open: the closed one assigned to you is not on your list');
  assert.deepEqual(ids('?quick=serious'), [1, 2, 4, 7]);
  assert.deepEqual(ids('?quick=closing'), [2]);
  assert.deepEqual(ids('?quick=unassigned'), [4, 6]);
  assert.deepEqual(ids('?quick=contract'), [2, 3]);
});

test('the head\'s numbers are the same rules over the same rows', () => {
  assert.deepEqual(issueCounts(rows, now), { total: 7, open: 5, late: 2, serious: 4, awaiting: 1 });
  assert.equal(lateDays(rows[0], now), 3);
  assert.equal(lateDays(rows[2], now), null);
  assert.equal(lateDays(rows[3], now), null);
});

test('facets reach every issue: an unlisted word and a missing value have their own option, and a count is what choosing it would show', () => {
  const type = def.facets.find((f) => f.key === 'type')!;
  const options = type.options(rows).map((o) => o.value);
  assert.ok(options.includes('unheard_of') && options.includes('none') && options.includes('incident'));
  assert.deepEqual(ids('?type=unheard_of'), [5]);
  assert.deepEqual(ids('?type=none'), [2, 3, 4, 6, 7]);
  assert.deepEqual(ids('?state=closed,cancelled'), [3, 5]);
  assert.deepEqual(ids('?state=new'), [6, 7], 'an issue with no state is a new one');
  assert.deepEqual(ids('?category=contract'), [2, 3], 'the old Contract Compliance tab, as an address');
  assert.deepEqual(ids('?assignee=none'), [4, 5, 6]);
  assert.deepEqual(def.facets.find((f) => f.key === 'assignee')!.options(rows).map((o) => o.label), ['Amina Khan', 'bilal', 'Unassigned']);
  assert.equal(run('?severity=critical').result.counts.state.get('in_progress'), 1);
  assert.equal(run('?severity=critical').result.counts.state.get('closed') ?? 0, 0, 'a zero stays in the list');
});

test('search finds the code, the title, the people and the words a person sees', () => {
  assert.deepEqual(ids('?q=ISS-3'), [3]);
  assert.deepEqual(ids('?q=amina'), [1, 3, 7]);
  assert.deepEqual(ids('?q=vulnerability'), [1]);
  assert.deepEqual(ids('?q=raised+by+hand'), [2, 3, 4, 5, 6, 7], 'an issue with no source is a hand-raised one');
});

test('the board has every issue in one column; closed and cancelled share the last', () => {
  const board = groupBoard(rows, def.board!.columns);
  assert.deepEqual(board.map((c) => [c.id, c.rows.map((x) => x.id)]), [['new', [6, 7]], ['triage', [4]], ['in_progress', [1]], ['resolution', []], ['closure_review', [2]], ['closed', [3, 5]]]);
  assert.equal(board.reduce((n, c) => n + c.rows.length, 0), rows.length);
});

test('the default order puts open issues first, the most overdue on top, undated ones after the dated ones and closed ones last', () => {
  assert.deepEqual(sortRows(def, rows, def.defaultSort).map((x) => x.id), [1, 2, 4, 6, 7, 3, 5]);
  assert.deepEqual(sortRows(def, rows, { key: 'severity', dir: 'asc' }).map((x) => x.id), [1, 7, 2, 4, 5, 3, 6]);
  assert.deepEqual(sortRows(def, rows, { key: 'due', dir: 'asc' }).map((x) => x.id), [3, 5, 1, 2, 4, 6, 7], 'an issue with no date is last either way');
  assert.deepEqual(sortRows(def, rows, { key: 'state', dir: 'asc' }).map((x) => x.id), [6, 7, 4, 1, 2, 3, 5]);
});

test('the address: the old tab addresses land on a state of the register, and a word the register does not know is the default', () => {
  assert.deepEqual(readAddress(ISSUE_SCHEMA, '?quick=banana&view=grid&sort=nope:asc').quick, 'all');
  assert.equal(readAddress(ISSUE_SCHEMA, '').sort.key, 'attention');
  assert.equal(readAddress(ISSUE_SCHEMA, '?quick=late&id=12').id, 12);
  assert.equal(issueDef(null).quick.some((c) => c.key === 'mine'), false, 'no "Mine" until the person is known');
});

test('names: a code the creators did not write, and a person who has only a user name', () => {
  assert.equal(codeOf({ id: 41, title: 'x' }), 'ISS-41');
  assert.equal(codeOf(rows[0]), 'ISS-1');
  assert.equal(personName(bilal), 'bilal');
  assert.equal(personName(null), null);
});
