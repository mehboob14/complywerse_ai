// node --test "src/app/(dashboard)/erm/risks/[id]/_workspace/riskPageModel.test.ts"
// The risk page's rules: the reduction the page always showed, the in-place assessment (only what changed is sent, scores are likelihood x impact, a half pair is refused) and the
// History feed (newest first, one line per thing somebody did, nothing invented).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assessmentOf, assessmentPatch, assessmentProblem, draftScores, historyFeed, riskReduction, sameAssessment } from './riskPageModel.ts';

test('the risk reduction is round((inherent - residual) / inherent x 100) and only with both scores', () => {
  assert.equal(riskReduction(16, 12), 25);
  assert.equal(riskReduction(20, 6), 70);
  assert.equal(riskReduction(9, 4), 56);
  assert.equal(riskReduction(null, 4), null);
  assert.equal(riskReduction(16, 0), null);
  assert.equal(riskReduction(10, 15), -50, 'a residual above the inherent is shown as it is');
});

const RISK = { status: 'open', priority: null, owner_id: 3, business_owner_id: null, inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 3, residual_impact: 4 };

test('an untouched assessment sends nothing; a change sends only what changed', () => {
  const was = assessmentOf(RISK);
  assert.deepEqual(was, { status: 'open', priority: '', ownerId: '3', businessOwnerId: '', inherentL: '4', inherentI: '4', residualL: '3', residualI: '4' });
  assert.equal(sameAssessment(was, assessmentOf(RISK)), true);
  assert.deepEqual(assessmentPatch(was, was), {});
  assert.deepEqual(assessmentPatch(was, { ...was, status: 'in_treatment', priority: 'high' }), { status: 'in_treatment', priority: 'high' });
  assert.deepEqual(assessmentPatch(was, { ...was, ownerId: '', businessOwnerId: '9' }), { owner_id: null, business_owner_id: 9 });
});

test('scores are likelihood x impact, both of the pair travel together, and clearing a pair clears its score', () => {
  const was = assessmentOf(RISK);
  assert.deepEqual(assessmentPatch(was, { ...was, residualL: '2' }), { residual_likelihood: 2, residual_impact: 4, residual_score: 8 });
  assert.deepEqual(assessmentPatch(was, { ...was, inherentL: '5', inherentI: '5' }), { inherent_likelihood: 5, inherent_impact: 5, inherent_score: 25 });
  assert.deepEqual(assessmentPatch(was, { ...was, residualL: '', residualI: '' }), { residual_likelihood: null, residual_impact: null, residual_score: null });
  assert.equal(draftScores({ ...was, residualL: '2' }).residual, 8);
  assert.equal(draftScores({ ...was, residualL: '', residualI: '', inherentL: '', inherentI: '' }).band, 'none');
  assert.equal(draftScores(was).band, 'high', 'the band is the residual score\'s, else the inherent');
});

test('a likelihood without an impact (or the other way round) is refused in words', () => {
  const was = assessmentOf(RISK);
  assert.equal(assessmentProblem(was), '');
  assert.match(assessmentProblem({ ...was, inherentI: '' }), /inherent/);
  assert.match(assessmentProblem({ ...was, residualL: '' }), /residual/);
  assert.equal(assessmentProblem({ ...was, residualL: '', residualI: '' }), '');
});

test('History: newest first, one line for each thing somebody did, nothing invented', () => {
  const feed = historyFeed({
    created: '2026-01-05T09:00:00',
    scores: [{ id: 1, recorded_at: '2026-03-01T10:00:00', inherent_score: 20, residual_score: 12, change_reason: 'Review #4 approved', status: 'in_treatment' }],
    reviews: [
      { id: 4, status: 'approved', review_type: 'periodic', due_date: '2026-02-28T00:00:00', started_at: '2026-02-27T08:00:00', completed_at: '2026-03-01T09:30:00', new_residual_score: 12, findings: 'Controls hold' },
      { id: 5, status: 'pending', review_type: 'triggered', due_date: '2026-12-01T00:00:00' },
    ],
    actions: [{ id: 8, title: 'Patch the gateway', status: 'completed', created_at: '2026-02-01T00:00:00', completed_at: '2026-02-20T00:00:00', owner_name: 'Ana' }],
    incidents: [{ id: 2, title: 'Card skimming', severity: 'high', status: 'resolved', incident_date: '2026-02-10T00:00:00' }],
  });
  assert.deepEqual(feed.map((f) => f.key), ['review-5-due', 'score-1', 'review-4-done', 'review-4-due', 'review-4-start', 'action-8-done', 'incident-2', 'action-8-new', 'created']);
  const by = Object.fromEntries(feed.map((f) => [f.key, f]));
  assert.equal(by['score-1'].title, 'Scores recorded: inherent 20, residual 12');
  assert.equal(by['score-1'].detail, 'Review #4 approved · Status in treatment');
  assert.equal(by['review-5-due'].title, 'Triggered review is due');
  assert.equal(by['review-4-due'].title, 'Periodic review was due');
  assert.equal(by['review-4-done'].detail, 'New residual score 12 · Controls hold');
  assert.equal(by['action-8-new'].detail, 'Owner Ana');
  assert.equal(by['incident-2'].detail, 'High · Resolved');
  assert.deepEqual(historyFeed({}), []);
  assert.equal(historyFeed({ scores: [{ id: 9, recorded_at: 'x', inherent_score: null, residual_score: null }] })[0].title, 'Scores recorded: inherent not scored, residual not scored');
});
