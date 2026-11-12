// node --test "src/app/(dashboard)/erm/risks/_components/riskRecord.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  acceptanceBadge, acceptanceExpiryRange, daysUntil, gapToTarget, recordLabel, riskTrajectory, scoresChanged,
  withRiskTypes,
} from './riskRecord.ts';

const NOW = new Date('2026-11-11T12:00:00Z');

test('the acceptance badge follows the derived state and counts the days to expiry', () => {
  assert.equal(acceptanceBadge('none', null, NOW).label, 'Not accepted');
  assert.equal(acceptanceBadge(undefined, null, NOW).tone, 'slate');
  assert.equal(acceptanceBadge('requested', '2027-05-01T00:00:00Z', NOW).tone, 'amber');
  assert.deepEqual(acceptanceBadge('accepted', '2027-05-11T12:00:00Z', NOW),
    { label: 'Accepted', tone: 'emerald', detail: 'Expires in 181 days' });
  assert.equal(acceptanceBadge('expiring', '2026-11-12T12:00:00Z', NOW).detail, 'Expires in 1 day');
  assert.equal(acceptanceBadge('expired', '2026-11-01T12:00:00Z', NOW).detail, 'Expired 10 days ago');
  assert.equal(acceptanceBadge('expired', '2026-11-11T11:00:00Z', NOW).detail, 'Expired today');
});

test('days until a date, and the expiry range the backend takes', () => {
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil('not a date', NOW), null);
  assert.equal(daysUntil('2026-11-21T12:00:00Z', NOW), 10);
  assert.deepEqual(acceptanceExpiryRange(NOW), { min: '2026-11-12', max: '2027-11-11' });
});

test('the trajectory runs before controls, after controls, target, each with its band', () => {
  const steps = riskTrajectory({ inherent_score: 20, residual_score: 12, target_score: 4 });
  assert.deepEqual(steps.map((s) => [s.label, s.score, s.band]), [
    ['Before controls', 20, 'critical'], ['After controls', 12, 'high'], ['Target', 4, 'low']]);
  assert.deepEqual(riskTrajectory({}).map((s) => s.band), [null, null, null]);
  assert.equal(gapToTarget({ residual_score: 12, target_score: 4 }), 8);
  assert.equal(gapToTarget({ residual_score: 3, target_score: 4 }), 0);
  assert.equal(gapToTarget({ residual_score: 12 }), null);
});

test('the reason is asked for only when an edit moves a score', () => {
  const before = { inherent_likelihood: 3, inherent_impact: 3, residual_likelihood: 2, residual_impact: 2 };
  assert.equal(scoresChanged(before, { ...before }), false);
  assert.equal(scoresChanged(before, { ...before, target_likelihood: null }), false);
  assert.equal(scoresChanged(before, { ...before, residual_impact: 3 }), true);
  assert.equal(scoresChanged(before, { ...before, target_impact: 1 }), true);
  assert.equal(scoresChanged(null, { inherent_likelihood: 5 }), false);
});

test('the category list gains the risk types the tenant lacks and keeps what it archived out', () => {
  const tenant = [{ value: 'operational', label: 'Operational' }, { value: 'technology', label: 'Technology' },
    { value: 'third_party', label: 'Vendors' }];
  const all = [...tenant, { value: 'credit', label: 'Credit' }];  // credit archived by the tenant
  const values = withRiskTypes(tenant, all);
  assert.deepEqual(values.slice(0, 3).map((o) => o.label), ['Operational', 'IT / Cyber', 'Vendors']);
  assert.deepEqual(values.slice(3).map((o) => o.value), ['compliance', 'strategic', 'financial', 'market', 'liquidity']);
});

test('a built-in label still at the old default gives way to the plain one', () => {
  assert.equal(recordLabel('Business owner', 'Business owner', 'Accountable executive'), 'Accountable executive');
  assert.equal(recordLabel(undefined, 'Business owner', 'Accountable executive'), 'Accountable executive');
  assert.equal(recordLabel('Sponsor', 'Business owner', 'Accountable executive'), 'Sponsor');
});
