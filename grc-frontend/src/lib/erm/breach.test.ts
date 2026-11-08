// node --test "src/lib/erm/breach.test.ts"
// "Over appetite": the Overview's definition, written out from dashboard.py's Risk Appetite section and checked against a straight port of those lines on a mixed register.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { breaches, categoryOf, exposureByCategory, isActive, isScored, limitOf, unconfigured, type AppetiteConfig, type RiskRow } from './breach.ts';

const cfg = (category: string, tolerance: number | null, max: number | null = null, id = 1): AppetiteConfig => ({ id, category, appetite_level: 'moderate', tolerance_threshold: tolerance, max_acceptable_score: max });
const risk = (id: number, category: string | null, residual: number | null, extra: Partial<RiskRow> = {}): RiskRow => ({ id, title: `R${id}`, category, status: 'open', inherent_score: 20, residual_score: residual, ...extra });

test('the limit is the tolerance, else the maximum, else 12 (a 0 falls through, as `or` does in the Overview)', () => {
  assert.equal(limitOf(cfg('x', 9, 15)), 9);
  assert.equal(limitOf(cfg('x', null, 15)), 15);
  assert.equal(limitOf(cfg('x', 0, 15)), 15);
  assert.equal(limitOf(cfg('x', null, null)), 12);
  assert.equal(limitOf(cfg('x', 0, 0)), 12);
});

test('only active, scored risks in a configured category above its limit are over, the furthest over first', () => {
  const configs = [cfg('financial', 10), cfg('technology', null, 15, 2)];
  const risks = [
    risk(1, 'financial', 10),                                  // equal to the limit: not over
    risk(2, 'financial', 14),                                  // over by 4
    risk(3, 'technology', 25),                                 // over by 10
    risk(4, 'financial', 20, { status: 'closed' }),            // closed: not counted
    risk(5, 'financial', 20, { inherent_score: null }),        // not scored (no inherent): not counted
    risk(6, 'operational', 25),                                // no appetite for its category: nothing to be over
    risk(7, null, 25),                                         // no category = operational
    risk(8, 'financial', null),                                // no residual
    risk(9, 'financial', 14, { status: null }),                // a missing status is open; ties by id
  ];
  const over = breaches(risks, configs);
  assert.deepEqual(over.map((b) => [b.risk.id, b.over]), [[3, 10], [2, 4], [9, 4]]);
  assert.deepEqual(over[0], { risk: risks[2], category: 'technology', limit: 15, score: 25, over: 10 });
});

test('a straight port of the Overview\'s lines gives the same count on a larger register', () => {
  const categories = ['strategic', 'operational', 'financial', 'compliance', 'technology', 'third_party', 'project_change', null];
  const risks: RiskRow[] = [];
  for (let i = 1; i <= 200; i++) risks.push(risk(i, categories[i % categories.length], i % 11 === 0 ? null : (i * 7) % 26, { inherent_score: i % 13 === 0 ? null : 25, status: i % 17 === 0 ? 'closed' : i % 5 === 0 ? null : 'open' }));
  const configs = [cfg('financial', 8), cfg('technology', null, 14, 2), cfg('compliance', 0, 0, 3), cfg('operational', 18, null, 4)];
  // dashboard.py: limit_by_cat; scored_in_configured = scored active risks whose category is configured; breaches = residual > limit
  const limitBy = new Map(configs.map((c) => [c.category, c.tolerance_threshold || c.max_acceptable_score || 12.0]));
  const active = risks.filter((r) => (r.status || 'open') !== 'closed');
  const scored = active.filter((r) => r.inherent_score != null && r.residual_score != null);
  const inConfigured = scored.filter((r) => limitBy.has(r.category || 'operational'));
  const expected = inConfigured.filter((r) => (r.residual_score || 0) > (limitBy.get(r.category || 'operational') as number)).length;
  assert.equal(breaches(risks, configs).length, expected);
  assert.ok(expected > 5, 'the register has real breaches to compare');
  // per category, the exposure rows add up to the same number
  const rows = exposureByCategory(risks, configs);
  assert.equal(rows.reduce((n, r) => n + r.over, 0), expected);
  assert.equal(rows.reduce((n, r) => n + r.active, 0), active.length);
});

test('exposure: configured categories first in the configured order, then the rest by name; unconfigured ones with active risks are listed', () => {
  const configs = [cfg('technology', 10), cfg('financial', 10, null, 2)];
  const rows = exposureByCategory([risk(1, 'operational', 5), risk(2, 'compliance', 5), risk(3, 'technology', 12), risk(4, 'financial', 3, { status: 'closed' })], configs);
  assert.deepEqual(rows.map((r) => r.category), ['technology', 'financial', 'compliance', 'operational']);
  assert.deepEqual(rows.map((r) => r.active), [1, 0, 1, 1]);
  assert.deepEqual(rows.map((r) => r.over), [1, 0, 0, 0]);
  assert.deepEqual(unconfigured(rows).map((r) => r.category), ['compliance', 'operational']);
  assert.equal(rows[2].limit, null);
});

test('the helpers read a missing category, status and score the Overview\'s way', () => {
  assert.equal(categoryOf({ category: null }), 'operational');
  assert.equal(isActive({ status: undefined }), true);
  assert.equal(isActive({ status: 'closed' }), false);
  assert.equal(isScored({ inherent_score: 0, residual_score: 0 }), true, 'a 0 score is a score');
  assert.equal(isScored({ inherent_score: 5, residual_score: undefined }), false);
});
