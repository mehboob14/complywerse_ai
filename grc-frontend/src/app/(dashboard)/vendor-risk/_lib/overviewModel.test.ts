// node --test "src/app/(dashboard)/vendor-risk/_lib/overviewModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  attentionRows, barWidth, counters, coverageView, domainRows, postureView, registerHref, severitySlices, signalRows, statusBars, sum, tierGaps, tiles, tierSlices, topResidual, verdictOf,
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
  const odd = attentionRows({ brand_new: 2 }, 'portfolio');                               // a code from a newer server still shows, in readable words (Rule U1: no raw code on a screen)
  assert.deepEqual([odd[0].code, odd[0].label, odd[0].tone], ['brand_new', 'Brand new', 'neutral']);
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

test('highest residual is the first five, with a bar from 0 to 100', () => {
  const vendors = Array.from({ length: 8 }, (_, i) => ({ id: i, name: `V${i}`, tier: 'high', residual: 90 - i, inherent: 80, rating: null, grade: 'C' }));
  assert.deepEqual(topResidual(vendors).map((v) => v.id), [0, 1, 2, 3, 4]);
  assert.deepEqual(topResidual(undefined), []);
  assert.equal(barWidth(47.5), 47.5);
  assert.equal(barWidth(140), 100);
  assert.equal(barWidth(-3), 0);
  assert.equal(barWidth(null), 0);
});

test('the counters band is the four tiles and the requests waiting, the true total of them, linking to Intake', () => {
  const c = counters({ not_tiered: 3, no_owner: 4, reassessment_overdue: 1, kpis: KPIS, intake_pending: { total: 7, items: [] } }, 'portfolio');
  assert.deepEqual(c.map((x) => [x.key, x.value, x.tone]), [['not_tiered', 3, 'warning'], ['no_owner', 4, 'warning'], ['overdue', 1, 'danger'], ['critical', 3, 'danger'], ['requests', 7, 'pending']]);
  assert.equal(c[4].href, '/vendor-risk/intake');
  assert.equal(c[3].caption, '1 overdue');
  assert.equal(counters({ kpis: KPIS }, 'portfolio')[4].value, 0);
});

test('the verdict: over the appetite line, within eight points of it, inside it; none without an appetite', () => {
  assert.deepEqual([50, 45.1, 45, 37, 36.9].map((r) => verdictOf(r, 45)), ['over', 'over', 'approaching', 'approaching', 'within']);
  assert.equal(verdictOf(50, null), 'unset');
  assert.equal(verdictOf(50, undefined), 'unset');
});

test('the posture card says the number of the server for overdue, names the two coverages apart, and counts the points the controls remove', () => {
  const p = postureView({ kpis: KPIS, coverage: { in_window: 4, total: 5, percent: 80 }, reassessment_overdue: 1 }, 45);
  assert.deepEqual([p.verdict, p.gap, p.residual, p.inherent, p.removed], ['approaching', '0.5 of headroom', 44.5, 61, 17]);
  assert.equal(p.headline, 'Portfolio residual 44.5 against an appetite of 45');
  assert.deepEqual(p.assessed, { percent: 80, caption: '4/5 critical vendors have a residual score', tone: 'warning' });
  assert.deepEqual(p.window, { percent: 80, caption: '4/5 critical and high', outside: 1 });
  assert.deepEqual(p.reviews, { due: 4, overdue: 1 }, 'the overdue is reassessment_overdue, not the older count of every vendor with a past date (2)');
  const bare = postureView({ kpis: { ...KPIS, critical_count: 0, critical_coverage: 0, portfolio_inherent: 40, portfolio_residual: 52 } }, null);
  assert.deepEqual([bare.verdict, bare.gap, bare.removed, bare.assessed.percent, bare.reviews.overdue], ['unset', '', 0, null, null]);
  assert.equal(postureView({ kpis: { ...KPIS, critical_coverage: 95 } }, 45).assessed.tone, 'success');
  assert.equal(postureView({ kpis: KPIS }, 40).gap, '4.5 over the line');
});

test('the findings gather by domain: the most first, ties by name, each leading to that domain in the register', () => {
  const rows = domainRows({ cybersecurity: 4, data_privacy: 4, legal: 0, esg: 1, brand_new: 2 });
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [['Cybersecurity', 4], ['Data Privacy', 4], ['Brand New', 2], ['ESG & Sustainability', 1]]);
  assert.equal(rows[0].href, '/vendor-risk/findings?domain=cybersecurity');
  assert.equal(domainRows(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`d${i}`, i + 1]))).length, 8);
  assert.deepEqual(domainRows(undefined), []);
});

test('the signal feed is the latest six with the severity said in words; one nobody has acknowledged is fresh', () => {
  const feed = Array.from({ length: 8 }, (_, i) => ({ id: i, vendor_id: 1, vendor_name: i === 0 ? null : 'Acme', signal_type: 'security_rating', severity: i === 1 ? 'critical' : 'info', title: i === 2 ? 'TLS expires' : null, occurred_at: '2026-11-01', acknowledged: i > 0 }));
  const rows = signalRows(feed);
  assert.equal(rows.length, 6);
  assert.deepEqual([rows[0].title, rows[0].meta, rows[0].fresh, rows[0].severity, rows[0].tone], ['Security Rating', 'A vendor · Security Rating · 1 Nov 2026', true, 'Info', 'neutral']);
  assert.deepEqual([rows[1].severity, rows[1].tone, rows[2].title], ['Critical', 'danger', 'TLS expires']);
  assert.deepEqual(signalRows(undefined), []);
});

test('inherent against residual runs in the order of the ramp, whatever order the server sent', () => {
  assert.deepEqual(tierGaps([{ tier: 'low', inherent: 20, residual: 10 }, { tier: 'critical', inherent: 90, residual: 70 }]).map((r) => [r.label, r.inherent, r.residual]), [['Critical', 90, 70], ['Low', 20, 10]]);
  assert.deepEqual(tierGaps(undefined), []);
});
