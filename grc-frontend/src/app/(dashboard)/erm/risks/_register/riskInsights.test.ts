// node --test "src/app/(dashboard)/erm/risks/_register/riskInsights.test.ts"
// The Insights numbers, held to the rules of the server's dashboards (modules/erm/routers/risks.py: `/dashboard/by-register`, `/dashboard/by-source`, `/heatmap`): written out from the
// server's code as fixtures, so a change to either side fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { byCategory, byRegister, bySource, matrixRows, placedCount, severityCounts, sourceOf, statusCounts, workload } from './riskInsights.ts';
import { serverLow, type RiskRow } from './riskModel.ts';

const r = (id: number, over: Partial<RiskRow> = {}): RiskRow => ({ id, title: `R${id}`, status: 'open', category: 'operational', ...over });

const ROWS: RiskRow[] = [
  r(1, { register_type: 'NCA Template', residual_score: 25, inherent_score: 25, owner_id: 1, owner_name: 'Ana', status: 'open' }),
  r(2, { register_type: 'NCA Template', residual_score: 12, inherent_score: 20, owner_id: 1, owner_name: 'Ana', business_owner_id: 2, business_owner_name: 'Bo', status: 'mitigating' }),
  r(3, { register_type: 'ISO 27001', inherent_score: 6, status: 'accepted' }),
  r(4, { register_type: ' ', status: 'closed', residual_score: 3 }),
  r(5, { register_type: null, status: 'Resolved' }),
  r(6, { register_type: 'ISO 27001', residual_score: 0, inherent_score: 19, status: 'weird', source_type: 'incident' }),
];

test('severity: the residual score, else the inherent; the server counted an unscored risk in Low, so low + none is its Low', () => {
  const c = severityCounts(ROWS);
  assert.deepEqual(c, { critical: 1, high: 2, medium: 1, low: 1, none: 1, scored: 5 });
  assert.equal(serverLow(c), 2);
});

test('status buckets are the dashboard\'s five', () => {
  assert.deepEqual(statusCounts(ROWS), { open: 2, in_treatment: 1, mitigated: 0, accepted: 1, closed: 2 });
});

test('by register: no type is "Standard", biggest first, the mean residual over the residual scores that exist, two decimals', () => {
  const out = byRegister(ROWS);
  assert.deepEqual(out.map((g) => [g.register, g.total]), [['ISO 27001', 2], ['NCA Template', 2], ['Standard', 2]]);
  const nca = out.find((g) => g.register === 'NCA Template')!;
  assert.equal(nca.avgResidual, 18.5);
  assert.equal(nca.people, 2, 'Ana as risk owner and Bo as business owner');
  assert.deepEqual(nca.status, { open: 1, in_treatment: 1, mitigated: 0, accepted: 0, closed: 0 });
  assert.equal(out.find((g) => g.register === 'ISO 27001')!.avgResidual, 0, 'a zero residual is no residual: the mean has nothing to average');
  assert.equal(byRegister([r(1, { residual_score: 1 }), r(2, { residual_score: 2 }), r(3, { residual_score: 2 })])[0].avgResidual, 1.67);
});

test('by source: what the row states; else the register type and the assessments say (`_infer_source_type`)', () => {
  assert.equal(sourceOf({ source_type: 'rcsa', register_type: 'NCA' }), 'rcsa');
  assert.equal(sourceOf({ register_type: 'UBL Template' }), 'ubl_import');
  assert.equal(sourceOf({ register_type: ' nca ' }), 'nca_import');
  assert.equal(sourceOf({ register_type: 'SOX', in_assessment: true }), 'assessment');
  assert.equal(sourceOf({ register_type: 'SOX' }), 'register_import');
  assert.equal(sourceOf({}), 'manual');
  const out = bySource(ROWS);
  assert.deepEqual(out.map((g) => [g.source, g.total]), [['manual', 2], ['nca_import', 2], ['incident', 1], ['register_import', 1]]);
});

test('categories and the people who hold risks', () => {
  assert.deepEqual(byCategory([r(1), r(2), r(3, { risk_category: 'technology' })]), [{ key: 'operational', total: 2 }, { key: 'technology', total: 1 }]);
  assert.deepEqual(workload(ROWS), [{ id: 1, name: 'Ana', total: 2 }, { id: 2, name: 'Bo', total: 1 }]);
  assert.deepEqual(workload([r(1, { owner_id: 5, owner_name: 'Cy', business_owner_id: 5, business_owner_name: 'Cy' })]), [{ id: 5, name: 'Cy', total: 1 }], 'one person in both roles counts once');
});

test('the matrix is the server\'s heatmap: likelihood 5 at the top, impact 1 at the left, only risks with both', () => {
  const rows = [r(1, { residual_likelihood: 5, residual_impact: 1 }), r(2, { residual_likelihood: 5, residual_impact: 1 }), r(3, { residual_likelihood: 1, residual_impact: 5 }), r(4, { residual_likelihood: 3 })];
  const m = matrixRows(rows, 'residual');
  assert.equal(m.length, 5);
  assert.deepEqual(m[0].map((c) => [c.l, c.i, c.count]), [[5, 1, 2], [5, 2, 0], [5, 3, 0], [5, 4, 0], [5, 5, 0]]);
  assert.deepEqual(m[4].map((c) => c.count), [0, 0, 0, 0, 1]);
  assert.equal(placedCount(m), 3);
  assert.equal(placedCount(matrixRows(rows, 'inherent')), 0);
});
