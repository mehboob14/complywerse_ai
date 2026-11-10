// node --test "src/lib/statuses/vendorIntake.test.ts"
// The words of the Intake page: every word has a tone of the platform's families and a readable label, the request words are the ones the server writes, and a word nobody registered reads
// neutral with a label a person can read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { TONE } from '../status.ts';
import { intakeRequest, intakeScreening, intakeUrgency } from './vendorIntake.ts';

test('every word has a tone of the platform\'s families and a readable label', () => {
  for (const reg of [intakeRequest, intakeScreening, intakeUrgency]) for (const w of reg.words) {
    assert.ok(Object.keys(TONE).includes(reg.tone(w)), `${reg.record}.${w}`);
    assert.ok(reg.label(w).length > 2 && reg.label(w) !== '—', `${reg.record}.${w}`);
  }
});

test('the request words are the five the server writes, said as the review team says them', () => {
  assert.deepEqual(intakeRequest.words, ['draft', 'submitted', 'in_review', 'approved', 'rejected']);
  assert.deepEqual(intakeRequest.words.map((w) => intakeRequest.label(w)), ['Draft', 'Awaiting decision', 'In review', 'Approved', 'Declined']);
  const src = new URL('../../../../backend/grc/modules/vendor_risk/tpra/intake.py', import.meta.url);
  if (!existsSync(src)) return;
  const line = /^STATUSES = \(([^)]*)\)/m.exec(readFileSync(src, 'utf8'));
  assert.ok(line, 'intake.py lists STATUSES');
  assert.deepEqual(Array.from((line as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g), (m) => m[1]), intakeRequest.words, 'the server and the registry say the same words in the same order');
});

test('colours keep their meaning: waiting purple, moving blue, done green, turned down red, a draft grey; high urgency amber, a flag amber, a clean screen green', () => {
  assert.deepEqual(intakeRequest.words.map((w) => intakeRequest.tone(w)), ['neutral', 'pending', 'progress', 'success', 'danger']);
  assert.deepEqual(['low', 'normal', 'high'].map((w) => intakeUrgency.tone(w)), ['neutral', 'progress', 'warning']);
  assert.deepEqual(['flagged', 'screened'].map((w) => intakeScreening.tone(w)), ['warning', 'success']);
});

test('a word nobody registered is neutral and readable', () => {
  assert.equal(intakeRequest.tone('on_hold'), 'neutral');
  assert.equal(intakeRequest.label('on_hold'), 'On hold');
  assert.equal(intakeUrgency.label('urgent'), 'Urgent');
});
