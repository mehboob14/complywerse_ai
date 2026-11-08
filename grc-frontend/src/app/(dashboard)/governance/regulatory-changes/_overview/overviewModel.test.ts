// node --test "src/app/(dashboard)/governance/regulatory-changes/_overview/overviewModel.test.ts"
// The Regulatory Overview: the counters (the server's numbers, each opening what it counts), the person's own work and its urgency groups, the posture and the breakdowns of the register.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress } from '../../../../../lib/addressState.ts';
import { REGISTER_SCHEMA, pageOf, type RegisterAddress } from '../_register/changeAddress.ts';
import {
  COUNTERS, MINE, attentionTotal, buildWork, byRegulator, changeHref, complianceSlices, counterFrom, groupWork, metShare, registerHref, stageSlices, takesEffect, topPriority, urgencyOf,
} from './overviewModel.ts';
import type { ChangeRow, MyWorkPayload, OverviewPayload } from '../_lib/types.ts';

const TODAY = new Date(2026, 10, 8, 12, 0);
const OVERVIEW: OverviewPayload = {
  changes: { open: 5, by_status: { identified: 1, under_assessment: 3, implementation: 1 }, effective_soon: 2, in_force: 1 },
  obligations: { total: 40, by_compliance: { compliant: 10, not_assessed: 25, non_compliant: 5 }, to_check: 7, met: 12, without_control: 20, suggestions: 9 },
  tasks: { open: 14, late: 3, unassigned: 2 },
  feed: { new: 6 },
};
const row = (id: number, over: Partial<ChangeRow> = {}): ChangeRow => ({ id, title: `Change ${id}`, source: 'SBP', status: 'under_assessment', priority: 'medium', created_at: '2026-10-01T00:00:00', ...over });

test('every counter opens the register on what it counts, and the address it builds is one the register reads back', () => {
  assert.equal(registerHref({ work: 'late' }), '/governance/regulatory-changes?tab=changes&work=late');
  assert.equal(registerHref({ quick: 'open', eff: 'past' }), '/governance/regulatory-changes?tab=changes&quick=open&eff=past');
  assert.equal(registerHref({ status: ['identified', 'implementation'] }), '/governance/regulatory-changes?tab=changes&status=identified%2Cimplementation');
  assert.equal(changeHref(12), '/governance/regulatory-changes/12');
  assert.equal(changeHref(12, 'obligations', { obl: 5 }), '/governance/regulatory-changes/12?tab=obligations&obl=5');
  for (const c of [...COUNTERS, MINE].filter((x) => x.href.includes('tab=changes'))) {
    const page = pageOf(readAddress(REGISTER_SCHEMA, c.href.split('?')[1]) as RegisterAddress);
    assert.ok(page.filters.quick || page.filters.work.length || page.filters.effective.length || page.filters.status.length, `${c.key} lands on a filtered register`);
  }
  assert.equal(COUNTERS.find((c) => c.key === 'feed')?.href, '/governance/regulatory-feeds');
});

test('the counters read the server\'s numbers; a missing number is not recorded, never 0; a failure is its own state', () => {
  assert.deepEqual(COUNTERS.map((c) => c.pick(OVERVIEW, undefined)), [6, 3, 7, 9, 2, 1]);
  assert.deepEqual(counterFrom(0, false, false), { state: 'ready', value: 0 });
  assert.deepEqual(counterFrom(undefined, false, false), { state: 'none' });
  assert.deepEqual(counterFrom(undefined, true, false), { state: 'loading' });
  assert.deepEqual(counterFrom(undefined, false, true), { state: 'error' });
  assert.equal(attentionTotal(OVERVIEW), 6 + 3 + 7 + 9 + 2 + 1);
  assert.equal(attentionTotal(undefined), null);
});

const WORK: MyWorkPayload = {
  tasks: [
    { id: 1, change_id: 3, change_title: 'Cyber', title: 'Late task', status: 'in_progress', priority: 'high', due_date: '2026-11-02T00:00:00', late: true },
    { id: 2, change_id: 3, change_title: 'Cyber', title: 'Soon task', status: 'pending', priority: 'medium', due_date: '2026-11-12T00:00:00', late: false },
    { id: 3, change_id: 4, change_title: 'Outsourcing', title: 'Far task', status: 'pending', priority: 'low', due_date: '2026-12-30T00:00:00', late: false },
  ],
  tasks_total: 3,
  obligations: [{ id: 9, change_id: 3, change_title: 'Cyber', ref: '4.2', summary: 'Report incidents', priority: 'high', deadline: '2026-11-01' }],
  obligations_total: 1,
  changes: [{ id: 3, title: 'Cyber', source: 'SBP', status: 'under_assessment', priority: 'high', effective_date: '2026-11-20T00:00:00' }],
  changes_total: 1,
  feed_new: 2,
};

test('my work: overdue first (oldest day first), then this week, then the rest; each row has ONE action that opens the right tab', () => {
  const items = buildWork(WORK, TODAY);
  assert.deepEqual(items.map((i) => i.key), ['obligation-9', 'task-1', 'task-2', 'change-3', 'task-3', 'feed']);
  const [ob, late, soon] = items;
  assert.equal(ob.overdue, true, 'a deadline that has passed on an obligation nobody assessed');
  assert.equal(ob.action.href, '/governance/regulatory-changes/3?tab=obligations&obl=9', 'it opens that obligation\'s drawer');
  assert.equal(ob.context, 'Cyber · Clause 4.2 · Not assessed');
  assert.equal(late.action.href, '/governance/regulatory-changes/3?tab=tasks');
  assert.equal(late.context, 'Cyber · In progress');
  assert.equal(soon.overdue, false);
  assert.equal(items.find((i) => i.key === 'change-3')?.context, 'State Bank of Pakistan · Under assessment · Takes effect in 12 days');
  assert.equal(items.find((i) => i.key === 'feed')?.action.href, '/governance/regulatory-feeds');
  assert.deepEqual(buildWork(undefined, TODAY), []);
});

test('urgency groups and the length: a header where the urgency changes, only the first N rows', () => {
  const items = buildWork(WORK, TODAY);
  assert.equal(urgencyOf({ due: '2026-11-15', overdue: false }, TODAY), 'week');
  assert.equal(urgencyOf({ due: '2026-11-16', overdue: false }, TODAY), 'todo');
  assert.equal(urgencyOf({ due: null, overdue: false }, TODAY), 'todo');
  assert.deepEqual(groupWork(items, TODAY, 10).map((g) => [g.group, g.items.length]), [['overdue', 2], ['week', 1], ['todo', 3]]);
  assert.deepEqual(groupWork(items, TODAY, 3).map((g) => g.items.length), [2, 1], 'cut at three rows');
});

test('the posture: compliance in reading order with the words left out that nobody has, the share met by a control, the pipeline', () => {
  assert.deepEqual(complianceSlices(OVERVIEW).map((s) => [s.label, s.count]), [['Compliant', 10], ['Non-compliant', 5], ['Not assessed', 25]]);
  assert.deepEqual(metShare(OVERVIEW), { met: 12, total: 40, pct: 30 });
  assert.equal(metShare({ ...OVERVIEW, obligations: { ...OVERVIEW.obligations, total: 0 } }), null, 'no obligations is no share, not 0%');
  assert.equal(metShare(undefined), null);
  assert.deepEqual(stageSlices(OVERVIEW).map((s) => [s.label, s.count]), [['Identified', 1], ['Under assessment', 3], ['Implementation', 1]]);
  assert.equal(stageSlices(OVERVIEW)[1].href, '/governance/regulatory-changes?tab=changes&status=under_assessment');
});

test('the breakdowns of the whole register: by regulator, what takes effect, the changes that matter most', () => {
  const rows = [
    row(1, { source: 'SBP', late_task_count: 2, effective_date: '2026-11-20T00:00:00', priority: 'high' }),
    row(2, { source: 'SAMA', effective_date: '2026-10-20T00:00:00', priority: 'critical' }),
    row(3, { source: 'SBP', effective_date: '2026-11-09T00:00:00' }),
    row(4, { source: 'SAMA', status: 'completed', effective_date: '2026-11-10T00:00:00', priority: 'critical' }),
    row(5, { source: 'custom', priority: 'high' }),
  ];
  assert.deepEqual(byRegulator(rows).map((r) => [r.key, r.total, r.late]), [['SBP', 2, 2], ['custom', 1, 0], ['SAMA', 1, 0]], 'a finished change is not counted; equals by name');
  assert.equal(byRegulator(rows)[0].href, '/governance/regulatory-changes?tab=changes&quick=open&reg=SBP');
  assert.deepEqual(takesEffect(rows, TODAY).map((r) => r.id), [2, 3, 1], 'already in force first, then the next to take effect; no date and finished are left out');
  assert.deepEqual(takesEffect(rows, TODAY, 2).map((r) => r.id), [2, 3]);
  assert.deepEqual(topPriority(rows).map((r) => r.id), [2, 1, 5], 'critical first; among equals the dated one first');
});
