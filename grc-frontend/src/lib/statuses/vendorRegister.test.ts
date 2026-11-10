// node --test "src/lib/statuses/vendorRegister.test.ts"
// The words the Vendors register adds: every word has a tone of the platform's families and a readable label, the colours keep their meaning, and a word nobody registered reads neutral.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TONE } from '../status.ts';
import { checkinState, contractState, vendorClassification } from './vendorRegister.ts';

test('every word has a tone of the platform\'s families and a readable label', () => {
  for (const reg of [vendorClassification, contractState, checkinState]) for (const w of reg.words) {
    assert.ok(Object.keys(TONE).includes(reg.tone(w)), `${reg.record}.${w}`);
    assert.ok(reg.label(w).length > 2 && reg.label(w) !== '—', `${reg.record}.${w}`);
  }
});

test('the colours keep their meaning: late red, a decision amber, running green, nothing grey', () => {
  assert.equal(vendorClassification.tone('restricted'), 'danger');
  assert.equal(vendorClassification.tone('confidential'), 'warning');
  assert.equal(vendorClassification.tone('public'), 'neutral');
  assert.deepEqual(['lapsed', 'decide', 'ending', 'in_force', 'draft', 'ended'].map((w) => contractState.tone(w)), ['danger', 'warning', 'progress', 'success', 'neutral', 'neutral']);
  assert.deepEqual(['overdue', 'due_soon', 'upcoming', 'done'].map((w) => checkinState.tone(w)), ['danger', 'warning', 'neutral', 'success']);
});

test('the contract words are the ones the Contracts page used and the check-in words the ones the Check-ins page used', () => {
  assert.deepEqual(['lapsed', 'decide', 'ending', 'in_force', 'draft', 'ended'].map((w) => contractState.label(w)), ['Past its date', 'Decide now', 'Ending soon', 'In force', 'Draft', 'Ended']);
  assert.deepEqual(['overdue', 'due_soon', 'upcoming', 'done'].map((w) => checkinState.label(w)), ['Overdue', 'Due soon', 'Upcoming', 'Done']);
});

test('a word nobody registered reads neutral with a readable label, never a guess', () => {
  assert.equal(vendorClassification.tone('secret'), 'neutral');
  assert.equal(vendorClassification.label('secret'), 'Secret');
  assert.equal(contractState.tone('frozen'), 'neutral');
});
