// node --test "src/**/_overview/overviewModel.test.ts"
// The Overview's rules (Overview v2): every figure is the server's or worked out from the complete register with the register's own rules (so a tile's number is what its link shows),
// a number nobody has is null (never 0), every graphic opens the register filtered with an address the register reads, and the person's own work is built only from what is theirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appetiteLimits, type RiskRow } from '../risks/_register/riskModel.ts';
import { REGISTER_SCHEMA, pageOf } from '../risks/_register/riskAddress.ts';
import { readAddress } from '../../../../lib/addressState.ts';
import {
  ACTIVE_STATUS, GREEN_KRIS_HREF, GRADE_LABEL, OPEN_ACTIONS_HREF, SECTIONS, SIGNALS, activeHref, buildWork, byCategorySlices, byUnitSlices, cellAt, cellHref, cellLevel, gradeFigure, groupWork, krisOnTarget, matrixOf, postureOf,
  raisedByMonth, registerHref, riskFigures, sectionBand, sectionTiles, shareFigure, signalFrom, topRisks, treatmentOnTrack, treatmentParts, urgencyOf, type WorkSources,
} from './overviewModel.ts';

const NOW = new Date('2026-11-08T12:00:00Z');
const r = (id: number, over: Partial<RiskRow> = {}): RiskRow => ({ id, title: `Risk ${id}`, status: 'open', category: 'operational', ...over });
const LIMITS = appetiteLimits([{ category: 'operational', tolerance_threshold: 10 }]);

test('the module score is the server: the rounded score and the grade it said, and nothing when it said none', () => {
  assert.deepEqual(postureOf({ score: 72.4, grade: 'Good' }), { score: 72, grade: 'good' });
  assert.deepEqual(postureOf({ score: null, grade: null }), { score: null, grade: null }, 'no data is not a score of 0');
  assert.deepEqual(postureOf(undefined), { score: null, grade: null });
  assert.equal(GRADE_LABEL.excellent, 'Excellent');
  assert.deepEqual(['excellent', 'good', 'fair', 'poor'].map((g) => gradeFigure(g as 'good')), ['success', 'success', 'warning', 'danger']);
  assert.equal(gradeFigure(null), 'default');
});

test('section words: 80 strong, 60 fair, below weak, no data apart; a share on a tile takes the same colours', () => {
  assert.deepEqual([null, 100, 80, 79.9, 60, 59].map((s) => sectionBand(s).word), ['No data', 'Strong', 'Strong', 'Fair', 'Fair', 'Weak']);
  assert.deepEqual([null, 90, 70, 10].map(shareFigure), ['default', 'success', 'warning', 'danger']);
});

test('the ten sections are small multiples in the page order, each opening its own page; a section with no score is "No data", never 0', () => {
  assert.equal(SECTIONS.length, 10);
  assert.ok(SECTIONS.every((s) => s.href.startsWith('/')), 'every tile opens a page');
  const tiles = sectionTiles({ register: { label: 'Risk Register', score: 91.2 }, kris: { label: 'Key Risk Indicators', score: null }, incidents: { label: 'Incidents', score: 40 }, other: { label: 'Not one of them', score: 99 } });
  assert.deepEqual(tiles.map((t) => [t.key, t.value, t.tone, t.href]), [['register', 91, 'good', '/erm/risks'], ['kris', null, 'neutral', '/erm/kris'], ['incidents', 40, 'bad', '/erm/incidents']]);
  assert.deepEqual(tiles.map((t) => t.label), ['Register', 'KRIs', 'Incidents'], 'named in a word or two');
  assert.deepEqual(sectionTiles(undefined), []);
});

test('the register figures follow the register rules: active is not closed, high and critical is 12 or more, above appetite is the register\'s own quick view', () => {
  const rows = [
    r(1, { residual_score: 20, inherent_score: 25, created_at: '2026-11-01T00:00:00' }),
    r(2, { residual_score: 12, inherent_score: 16, created_at: '2026-09-01T00:00:00' }),
    r(3, { residual_score: 4, inherent_score: 9 }),
    r(4, { inherent_score: 9 }),
    r(5, { status: 'closed', residual_score: 25, inherent_score: 25 }),
  ];
  const f = riskFigures(rows, LIMITS, NOW);
  assert.deepEqual(f, { active: 4, highCritical: 2, critical: 1, aboveAppetite: 2, unscored: 1, raised30: 1 });
  assert.deepEqual(riskFigures([], LIMITS, NOW), { active: 0, highCritical: 0, critical: 0, aboveAppetite: 0, unscored: 0, raised30: 0 });
});

test('treatment on track is the open actions that are not past their date; nobody open means no share, not 100 and not 0', () => {
  assert.deepEqual(treatmentOnTrack({ open: 8, overdue: 2 }), { share: 75, part: 6, whole: 8 });
  assert.deepEqual(treatmentOnTrack({ open: 3, overdue: 9 }), { share: 0, part: 0, whole: 3 }, 'overdue never exceeds open');
  assert.equal(treatmentOnTrack({ open: 0, overdue: 0 }).share, null);
  assert.equal(treatmentOnTrack(undefined).share, null);
});

test('KRIs on target are the green ones of those that can be judged (a value and an amber threshold); inactive and unrated ones are not in the denominator', () => {
  const k = (current_value: number | null, over = {}) => ({ current_value, green_threshold: 10, amber_threshold: 20, threshold_direction: 'lower_is_better', ...over });
  assert.deepEqual(krisOnTarget([k(5), k(15), k(30), k(null), k(5, { amber_threshold: null }), k(5, { is_active: false })]), { share: 33, part: 1, whole: 3 });
  assert.equal(krisOnTarget([]).share, null);
  assert.equal(krisOnTarget([k(null)]).share, null);
});

test('the matrix places the open risks by likelihood (5 at the top) and impact, on the chosen score; a risk without both numbers is not placed', () => {
  const rows = [
    r(1, { residual_likelihood: 5, residual_impact: 5, inherent_likelihood: 5, inherent_impact: 5 }),
    r(2, { residual_likelihood: 3, residual_impact: 4, inherent_likelihood: 5, inherent_impact: 4 }),
    r(3, { residual_likelihood: 3, residual_impact: 4 }),
    r(4, { inherent_likelihood: 4, inherent_impact: 4 }),
    r(5, { status: 'closed', residual_likelihood: 1, residual_impact: 1 }),
  ];
  const res = matrixOf(rows, 'residual');
  assert.equal(res.placed, 3);
  assert.equal(res.active, 4);
  assert.equal(res.cells[0][4], 1, 'likelihood 5, impact 5: top right');
  assert.equal(res.cells[2][3], 2, 'likelihood 3, impact 4');
  assert.equal(res.cells[4][0], 0, 'a closed risk is not on the matrix');
  const inh = matrixOf(rows, 'inherent');
  assert.equal(inh.placed, 3);
  assert.equal(inh.cells[1][3], 1, 'likelihood 4, impact 4');
  assert.equal(inh.cells[0][3], 1, 'likelihood 5, impact 4');
});

test('a matrix cell opens the register with the cell, the basis and the open statuses, an address the register reads back to the same cell', () => {
  assert.deepEqual(cellAt(0, 4), { l: 5, i: 5 });
  assert.deepEqual(cellAt(4, 0), { l: 1, i: 1 });
  assert.equal(cellLevel(0, 4), 'critical');
  assert.equal(cellLevel(2, 2), 'medium');
  assert.equal(cellLevel(4, 0), 'low');
  const href = cellHref(2, 3, 'residual');
  assert.equal(href, `/erm/risks?status=${ACTIVE_STATUS}&cell=3-4&basis=residual`);
  const a = pageOf(readAddress(REGISTER_SCHEMA, href.split('?')[1]) as never);
  assert.deepEqual(a.filters.cell, { l: 3, i: 4 });
  assert.equal(a.filters.basis, 'residual');
  assert.deepEqual(a.filters.status, ['open', 'in_treatment', 'mitigated', 'accepted']);
  assert.equal(pageOf(readAddress(REGISTER_SCHEMA, cellHref(1, 1, 'inherent').split('?')[1]) as never).filters.basis, 'inherent');
});

test('every address the overview builds is one the register reads: the facets, the quick views, the sort', () => {
  const read = (href: string) => pageOf(readAddress(REGISTER_SCHEMA, href.split('?')[1] ?? '') as never);
  assert.deepEqual(read(activeHref({ level: 'critical,high' })).filters.level, ['critical', 'high']);
  assert.deepEqual(read(activeHref({ cat: 'technology' })).filters.category, ['technology']);
  assert.deepEqual(read(activeHref({ unit: 'none' })).filters.unit, ['none']);
  assert.deepEqual(read(activeHref({ treat: 'not_started' })).filters.treatment, ['not_started']);
  assert.equal(read(registerHref({ quick: 'appetite' })).filters.quick, 'appetite');
  assert.equal(read(registerHref({ quick: 'unscored' })).filters.quick, 'unscored');
  assert.deepEqual(read(registerHref({ sort: 'created:desc' })).sort, { key: 'created', dir: 'desc' });
  assert.equal(registerHref(), '/erm/risks');
  assert.equal(registerHref({ cat: 'a b' }), '/erm/risks?cat=a%20b');
});

test('the breakdowns are of every open risk: the biggest first, with the register filter each opens', () => {
  const rows = [
    r(1, { risk_category: 'technology', residual_score: 22, business_unit_id: 3, business_unit_name: 'Payments' }), r(2, { risk_category: 'technology', residual_score: 12 }),
    r(3, { risk_category: 'strategic', residual_score: 3 }), r(4, { risk_category: 'strategic', status: 'closed', residual_score: 25 }), r(5, { risk_category: 'strategic', residual_score: 20 }),
  ];
  const cats = byCategorySlices(rows);
  assert.deepEqual(cats.map((c) => [c.key, c.total, c.critical, c.high]), [['technology', 2, 1, 1], ['strategic', 2, 1, 0]], 'a closed risk is not counted; ties break on the worst');
  assert.equal(cats[0].href, `/erm/risks?status=${ACTIVE_STATUS}&cat=technology`);
  assert.deepEqual(byUnitSlices(rows).map((u) => [u.key, u.label, u.total]), [['none', 'No unit', 3], ['3', 'Payments', 1]]);
  assert.deepEqual(treatmentParts([r(1, { has_plan: true }), r(2, { has_plan: true, status: 'mitigated' }), r(3), r(4), r(5, { status: 'closed' })]).map((p) => [p.key, p.value]), [['not_started', 2], ['in_progress', 1], ['completed', 1]]);
});

test('the highest risks are the open ones with a score, the highest first, five at most', () => {
  const rows = [r(1, { residual_score: 5 }), r(2, { inherent_score: 20 }), r(3), r(4, { residual_score: 20, status: 'closed' }), r(5, { residual_score: 9 }), r(6, { residual_score: 9 })];
  assert.deepEqual(topRisks(rows, 3).map((x) => x.id), [2, 6, 5]);
  assert.equal(topRisks(Array.from({ length: 9 }, (_, i) => r(i + 1, { residual_score: 10 + i }))).length, 5);
});

test('risks raised by month: the last twelve calendar months, oldest first, a month with none is a real 0; no created date at all is no history', () => {
  const rows = [r(1, { created_at: '2026-11-02T00:00:00' }), r(2, { created_at: '2026-11-07T00:00:00' }), r(3, { created_at: '2026-09-15T00:00:00' }), r(4, { created_at: '2025-01-01T00:00:00' }), r(5)];
  const m = raisedByMonth(rows, NOW) ?? [];
  assert.equal(m.length, 12);
  assert.deepEqual([m[0].label, m[11].label], ['Dec 25', 'Nov']);
  assert.equal(m[11].value, 2);
  assert.equal(m[9].value, 1, 'September');
  assert.equal(m[10].value, 0, 'October: nothing raised');
  assert.equal(m.reduce((n, x) => n + x.value, 0), 3, 'a risk older than the window is not drawn');
  assert.equal(raisedByMonth([r(1)], NOW), null);
});

test("the lists the tiles open are the registers' own quick views and facets", () => {
  assert.equal(OPEN_ACTIONS_HREF, '/erm/mitigation-actions?quick=open');
  assert.equal(GREEN_KRIS_HREF, '/erm/kris?status=green');
  assert.deepEqual(SIGNALS.map((s) => s.href), ['/vendor-risk/findings?severity=critical', '/erm/incidents?quick=severe', '/erm/risk-assessments/ai-risk-assessment?quick=overdue']);
});

test('three signals from other modules: the server count, a dash when the answer lacks it, loading, or an error: never a made-up 0', () => {
  assert.deepEqual(SIGNALS.map((s) => s.key), ['vendor_critical_findings', 'open_critical_incidents', 'overdue_ai_reviews']);
  const queue = { vendor_critical_findings: 4, open_critical_incidents: 0 };
  assert.deepEqual(signalFrom('vendor_critical_findings', queue, false, false), { state: 'ready', value: 4 });
  assert.deepEqual(signalFrom('open_critical_incidents', queue, false, false), { state: 'ready', value: 0 }, 'a real zero is a zero');
  assert.deepEqual(signalFrom('overdue_ai_reviews', queue, false, false), { state: 'none' });
  assert.deepEqual(signalFrom('overdue_ai_reviews', undefined, true, false), { state: 'loading' });
  assert.deepEqual(signalFrom('overdue_ai_reviews', undefined, false, true), { state: 'error' });
});

const ME = 7;
const base = (over: Partial<WorkSources> = {}): WorkSources => ({
  me: ME, now: NOW, rows: [], ctx: { me: ME, now: NOW, limits: appetiteLimits([{ category: 'operational', tolerance_threshold: 10 }]), reviews: new Map() },
  reviews: [], overdueActions: [], kriUpdates: [], incidents: [], ...over,
});

test('my work holds only what is mine: my reviews, my overdue actions, my incidents, the KRIs I must report, my risks that need me', () => {
  const work = buildWork(base({
    rows: [r(1, { owner_id: ME, inherent_score: 9 }), r(2, { owner_id: 3, inherent_score: 9 }), r(3, { business_owner_id: ME, inherent_score: 20, residual_score: 15 }), r(4, { owner_id: ME, status: 'closed' })],
    reviews: [{ id: 10, risk_id: 1, due_date: '2026-11-01T00:00:00', status: 'pending', reviewer_id: ME, risk_title: 'Card fraud' }, { id: 11, risk_id: 2, due_date: '2026-11-01T00:00:00', status: 'pending', reviewer_id: 3 }],
    overdueActions: [{ id: 20, risk_id: 1, title: 'Patch', owner_id: ME, due_date: '2026-10-20T00:00:00' }, { id: 21, risk_id: 1, title: 'Not mine', owner_id: 3, due_date: '2026-10-20T00:00:00' }],
    kriUpdates: [{ id: 30, name: 'Failed logins', next_due_date: '2026-11-09T00:00:00', overdue: false }],
    incidents: [{ id: 40, title: 'Skimming', severity: 'high', status: 'investigating', assigned_to: ME }, { id: 41, title: 'Closed one', status: 'closed', assigned_to: ME }, { id: 42, title: 'Theirs', status: 'open', assigned_to: 3 }],
  }));
  assert.deepEqual(work.map((w) => w.key), ['action-20', 'review-10', 'kri-30', 'risk-3', 'risk-1', 'incident-40']);
  const by = Object.fromEntries(work.map((w) => [w.key, w]));
  assert.deepEqual(by['review-10'].action, { label: 'Start', href: '/erm/reviews?review=10' });
  assert.equal(by['review-10'].overdue, true);
  assert.equal(by['action-20'].href, '/erm/risks/1?tab=treatment');
  assert.equal(by['risk-1'].context, 'Not fully scored');
  assert.deepEqual(by['risk-1'].action, { label: 'Score', href: '/erm/risks/1?tab=assessment' });
  assert.equal(by['risk-3'].context, 'Above appetite');
  assert.equal(by['incident-40'].context, 'High severity · investigating');
});

test('work is grouped by urgency: overdue (oldest first), this week, then the rest', () => {
  const work = buildWork(base({
    reviews: [{ id: 1, risk_id: 1, due_date: '2026-11-05T00:00:00', status: 'pending', reviewer_id: ME }, { id: 2, risk_id: 2, due_date: '2026-10-01T00:00:00', status: 'in_review', reviewer_id: ME }, { id: 3, risk_id: 3, due_date: '2026-11-12T00:00:00', status: 'pending', reviewer_id: ME }],
    kriUpdates: [{ id: 9, name: 'K', next_due_date: null, overdue: false }],
  }));
  assert.deepEqual(work.map((w) => w.key), ['review-2', 'review-1', 'review-3', 'kri-9']);
  assert.deepEqual(work.map((w) => urgencyOf(w, NOW)), ['overdue', 'overdue', 'week', 'todo']);
  assert.deepEqual(groupWork(work, NOW, 3).map((g) => [g.group, g.items.length]), [['overdue', 2], ['week', 1]]);
  assert.deepEqual(groupWork(work, NOW, 10).map((g) => g.group), ['overdue', 'week', 'todo']);
  assert.deepEqual(buildWork(base({ me: null, reviews: [{ id: 1, risk_id: 1, due_date: '2026-10-01T00:00:00', status: 'pending', reviewer_id: null }] })), [], 'nobody signed in owns nothing');
});
