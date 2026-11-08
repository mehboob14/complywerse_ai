// node --test "src/app/(dashboard)/bcm/_overview/overviewModel.test.ts"
// The Business Continuity Overview: the five counters (each is the number of rows the register it opens shows), the rows of "Do now" (most urgent first, one action each), and the words under
// them. The figures are the server's; these tests hold the arrangement.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Dashboard, DrillRow, Mine } from '../bcmModel.ts';
import { attentionTotal, countersOf, mineLine, mineTotal, rowDue, workItems } from './overviewModel.ts';

const NOW = new Date(2026, 10, 8, 12, 0, 0).getTime();
const at = (offset: number): string => { const d = new Date(2026, 10, 8 + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00`; };

const dashboard = (o: Partial<Dashboard> = {}): Dashboard => ({
  totals: { plans: 14, active_plans: 12, drills: 30, overdue_drills: 3, bia_records: 40, open_findings: 6 },
  plans_by_status: { draft: 2, approved: 10, retired: 2 }, drills_by_status: {}, drill_coverage_pct: 78, coverage_detail: { covered: 9, active_plans: 12 },
  rto_pass_rate: 83, rpo_pass_rate: 91, results_scored: 12, open_findings_by_severity: { critical: 1, high: 2, medium: 2, low: 1 }, recent_drills: [], overdue_drills: [],
  attention: { reviews_due: 2, bia_without_strategy: 5, plans_without_strategy: 3, findings_without_issue: 4 }, ...o,
});

test('the five counters, each opening the register it counts, in the order of urgency', () => {
  const c = countersOf(dashboard());
  assert.deepEqual(c.map((x) => [x.label, x.value, x.href]), [
    ['Overdue drills', 3, '/bcm/drills?quick=overdue'],
    ['Reviews due', 2, '/bcm/plans?quick=review'],
    ['Draft plans', 2, '/bcm/plans?quick=draft'],
    ['Plans with no recovery strategy', 3, '/bcm/plans?quick=nostrategy'],
    ['Findings with no issue', 4, '/bcm/findings?quick=noissue'],
  ]);
  assert.equal(attentionTotal(c), 14);
});

test('a counter the server did not send is a dash, never 0, and the total is of those that were sent', () => {
  const c = countersOf(dashboard({ attention: undefined }));
  assert.deepEqual(c.map((x) => x.value), [3, null, 2, null, null]);
  assert.equal(attentionTotal(c), 5);
  assert.equal(attentionTotal(c.map((x) => ({ ...x, value: null }))), null);
  assert.equal(countersOf(dashboard({ plans_by_status: {} }))[2].value, 0, 'no draft plan is a true zero');
});

const drill = (id: number, o: Partial<DrillRow> = {}) => ({ id, plan_title: 'Core banking', title: `Drill ${id}`, drill_type: 'tabletop', scheduled_date: at(-9), ...o } as DrillRow);

test('"Do now": what is late first (the oldest first), then what is due soon, then what has no day, each with one action', () => {
  const mine: Mine = {
    counts: { overdue_drills: 2, reviews_due: 2, bia_without_strategy: 1, findings_without_issue: 2 },
    overdue_drills: [drill(1, { scheduled_date: at(-9) }), drill(2, { scheduled_date: at(-2), title: 'Call tree' })],
    reviews_due: [{ id: 5, title: 'DR plan', status: 'approved', next_review_due: at(12) }, { id: 6, title: 'Payments plan', status: 'draft', next_review_due: at(-4) }],
    findings_without_issue: [
      { id: 8, drill_id: 3, drill_title: 'Tabletop', title: 'No runbook', severity: 'critical', due_date: at(5) },
      { id: 9, drill_id: 3, drill_title: 'Tabletop', title: 'Stale list', severity: 'low', due_date: null },
    ],
    bia_without_strategy: [{ id: 4, plan_id: 5, plan_title: 'DR plan', process_name: 'Card authorisation', criticality_rating: 'critical' }],
  };
  const items = workItems(mine, NOW);
  assert.deepEqual(items.map((i) => i.key), ['drill:1', 'review:6', 'drill:2', 'finding:8', 'review:5', 'bia:4', 'finding:9']);
  assert.deepEqual(items.map((i) => i.kind.label), ['Drill overdue', 'Review due', 'Drill overdue', 'No issue yet', 'Review due', 'No strategy', 'No issue yet']);
  assert.equal(items[0].href, '/bcm/drills/1');
  assert.equal(items.find((i) => i.key === 'bia:4')?.href, '/bcm/plans/5?tab=bia&process=4');
  assert.equal(items.find((i) => i.key === 'bia:4')?.action, 'Add strategy');
  assert.equal(items.find((i) => i.key === 'finding:8')?.href, '/bcm/drills/3?tab=findings');
  assert.equal(items.find((i) => i.key === 'drill:1')?.context, 'Core banking · Tabletop');
  assert.equal(rowDue(items[0], NOW), 'Overdue by 9 days');
  assert.equal(rowDue(items[4], NOW), 'Due in 12 days');
  assert.equal(rowDue(items[6], NOW), '');
});

test('a person with no `mine` block, or an empty one, has no rows; the total is the true count, not the length of the cut lists', () => {
  assert.deepEqual(workItems(undefined, NOW), []);
  assert.deepEqual(workItems({ counts: {} }, NOW), []);
  assert.equal(mineTotal(undefined), null);
  assert.equal(mineTotal({ counts: {} }), 0);
  assert.equal(mineTotal({ counts: { overdue_drills: 14, reviews_due: 3 } }), 17);
  assert.equal(mineLine(10, 17), 'Showing 10 of 17');
  assert.equal(mineLine(1, 1), '1 item');
  assert.equal(mineLine(0, 0), '0 items');
});

test('among work with no day, the process of the more critical activity comes first', () => {
  const mine: Mine = { counts: { bia_without_strategy: 2 }, bia_without_strategy: [
    { id: 1, plan_id: 1, plan_title: 'A', process_name: 'Low one', criticality_rating: 'low' },
    { id: 2, plan_id: 1, plan_title: 'A', process_name: 'Critical one', criticality_rating: 'critical' },
  ] };
  assert.deepEqual(workItems(mine, NOW).map((i) => i.title), ['Critical one', 'Low one']);
});
