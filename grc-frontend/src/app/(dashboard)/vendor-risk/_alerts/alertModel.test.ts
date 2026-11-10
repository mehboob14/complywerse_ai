// node --test "src/app/(dashboard)/vendor-risk/_alerts/alertModel.test.ts"
// The Alerts register: ONE record (a monitoring signal) on one register. Acknowledged is not closed; the severity sort and the "reassessment" filter act on the WHOLE load (they used to act on the 25
// rows of a page); the steps are the server's; the old e-mail address still lands on its alert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { countOf } from '../../../../components/records/facetEngine.ts';
import { evaluateRegister, indexRegister, sortRows, stateOf, buildSchema } from '../../../../components/records/registerModel.ts';
import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import {
  ALERT_SCHEMA, MOVES, NEEDS_NOTE, alertDef, headLine, historyWords, isAlertKind, momentOf, needsDecision, periodLabel, registerAddress, rowActions, seenOn, severityKey, titleOf, type AlertRow,
} from './alertModel.ts';

let n = 0;
const row = (o: Partial<AlertRow> = {}): AlertRow => ({
  id: ++n, vendor: { id: 1, name: 'Payroll Co', tier: 'critical' }, type: 'breach', severity: 'high', title: 'Payroll Co confirms breach', source: 'GDELT news', occurred_at: '2026-11-01T10:00:00',
  status: 'new', stage: 'new', owner: null, verified: true, sources: 2, researched: false, finding_id: null, acknowledged: false, triggered_reassessment: false, ...o,
});

const ROWS: AlertRow[] = [
  row({ id: 1 }),
  row({ id: 2, type: 'security_rating', severity: 'medium', title: 'Rating fell 82 to 64', stage: 'acknowledged', status: 'closed', acknowledged: true, triggered_reassessment: true, occurred_at: '2026-11-03T09:00:00' }),
  row({ id: 3, severity: 'critical', stage: 'investigating', status: 'investigating', owner: { id: 7, name: 'Ana Lyst' }, occurred_at: '2026-10-01T09:00:00' }),
  row({ id: 4, type: 'cert_expiry', severity: 'low', title: null, stage: 'closed', status: 'closed', acknowledged: true, vendor: { id: 2, name: 'Beta', tier: null } }),
  row({ id: 5, type: 'adverse_media', severity: 'critical', stage: 'confirmed', status: 'confirmed', verified: false, owner: { id: 8, name: 'Bo Reviewer' } }),
];
const stateWith = (def: ReturnType<typeof alertDef>, over: Record<string, unknown> = {}) => stateOf(def, { ...readAddress(buildSchema(def), ''), ...over });

test('acknowledged is a stage of its own: still open for a decision, counted apart from closed', () => {
  assert.equal(needsDecision(ROWS[1]), true);
  assert.equal(needsDecision(ROWS[3]), false);
  const def = alertDef(7);
  const { quickCounts } = evaluateRegister(def, indexRegister(def, ROWS), stateWith(def), new Date('2026-11-10'));
  assert.equal(quickCounts.all, 5);
  assert.equal(quickCounts.open, 3, 'new + acknowledged + investigating');
  assert.equal(quickCounts.new, 1, 'the acknowledged one is not "new"');
  assert.equal(quickCounts.mine, 1);
  assert.equal(quickCounts.reassess, 1);
  assert.equal(quickCounts.severe, 2, 'open and critical or high');
  const stages = evaluateRegister(def, indexRegister(def, ROWS), stateWith(def), new Date()).result.counts;
  assert.equal(countOf(stages, 'stage', 'acknowledged'), 1);
  assert.equal(countOf(stages, 'stage', 'closed'), 1);
});

test('the reassessment filter and the severity sort work over EVERY row, not a page of them', () => {
  const def = alertDef(null);
  const many = Array.from({ length: 300 }, (_, i) => row({ id: 1000 + i, severity: i === 299 ? 'critical' : 'low', triggered_reassessment: i === 299, occurred_at: '2026-01-01T00:00:00' }));
  const index = indexRegister(def, many);
  const asked = evaluateRegister(def, index, stateWith(def, { reassess: ['yes'] }), new Date());
  assert.deepEqual(asked.result.matches.map((r) => r.id), [1299], 'the 300th row is found');
  const sorted = sortRows(def, many, { key: 'severity', dir: 'asc' });
  assert.equal(sorted[0].id, 1299, 'the most severe is first although it is the last row');
});

test('the severity sort is most severe first, then newest first; a row with no date is last of its severity', () => {
  const a = row({ severity: 'high', occurred_at: '2026-11-05T00:00:00' });
  const b = row({ severity: 'high', occurred_at: '2026-11-07T00:00:00' });
  const c = row({ severity: 'critical', occurred_at: '2020-01-01T00:00:00' });
  const d = row({ severity: 'high', occurred_at: null });
  const def = alertDef(null);
  assert.deepEqual(sortRows(def, [a, b, c, d], { key: 'severity', dir: 'asc' }).map((r) => r.id), [c.id, b.id, a.id, d.id]);
  assert.equal(momentOf(d), 0);
  assert.ok(severityKey(row({ severity: null })) > severityKey(row({ severity: 'low' })) - 1, 'no severity sorts with the unknown');
});

test('every stage has a board column, and a facet offers every value a row can have', () => {
  const def = alertDef(7);
  assert.deepEqual(def.board?.columns.map((c) => c.id), ['new', 'acknowledged', 'investigating', 'confirmed', 'not_relevant', 'closed']);
  for (const r of ROWS) assert.equal(def.board?.columns.filter((c) => c.test(r)).length, 1, `row ${r.id} is in exactly one column`);
  for (const f of def.facets) for (const r of ROWS) for (const v of f.values(r)) assert.ok(f.options(ROWS).some((o) => o.value === v), `${f.key}: ${v}`);
  assert.equal(def.facets.find((f) => f.key === 'owner')?.options(ROWS).at(-1)?.label, 'Nobody yet');
});

test('the "With me" chip is offered only when the person is known, and the address names stay clear of the ones the frame owns', () => {
  assert.ok(alertDef(7).quick.some((c) => c.key === 'mine'));
  assert.ok(!alertDef(null).quick.some((c) => c.key === 'mine'));
  assert.deepEqual(Object.keys(ALERT_SCHEMA).sort(), ['id', 'kind', 'page', 'proof', 'q', 'quick', 'reassess', 'severity', 'sort', 'stage', 'tier', 'view', 'owner'].sort());
  const query = writeAddress(ALERT_SCHEMA, '', { ...readAddress(ALERT_SCHEMA, ''), stage: ['new', 'acknowledged'], kind: ['breach'], id: 41 });
  assert.equal(query, 'id=41&stage=new%2Cacknowledged&kind=breach');
  assert.deepEqual(readAddress(ALERT_SCHEMA, query).stage, ['new', 'acknowledged']);
});

test('the steps are the ones the server allows: the same table as alerts.py MOVES and NOTE_NEEDED', () => {
  const src = new URL('../../../../../../backend/grc/modules/vendor_risk/tpra/alerts.py', import.meta.url);
  if (!existsSync(src)) return;
  const code = readFileSync(src, 'utf8');
  const table = code.slice(code.indexOf('MOVES = {'), code.indexOf('NOTE_NEEDED'));
  const server: Record<string, string[]> = {};
  Array.from(table.matchAll(/"([a-z_]+)": \{([^}]*)\}/g)).forEach((m) => { server[m[1]] = (m[2].match(/"([a-z_]+)"/g) ?? []).map((w) => w.replace(/"/g, '')).sort(); });
  const mine = Object.fromEntries(Object.entries(MOVES).map(([k, v]) => [k, v.slice().sort()]));
  assert.deepEqual(mine, server);
  const noted = (/NOTE_NEEDED = \{([^}]*)\}/.exec(code)?.[1].match(/"([a-z_]+)"/g) ?? []).map((w) => w.replace(/"/g, '')).sort();
  assert.deepEqual(NEEDS_NOTE.slice().sort(), noted);
});

test('what a person may do to a row without opening it follows the kind and the right, never more than the server allows', () => {
  const can = { edit: true, raise: true };
  assert.deepEqual(rowActions(ROWS[0], can), ['acknowledge', 'investigate'], 'a new alert');
  assert.deepEqual(rowActions(ROWS[2], can), [], 'an alert being investigated: its steps say why, so they are in its details');
  assert.deepEqual(rowActions(ROWS[1], can), ['dismiss', 'raise_finding'], 'an acknowledged rating change: already seen');
  assert.deepEqual(rowActions(row({ type: 'sla', stage: 'new' }), can), ['acknowledge', 'dismiss', 'raise_finding']);
  assert.deepEqual(rowActions(row({ type: 'sla', stage: 'new', finding_id: 9 }), can), ['acknowledge', 'dismiss'], 'a finding is raised once');
  assert.deepEqual(rowActions(ROWS[0], { edit: false, raise: false }), [], 'no right, no action: not a disabled one');
  assert.deepEqual(rowActions(row({ type: 'sla', stage: 'closed' }), { edit: false, raise: true }), ['raise_finding'], 'the findings right is its own');
  assert.equal(isAlertKind('breach') && !isAlertKind('sla'), true);
});

test('the old address of an alert lands on it; every other param stays', () => {
  assert.equal(registerAddress('?alert=41'), 'id=41');
  assert.equal(registerAddress('alert=41&stage=new'), 'stage=new&id=41');
  assert.equal(registerAddress('?alert=junk&x=1'), 'x=1', 'a value that is not an id is dropped, the rest kept');
  assert.equal(registerAddress('?stage=new'), null);
  assert.equal(registerAddress(''), null);
});

test('words: a signal with no title says its kind; the head line counts what is open; the period is named', () => {
  assert.equal(titleOf(ROWS[3]), 'Certificate expiry');
  assert.equal(headLine(5, { new: 1, acknowledged: 1, investigating: 1, closed: 1 }), '5 alerts · 1 new · 1 acknowledged · 1 investigating');
  assert.equal(headLine(1, {}), '1 alert');
  assert.equal(periodLabel(90), 'Last 90 days');
  assert.equal(periodLabel(7), 'Last 12 months');
});

test('the drawer\'s words: a feed date is read as a day, and a history line says what happened without a code word', () => {
  assert.equal(seenOn('20261105T143000Z'), '2026-11-05');
  assert.equal(seenOn('yesterday'), null);
  assert.equal(seenOn(undefined), null);
  assert.equal(historyWords({ action: 'triage', from: 'acknowledged', to: 'investigating' }), 'Acknowledged → Investigating');
  assert.equal(historyWords({ action: 'triage', from: null, to: 'confirmed' }), 'New → Confirmed');
  assert.equal(historyWords({ action: 'research', from: null, to: null }), 'Researched by AI');
  assert.equal(historyWords({ action: 'something_new', from: null, to: null }), 'Something new');
});
