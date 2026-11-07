// node --test "src/lib/rcsa/rules.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { campaignRunning, canEdit, canStart, decisionCopy, decisions, inReview, readOnlyReason, standing, submitAsk } from './rules.ts';

const STATES = ['not_started', 'in_progress', 'submitted', 'under_review', 'approved', 'rejected', 'requires_changes'];

test('answers can be typed only while in progress or sent back, and only in a running campaign (the server\'s save: in_progress and requires_changes)', () => {
  assert.deepEqual(STATES.filter((status) => canEdit({ status, campaignStatus: 'active' })), ['in_progress', 'requires_changes']);
  assert.equal(canEdit({ status: 'in_progress', campaignStatus: 'closed' }), false, 'a closed campaign is read only (the server would still take the answer)');
  assert.equal(canEdit({ status: 'in_progress' }), true, 'no campaign status given: it is read as running');
});

test('only a not-started unit of a running campaign is started by opening it', () => {
  assert.deepEqual(STATES.filter((status) => canStart({ status, campaignStatus: 'active' })), ['not_started']);
  assert.equal(canStart({ status: 'not_started', campaignStatus: 'draft' }), false);
  assert.equal(campaignRunning('closed'), false);
});

test('the decision bar exists while the unit waits for review, and only for the people it waits for', () => {
  assert.deepEqual(decisions({ status: 'submitted' }, true), ['approve', 'return', 'reject']);
  assert.deepEqual(decisions({ status: 'under_review' }, true), ['approve', 'return', 'reject']);
  assert.deepEqual(decisions({ status: 'submitted' }, false), []);
  for (const status of STATES.filter((s) => !inReview(s))) assert.deepEqual(decisions({ status }, true), [], `${status}: nothing to decide`);
});

test('a rejected unit offers nothing and says so in plain words, a returned one says what to do', () => {
  assert.equal(canEdit({ status: 'rejected' }), false);
  assert.match(standing({ status: 'rejected' }, 'assessor'), /closed and cannot be answered again/);
  assert.match(standing({ status: 'requires_changes' }, 'assessor'), /Fix the answers/);
  assert.match(standing({ status: 'under_review', tier: 2, total: 3 }, 'reviewer'), /Waiting for your decision\. Step 2 of 3\./);
  assert.doesNotMatch(standing({ status: 'submitted', tier: 1, total: 1 }, 'reader'), /Step/);
});

test('every state has a sentence, and a read-only form says why', () => {
  for (const status of STATES) assert.ok(standing({ status }, 'assessor').length > 10, status);
  assert.equal(readOnlyReason({ status: 'in_progress', campaignStatus: 'active' }), null);
  assert.match(readOnlyReason({ status: 'in_progress', campaignStatus: 'closed' }) ?? '', /closed/);
  assert.match(readOnlyReason({ status: 'submitted' }) ?? '', /decides/);
});

test('submitting with empty required questions is allowed after a plain warning that counts them', () => {
  assert.equal(submitAsk(0).confirmLabel, 'Submit for review');
  const ask = submitAsk(3);
  assert.match(ask.title, /3 required questions unanswered/);
  assert.equal(ask.confirmLabel, 'Submit anyway');
  assert.match(submitAsk(1).title, /1 required question unanswered/);
});

test('sending back and rejecting need words, approving does not; rejecting says it closes the unit', () => {
  assert.equal(decisionCopy('approve').required, false);
  assert.equal(decisionCopy('return').required, true);
  assert.equal(decisionCopy('reject').required, true);
  assert.equal(decisionCopy('reject').tone, 'danger');
  assert.match(decisionCopy('reject').hint, /closes the unit/);
});
