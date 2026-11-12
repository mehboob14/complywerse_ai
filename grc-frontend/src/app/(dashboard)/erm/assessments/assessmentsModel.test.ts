// node --test "src/app/(dashboard)/erm/assessments/assessmentsModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, planTargets, type AssessmentRow } from './assessmentsModel.ts';

const row = (over: Partial<AssessmentRow>): AssessmentRow => ({
  kind: 'risk_workshop', id: 1, title: 'T', unit: null, status: 'In progress', raw_status: 'in_progress', due_date: null,
  lead: null, lead_id: null, mine: false, url: '/erm/risk-assessments/1', ...over,
});

const rows: AssessmentRow[] = [
  row({ id: 1, unit: 'Treasury', status: 'Approved' }),
  row({ id: 2, unit: 'Treasury', status: 'Returned', due_date: '2026-12-01' }),
  row({ id: 3, unit: null, kind: 'framework_it_risk', status: 'Under review' }),
  row({ id: 4, unit: 'Payments', kind: 'self_assessment', status: 'Planned', mine: true }),
  row({ id: 5, unit: 'Ops', status: 'In progress', mine: true, due_date: '2026-11-20' }),
];

test('my assignments come first, then everything else by unit (no unit last) and by status', () => {
  const { mine, byUnit } = arrange(rows, {});
  assert.deepEqual(mine.map((r) => r.id), [5, 4], 'due date first among mine');
  assert.deepEqual(byUnit.map((g) => g.unit), ['Treasury', null]);
  assert.deepEqual(byUnit[0].rows.map((r) => r.id), [2, 1], 'Returned before Approved');
});

test('filters by kind and by status take out rows from both parts', () => {
  assert.deepEqual(arrange(rows, { kind: 'self_assessment' }).mine.map((r) => r.id), [4]);
  assert.deepEqual(arrange(rows, { kind: 'self_assessment' }).byUnit, []);
  const approved = arrange(rows, { status: 'Approved' });
  assert.deepEqual([approved.mine.length, approved.byUnit.flatMap((g) => g.rows).map((r) => r.id)], [0, [1]]);
  assert.equal(arrange([], {}).total, 0);
  assert.equal(arrange(rows, {}).total, 5);
});

test('Plan assessment offers the kinds the person may create, each to its existing create flow', () => {
  const can = (rights: string[]) => (asked: string[]) => asked.some((r) => rights.includes(r));
  assert.deepEqual(planTargets(can(['erm:rcsa:create'])).map((t) => t.href), ['/erm/rcsa/campaigns?action=new']);
  assert.deepEqual(planTargets(can(['erm:risks:create'])).map((t) => t.kind), ['risk_workshop', 'self_assessment', 'framework_it_risk']);
  assert.deepEqual(planTargets(can([])), []);
});
