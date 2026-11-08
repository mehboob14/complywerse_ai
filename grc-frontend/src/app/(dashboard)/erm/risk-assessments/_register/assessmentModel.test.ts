// node --test "src/app/(dashboard)/erm/risk-assessments/_register/assessmentModel.test.ts"
// The rules of the Risk Assessments pages: ONE score-band system (the Risk Register's), one rating function for the tiles, the rows and the saved rating, averages that divide by their
// own counts, the stage that folds the framework words into the manual ones, the quick views, the address, the figures of Insights and the words of an AI failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SORT, NO_FILTERS, REGISTER_SCHEMA, aiFailureWords, applyPatch, bandOf, filterCount, inQuick, insightsOf, inherentOf, isEditable, keyOf, movesFrom, nextSort, pageOf, parseRef,
  patchBody, plainFilter, progressOf, progressWords, ratingOf, refOf, residualOf, scoreOf, sortRows, sourceOf, stageOf, summarise, type AssessedRisk, type AssessmentRow, type RegisterAddress,
} from './assessmentModel.ts';
import { readAddress, writeAddress } from '../../../../../lib/addressState.ts';

const row = (o: Partial<AssessmentRow> & { id: number }): AssessmentRow => ({ kind: 'manual', name: `A${o.id}`, status: 'draft', total_items: 0, done_items: 0, blocked_items: 0, mine_items: 0, ...o });
const risk = (o: Partial<AssessedRisk> = {}): AssessedRisk => ({ id: 1, risk_id: 1, ...o });

test('one band system: 20 is critical, 12 high, 6 medium, below low, no score is not scored (the old page said 21 / 13 / 6)', () => {
  assert.deepEqual([25, 20, 19, 12, 11, 6, 5, 1, 0, null].map((s) => bandOf(s)), ['critical', 'critical', 'high', 'high', 'medium', 'medium', 'low', 'low', 'none', 'none']);
  assert.equal(ratingOf({ residual_likelihood: 4, residual_impact: 5 }), 'critical');                       // 20: Critical here and on the Risk Register
});

test('the rating is the residual band, else the inherent band, and never the stored word', () => {
  assert.equal(ratingOf({ inherent_likelihood: 5, inherent_impact: 5, residual_likelihood: 2, residual_impact: 2 }), 'low');
  assert.equal(ratingOf({ inherent_likelihood: 5, inherent_impact: 4 }), 'critical');
  assert.equal(ratingOf({}), 'none');
  assert.equal(ratingOf({ ...risk({ residual_likelihood: 1, residual_impact: 1 }), ...({ risk_rating: 'critical' } as object) }), 'low');     // a stored "critical" does not win
});

test('an imported score without axes is kept; one axis alone is no score', () => {
  assert.equal(inherentOf({ inherent_score: 18 }), 18);
  assert.equal(residualOf({ residual_likelihood: 3, residual_score: 9 }), null);
  assert.equal(scoreOf(3, 3), 9);
  assert.equal(scoreOf(null, 3), null);
});

test('the tiles and the rows are one function: a bulk-added risk with scores and no stored rating counts', () => {
  const rows = [
    risk({ id: 1, inherent_likelihood: 4, inherent_impact: 5, residual_likelihood: 3, residual_impact: 3, risk_rating: null }),   // residual 9 -> medium
    risk({ id: 2, inherent_likelihood: 5, inherent_impact: 5, risk_rating: null }),                                             // inherent 25 only -> critical
    risk({ id: 3 }),                                                                                                              // nothing -> not scored
  ];
  const s = summarise(rows);
  assert.deepEqual(s.byBand, { critical: 1, high: 0, medium: 1, low: 0, none: 1 });
  assert.equal(s.scored, 2);
  assert.deepEqual(rows.map(ratingOf), ['medium', 'critical', 'none']);
});

test('each average divides by its own count; the reduction needs both', () => {
  const rows = [
    risk({ id: 1, inherent_likelihood: 4, inherent_impact: 5, residual_likelihood: 3, residual_impact: 3 }),    // 20, 9
    risk({ id: 2, inherent_likelihood: 2, inherent_impact: 2 }),                                                  // 4, none
    risk({ id: 3 }),
  ];
  const s = summarise(rows);
  assert.equal(s.avgInherent, 12);                  // (20 + 4) / 2
  assert.equal(s.avgResidual, 9);                   // 9 / 1 (it used to be 9 / 2)
  assert.equal(s.reduction, 3);
  assert.equal(summarise([risk({ inherent_likelihood: 2, inherent_impact: 2 })]).reduction, null);
  assert.equal(summarise([]).avgInherent, null);
});

test('treatment and effectiveness are counted, an empty one is undecided / unrated', () => {
  const s = summarise([risk({ treatment_decision: 'mitigate', control_effectiveness: 'partially_effective' }), risk({ id: 2, treatment_decision: 'accept' }), risk({ id: 3, treatment_decision: 'weird' })]);
  assert.deepEqual([s.byTreatment.mitigate, s.byTreatment.accept, s.byTreatment.undecided], [1, 1, 1]);
  assert.deepEqual([s.byEffectiveness.partially_effective, s.byEffectiveness.unrated], [1, 2]);
});

test('an in-place edit sends the change and the rating that follows from the scores after it', () => {
  const r = risk({ inherent_likelihood: 4, inherent_impact: 5, residual_likelihood: 3, residual_impact: 3 });
  assert.deepEqual(patchBody(r, { residual_impact: 5 }), { residual_impact: 5, risk_rating: 'high' });          // 3 x 5 = 15
  assert.deepEqual(patchBody(r, { residual_likelihood: null }), { residual_likelihood: null, risk_rating: 'critical' });   // no residual: the inherent 20 reads
  assert.deepEqual(patchBody(risk(), { inherent_likelihood: null }), { inherent_likelihood: null, risk_rating: null });
  assert.deepEqual(patchBody(r, { rationale: 'because' }), { rationale: 'because' });                          // a note does not touch the rating
  assert.equal(applyPatch(r, { residual_likelihood: null }).residual_score, null);
  assert.equal(applyPatch(r, { residual_impact: 4 }).residual_score, 12);
});

test('the framework words fold into the manual stages', () => {
  assert.deepEqual(['not_started', 'in_progress', 'completed', 'archived', 'odd'].map((s) => stageOf('framework', s)), ['draft', 'in_progress', 'approved', 'closed', 'in_progress']);
  assert.deepEqual(['draft', 'In Progress', 'under_review', 'approved', 'closed'].map((s) => stageOf('manual', s)), ['draft', 'in_progress', 'under_review', 'approved', 'closed']);
});

test('a manual assessment and a framework one with the same number are two records', () => {
  assert.notEqual(keyOf({ kind: 'manual', id: 5 }), keyOf({ kind: 'framework', id: 5 }));
  assert.equal(refOf({ kind: 'framework', id: 12 }), 'f12');
  assert.deepEqual(parseRef('m7'), { kind: 'manual', id: 7 });
  assert.equal(parseRef('x7'), null);
  assert.equal(parseRef('m0'), null);
});

test('progress is a true fraction, never over 100', () => {
  assert.deepEqual(progressOf({ kind: 'framework', total_items: 40, done_items: 18 }), { done: 18, total: 40, pct: 45, unit: 'questions' });
  assert.equal(progressOf({ kind: 'manual', total_items: 0, done_items: 0 }).pct, null);
  assert.equal(progressOf({ kind: 'manual', total_items: 3, done_items: 9 }).pct, 100);
  assert.equal(progressWords({ kind: 'framework', total_items: 40, done_items: 18 }), '18 of 40 answered');
  assert.equal(progressWords({ kind: 'manual', total_items: 0, done_items: 0 }), 'No risks yet');
});

const ROWS: AssessmentRow[] = [
  row({ id: 1, status: 'in_progress', owner_id: 7, owner_name: 'Sana', total_items: 14, done_items: 9, updated_at: '2026-11-03T10:00:00' }),
  row({ id: 2, status: 'under_review', owner_id: 8, owner_name: 'Ali', total_items: 5, done_items: 5, updated_at: '2026-11-02T10:00:00' }),
  row({ id: 1, kind: 'framework', name: 'ISO 27005 2026', status: 'in_progress', owner_id: 8, owner_name: 'Ali', framework_name: 'ISO 27005', total_items: 40, done_items: 18, blocked_items: 2, mine_items: 3, updated_at: '2026-11-04T10:00:00' }),
  row({ id: 3, kind: 'framework', name: 'PCI Q12', status: 'completed', framework_name: 'PCI DSS', total_items: 20, done_items: 20, updated_at: '2026-10-01T10:00:00' }),
  row({ id: 4, status: 'draft', updated_at: '2026-09-01T10:00:00' }),
];

test('the quick views', () => {
  const ctx = { me: 7 };
  const ids = (q: Parameters<typeof inQuick>[0]) => ROWS.filter((r) => inQuick(q, r, ctx)).map((r) => `${r.kind[0]}${r.id}`);
  assert.deepEqual(ids('mine'), ['m1', 'f1']);              // I lead m1; I have 3 open questions in f1
  assert.deepEqual(ids('progress'), ['m1', 'f1']);
  assert.deepEqual(ids('review'), ['m2']);
  assert.deepEqual(ids('blocked'), ['f1']);
  assert.deepEqual(ids('empty'), ['m4']);                   // nothing in it and not finished
  assert.equal(ids('all').length, 5);
});

test('the plain filter holds facets, search and quick view together', () => {
  const ctx = { me: 7 };
  assert.deepEqual(plainFilter(ROWS, { ...NO_FILTERS, kind: ['framework'] }, ctx).map((r) => r.name), ['ISO 27005 2026', 'PCI Q12']);
  assert.deepEqual(plainFilter(ROWS, { ...NO_FILTERS, status: ['approved'] }, ctx).map((r) => r.name), ['PCI Q12']);       // a completed framework assessment is "approved or completed"
  assert.deepEqual(plainFilter(ROWS, { ...NO_FILTERS, owner: ['8'] }, ctx).length, 2);
  assert.deepEqual(plainFilter(ROWS, { ...NO_FILTERS, owner: ['none'] }, ctx).map((r) => r.name), ['PCI Q12', 'A4']);
  assert.deepEqual(plainFilter(ROWS, { ...NO_FILTERS, framework: ['PCI DSS'] }, ctx).length, 1);
  assert.deepEqual(plainFilter(ROWS, { ...NO_FILTERS, search: 'iso 27005' }, ctx).length, 1);
  assert.equal(filterCount({ ...NO_FILTERS, kind: ['manual'], search: 'x', quick: 'mine' }), 3);
});

test('sorting: by default the latest change first; an unowned one is last either way; the order cycles', () => {
  assert.deepEqual(sortRows(ROWS, DEFAULT_SORT).map((r) => r.name), ['ISO 27005 2026', 'A1', 'A2', 'PCI Q12', 'A4']);
  assert.deepEqual(sortRows(ROWS, { key: 'owner', dir: 'asc' }).map((r) => r.owner_name ?? null), ['Ali', 'Ali', 'Sana', null, null]);
  assert.deepEqual(sortRows(ROWS, { key: 'owner', dir: 'desc' }).map((r) => r.owner_name ?? null), ['Sana', 'Ali', 'Ali', null, null]);
  assert.deepEqual(sortRows(ROWS, { key: 'status', dir: 'asc' }).map((r) => r.name)[0], 'A4');
  assert.deepEqual(nextSort(DEFAULT_SORT, 'name'), { key: 'name', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'name', dir: 'desc' }, 'name'), DEFAULT_SORT);
});

test('the address: filters, view and the open assessment live in it; the old links still work', () => {
  const state = readAddress(REGISTER_SCHEMA, '?kind=framework&status=in_progress,under_review&quick=blocked&sort=name:asc&view=board&open=f12&q=iso');
  const page = pageOf(state as RegisterAddress);
  assert.deepEqual(page.filters, { search: 'iso', kind: ['framework'], status: ['in_progress', 'under_review'], owner: [], framework: [], quick: 'blocked' });
  assert.deepEqual(page.open, { kind: 'framework', id: 12 });
  assert.equal(page.view, 'board');
  assert.equal(writeAddress(REGISTER_SCHEMA, '', state), 'q=iso&kind=framework&status=in_progress%2Cunder_review&quick=blocked&sort=name%3Aasc&view=board&open=f12');
  // the old "Assigned To Me" tab of the framework page, and the old ?upload link
  assert.equal(pageOf(readAddress(REGISTER_SCHEMA, '?tab=assigned') as RegisterAddress).filters.quick, 'mine');
  assert.equal(pageOf(readAddress(REGISTER_SCHEMA, '?new=framework') as RegisterAddress).create, 'framework');
  // junk is the default
  const junk = pageOf(readAddress(REGISTER_SCHEMA, '?kind=weird&view=cloud&open=zz&sort=nope:up&quick=zzz') as RegisterAddress);
  assert.deepEqual([junk.filters.kind, junk.view, junk.open, junk.sort, junk.filters.quick], [[], 'list', null, DEFAULT_SORT, null]);
});

test('Insights: the dashboard\'s figures over the rows, to one decimal, with the true counts', () => {
  const ins = insightsOf(ROWS, new Date('2026-11-08T00:00:00Z'));
  assert.deepEqual([ins.total, ins.manual, ins.framework], [5, 3, 2]);
  assert.deepEqual(ins.byStage, { draft: 1, in_progress: 2, under_review: 1, approved: 1, closed: 0 });
  assert.equal(ins.risksAssessed, 19);                         // 14 + 5 + 0
  assert.equal(ins.risksPerAssessment, 6.3);                   // 19 / 3
  assert.equal(ins.questions, 60);
  assert.equal(ins.questionsPerAssessment, 30);
  assert.equal(ins.blocked, 2);
  assert.equal(ins.trend.length, 12);
  assert.deepEqual(ins.byOwner[0], { label: 'Ali', count: 2 });
  assert.equal(insightsOf([]).risksPerAssessment, 0);
});

test('the lifecycle offers what the server allows from each status', () => {
  assert.deepEqual(movesFrom('draft').map((m) => m.to), ['in_progress']);
  assert.deepEqual(movesFrom('in_progress').map((m) => m.to), ['under_review']);
  assert.deepEqual(movesFrom('under_review').map((m) => m.to), ['approved', 'in_progress']);
  assert.deepEqual(movesFrom('approved').map((m) => m.to), ['closed']);
  assert.deepEqual(movesFrom('closed'), []);
  assert.deepEqual([isEditable('draft'), isEditable('in_progress'), isEditable('approved')], [true, true, false]);
});

test('an AI answer says what it is; a failure says it in plain words and never repeats the server\'s text', () => {
  assert.equal(sourceOf({ source: 'ai' }), 'ai');
  assert.equal(sourceOf({ source: 'rules' }), 'rules');
  assert.equal(sourceOf({}), 'unknown');
  assert.equal(sourceOf(null), 'unknown');
  for (const code of [undefined, 400, 403, 429, 500, 503]) assert.ok(!/openai|gpt|key|exception|unavailable:/i.test(aiFailureWords(code)), String(code));
  assert.match(aiFailureWords(503), /could not draft/);
});
