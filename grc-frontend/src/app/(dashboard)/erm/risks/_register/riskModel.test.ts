// node --test "src/app/(dashboard)/erm/risks/_register/riskModel.test.ts"
// The rules of the Risk Register, held to the server's: the score bands (critical >= 20, high >= 12, medium >= 6: `risk_priority_for_score`, the dashboards), the status
// buckets (`_bucket_status`), active / fully scored / critical open / above appetite (routers/dashboard.py), "mine", the review state, sort and the CSV of a selection.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SORT, aboveAppetite, appetiteLimits, bandOf, categoryKey, categoryLabel, changedRecently, csvCell, inQuick, isCriticalOpen, isMine, isUnowned, isUnscoredActive, levelOf,
  levelScore, matrixOf, nextSort, reviewIndex, reviewOf, sortRisks, statusBucket, toCsv, treatmentOf, type RiskRow, type RuleContext,
} from './riskModel.ts';

const NOW = new Date('2026-11-08T12:00:00Z');
const risk = (id: number, over: Partial<RiskRow> = {}): RiskRow => ({ id, title: `Risk ${id}`, status: 'open', category: 'operational', ...over });
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({ me: 7, now: NOW, limits: new Map(), reviews: new Map(), ...over });

test('the bands are the server\'s: 20 critical, 12 high, 6 medium, below low, and no score is "none", not low', () => {
  assert.deepEqual([null, undefined, 0, 1, 5, 5.9, 6, 11, 12, 19, 20, 25].map((s) => bandOf(s)),
    ['none', 'none', 'none', 'low', 'low', 'low', 'medium', 'medium', 'high', 'high', 'critical', 'critical']);
});

test('a risk is read at its residual score, else its inherent score, else none', () => {
  assert.equal(levelScore({ residual_score: 8, inherent_score: 20 }), 8);
  assert.equal(levelScore({ residual_score: null, inherent_score: 20 }), 20);
  assert.equal(levelScore({ residual_score: 0, inherent_score: 20 }), 20);                 // `residual or inherent`: a zero residual is no residual
  assert.equal(levelOf({ residual_score: null, inherent_score: null }), 'none');
  assert.equal(levelOf({ residual_score: 12, inherent_score: 25 }), 'high');
});

test('the status buckets fold every word the server knows into the five, and a word it does not know is Open', () => {
  assert.deepEqual(['open', 'in_treatment', 'mitigating', 'under_review', 'in_progress', 'treating', 'mitigated', 'accepted', 'closed', 'resolved', 'cancelled', 'Canceled', 'In Treatment', '', null, 'weird'].map(statusBucket),
    ['open', 'in_treatment', 'in_treatment', 'in_treatment', 'in_treatment', 'in_treatment', 'mitigated', 'accepted', 'closed', 'closed', 'closed', 'closed', 'in_treatment', 'open', 'open', 'open']);
});

test('the category is the one the risk stores, never a guess from its words', () => {
  assert.equal(categoryKey(risk(1, { risk_category: 'Third Party', category: 'operational', title: 'Ransomware in the data centre' })), 'third_party');
  assert.equal(categoryKey(risk(1, { risk_category: null, category: 'technology' })), 'technology');
  assert.equal(categoryKey(risk(1, { risk_category: '', category: '' })), 'uncategorised');
  assert.equal(categoryLabel('third_party'), 'Third party');
  assert.equal(categoryLabel('uncategorised'), 'Uncategorised');
});

test('mine is the risk owner OR the business owner; unowned is neither', () => {
  assert.equal(isMine({ owner_id: 7, business_owner_id: null }, 7), true);
  assert.equal(isMine({ owner_id: null, business_owner_id: 7 }, 7), true);
  assert.equal(isMine({ owner_id: 8, business_owner_id: 9 }, 7), false);
  assert.equal(isMine({ owner_id: 7 }, null), false);                                       // nobody signed in is nobody's
  assert.equal(isUnowned({ owner_id: null, business_owner_id: null }), true);
  assert.equal(isUnowned({ owner_id: null, business_owner_id: 3 }), false);
});

test('active, fully scored, unscored and critical open follow routers/dashboard.py', () => {
  const scored = risk(1, { inherent_score: 25, residual_score: 20 });
  assert.equal(isCriticalOpen(scored), true);
  assert.equal(isCriticalOpen(risk(2, { inherent_score: 25, residual_score: 19 })), false);
  assert.equal(isCriticalOpen(risk(3, { status: 'closed', inherent_score: 25, residual_score: 25 })), false);
  assert.equal(isCriticalOpen(risk(4, { inherent_score: 25 })), false, 'a risk without a residual score is not "scored"');
  assert.equal(isUnscoredActive(risk(5, { inherent_score: 9 })), true);
  assert.equal(isUnscoredActive(risk(6, { inherent_score: 9, residual_score: 4 })), false);
  assert.equal(isUnscoredActive(risk(7, { status: 'closed' })), false);
  assert.equal(isUnscoredActive(risk(8, { status: null })), true, 'no status is open');
});

test('above appetite: a scored active risk whose residual is over the limit of its category (tolerance, else max acceptable, else 12)', () => {
  const limits = appetiteLimits([{ category: 'operational', tolerance_threshold: 10, max_acceptable_score: 15 }, { category: 'technology', max_acceptable_score: 8 }, { category: 'strategic' }]);
  assert.deepEqual(Array.from(limits), [['operational', 10], ['technology', 8], ['strategic', 12]]);
  const base = { inherent_score: 20 };
  assert.equal(aboveAppetite(risk(1, { ...base, residual_score: 11 }), limits), true);
  assert.equal(aboveAppetite(risk(2, { ...base, residual_score: 10 }), limits), false, 'equal to the limit is within it');
  assert.equal(aboveAppetite(risk(3, { ...base, residual_score: 9, category: 'technology' }), limits), true);
  assert.equal(aboveAppetite(risk(4, { ...base, residual_score: 24, category: 'financial' }), limits), false, 'a category with no limit has no breach');
  assert.equal(aboveAppetite(risk(5, { ...base, residual_score: 24, status: 'closed' }), limits), false);
  assert.equal(aboveAppetite(risk(6, { residual_score: 24 }), limits), false);
  assert.equal(aboveAppetite(risk(7, { ...base, residual_score: 24, category: null }), limits), true, 'no category reads as operational');
});

test('the review state is the earlier of the risk\'s own date and its open reviews, in the server\'s UTC', () => {
  const reviews = reviewIndex([{ risk_id: 1, due_date: '2026-12-20T00:00:00' }, { risk_id: 1, due_date: '2026-11-30T09:00:00' }, { risk_id: 2, due_date: '2026-11-01T09:00:00' }]);
  assert.deepEqual(reviewOf(risk(1), reviews, NOW), { state: 'soon', due: '2026-11-30T09:00:00' });
  assert.equal(reviewOf(risk(2), reviews, NOW).state, 'overdue');
  assert.deepEqual(reviewOf(risk(3, { review_date: '2027-03-01T00:00:00' }), reviews, NOW), { state: 'later', due: '2027-03-01T00:00:00' });
  assert.deepEqual(reviewOf(risk(4), reviews, NOW), { state: 'none', due: null });
  assert.equal(reviewOf(risk(5, { review_date: '2026-11-08T11:59:59' }), reviews, NOW).state, 'overdue', 'a minute ago is late');
  assert.equal(reviewOf(risk(1, { review_date: '2026-10-01T00:00:00' }), reviews, NOW).state, 'overdue', 'the earlier date decides');
});

test('the quick views', () => {
  const c = ctx({ reviews: reviewIndex([{ risk_id: 2, due_date: '2026-10-01T00:00:00' }]), limits: appetiteLimits([{ category: 'operational', tolerance_threshold: 5 }]) });
  assert.equal(inQuick('mine', risk(1, { business_owner_id: 7 }), c), true);
  assert.equal(inQuick('review', risk(2), c), true);
  assert.equal(inQuick('review', risk(2, { status: 'closed' }), c), false, 'a closed risk is not chased for review');
  assert.equal(inQuick('appetite', risk(3, { inherent_score: 20, residual_score: 6 }), c), true);
  assert.equal(inQuick('unowned', risk(4), c), true);
  assert.equal(inQuick('unowned', risk(4, { owner_id: 1 }), c), false);
  assert.equal(inQuick('recent', risk(5, { updated_at: '2026-11-03T00:00:00' }), c), true);
  assert.equal(inQuick('recent', risk(5, { updated_at: '2026-10-30T00:00:00' }), c), false);
  assert.equal(changedRecently(risk(6, { updated_at: null }), NOW), false);
  assert.equal(inQuick('all', risk(9), c), true);
  assert.equal(inQuick(null, risk(9), c), true);
});

test('treatment is derived and never stored: a plan with the risk mitigated is Completed, a plan In progress, else Not started', () => {
  assert.deepEqual([{ has_plan: true, status: 'mitigated' }, { has_plan: true, status: 'open' }, { has_plan: false, status: 'mitigated' }, { has_plan: false, status: 'open' }].map(treatmentOf),
    ['completed', 'in_progress', 'not_started', 'not_started']);
});

test('the matrix places a risk only with both a likelihood and an impact, as the server\'s heatmap does', () => {
  const rows = [risk(1, { residual_likelihood: 4, residual_impact: 5 }), risk(2, { residual_likelihood: 4, residual_impact: 5 }), risk(3, { residual_likelihood: 4 }), risk(4, { inherent_likelihood: 1, inherent_impact: 1 })];
  assert.deepEqual(Array.from(matrixOf(rows, 'residual')), [['4-5', 2]]);
  assert.deepEqual(Array.from(matrixOf(rows, 'inherent')), [['1-1', 1]]);
});

test('sorting: the default is the highest level first; an empty value is last in either direction; ties keep a fixed order', () => {
  const rows = [risk(1, { residual_score: 6, updated_at: '2026-11-01T00:00:00' }), risk(2, { inherent_score: 25 }), risk(3), risk(4, { residual_score: 6, updated_at: '2026-11-05T00:00:00' })];
  const k = { reviews: new Map<number, string>(), now: NOW };
  assert.deepEqual(sortRisks(rows, DEFAULT_SORT, k).map((r) => r.id), [2, 4, 1, 3]);
  assert.deepEqual(sortRisks(rows, { key: 'level', dir: 'asc' }, k).map((r) => r.id), [4, 1, 2, 3], 'the unscored one is still last');
  assert.deepEqual(sortRisks([risk(1, { title: 'b' }), risk(2, { title: 'A' }), risk(3, { title: 'é' })], { key: 'title', dir: 'asc' }, k).map((r) => r.id), [2, 1, 3]);
  assert.deepEqual(nextSort(DEFAULT_SORT, 'title'), { key: 'title', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'title', dir: 'asc' }, 'title'), { key: 'title', dir: 'desc' });
});

test('the CSV: every cell that a spreadsheet could take for a formula gets an apostrophe, and the file says the level in words', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('plain, with comma'), '"plain, with comma"');
  assert.equal(csvCell(null), '');
  const csv = toCsv([risk(1, { title: '=cmd', residual_score: 20, owner_name: 'Ana', framework_ids: [1, 2] }), risk(2)], { frameworks: (r) => (r.framework_ids ?? []).join('; ') });
  const lines = csv.split('\r\n');
  assert.equal(lines[0].split(',')[0], 'Title');
  assert.ok(lines[1].startsWith("'=cmd,Operational,,Open,critical,,20,Ana"), lines[1]);
  assert.ok(lines[2].includes('Not scored'));
});
