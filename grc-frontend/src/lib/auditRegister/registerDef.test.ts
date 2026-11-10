// node --test "src/lib/auditRegister/registerDef.test.ts"
// The Issue Register's definition on synthetic rows: the chips and the head count come from one pass, a chip and its rows can never disagree, the facets reach every record (a finding with no
// owner, no rating or no report has a value to filter by), the default sort puts what needs attention first, the board has a column for every status, and an owner opens on "Mine".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRegister, indexRegister, sortRows, stateOf } from '../../components/records/registerModel.ts';
import { readAddress } from '../addressState.ts';
import { OWNER_SCHEMA, REGISTER_SCHEMA, attentionValue, dayMs, daysSince, dueOf, hasOwnerToMap, isAwaiting, referenceOf, registerCounts, registerDef, reportLabel, type RegisterRow } from './registerDef.ts';

let next = 1;
const row = (over: Partial<RegisterRow> = {}): RegisterRow => ({
  issue_id: next++, code: null, source: 'regulator', record_type: 'issue', regulator: 'OCC', report: 'Report of Examination', report_key: 'occ-1', report_prefill: {}, added_in_platform: false,
  reference: `MRA-${next}`, title: 'A synthetic finding', risk_rating: 'High', lob: 'ERM', owner: 'Rivera, P', owner_id: 7, owner_name: 'Pat Rivera', affected_hosts: null, edited: false,
  target_date: '2026-03-31', revised_target_date: null, ia_status: 'IP', remediation_status: null, validation_status: null, validation_pass_fail: null, aged_status: null, days_past_due: null,
  status: 'IP', workflow_state: 'in_progress', ...over,
});

const ROWS: RegisterRow[] = [
  row({ status: 'PD', days_past_due: 40, mine: true }),
  row({ status: 'PD', days_past_due: 5 }),
  row({ status: 'IP', workflow_state: 'closure_review', awaiting_validation: true, waiting_since: '2026-04-01', mine: true }),
  row({ status: 'EXT', extension_requested: true, revised_target_date: '2026-09-30' }),
  row({ status: 'CD', mine: true }),
  row({ status: 'NS', owner: 'Nobody Here', owner_id: null, owner_name: null, risk_rating: null, lob: null, report_key: null, report: null, regulator: null, source: 'it_pen' }),
  row({ status: 'unstated', owner: null, owner_id: null, owner_name: null, risk_rating: 'Moderate', source: 'self_id' }),
];

test('the head count and the chips come from the same pass over the rows', () => {
  const counts = registerCounts(ROWS);
  assert.deepEqual(counts, { total: 7, open: 6, pastDue: 2, awaiting: 1, extension: 1, mine: 2 });
  const def = registerDef();
  const index = indexRegister(def, ROWS);
  const state = stateOf(def, readAddress(REGISTER_SCHEMA, ''));
  const { quickCounts } = evaluateRegister(def, index, state, new Date('2026-11-10T09:00:00'));
  assert.equal(quickCounts.all, counts.total);
  assert.equal(quickCounts.open, counts.open);
  assert.equal(quickCounts.pastdue, counts.pastDue);
  assert.equal(quickCounts.awaiting, counts.awaiting);
  assert.equal(quickCounts.extension, counts.extension);
  assert.equal(quickCounts.mine, counts.mine);
});

test('"Mine" is the open findings you own: a closed one is not on your list', () => {
  assert.equal(registerCounts(ROWS).mine, 2);
  assert.equal(ROWS.filter((r) => r.mine && r.status === 'CD').length, 1);
});

test('a chip keeps exactly the rows it counts', () => {
  const def = registerDef();
  const index = indexRegister(def, ROWS);
  for (const chip of def.quick) {
    const state = { ...stateOf(def, readAddress(REGISTER_SCHEMA, '')), quick: chip.key };
    const { result, quickCounts } = evaluateRegister(def, index, state, new Date());
    assert.equal(result.matches.length, quickCounts[chip.key], chip.key);
  }
});

test('every finding can be reached by a filter: a missing owner, rating, report or line of business has a value of its own', () => {
  const def = registerDef();
  const options = (key: string) => (def.facets.find((f) => f.key === key) as NonNullable<typeof def.facets[number]>).options(ROWS).map((o) => o.value);
  assert.ok(options('owner').includes('unmatched') && options('owner').includes('none'));
  assert.ok(options('risk').includes('none'));
  assert.ok(options('report').includes('none'));
  assert.ok(options('lob').includes('none'));
  for (const f of def.facets) {
    const offered = new Set(f.options(ROWS).map((o) => o.value));
    for (const r of ROWS) for (const v of f.values(r)) assert.ok(offered.has(v), `${f.key}: ${v} is offered`);
  }
});

test('the facets say their words in full and in the client\'s order: status by code order, source by sheet, risk worst first', () => {
  const def = registerDef();
  const labels = (key: string) => (def.facets.find((f) => f.key === key) as NonNullable<typeof def.facets[number]>).options(ROWS).map((o) => o.label);
  assert.deepEqual(labels('status'), ['Not started', 'In progress', 'Past due', 'Extension', 'Closed', 'No status']);
  assert.deepEqual(labels('source'), ['Regulator', 'Self identified', 'IT pen test']);
  assert.deepEqual(labels('risk').slice(0, 2), ['High', 'Moderate']);
});

test('the default order: past due (longest first), then the soonest target, then closed', () => {
  const def = registerDef();
  const ordered = sortRows(def, ROWS, def.defaultSort);
  assert.deepEqual(ordered.slice(0, 2).map((r) => r.days_past_due), [40, 5]);
  assert.equal(ordered[ordered.length - 1].status, 'CD');
  assert.ok(attentionValue(ROWS[0]) < attentionValue(ROWS[2]) && attentionValue(ROWS[2]) < attentionValue(ROWS[4]));
});

test('a revised date wins over the target, and calendar days are exact', () => {
  assert.equal(dueOf(ROWS[3]), '2026-09-30');
  assert.equal(dueOf(ROWS[0]), '2026-03-31');
  assert.equal(dayMs('2026-03-31'), Date.UTC(2026, 2, 31));
  assert.equal(dayMs('not a date'), null);
  assert.equal(daysSince('2026-11-01', new Date(2026, 10, 10, 23, 30)), 9);
  assert.equal(daysSince('2026-11-10', new Date(2026, 10, 10, 0, 5)), 0);
  assert.equal(daysSince(null, new Date()), null);
});

test('the board has a column for each status the client uses, and every row lands in exactly one', () => {
  const def = registerDef();
  const columns = (def.board as NonNullable<typeof def.board>).columns;
  assert.deepEqual(columns.map((c) => c.label), ['Not started', 'In progress', 'Delayed', 'Past due', 'Extension', 'Closed', 'No status']);
  for (const r of ROWS) assert.equal(columns.filter((c) => c.test(r)).length, 1, `row ${r.issue_id}`);
});

test('an owner name that matches nobody is a name to map; a closed finding does not wait for validation', () => {
  assert.equal(hasOwnerToMap(ROWS[5]), true);
  assert.equal(hasOwnerToMap(ROWS[6]), false);
  assert.equal(isAwaiting({ ...ROWS[2], status: 'CD' }), false);
  assert.equal(referenceOf(row({ reference: null, code: 'ISS-9' })), 'ISS-9');
  assert.equal(reportLabel(ROWS[0]), 'OCC · Report of Examination');
  assert.equal(reportLabel(ROWS[5]), null);
});

test('the address: everyone opens on all of them, except an owner who opens on "Mine"; a name the address does not know is ignored', () => {
  assert.equal(readAddress(REGISTER_SCHEMA, '').quick, 'all');
  assert.equal(readAddress(OWNER_SCHEMA, '').quick, 'mine');
  assert.equal(readAddress(OWNER_SCHEMA, '?quick=all').quick, 'all');
  assert.equal(readAddress(REGISTER_SCHEMA, '?quick=nonsense').quick, 'all');
  assert.deepEqual(readAddress(REGISTER_SCHEMA, '?source=regulator,it_pen&id=12').source, ['regulator', 'it_pen']);
  assert.equal(readAddress(REGISTER_SCHEMA, '?id=12').id, 12);
});

test('a search finds a finding by its number, title, owner, report or line of business', () => {
  const def = registerDef();
  const index = indexRegister(def, ROWS);
  const find = (q: string) => evaluateRegister(def, index, { ...stateOf(def, readAddress(REGISTER_SCHEMA, '')), q }, new Date()).result.matches.length;
  assert.equal(find('nobody'), 1);
  assert.equal(find('examination'), 6);   // every row but the one with no report
  assert.equal(find('regulator'), 5);
  assert.equal(find('zzz'), 0);
});
