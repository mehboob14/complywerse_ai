// node --test "src/app/(dashboard)/erm/reviews/_review/reviewsModel.test.ts"
// The Reviews page rules: overdue is worked out (the server never writes it), the filter counts are the true ones over the complete list, the order is fixed, and completing a review sends
// the scores with the likelihood and impact (the server does not recompute them).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FILTERS, completeBody, completeProblem, countsOf, daysLate, isOverdue, matchesFilter, matchesSearch, sortReviews, type Review } from './reviewsModel.ts';

const NOW = new Date('2026-11-08T12:00:00Z');
const rv = (id: number, over: Partial<Review> = {}): Review => ({ id, risk_id: id, risk_title: `Risk ${id}`, status: 'pending', due_date: '2026-12-01T00:00:00', ...over });

test('overdue is an open review past its due date, worked out here; a finished one never is', () => {
  assert.equal(isOverdue(rv(1, { due_date: '2026-11-01T00:00:00' }), NOW), true);
  assert.equal(isOverdue(rv(1, { due_date: '2026-11-01T00:00:00', status: 'in_review' }), NOW), true);
  assert.equal(isOverdue(rv(1, { due_date: '2026-11-01T00:00:00', status: 'completed' }), NOW), false);
  assert.equal(isOverdue(rv(1, { due_date: '2026-12-01T00:00:00' }), NOW), false);
  assert.equal(isOverdue(rv(1, { due_date: '2026-11-08' }), NOW), true, 'a date-only due date is the start of that day');
  assert.equal(daysLate(rv(1, { due_date: '2026-11-01T12:00:00' }), NOW), 7);
  assert.equal(daysLate(rv(1, { due_date: '2026-11-08T11:00:00' }), NOW), 1, 'an hour late is a day late, never "0 days overdue"');
  assert.equal(daysLate(rv(1), NOW), 0);
});

test('the counts are of the complete list, and each filter shows what its count says', () => {
  const list = [rv(1), rv(2, { due_date: '2026-10-01T00:00:00' }), rv(3, { status: 'in_review', due_date: '2026-10-01T00:00:00' }), rv(4, { status: 'completed' }), rv(5, { status: 'approved' }), rv(6, { status: 'rejected' })];
  assert.deepEqual(countsOf(list, NOW), { all: 6, pending: 2, in_review: 1, overdue: 2, completed: 2 });
  for (const f of FILTERS) assert.equal(list.filter((r) => matchesFilter(r, f, NOW)).length, countsOf(list, NOW)[f], f);
  assert.equal(matchesSearch(rv(1, { risk_title: 'Card Fraud' }), ' fraud '), true);
  assert.equal(matchesSearch(rv(1, { risk_title: null }), 'x'), false);
});

test('the default order is the earliest due first; a tie keeps its order', () => {
  const list = [rv(3, { due_date: '2026-12-01T00:00:00' }), rv(1, { due_date: '2026-10-01T00:00:00' }), rv(2, { due_date: '2026-10-01T00:00:00' })];
  assert.deepEqual(sortReviews(list, { key: 'due', dir: 'asc' }).map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(sortReviews(list, { key: 'due', dir: 'desc' }).map((r) => r.id), [3, 1, 2]);
  assert.deepEqual(sortReviews([rv(1, { risk_title: 'b' }), rv(2, { risk_title: 'A' })], { key: 'risk', dir: 'asc' }).map((r) => r.id), [2, 1]);
});

test('completing sends the risk new likelihood and impact WITH their scores, only where something changed, and the review its new scores and words', () => {
  const risk = { inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 3, residual_impact: 4 };
  const same = completeBody({ risk, inhL: '4', inhI: '4', resL: '3', resI: '4', findings: ' ', recommendations: '' });
  assert.deepEqual(same.riskUpdate, {}, 'nothing changed: the risk is not touched');
  assert.deepEqual(same.review, { status: 'completed', new_inherent_score: 16, new_residual_score: 12, findings: undefined, recommendations: undefined });
  const changed = completeBody({ risk, inhL: '4', inhI: '4', resL: '2', resI: '4', findings: ' Controls hold ', recommendations: 'Re-test in March' });
  assert.deepEqual(changed.riskUpdate, { residual_likelihood: 2, residual_score: 8 }, 'the residual score travels with the residual likelihood');
  assert.deepEqual(changed.review, { status: 'completed', new_inherent_score: 16, new_residual_score: 8, findings: 'Controls hold', recommendations: 'Re-test in March' });
  const blank = completeBody({ risk, inhL: '', inhI: '', resL: '', resI: '', findings: '', recommendations: '' });
  assert.deepEqual(blank.riskUpdate, {});
  assert.deepEqual(blank.review, { status: 'completed', new_inherent_score: undefined, new_residual_score: undefined, findings: undefined, recommendations: undefined });
  assert.deepEqual(completeBody({ risk: undefined, inhL: '5', inhI: '5', resL: '', resI: '', findings: '', recommendations: '' }).riskUpdate, { inherent_likelihood: 5, inherent_impact: 5, inherent_score: 25 });
});

test('a draft is refused in words when a value is out of range or a pair is half given', () => {
  assert.equal(completeProblem({ inhL: '4', inhI: '4', resL: '', resI: '' }), '');
  assert.match(completeProblem({ inhL: '6', inhI: '4', resL: '', resI: '' }), /1 to 5/);
  assert.match(completeProblem({ inhL: '2.5', inhI: '4', resL: '', resI: '' }), /1 to 5/);
  assert.match(completeProblem({ inhL: '4', inhI: '', resL: '', resI: '' }), /inherent/);
  assert.match(completeProblem({ inhL: '', inhI: '', resL: '3', resI: '' }), /residual/);
});
