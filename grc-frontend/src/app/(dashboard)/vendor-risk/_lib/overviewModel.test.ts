// node --test "src/app/(dashboard)/vendor-risk/_lib/overviewModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  attentionRows, barWidth, coverageView, intakeRows, kpis, registerHref, severitySlices, statusBars, sum, tiles, tierSlices, topResidual,
  type Kpis,
} from './overviewModel.ts';

const KPIS: Kpis = {
  active_vendors: 12, onboarded_this_period: 2, critical_coverage: 80, critical_count: 5, critical_covered: 4, portfolio_inherent: 61, portfolio_residual: 44.5,
  open_critical_findings: 3, open_critical_overdue: 1, closure_rate: 40, reviews_due_30d: 4, overdue_reviews: 2, new_signals: 6, attention_open: 9, attention_urgent: 2,
};

test('a tile or a card leads to the register filtered as it counted; in My queue the list is the caller\'s own', () => {
  assert.equal(registerHref({ attention: 'not_tiered' }, 'portfolio'), '/vendor-risk/vendors?attention=not_tiered');
  assert.equal(registerHref({ attention: 'not_tiered' }, 'mine'), '/vendor-risk/vendors?attention=not_tiered&owner=me');
  assert.equal(registerHref({ owner: 'unassigned' }, 'mine'), '/vendor-risk/vendors?owner=unassigned');         // it already names whose
  assert.equal(registerHref({}, 'portfolio'), '/vendor-risk/vendors');
});

test('Verity\'s four tiles count what they link to, and the findings tile says how many are overdue', () => {
  const t = tiles({ not_tiered: 3, no_owner: 4, reassessment_overdue: 1, kpis: KPIS }, 'portfolio');
  assert.deepEqual(t.map((x) => [x.label, x.value, x.href]), [
    ['Not tiered', 3, '/vendor-risk/vendors?attention=not_tiered'],
    ['No business owner', 4, '/vendor-risk/vendors?owner=unassigned'],
    ['Reassessment overdue', 1, '/vendor-risk/vendors?attention=reassessment_overdue'],
    ['Critical findings', 3, '/vendor-risk/findings?severity=critical'],
  ]);
  assert.equal(t[3].caption, '1 overdue');
  assert.equal(tiles({ kpis: { ...KPIS, open_critical_overdue: 0 } }, 'portfolio')[3].caption, undefined);
  assert.deepEqual(tiles({ kpis: KPIS }, 'portfolio').slice(0, 3).map((x) => x.value), [0, 0, 0]);      // an older server: zeros, not a crash
});

test('needs-attention rows follow the register\'s order, skip what is zero, and lead to that filter', () => {
  const rows = attentionRows({ no_owner: 2, reassessment_overdue: 1, not_tiered: 3, weak_grade: 0 }, 'portfolio');
  assert.deepEqual(rows.map((r) => [r.code, r.label, r.count, r.tone]), [
    ['reassessment_overdue', 'Reassessment overdue', 1, 'danger'],
    ['not_tiered', 'Needs tiering', 3, 'warning'],
    ['no_owner', 'No owner', 2, 'warning'],
  ]);
  assert.equal(rows[0].href, '/vendor-risk/vendors?attention=reassessment_overdue');
  assert.deepEqual(attentionRows({}, 'portfolio'), []);                                   // the card says "All clear"
  assert.deepEqual(attentionRows(undefined, 'portfolio'), []);
  const odd = attentionRows({ brand_new: 2 }, 'portfolio');                               // a code from a newer server still shows
  assert.deepEqual([odd[0].code, odd[0].label, odd[0].tone], ['brand_new', 'brand_new', 'neutral']);
});

test('the tier donut keeps the tiers that have someone in them and the untiered apart, each leading to its own list', () => {
  const slices = tierSlices({ critical: 2, high: 0, medium: 3, low: 1, not_tiered: 4 }, 'portfolio');
  assert.deepEqual(slices.map((s) => [s.key, s.value]), [['critical', 2], ['medium', 3], ['low', 1], ['not_tiered', 4]]);
  assert.equal(slices[0].href, '/vendor-risk/vendors?tier=critical');
  assert.equal(slices[3].href, '/vendor-risk/vendors?attention=not_tiered');
  assert.equal(sum(slices), 10);
  assert.deepEqual(tierSlices({}, 'portfolio'), []);
  assert.equal(new Set(slices.map((s) => s.color)).size, 4);                              // each slice its own colour
});

test('open findings by severity lead to that severity in the findings register', () => {
  const slices = severitySlices({ critical: 2, high: 1, medium: 0, low: 0 });
  assert.deepEqual(slices.map((s) => [s.key, s.value, s.href]), [['critical', 2, '/vendor-risk/findings?severity=critical'], ['high', 1, '/vendor-risk/findings?severity=high']]);
  assert.deepEqual(severitySlices(undefined), []);
});

test('the status bars run biggest first with their share, and a status with no word is "Not set"', () => {
  const bars = statusBars({ active: 6, under_review: 3, unset: 1, offboarded: 0 });
  assert.deepEqual(bars.map((b) => [b.label, b.count, b.percent]), [['Active', 6, 60], ['Under review', 3, 30], ['Not set', 1, 10]]);
  assert.deepEqual(statusBars(undefined), []);
  assert.deepEqual(statusBars({ b: 2, a: 2 }).map((b) => b.key), ['a', 'b']);              // ties by name, so it never jumps
});

test('coverage is the share inside the reassessment window, with how many sit outside; nothing to cover is its own state', () => {
  assert.deepEqual(coverageView({ in_window: 6, total: 6, percent: 100 }), { percent: 100, caption: '6/6 critical and high', outside: 0 });
  assert.deepEqual(coverageView({ in_window: 4, total: 5, percent: null }), { percent: 80, caption: '4/5 critical and high', outside: 1 });
  assert.deepEqual(coverageView({ in_window: 0, total: 0, percent: null }), { percent: null, caption: '', outside: 0 });
  assert.deepEqual(coverageView(undefined), { percent: null, caption: '', outside: 0 });
});

test('the intake card shows the first four requests: who asked and when, and whether it may be a duplicate', () => {
  const rows = intakeRows([
    { id: 1, name: 'Northwind', requested_by: 'Dana Okafor', requested_by_id: 5, submitted_at: '2026-09-26T12:00:00', duplicate: true },
    { id: 2, name: 'Gravel', requested_by: null, requested_by_id: null, submitted_at: null, duplicate: false },
    { id: 3, name: 'C', requested_by: 'X', requested_by_id: 1, submitted_at: '2026-09-27', duplicate: false },
    { id: 4, name: 'D', requested_by: 'X', requested_by_id: 1, submitted_at: '2026-09-27', duplicate: false },
    { id: 5, name: 'E', requested_by: 'X', requested_by_id: 1, submitted_at: '2026-09-27', duplicate: false },
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { id: 1, name: 'Northwind', byline: 'Dana Okafor · 26 Sep 2026', duplicate: true });
  assert.equal(rows[1].byline, 'Unattributed');
  assert.deepEqual(intakeRows(undefined), []);
});

test('highest residual is the first five, with a bar from 0 to 100', () => {
  const vendors = Array.from({ length: 8 }, (_, i) => ({ id: i, name: `V${i}`, tier: 'high', residual: 90 - i, inherent: 80, rating: null, grade: 'C' }));
  assert.deepEqual(topResidual(vendors).map((v) => v.id), [0, 1, 2, 3, 4]);
  assert.deepEqual(topResidual(undefined), []);
  assert.equal(barWidth(47.5), 47.5);
  assert.equal(barWidth(140), 100);
  assert.equal(barWidth(-3), 0);
  assert.equal(barWidth(null), 0);
});

test('Compliverse\'s own headline numbers stay: the queue, the size, coverage, residual and the reviews coming up', () => {
  const k = kpis(KPIS);
  assert.deepEqual(k.map((x) => [x.label, x.value]), [
    ['Attention queue', 9], ['Active vendors', 12], ['Critical coverage', '80%'], ['Portfolio residual', 44.5], ['Reviews due ≤30d', 4],
  ]);
  assert.equal(k[0].caption, '2 urgent');
  assert.equal(k[0].tone, 'danger');
  assert.equal(k[0].href, '/vendor-risk/attention');
  assert.equal(k[1].caption, '+2 onboarded · 30d');
  assert.equal(k[2].tone, 'warning');
  assert.equal(k[3].caption, '17 removed vs inherent 61');
  assert.equal(k[4].caption, '2 overdue · 6 new signals');
  const calm = kpis({ ...KPIS, attention_urgent: 0, onboarded_this_period: 0, critical_coverage: 95, overdue_reviews: 0 });
  assert.equal(calm[0].tone, 'success');
  assert.equal(calm[0].caption, undefined);
  assert.equal(calm[1].caption, 'No new onboards · 30d');
  assert.equal(calm[2].tone, 'success');
  assert.equal(calm[4].caption, '6 new signals');
});
