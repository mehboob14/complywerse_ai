// node --test "src/app/(dashboard)/automation/soc2-controls/[code]/_workspace/applicabilityModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REASON_MAX, applicabilityView, decisionBody, decisionProblem, requestBody, requestProblem, type ApplicabilityBlock } from './applicabilityModel.ts';

const BLOCK: ApplicabilityBlock = {
  is_applicable: true, source: 'derived', reason: null, obligation: 'MCR', status: 'draft', requested_by: null, requested_by_name: null, requested_at: null,
  reviewed_by: null, reviewed_by_name: null, reviewed_at: null, review_comment: null,
};
const MAY = { frameworks: true };
const MAY_NOT = { frameworks: false };

test('a control that applies says why, in the words of its source', () => {
  const v = applicabilityView(BLOCK, 7, MAY);
  assert.equal(v.state, 'applies');
  assert.equal(v.headline, 'This control applies to you.');
  assert.equal(v.because, 'Your frameworks decide it.');
  assert.equal(v.canRequest, true);
  assert.equal(v.canDecide, false);
  assert.equal(v.pending, null);
});

test('a reason a person wrote beats the words of the source', () => {
  const v = applicabilityView({ ...BLOCK, is_applicable: false, source: 'override', reason: 'We have no offices.', status: 'approved', reviewed_by_name: 'Rey', review_comment: 'Agreed' }, 7, MAY);
  assert.equal(v.state, 'not_applicable');
  assert.equal(v.because, 'We have no offices.');
  assert.deepEqual(v.ruled, { approved: true, by: 'Rey', at: null, comment: 'Agreed' });
});

test('no scope yet reads as unknown, never as "applies"', () => {
  const v = applicabilityView({ ...BLOCK, is_applicable: null, source: null }, 7, MAY);
  assert.equal(v.state, 'unscoped');
  assert.match(v.headline, /has not been calculated/);
  assert.equal(applicabilityView(null, 7, MAY).state, 'unscoped');
});

test('a pending request says what was ASKED for, and a different person may rule on it', () => {
  const pending = { ...BLOCK, is_applicable: false, source: 'override', reason: 'No offices', status: 'pending_review', requested_by: 3, requested_by_name: 'Ana', requested_at: '2026-11-08T09:00:00' };
  const v = applicabilityView(pending, 7, MAY);
  assert.equal(v.state, 'pending');
  assert.equal(v.headline, 'Ana asked to mark this control not applicable.');
  assert.deepEqual(v.pending, { asked: 'not_applicable', by: 'Ana', at: '2026-11-08T09:00:00', reason: 'No offices', mine: false });
  assert.equal(v.canDecide, true);
  assert.equal(v.canRequest, false, 'one request at a time');
  assert.equal(v.blocked, null);
});

test('the person who asked cannot rule on their own request (the server refuses it too)', () => {
  const v = applicabilityView({ ...BLOCK, is_applicable: false, status: 'pending_review', requested_by: 7, requested_by_name: 'Me' }, 7, MAY);
  assert.equal(v.pending?.mine, true);
  assert.equal(v.canDecide, false);
  assert.equal(v.blocked, 'You asked for this change, so someone else has to decide it.');
});

test('a person without the right can read, and is told why a button is off', () => {
  const v = applicabilityView({ ...BLOCK, is_applicable: false, status: 'pending_review', requested_by: 3 }, 7, MAY_NOT);
  assert.equal(v.canDecide, false);
  assert.equal(v.canRequest, false);
  assert.equal(v.blocked, 'You need the right to manage frameworks.');
  assert.equal(applicabilityView(BLOCK, 7, MAY_NOT).blocked, 'You need the right to manage frameworks.');
});

test('while the signed-in person is not known nobody is the asker, and the server has the last word', () => {
  const v = applicabilityView({ ...BLOCK, status: 'pending_review', requested_by: 3 }, null, MAY);
  assert.equal(v.pending?.mine, false);
  assert.equal(v.canDecide, true);
});

test('a rejected request is shown as a ruling', () => {
  const v = applicabilityView({ ...BLOCK, status: 'rejected', reviewed_by_name: 'Rey', review_comment: ' needs a better reason ' }, 7, MAY);
  assert.deepEqual(v.ruled, { approved: false, by: 'Rey', at: null, comment: 'needs a better reason' });
});

test('"not applicable" needs a reason before it is sent; "applicable" does not', () => {
  assert.match(requestProblem({ makeApplicable: false, reason: '  ' }) ?? '', /Say why/);
  assert.equal(requestProblem({ makeApplicable: false, reason: 'No offices' }), null);
  assert.equal(requestProblem({ makeApplicable: true, reason: '' }), null);
  assert.match(requestProblem({ makeApplicable: true, reason: 'x'.repeat(REASON_MAX + 1) }) ?? '', /under 2000/);
  assert.deepEqual(requestBody({ makeApplicable: false, reason: '  No offices ' }), { is_applicable: false, reason: 'No offices' });
});

test('refusing needs a why; approving does not; an empty comment is sent as none', () => {
  assert.match(decisionProblem(false, ' ') ?? '', /Say why you are refusing/);
  assert.equal(decisionProblem(false, 'Not enough'), null);
  assert.equal(decisionProblem(true, ''), null);
  assert.deepEqual(decisionBody(true, '  '), { approve: true, comment: null });
  assert.deepEqual(decisionBody(false, ' no '), { approve: false, comment: 'no' });
});
