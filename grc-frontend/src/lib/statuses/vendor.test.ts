// node --test "src/lib/statuses/vendor.test.ts"
// The words of Third-Party Vendor Risk: every word a page can show has a tone of the platform's families and a readable label, the colours keep their meaning, and a word nobody registered
// reads neutral with its own label. The next-step words are the ones the server writes (`NEXT_ACTIONS` of the vendor router), read from it so a new one fails here until it is registered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { TONE, statusPill } from '../status.ts';
import {
  vendorAction, vendorActionKind, vendorAssessment, vendorBand, vendorCondition, vendorContract, vendorDecision, vendorDocument, vendorFinding, vendorGrade, vendorLifecycle,
  vendorNextStep, vendorQueueState, vendorScreening, vendorStage, vendorTier, vendorUrgency,
} from './vendor.ts';

const ALL = [
  vendorLifecycle, vendorStage, vendorFinding, vendorDecision, vendorCondition, vendorAssessment, vendorDocument, vendorContract, vendorUrgency, vendorScreening, vendorGrade, vendorTier,
  vendorBand, vendorNextStep, vendorAction, vendorActionKind, vendorQueueState,
];

test('every word has a tone of the platform\'s families and a readable label', () => {
  for (const reg of ALL) for (const w of reg.words) {
    assert.ok(Object.keys(TONE).includes(reg.tone(w)), `${reg.record}.${w}`);
    assert.ok(reg.label(w).length > 1 && reg.label(w) !== '—', `${reg.record}.${w}`);
  }
});

test('the next-step words are the ones the server writes, in the register\'s order', () => {
  assert.deepEqual(vendorNextStep.words, ['suspended', 'reassessment_overdue', 'not_tiered', 'awaiting_approval', 'response_to_review', 'documents_expired', 'weak_grade', 'no_owner', 'reassessment_due', 'offboarding']);
  const src = new URL('../../../../backend/grc/modules/vendor_risk/routers/vendors.py', import.meta.url);
  if (!existsSync(src)) return;
  const code = readFileSync(src, 'utf8');
  const table = code.slice(code.indexOf('NEXT_ACTIONS = {'), code.indexOf('DUE_SOON_DAYS'));
  const codes = Array.from(table.matchAll(/^\s+"([a-z_]+)":\s*\(/gm), (m) => m[1]);
  assert.deepEqual(codes, vendorNextStep.words, 'the NEXT_ACTIONS table of the server and lib/statuses/vendor.ts say the same words in the same order');
  Array.from(table.matchAll(/^\s+"([a-z_]+)":\s*\("([^"]+)"/gm)).forEach((m) => assert.equal(vendorNextStep.label(m[1]), m[2], `${m[1]}: the words of the register`));
});

test('the colours keep their meaning: late red, missing amber, someone on it blue, done green, a decision purple, nothing grey', () => {
  assert.deepEqual(['suspended', 'reassessment_overdue', 'documents_expired'].map((w) => vendorNextStep.tone(w)), ['danger', 'danger', 'danger']);
  assert.deepEqual(['not_tiered', 'weak_grade', 'no_owner', 'offboarding'].map((w) => vendorNextStep.tone(w)), ['warning', 'warning', 'warning', 'warning']);
  assert.deepEqual(['awaiting_approval', 'response_to_review', 'reassessment_due'].map((w) => vendorNextStep.tone(w)), ['progress', 'progress', 'progress']);
  assert.deepEqual(['critical', 'high', 'medium', 'low', 'not_tiered'].map((w) => vendorTier.tone(w)), ['danger', 'warning', 'progress', 'success', 'neutral']);
  assert.deepEqual(['critical', 'high', 'medium', 'low', 'none'].map((w) => vendorBand.tone(w)), ['danger', 'warning', 'progress', 'success', 'neutral']);
  assert.deepEqual(['a', 'B', 'c', 'D', 'e', 'F'].map((w) => vendorGrade.tone(w)), ['success', 'success', 'progress', 'warning', 'danger', 'danger']);
  assert.deepEqual(['scheduled', 'done', 'failed', 'cancelled'].map((w) => vendorAction.tone(w)), ['progress', 'success', 'danger', 'neutral']);
  assert.equal(vendorNextStep.label('not_tiered'), 'Needs tiering');
  assert.equal(vendorTier.label('not_tiered'), 'Not tiered');
  assert.equal(vendorBand.label('none'), 'Not scored');
  assert.equal(vendorAction.label('failed'), 'Could not happen');
  assert.equal(vendorGrade.label('b'), 'Grade B');
});

test('a word reads the same whatever its spelling, and the same word means different things in different registries', () => {
  assert.equal(vendorLifecycle.tone('Under review'), 'progress');
  assert.equal(vendorLifecycle.tone('under-review'), 'progress');
  assert.equal(vendorFinding.tone('open'), 'danger');
  assert.equal(vendorCondition.tone('open'), 'warning');
  assert.equal(vendorStage.tone('not_started'), 'pending');
});

test('an unknown word is neutral with a readable label, and none at all is a dash', () => {
  assert.deepEqual(statusPill(vendorLifecycle, 'awaiting_board'), { tone: 'neutral', label: 'Awaiting board' });
  assert.deepEqual(statusPill(vendorNextStep, 'something_new'), { tone: 'neutral', label: 'Something new' });
  for (const reg of ALL) assert.equal(reg.tone(null), 'neutral', reg.record);
  assert.equal(vendorLifecycle.label(null), '—');
});
