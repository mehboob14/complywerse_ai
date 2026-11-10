// node --test "src/app/(dashboard)/vendor-risk/reports/_reports/reportsModel.test.ts"
// The Reports page's rules: where a kept report stands and what can be done with it, who may do it (as the server enforces it, no fallback on approve and share), the quarters and the request each kind is
// made with, the register's chips and the programme-health tiles (a missing figure is never 0).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSchema, evaluateRegister, indexRegister, sortRows, stateOf as registerState, type RegisterDef } from '../../../../../components/records/registerModel.ts';
import { readAddress } from '../../../../../lib/addressState.ts';
import { REPORT_KINDS } from '../../../../../lib/statuses/vendorInsights.ts';
import {
  REPORTS_SCHEMA, SHARE_DAYS, can, headLine, healthTiles, ownReport, quarters, ready, reportsDef, requestOf, rightsFrom, stateOf, whoWhen, type KeptReport, type Measures,
} from './reportsModel.ts';

const rep = (over: Partial<KeptReport> & { id: number }): KeptReport => ({
  kind: 'committee_pack', kind_label: 'Committee pack', title: `Report ${over.id}`, generated_at: `2026-11-0${over.id}T09:00:00`, generated_by: 'A. Khan', generated_by_id: 7, approved_at: null, approved_by: null,
  share: { active: false, expires_at: null, views: 0, last_viewed_at: null }, ...over,
});
const ROWS = [
  rep({ id: 1 }),
  rep({ id: 2, kind: 'register', approved_at: '2026-11-03T10:00:00', approved_by: 'B. Ali', generated_by_id: 8, generated_by: 'B. Ali' }),
  rep({ id: 3, approved_at: '2026-11-03T10:00:00', share: { active: true, expires_at: '2026-11-17T00:00:00', views: 2, last_viewed_at: null } }),
  rep({ id: 4, generated_by: null, generated_by_id: null }),
];
const state = (def: RegisterDef<KeptReport>, over: Record<string, unknown> = {}) => registerState(def, { ...readAddress(buildSchema(def), ''), ...over });

test('a report is a draft until approved, approved until its link is live, shared while it is', () => {
  assert.deepEqual(ROWS.map(stateOf), ['draft', 'approved', 'shared', 'draft']);
  assert.equal(stateOf({ approved_at: null, share: { active: true, expires_at: null, views: 0, last_viewed_at: null } }), 'shared', 'the server only shares an approved report; whatever it says, a live link is "shared"');
});

test('what can be done follows the state: approve or discard a draft, share an approved one, withdraw a shared one; an approved report is never discarded', () => {
  const [draft, approved, shared] = ROWS;
  assert.deepEqual([can.approve(draft), can.discard(draft), can.share(draft), can.withdraw(draft)], [true, true, false, false]);
  assert.deepEqual([can.approve(approved), can.discard(approved), can.share(approved), can.withdraw(approved)], [false, false, true, false]);
  assert.deepEqual([can.approve(shared), can.discard(shared), can.share(shared), can.withdraw(shared)], [false, false, false, true]);
});

test('who may do what is the server\'s rule: approve needs the approval right and share the config right, with no fallback; generate may use the risk-edit right', () => {
  const only = (...held: string[]) => rightsFrom((k) => held.includes(k));
  assert.deepEqual(only('erm:risks:edit'), { generate: true, approve: false, share: false }, 'the risk-edit right generates, but approves and shares nothing');
  assert.deepEqual(only('vendor_risk:approvals:approve'), { generate: false, approve: true, share: false });
  assert.deepEqual(only('vendor_risk:config:edit'), { generate: false, approve: false, share: true });
  assert.deepEqual(only('vendor_risk:vendors:edit'), { generate: true, approve: false, share: false });
  assert.deepEqual(only(), { generate: false, approve: false, share: false });
});

test('a person about to approve their own report is told, never blocked', () => {
  assert.equal(ownReport(ROWS[0], 7), true);
  assert.equal(ownReport(ROWS[1], 7), false);
  assert.equal(ownReport(ROWS[3], 7), false, 'a report with no recorded maker is nobody\'s');
  assert.equal(ownReport(ROWS[0], null), false, 'while the person is not known nothing is claimed');
  assert.deepEqual(Array.from(SHARE_DAYS), [7, 14, 30]);
});

test('the five quarters run back from this one to date, across a year end', () => {
  const q = quarters(new Date(2026, 1, 17));                // 17 Feb 2026: Q1 2026 to date, then Q4 2025 ... Q1 2025
  assert.deepEqual(q.map((x) => x.label), ['Q1 2026 to date', 'Q4 2025', 'Q3 2025', 'Q2 2025', 'Q1 2025']);
  assert.deepEqual([q[0].start, q[0].end], ['2026-01-01', '2026-02-17']);
  assert.deepEqual([q[1].start, q[1].end], ['2025-10-01', '2025-12-31']);
  assert.deepEqual([q[4].start, q[4].end], ['2025-01-01', '2025-03-31']);
  const mid = quarters(new Date(2026, 10, 10));
  assert.deepEqual([mid[0].label, mid[1].label, mid[1].end], ['Q4 2026 to date', 'Q3 2026', '2026-09-30']);
});

test('each kind of report is requested with its own parameters, and a supplier report needs its supplier', () => {
  const [now] = quarters(new Date(2026, 10, 10));
  assert.deepEqual(requestOf('committee_pack', now, null), { kind: 'committee_pack', period_start: '2026-10-01', period_end: '2026-11-10' });
  assert.deepEqual(requestOf('ratings_quarter', now, 5), { kind: 'ratings_quarter', period_start: '2026-10-01', period_end: '2026-11-10' });
  assert.deepEqual(requestOf('register', now, 5), { kind: 'register' });
  assert.deepEqual(requestOf('vendor_file', now, 5), { kind: 'vendor_file', vendor_id: 5 });
  assert.deepEqual(requestOf('vendor_summary', now, null), { kind: 'vendor_summary' });
  assert.equal(ready('vendor_file', null), false);
  assert.equal(ready('vendor_file', 3), true);
  assert.equal(ready('register', null), true);
  assert.equal(REPORT_KINDS.length, 5);
});

test('the register keeps its chips and its facets true over the whole list, and the newest report comes first', () => {
  const def = reportsDef(7);
  const { quickCounts } = evaluateRegister(def, indexRegister(def, ROWS), state(def), new Date());
  assert.equal(quickCounts.all, 4);
  assert.equal(quickCounts.draft, 2);
  assert.equal(quickCounts.shared, 1);
  assert.equal(quickCounts.mine, 2, 'reports made by person 7; the one with no recorded maker is nobody\'s');
  assert.deepEqual(sortRows(def, ROWS, def.defaultSort).map((r) => r.id), [4, 3, 2, 1]);
  assert.deepEqual(Object.keys(REPORTS_SCHEMA).sort(), ['by', 'id', 'kind', 'page', 'q', 'quick', 'sort', 'state', 'view']);
  const by = def.facets.find((f) => f.key === 'by')!.options(ROWS);
  assert.deepEqual(by.map((o) => o.label), ['A. Khan', 'B. Ali', 'Not recorded']);
});

test('the head says how many are kept and how many wait, and the real total when the server cut the list', () => {
  assert.equal(headLine(ROWS), '4 reports kept · 2 waiting for approval');
  assert.equal(headLine([ROWS[2]]), '1 report kept');
  assert.equal(headLine(ROWS, 312), '312 reports kept · 2 waiting for approval');
});

test('the health tiles say what the server measured; no figure is 0 when the server had none', () => {
  const m: Measures = {
    coverage: { active: 220, in_date: 0, overdue: 1, never: 219, coverage_pct: 0, overdue_pct: 0.5 },
    measures: [{ key: 'cycle', label: 'Assessment cycle: start to decision', median_days: null, count: 0 }, { key: 'review', label: 'Questionnaire review', median_days: 2, count: 1 }],
    trends: { tprm_coverage_pct: [{ date: '2026-11-01', value: 0 }], tprm_review_days: [{ date: '2026-11-01', value: 2 }] },
  };
  const tiles = healthTiles(m);
  assert.deepEqual(tiles.map((t) => t.key), ['coverage', 'overdue', 'cycle', 'review']);
  assert.deepEqual([tiles[0].value, tiles[0].note], ['0%', '0 of 220 vendors']);
  assert.deepEqual([tiles[1].value, tiles[1].note], ['0.5%', '1 vendors, 219 never approved']);
  assert.equal(tiles[2].value, null, 'no cases: not recorded, not "0 days"');
  assert.deepEqual([tiles[3].value, tiles[3].note, tiles[3].trend?.length], ['2 days', '1 case', 1]);
  assert.equal(tiles[1].trend, null);
  assert.equal(healthTiles({ ...m, coverage: { ...m.coverage, coverage_pct: null, overdue_pct: null } })[0].value, null);
});

test('a report row says who made it and who approved it, in words', () => {
  assert.equal(whoWhen(ROWS[0], '1 Nov 2026', null), 'Generated 1 Nov 2026 by A. Khan · waiting for approval');
  assert.equal(whoWhen(ROWS[1], '2 Nov 2026', '3 Nov 2026'), 'Generated 2 Nov 2026 by B. Ali · approved 3 Nov 2026 by B. Ali');
  assert.equal(whoWhen(ROWS[3], '4 Nov 2026', null), 'Generated 4 Nov 2026 · waiting for approval');
});
