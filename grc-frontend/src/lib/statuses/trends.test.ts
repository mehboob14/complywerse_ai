// node --test "src/lib/statuses/trends.test.ts"
// The words of the Trends board: the four words the server writes (metric_catalog.rag_status) each have a tone that exists and a readable label, the colours keep their meaning, and a word nobody registered
// reads neutral.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TONE } from '../status.ts';
import { analyticsConnection, trendStatus } from './trends.ts';

test('every word the server writes has a tone that exists and a readable label', () => {
  assert.deepEqual(trendStatus.words, ['ok', 'warn', 'critical', 'none']);
  for (const word of trendStatus.words) {
    assert.ok(Object.keys(TONE).includes(trendStatus.tone(word)), `${word}: tone`);
    assert.match(trendStatus.label(word), /^[A-Z][a-z]+( [a-z]+)?$/, `${word}: label`);
  }
});

test('on target is success, watch is a warning, off target is danger, no target is neutral: and each says so in words', () => {
  assert.deepEqual(trendStatus.words.map((w) => [trendStatus.tone(w), trendStatus.label(w)]), [['success', 'On target'], ['warning', 'Watch'], ['danger', 'Off target'], ['neutral', 'No target']]);
});

test('a word nobody registered is neutral with a readable label', () => {
  assert.equal(trendStatus.tone('surprise'), 'neutral');
  assert.equal(trendStatus.label('surprise'), 'Surprise');
  assert.equal(trendStatus.tone(null), 'neutral');
});

test('the analytics connection says Connected or Not set up yet, and not being set up is a warning, never danger', () => {
  assert.deepEqual(analyticsConnection.words.map((w) => [analyticsConnection.tone(w), analyticsConnection.label(w)]), [['success', 'Connected'], ['warning', 'Not set up yet']]);
  assert.equal(analyticsConnection.tone('surprise'), 'neutral');
});
