// node --test "src/lib/statuses/assessments.test.ts"
// The status words of Compliance > Assessments: every word the workspace can show has a tone and a label, an unknown word reads neutral with a readable label,
// and the vocabulary is the audit's (one for every type: Complied / Partially complied / Not complied / Not answered / Not applicable).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { statusPill, type Statuses } from '../status.ts';
import { approvalWord, CONTROL_STATUS_ORDER, controlStatus, evidenceApproval, grade, lifecycle, lifecycleOf, remediationState } from './assessments.ts';

const ALL: Statuses[] = [controlStatus, remediationState, lifecycle, grade, evidenceApproval];

test('every registered word has a tone and a readable label, an unknown word is neutral with its own label, a missing word is the dash', () => {
  for (const registry of ALL) {
    assert.ok(registry.words.length > 0, registry.record);
    for (const word of registry.words) {
      assert.match(registry.tone(word), /^(success|danger|warning|progress|pending|neutral)$/, `${registry.record}: ${word}`);
      assert.ok(registry.label(word).trim().length > 1 && registry.label(word) !== '—', `${registry.record}: ${word} has a label`);
    }
    assert.deepEqual(statusPill(registry, 'some_new_word'), { tone: 'neutral', label: 'Some new word' }, registry.record);
    assert.equal(statusPill(registry, null).label, '—', registry.record);
    assert.equal(registry.tone('constructor'), 'neutral', `${registry.record}: not an inherited property`);
  }
});

test('the five control answers are one vocabulary for every type, in the order they are offered', () => {
  assert.deepEqual([...CONTROL_STATUS_ORDER], controlStatus.words.slice());
  assert.deepEqual(CONTROL_STATUS_ORDER.map((w) => controlStatus.label(w)), ['Complied', 'Partially complied', 'Not complied', 'Not answered', 'Not applicable']);
  assert.deepEqual(CONTROL_STATUS_ORDER.map((w) => controlStatus.tone(w)), ['success', 'warning', 'danger', 'neutral', 'neutral']);
});

test('remediation words read the same in the old title case and the new lower case', () => {
  for (const [stored, label] of [['Open', 'Open'], ['open', 'Open'], ['In Progress', 'In progress'], ['in_progress', 'In progress'], ['Closed', 'Closed'], ['closed', 'Closed']]) {
    assert.equal(remediationState.label(stored), label, stored);
    assert.ok(remediationState.has(stored), stored);
  }
  assert.equal(remediationState.tone('closed'), 'success');
});

test('lifecycle: a scoped draft is scoping whatever its stored status says, an upload nobody moved on is a draft', () => {
  assert.equal(lifecycleOf({ phase: 'scoping', status: 'draft' }), 'scoping');
  assert.equal(lifecycleOf({ phase: 'in_progress', status: 'in_progress' }), 'in_progress');
  assert.equal(lifecycleOf({ phase: null, status: 'draft' }), 'draft');
  assert.equal(lifecycleOf({ phase: null, status: 'In Review' }), 'in_review');
  assert.equal(lifecycleOf({ phase: null, status: null }), 'draft');
  assert.equal(lifecycle.label('completed'), 'Completed');
});

test('the grade words are the server\'s four; a review at any tier is one pill', () => {
  assert.deepEqual(['excellent', 'good', 'fair', 'poor'].map((w) => grade.tone(w)), ['success', 'progress', 'warning', 'danger']);
  assert.equal(approvalWord('pending_tier_3'), 'pending_review');
  assert.equal(approvalWord('Pending Review'), 'pending_review');
  assert.equal(approvalWord(null), 'draft');
  assert.equal(evidenceApproval.label(approvalWord('pending_tier_2')), 'In review');
  assert.equal(evidenceApproval.label('draft'), 'Not submitted');
});
