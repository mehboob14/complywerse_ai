// node --test "src/app/(dashboard)/vendor-risk/_overview/chartsModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  attentionFacts, contractCategories, findingCategories, heatData, heatHref, heroTiles, kpiTrend, nextStepBars, platformBars, reviewCategories, signalCategories,
  stackTotal, stageBars, tierDonut, topFive, topResidualBars, trendCard, trendPoints, windowMonths, TIER_COLOR, BAND_COLOR, type ContractLike, type OverviewCharts,
} from './chartsModel.ts';
import type { Dashboard } from '../_lib/overviewModel.ts';
import { STATUS, RAMP } from '../../../../components/overview/charts/palette.ts';

const NOW = new Date(Date.UTC(2026, 10, 11));        // 11 Nov 2026

const DASH = {
  scope: 'portfolio',
  kpis: {
    active_vendors: 12, onboarded_this_period: 2, critical_coverage: 80, critical_count: 5, critical_covered: 4, portfolio_inherent: 61, portfolio_residual: 48.5,
    open_critical_findings: 3, open_critical_overdue: 1, closure_rate: 40, reviews_due_30d: 4, overdue_reviews: 2, new_signals: 6,
  },
  tier_distribution: {}, inherent_vs_residual: [{ tier: 'critical', inherent: 80, residual: 60 }, { tier: 'high', inherent: 60, residual: 40 }, { tier: 'medium', inherent: 0, residual: 0 }, { tier: 'low', inherent: 15, residual: 10 }],
  findings_posture: { open: 5, in_remediation: 2, accepted: 1, closed: 4 }, findings_severity: {}, findings_by_domain: { legal: 1, cybersecurity: 4 }, monitoring_feed: [],
  top_residual_vendors: [
    { id: 1, name: 'Atlas', tier: 'critical', residual: 80, inherent: 90, rating: 'critical', grade: 'E' },
    { id: 2, name: 'Mail', tier: null, residual: 30, inherent: 40, rating: 'medium', grade: null },
    { id: 3, name: 'Unscored', tier: 'low', residual: null, inherent: null, rating: null, grade: null },
  ],
  coverage: { in_window: 7, total: 9, percent: 78 }, reassessment_overdue: 2, attention_counts: { reassessment_overdue: 2, no_owner: 3, not_tiered: 1 },
  tier_counts: { critical: 5, high: 4, medium: 0, low: 2, not_tiered: 1 },
} as unknown as Dashboard;

const TREND = {
  appetite: 45,
  series: [
    { month: '2026-06', inherent: 60, residual: 50, open_findings: 20, critical_findings: 5, vendor_count: 20 },
    { month: '2026-09', inherent: 61, residual: 47.4, open_findings: 22, critical_findings: 4, vendor_count: 21 },
    { month: '2026-10', inherent: 62, residual: 46.6, open_findings: 24, critical_findings: 4, vendor_count: 22 },
  ],
};

test('the window is twelve calendar months ending with this one, and the year is said where it changes', () => {
  const w = windowMonths(NOW);
  assert.equal(w.length, 12);
  assert.deepEqual([w[0], w[1], w[2], w[11]], [{ key: '2025-12', label: 'Dec 25' }, { key: '2026-01', label: 'Jan 26' }, { key: '2026-02', label: 'Feb' }, { key: '2026-11', label: 'Nov' }]);
  assert.deepEqual(windowMonths(new Date(Date.UTC(2027, 0, 5)), 2), [{ key: '2026-12', label: 'Dec 26' }, { key: '2027-01', label: 'Jan 27' }]);
});

test('the trend is one point per month; a month with no snapshot is a gap in every field, never 0; the controls\' work is inherent less residual', () => {
  const p = trendPoints(TREND.series, NOW);
  assert.equal(p.length, 12);
  const byKey = Object.fromEntries(p.map((x) => [x.key, x]));
  assert.equal(byKey['2026-06'].residual, 50);
  assert.equal(byKey['2026-06'].removed, 10);
  assert.equal(byKey['2026-07'].residual, null);
  assert.equal(byKey['2026-07'].removed, null);
  assert.equal(byKey['2026-07'].open, null);
  assert.equal(byKey['2026-10'].open, 24);
  assert.deepEqual(trendPoints(undefined, NOW).filter((x) => x.residual !== null), []);
  assert.equal(trendPoints([{ month: '2026-11', inherent: 40, residual: 55 }], NOW)[11].removed, 0);                  // the controls never remove a negative amount
  assert.equal(trendPoints([{ month: '2026-11', inherent: 40, residual: 38 }], NOW)[11].open, null);                   // an older server sends no counts: not recorded
});

test('a figure\'s history: nothing under two recorded months; the change is on whole numbers and names the month it is against', () => {
  const p = trendPoints(TREND.series, NOW);
  const r = kpiTrend(p, (x) => x.residual, 'Residual risk', 'down', [' point', ' points'], 1);
  assert.equal(r.spark?.values.length, 12);
  assert.deepEqual(r.spark?.values.filter((v) => v !== null), [50, 47.4, 46.6]);
  assert.deepEqual(r.delta, { text: 'Down 0.8 points', direction: 'down', tone: 'good', since: 'since Sep' });      // 47.4 -> 46.6 at the score's own precision (a whole-number change would say "none")
  assert.match(r.spark?.summary ?? '', /^Residual risk: from 50 in Jun to 47 in Oct, down 3\./);
  assert.deepEqual(kpiTrend(p, (x) => x.residual, 'Residual risk', 'down', [' point', ' points'], 0).delta?.text, 'No change');       // at whole points 47 -> 47
  const one = kpiTrend(trendPoints([TREND.series[0]], NOW), (x) => x.residual, 'Residual risk', 'down');
  assert.deepEqual(one, { spark: null, delta: null });
  const up = kpiTrend(trendPoints(TREND.series, NOW), (x) => x.open, 'Open findings', 'down', [' finding', ' findings']);
  assert.deepEqual(up.delta, { text: 'Up 2 findings', direction: 'up', tone: 'bad', since: 'since Sep' });            // more findings is bad
});

test('the hero row: six figures from the dashboard, every one opening the page it counts; the history only for the whole portfolio and only when the trend answered', () => {
  const tiles = heroTiles(DASH, TREND, 'portfolio', NOW);
  assert.deepEqual(tiles.map((t) => t.key), ['vendors', 'residual', 'findings', 'assessed', 'window', 'attention']);
  assert.ok(tiles.every((t) => t.href.startsWith('/vendor-risk/') && t.linkLabel.length > 0));
  const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
  assert.equal(by.vendors.value, '12');
  assert.equal(by.vendors.note, '2 added in 30 days');
  assert.equal(by.vendors.href, '/vendor-risk/vendors');
  assert.equal(by.vendors.spark, null);                                    // the snapshot's vendor count includes requests: no history is drawn for it
  assert.equal(by.residual.value, '48.5');
  assert.equal(by.residual.tone, 'danger');                                // over the appetite of 45
  assert.equal(by.residual.note, '3.5 over the line. Appetite 45');
  assert.equal(by.residual.href, '/vendor-risk/vendors?sort=risk%3Aasc');
  assert.ok(by.residual.spark && by.residual.delta);
  assert.equal(by.findings.value, '7');                                    // open + in remediation
  assert.equal(by.findings.tone, 'danger');
  assert.equal(by.findings.note, '3 critical');
  assert.equal(by.findings.href, '/vendor-risk/findings');
  assert.equal(by.assessed.value, '80%');
  assert.equal(by.assessed.progress, 80);
  assert.equal(by.assessed.note, '4/5');
  assert.equal(by.assessed.tone, 'warning');
  assert.equal(by.assessed.href, '/vendor-risk/vendors?tier=critical');
  assert.equal(by.window.value, '78%');
  assert.equal(by.window.note, '7/9, 2 outside');
  assert.equal(by.window.href, '/vendor-risk/vendors?attention=reassessment_overdue');
  assert.equal(heroTiles({ ...DASH, coverage: { in_window: 9, total: 9, percent: 100 } } as Dashboard, TREND, 'portfolio', NOW).find((t) => t.key === 'window')?.href, '/vendor-risk/vendors?sort=next_reassessment%3Aasc');
  const mine = heroTiles(DASH, TREND, 'mine', NOW);
  assert.ok(mine.every((t) => t.spark === null && t.delta === null));
  assert.equal(mine.find((t) => t.key === 'vendors')?.href, '/vendor-risk/vendors?owner=me');
  assert.equal(mine.find((t) => t.key === 'attention')?.href, '/vendor-risk/attention?scope=mine');
  const failed = heroTiles(DASH, undefined, 'portfolio', NOW);
  assert.equal(failed.find((t) => t.key === 'residual')?.note, 'Appetite unavailable');
  assert.ok(failed.every((t) => t.spark === null));
  assert.equal(heroTiles(DASH, undefined, 'portfolio', NOW, true).find((t) => t.key === 'residual')?.note, undefined);
  const unscored = heroTiles({ ...DASH, top_residual_vendors: [], kpis: { ...DASH.kpis, portfolio_residual: 0, portfolio_inherent: 0 } } as Dashboard, TREND, 'portfolio', NOW);
  assert.equal(unscored.find((t) => t.key === 'residual')?.value, null);                      // no scored vendor: the residual is not recorded, not a score of 0 that reads "within appetite"
  const noCritical = heroTiles({ ...DASH, kpis: { ...DASH.kpis, critical_count: 0 }, coverage: undefined } as Dashboard, TREND, 'portfolio', NOW);
  assert.equal(noCritical.find((t) => t.key === 'assessed')?.value, null);                    // "not recorded", never 0%
  assert.equal(noCritical.find((t) => t.key === 'window')?.value, null);
});

test('Needs attention is ONE figure (the vendors that wait on a next step) and a thin bar of how urgent, the register tones; it opens the Work queue', () => {
  const f = attentionFacts(DASH.attention_counts, 'portfolio');              // reassessment_overdue 2 (danger), no_owner 3 + not_tiered 1 (warning)
  assert.deepEqual(f.parts.map((p) => [p.label, p.value]), [['Urgent', 2], ['To fix', 4], ['In hand', 0]]);
  assert.equal(f.total, 6);
  assert.equal(f.urgent, 2);
  assert.equal(f.href, '/vendor-risk/attention');
  const tile = heroTiles(DASH, TREND, 'portfolio', NOW).find((t) => t.key === 'attention');
  assert.equal(tile?.value, '6');
  assert.equal(tile?.tone, 'danger');
  assert.equal(tile?.note, '2 urgent');
  assert.equal(tile?.bar?.length, 3);
  const quiet = heroTiles({ ...DASH, attention_counts: {} } as Dashboard, TREND, 'portfolio', NOW).find((t) => t.key === 'attention');
  assert.equal(quiet?.value, '0');                                          // a vendor nobody waits on is a real zero: the dashboard answered
  assert.equal(quiet?.tone, 'default');
  assert.equal(quiet?.bar, undefined);
});

test('the trend card has the months with a score; with none it says so instead of drawing a flat line', () => {
  const c = trendCard(TREND, NOW);
  assert.equal(c.rows.length, 12);
  assert.equal(c.recorded, 3);
  assert.deepEqual(c.rows[7], { label: 'Jul', residual: null, inherent: null });
  assert.equal(trendCard({ appetite: 45, series: [] }, NOW).recorded, 0);
  assert.equal(trendCard(undefined, NOW).recorded, 0);
});

test('vendors by tier: the tiers with someone in them, the untiered apart, in the tier ramp, each opening the register', () => {
  const s = tierDonut(DASH.tier_counts, 'portfolio');
  assert.deepEqual(s.map((x) => [x.key, x.value]), [['critical', 5], ['high', 4], ['low', 2], ['not_tiered', 1]]);
  assert.equal(s[0].color, STATUS.bad);
  assert.equal(s[3].color, STATUS.neutral);
  assert.equal(s[0].href, '/vendor-risk/vendors?tier=critical');
  assert.equal(s[3].href, '/vendor-risk/vendors?attention=not_tiered');
  assert.equal(tierDonut(DASH.tier_counts, 'mine')[1].href, '/vendor-risk/vendors?tier=high&owner=me');
  assert.deepEqual(tierDonut({}, 'portfolio'), []);
});

const MATRIX: OverviewCharts['risk_matrix'] = {
  tiers: ['critical', 'high', 'medium', 'low', 'not_tiered'], bands: ['critical', 'high', 'medium', 'low', 'none'],
  cells: {
    critical: { critical: 2, high: 2, medium: 1, low: 0, none: 0 }, high: { critical: 0, high: 1, medium: 2, low: 1, none: 0 }, medium: { critical: 0, high: 0, medium: 0, low: 0, none: 0 },
    low: { critical: 0, high: 0, medium: 0, low: 2, none: 0 }, not_tiered: { critical: 0, high: 0, medium: 0, low: 0, none: 1 },
  },
};

test('the risk grid has every tier row and band column, the numbers the server counted, and a cell opens its tier', () => {
  const h = heatData(MATRIX);
  assert.deepEqual(h.rows, ['Critical', 'High', 'Medium', 'Low', 'Not tiered']);
  assert.deepEqual(h.cols, ['Critical', 'High', 'Medium', 'Low', 'Not scored']);
  assert.deepEqual(h.cells[0], [2, 2, 1, 0, 0]);
  assert.equal(h.total, 12);
  assert.equal(heatHref('critical', 'portfolio'), '/vendor-risk/vendors?tier=critical');
  assert.equal(heatHref('not_tiered', 'mine'), '/vendor-risk/vendors?attention=not_tiered&owner=me');
  const empty = heatData(undefined);
  assert.equal(empty.total, 0);
  assert.equal(empty.cells.length, 5);
});

test('the highest residual scores are bars in the colour of their band on the tenant bands, the band in words beside the figure, each a link to the vendor; a vendor with no score is left out', () => {
  const bars = topResidualBars(DASH.top_residual_vendors, { critical: 75, high: 50, medium: 25 });
  assert.deepEqual(bars.map((b) => [b.label, b.value, b.valueText, b.color, b.href]), [['Atlas', 80, '80 Critical', BAND_COLOR.critical, '/vendor-risk/vendors/1'], ['Mail', 30, '30 Medium', BAND_COLOR.medium, '/vendor-risk/vendors/2']]);
  assert.equal(topResidualBars(DASH.top_residual_vendors, { critical: 90, high: 80, medium: 60 })[0].color, BAND_COLOR.high);      // 80 is "high", not "critical", on a looser policy: the colour follows the policy
  const many = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: `V${i}`, tier: 'low', residual: 50 - i, inherent: 60, rating: null, grade: null }));
  assert.equal(topResidualBars(many, { critical: 75, high: 50, medium: 25 }).length, 5);                                              // never more than five rows
});

test('a list on the Overview is the five biggest and says how many there are; what vendors wait on opens the register on each step', () => {
  const t = topFive([{ value: 1 }, { value: 7 }, { value: 3 }, { value: 9 }, { value: 2 }, { value: 4 }, { value: 8 }]);
  assert.deepEqual(t.rows.map((r) => r.value), [9, 8, 7, 4, 3]);
  assert.equal(t.total, 7);
  const bars = nextStepBars(DASH.attention_counts, 'portfolio');
  assert.deepEqual(bars.rows.map((b) => [b.label, b.value]), [['No owner', 3], ['Reassessment overdue', 2], ['Needs tiering', 1]]);
  assert.equal(bars.total, 3);
  assert.equal(bars.rows[1].color, STATUS.bad);
  assert.equal(bars.rows[2].color, STATUS.warn);
  assert.equal(bars.rows[1].href, '/vendor-risk/vendors?attention=reassessment_overdue');
  assert.deepEqual(nextStepBars({}, 'portfolio'), { rows: [], total: 0 });
});

test('the review calendar is the server\'s buckets by tier in date order; overdue opens the register on the tile\'s own filter', () => {
  const reviews: OverviewCharts['reviews'] = {
    buckets: ['overdue', 'd30', 'd60', 'd90', 'later', 'none'], tiers: ['critical', 'high', 'medium', 'low', 'not_tiered'], apart: 2,
    cells: {
      overdue: { critical: 2, high: 1, medium: 0, low: 0, not_tiered: 0 }, d30: { critical: 0, high: 1, medium: 1, low: 0, not_tiered: 0 }, d60: { critical: 0, high: 0, medium: 0, low: 0, not_tiered: 0 },
      d90: { critical: 0, high: 0, medium: 0, low: 0, not_tiered: 0 }, later: { critical: 1, high: 0, medium: 0, low: 3, not_tiered: 0 }, none: { critical: 0, high: 0, medium: 0, low: 1, not_tiered: 2 },
    },
  };
  const cats = reviewCategories(reviews, 'portfolio');
  assert.deepEqual(cats.map((c) => c.label), ['Overdue', 'In 30 d', 'In 60 d', 'In 90 d', 'Later', 'No date']);
  assert.equal(cats[0].cells.critical, 2);
  assert.equal(cats[0].href, '/vendor-risk/vendors?attention=reassessment_overdue');
  assert.equal(cats[1].href, '/vendor-risk/vendors?sort=next_reassessment%3Aasc');
  assert.equal(stackTotal(cats), 12);
  assert.equal(stackTotal(reviewCategories(undefined, 'portfolio')), 0);
});

test('the stages: the five with most vendors, the vendors with no review started as one more, each opening the register on that stage', () => {
  const stages = { items: [{ key: 'intake', label: 'Intake & Scoping', count: 1 }, { key: 'tiering', label: 'Inherent Risk Tiering', count: 0 }, { key: 'scoring', label: 'Scoring', count: 3 }], not_started: 4 };
  const bars = stageBars(stages, 'portfolio');
  assert.deepEqual(bars.rows.map((b) => [b.label, b.value]), [['Not started', 4], ['Scoring', 3], ['Intake', 1]]);       // a stage nobody is in is not a bar
  assert.equal(bars.total, 3);
  assert.equal(bars.rows[0].href, '/vendor-risk/vendors?stage=not_started');
  assert.equal(bars.rows[1].href, '/vendor-risk/vendors?stage=scoring');
  assert.equal(stageBars(stages, 'mine').rows[1].href, '/vendor-risk/vendors?stage=scoring&owner=me');
  assert.equal(stageBars({ items: [{ key: 'custom', label: 'A stage of its own', count: 2 }], not_started: 0 }, 'portfolio').rows[0].label, 'A stage of its own');
  assert.deepEqual(stageBars(undefined, 'portfolio'), { rows: [], total: 0 });
  const eleven = { items: Array.from({ length: 11 }, (_, i) => ({ key: `s${i}`, label: `S${i}`, count: i + 1 })), not_started: 0 };
  assert.equal(stageBars(eleven, 'portfolio').rows.length, 5);
  assert.equal(stageBars(eleven, 'portfolio').total, 11);
});

const FINDINGS: OverviewCharts['findings'] = {
  severities: ['critical', 'high', 'medium', 'low'], statuses: ['open', 'in_remediation', 'accepted', 'closed'], ages: ['d30', 'd60', 'd90', 'older'],
  matrix: {
    critical: { open: 2, in_remediation: 1, accepted: 0, closed: 1 }, high: { open: 1, in_remediation: 0, accepted: 1, closed: 0 },
    medium: { open: 0, in_remediation: 0, accepted: 0, closed: 3 }, low: { open: 0, in_remediation: 0, accepted: 0, closed: 0 },
  },
  age: { critical: { d30: 1, d60: 0, d90: 0, older: 2 }, high: { d30: 0, d60: 1, d90: 0, older: 0 }, medium: { d30: 0, d60: 0, d90: 0, older: 0 }, low: { d30: 0, d60: 0, d90: 0, older: 0 } },
  overdue: { critical: 1, high: 0, medium: 0, low: 0 },
};

test('findings by severity split by status (a bar counts closed ones too, so it opens all of them) or the open ones by age; a severity opens its findings', () => {
  const status = findingCategories(FINDINGS, 'status');
  assert.deepEqual(status.map((c) => c.label), ['Critical', 'High', 'Medium', 'Low']);
  assert.deepEqual(status[0].cells, { open: 2, in_remediation: 1, accepted: 0, closed: 1 });
  assert.equal(status[0].href, '/vendor-risk/findings?severity=critical&scope=all');
  const age = findingCategories(FINDINGS, 'age');
  assert.deepEqual(age[0].cells, { d30: 1, d60: 0, d90: 0, older: 2 });
  assert.equal(age[0].href, '/vendor-risk/findings?severity=critical');
  assert.equal(stackTotal(findingCategories(undefined, 'status')), 0);
  assert.equal(RAMP.length, 5);
});

test('signals by month: the months are the server\'s, split by severity, the year said at January', () => {
  const cats = signalCategories({
    waiting: { critical: 1, high: 0, medium: 0, low: 0 },
    months: [{ month: '2026-12', critical: 1, high: 2, medium: 0, low: 0 }, { month: '2027-01', critical: 0, high: 1, medium: 1, low: 4 }],
  });
  assert.deepEqual(cats.map((c) => c.label), ['Dec', 'Jan 27']);
  assert.deepEqual(cats[1].cells, { critical: 0, high: 1, medium: 1, low: 4 });
  assert.ok(cats.every((c) => c.href === '/vendor-risk/monitoring'));
  assert.deepEqual(signalCategories(undefined), []);
});

const contract = (id: number, ends_on: string | null, tier: string | null, owner: number | null, state = 'in_force', status = 'active'): ContractLike => ({ id, status, state, ends_on, vendor: { id, name: `V${id}`, tier, owner_id: owner } });

test('the contract timeline: active contracts by the month they end, the lapsed apart, by the vendor\'s tier; My vendors are the person\'s own', () => {
  const items = [
    contract(1, '2026-10-20', 'critical', 7, 'lapsed'), contract(2, '2026-11-30', 'critical', 7, 'decide'), contract(3, '2026-11-12', null, 8), contract(4, '2027-02-03', 'high', 7),
    contract(5, '2028-01-01', 'low', 7), contract(6, '2027-03-01', 'low', 7, 'in_force', 'draft'), contract(7, null, 'low', 7), contract(8, '2026-11-11', 'medium', 7, 'decide'),
  ];
  const all = contractCategories(items, 'portfolio', 7, NOW);
  assert.equal(all.categories.length, 13);
  assert.deepEqual(all.categories.slice(0, 3).map((c) => c.label), ['Lapsed', 'Nov 26', 'Dec']);
  assert.equal(all.categories[0].cells.critical, 1);
  assert.equal(all.categories[1].cells.critical, 1);
  assert.equal(all.categories[1].cells.not_tiered, 1);
  assert.equal(all.categories[1].cells.medium, 1);                                  // ending today is not lapsed
  assert.equal(stackTotal(all.categories), 5);                                      // 2028, the draft and the one with no date are not drawn
  assert.deepEqual(all.facts, { lapsed: 1, decide: 2, total: 5 });
  assert.ok(all.categories.every((c) => c.href === '/vendor-risk/contracts?sort=ends:asc'));
  const mine = contractCategories(items, 'mine', 8, NOW);
  assert.equal(stackTotal(mine.categories), 1);
  assert.equal(stackTotal(contractCategories(items, 'mine', null, NOW).categories), 0);   // who the person is is not known: nothing is claimed as theirs
  assert.equal(stackTotal(contractCategories(undefined, 'portfolio', null, NOW).categories), 0);
});

test('concentration: the five platforms most vendors rely on and how many there are, each opening what suppliers run on it', () => {
  const list = [{ platform: 'AWS', vendor_count: 6, critical_count: 3 }, { platform: 'Azure', vendor_count: 4, critical_count: 1 }, { platform: 'Okta', vendor_count: 2, critical_count: 0 }];
  const bars = platformBars(list);
  assert.deepEqual(bars.rows.map((b) => [b.label, b.value, b.note, b.href]), [
    ['AWS', 6, undefined, '/vendor-risk/dependencies?view=technology&q=AWS'], ['Azure', 4, undefined, '/vendor-risk/dependencies?view=technology&q=Azure'], ['Okta', 2, undefined, '/vendor-risk/dependencies?view=technology&q=Okta'],
  ]);
  const seven = platformBars(Array.from({ length: 7 }, (_, i) => ({ platform: `P${i}`, vendor_count: 9 - i, critical_count: 0 })));
  assert.equal(seven.rows.length, 5);
  assert.equal(seven.total, 7);
  assert.deepEqual(platformBars(undefined), { rows: [], total: 0 });
  assert.equal(TIER_COLOR.not_tiered, STATUS.neutral);
});
