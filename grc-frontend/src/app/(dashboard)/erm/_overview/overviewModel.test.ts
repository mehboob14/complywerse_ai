// node --test "src/**/_overview/overviewModel.test.ts"
// The Overview's rules: the 14 counters keep their keys and words, a counter the server did not give is a dash and a failed request is an error (never 0), the person's own work is built only
// from what is theirs and ordered by urgency, and the breakdowns are of the whole register.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appetiteLimits, type RiskRow } from '../risks/_register/riskModel.ts';
import {
  ATTENTION, GRADE_LABEL, attentionTotal, buildWork, byCategorySlices, byUnitSlices, counterFrom, groupWork, postureOf, sectionBand, topRisks, urgencyOf, weakest, type WorkSources,
} from './overviewModel.ts';

const NOW = new Date('2026-11-08T12:00:00Z');
const r = (id: number, over: Partial<RiskRow> = {}): RiskRow => ({ id, title: `Risk ${id}`, status: 'open', category: 'operational', ...over });

test('the server fourteen counters keep their keys, words and tones; the register ones open the register filtered', () => {
  assert.deepEqual(ATTENTION.map((c) => c.key).sort(), [
    'appetite_breaches', 'blocked_questions', 'controls_tests_overdue', 'critical_open_risks', 'open_critical_incidents', 'overdue_ai_reviews', 'overdue_mitigation_actions', 'overdue_risk_reviews',
    'rcsa_open_findings', 'red_kris', 'unscored_active_risks', 'vendor_critical_findings', 'vendor_overdue_reassessments', 'vendor_overdue_remediations',
  ]);
  const by = Object.fromEntries(ATTENTION.map((c) => [c.key, c]));
  assert.equal(by.critical_open_risks.href, '/erm/risks?quick=critical');
  assert.equal(by.unscored_active_risks.href, '/erm/risks?quick=unscored');
  assert.equal(by.appetite_breaches.href, '/erm/risks?quick=appetite');
  assert.equal(by.overdue_risk_reviews.href, '/erm/reviews');
  assert.equal(by.vendor_critical_findings.href, '/vendor-risk/findings');
  assert.equal(by.red_kris.label, 'Red KRIs');
});

test('a counter is the server number, a dash when the answer lacks it, loading, or an error: never a made-up 0', () => {
  const queue = { critical_open_risks: 0, red_kris: 4, total: 4 };
  assert.deepEqual(counterFrom('red_kris', queue, false, false), { state: 'ready', value: 4 });
  assert.deepEqual(counterFrom('critical_open_risks', queue, false, false), { state: 'ready', value: 0 }, 'a real zero is a zero');
  assert.deepEqual(counterFrom('open_critical_incidents', queue, false, false), { state: 'none' });
  assert.deepEqual(counterFrom('red_kris', undefined, true, false), { state: 'loading' });
  assert.deepEqual(counterFrom('red_kris', undefined, false, true), { state: 'error' });
  assert.equal(attentionTotal(queue), 4);
  assert.equal(attentionTotal({}), null);
});

test('the module score is the server: the rounded score and the grade it said, and nothing when it said none', () => {
  assert.deepEqual(postureOf({ score: 72.4, grade: 'Good' }), { score: 72, grade: 'good' });
  assert.deepEqual(postureOf({ score: null, grade: null }), { score: null, grade: null }, 'no data is not a score of 0');
  assert.deepEqual(postureOf(undefined), { score: null, grade: null });
  assert.equal(GRADE_LABEL.excellent, 'Excellent');
});

test('section words: 80 strong, 60 fair, below weak, no data apart; the weakest come first and no data is left out', () => {
  assert.deepEqual([null, 100, 80, 79.9, 60, 59].map((s) => sectionBand(s).word), ['No data', 'Strong', 'Strong', 'Fair', 'Fair', 'Weak']);
  const rows = [{ key: 'a', label: 'A', weight: 0.1, score: 70 }, { key: 'b', label: 'B', weight: 0.2, score: 40 }, { key: 'c', label: 'C', weight: 0.3, score: null }, { key: 'd', label: 'D', weight: 0.4, score: 40 }];
  assert.deepEqual(weakest(rows, 2).map((x) => x.key), ['d', 'b'], 'equal scores: the heavier section first');
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

test('the breakdowns are of every active risk: the most critical first, with the register filter each opens', () => {
  const rows = [r(1, { risk_category: 'technology', residual_score: 22, business_unit_id: 3, business_unit_name: 'Payments' }), r(2, { risk_category: 'technology', residual_score: 12 }), r(3, { risk_category: 'strategic', residual_score: 3 }), r(4, { risk_category: 'strategic', status: 'closed', residual_score: 25 })];
  const cats = byCategorySlices(rows);
  assert.deepEqual(cats.map((c) => [c.key, c.total, c.critical, c.high]), [['technology', 2, 1, 1], ['strategic', 1, 0, 0]], 'a closed risk is not counted');
  assert.equal(cats[0].href, '/erm/risks?cat=technology');
  assert.deepEqual(byUnitSlices(rows).map((u) => [u.key, u.label, u.total]), [['3', 'Payments', 1], ['none', 'No unit', 2]]);
  assert.deepEqual(topRisks([r(1, { residual_score: 5 }), r(2, { inherent_score: 20 }), r(3), r(4, { residual_score: 20, status: 'closed' })], 3).map((x) => x.id), [4, 2, 1], 'the list takes every risk with a score, the highest first');
});
