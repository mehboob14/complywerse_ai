// node --test "src/lib/rcsa/scores.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { controlBand, controlText, percent, progressTone, riskBand, riskText } from './scores.ts';

test('risk bands are the Risk Register\'s: 20 critical, 12 high, 6 medium, below that low', () => {
  assert.deepEqual([25, 20, 19.9, 12, 11.9, 6, 5.9, 1].map(riskBand), ['critical', 'critical', 'high', 'high', 'medium', 'medium', 'low', 'low']);
  assert.equal(riskBand(0), null);
  assert.equal(riskBand(null), null);
  assert.equal(riskBand(Number.NaN), null);
});

test('the average residual reads with its band; nothing scored is the dash', () => {
  assert.equal(riskText(11.2), '11.2 · Medium');
  assert.equal(riskText(12), '12.0 · High');
  assert.equal(riskText(null), '—');
});

test('the control score is on its own 1-to-3 scale (the old pages coloured it on the 25 scale, so it was always red)', () => {
  assert.deepEqual([3, 2.5, 2.4, 1.5, 1.4, 1].map(controlBand), ['strong', 'strong', 'partial', 'partial', 'weak', 'weak']);
  assert.equal(controlText(3), '3.0 of 3 · Working');
  assert.equal(controlText(2), '2.0 of 3 · Partly working');
  assert.equal(controlText(undefined), '—');
});

test('a percent never rounds up to done', () => {
  assert.equal(percent(5, 14), 35);
  assert.equal(percent(14, 14), 100);
  assert.equal(percent(13, 14), 92);
  assert.equal(percent(0, 0), 0);
  assert.equal(progressTone(100, true), 'success');
  assert.equal(progressTone(40, true), 'danger');
  assert.equal(progressTone(40, false), 'default');
});
