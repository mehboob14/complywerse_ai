// node --test "src/lib/statuses/connections.test.ts"
// The Connected systems words: every word the register can show has a tone and a plain label, and a word nobody registered reads neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TONE, statusPill, type Statuses } from '../status.ts';
import { CONNECTION_REGISTRIES, connectionHealth } from './connections.ts';

test('every word has a tone that exists and a label of words', () => {
  for (const reg of Object.values(CONNECTION_REGISTRIES) as Statuses[]) {
    assert.ok(reg.words.length > 0);
    for (const word of reg.words) {
      assert.ok(reg.tone(word) in TONE, `${reg.record}: ${word} has a tone`);
      assert.ok(reg.label(word).length > 2 && reg.label(word) !== '—', `${reg.record}: ${word} has a label`);
    }
  }
});

test('the register has exactly the five health words, a failure is red and a pause is not', () => {
  assert.deepEqual([...connectionHealth.words].sort(), ['degraded', 'failing', 'healthy', 'never_run', 'paused']);
  assert.equal(connectionHealth.tone('failing'), 'danger');
  assert.equal(connectionHealth.tone('healthy'), 'success');
  assert.equal(connectionHealth.tone('paused'), 'neutral');
});

test('a word nobody registered reads neutral with a readable label, and no word is the colour alone', () => {
  assert.deepEqual(statusPill(connectionHealth, 'on_hold'), { tone: 'neutral', label: 'On hold' });
  assert.equal(connectionHealth.tone(undefined), 'neutral');
  assert.equal(connectionHealth.label(null), '—');
});
