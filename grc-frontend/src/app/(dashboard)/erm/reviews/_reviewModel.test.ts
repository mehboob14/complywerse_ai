import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedScores, compareScores, isReviewOverdue, reviewTab } from './_reviewModel.ts';

const now = new Date('2026-11-11T12:00:00');

test('overdue is a scheduled or in-review review past its due date', () => {
  assert.equal(isReviewOverdue({ status: 'pending', due_date: '2026-11-01T00:00:00' }, now), true);
  assert.equal(isReviewOverdue({ status: 'in_review', due_date: '2026-11-01T00:00:00' }, now), true);
  assert.equal(isReviewOverdue({ status: 'pending', due_date: '2026-12-01T00:00:00' }, now), false, 'not due yet');
  for (const other of ['submitted', 'approved', 'completed', 'rejected', 'skipped']) {
    assert.equal(isReviewOverdue({ status: other, due_date: '2026-11-01T00:00:00' }, now), false, `${other} is not overdue`);
  }
});

test('each review sits on one tab', () => {
  const tab = (status: string, due_date: string) => reviewTab({ status, due_date }, now);
  assert.equal(tab('pending', '2026-11-20T00:00:00'), 'due');
  assert.equal(tab('in_review', '2026-11-30T23:00:00'), 'due');
  assert.equal(tab('pending', '2026-11-02T00:00:00'), 'overdue');
  assert.equal(tab('pending', '2026-12-01T00:00:00'), 'upcoming');
  assert.equal(tab('pending', '2027-11-20T00:00:00'), 'upcoming', 'same month next year is not this month');
  assert.equal(tab('submitted', '2026-10-01T00:00:00'), 'awaiting', 'awaiting approval even when past due');
  for (const done of ['approved', 'completed', 'rejected']) assert.equal(tab(done, '2026-10-01T00:00:00'), 'completed');
  assert.equal(tab('skipped', '2026-10-01T00:00:00'), null);
});

test('the proposal sits beside the last approved values with the change', () => {
  const risk = { inherent_likelihood: 4, inherent_impact: 4, inherent_score: 16, residual_likelihood: 3, residual_impact: 3, residual_score: 9 };
  const rows = compareScores(risk, { proposed_residual_likelihood: 4, proposed_residual_impact: 2 });
  assert.deepEqual(rows.map((r) => [r.label, r.before, r.after, r.delta]), [
    ['Before controls: likelihood', 4, 4, 0],
    ['Before controls: impact', 4, 4, 0],
    ['Before controls: score', 16, 16, 0],
    ['After controls: likelihood', 3, 4, 1],
    ['After controls: impact', 3, 2, -1],
    ['After controls: score', 9, 8, -1],
  ]);
  assert.equal(compareScores(risk, { new_residual_score: 6 })[5].after, 6, 'the old API proposed a bare score');
  assert.equal(compareScores({}, {})[2].delta, null, 'unscored: no change to show');
});

test('an approved review shows what it changed', () => {
  const rows = approvedScores({ previous_inherent_score: 16, new_inherent_score: 16, previous_residual_score: 9, new_residual_score: 16 });
  assert.deepEqual(rows.map((r) => r.delta), [0, 7]);
});
