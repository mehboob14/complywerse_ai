import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskBandForScore } from './riskBands.ts';

test('bands match the backend: critical >= 20, high >= 12, medium >= 6', () => {
  assert.equal(riskBandForScore(25), 'critical');
  assert.equal(riskBandForScore(20), 'critical');
  assert.equal(riskBandForScore(19), 'high');
  assert.equal(riskBandForScore(12), 'high');
  assert.equal(riskBandForScore(11), 'medium');
  assert.equal(riskBandForScore(6), 'medium');
  assert.equal(riskBandForScore(5), 'low');
  assert.equal(riskBandForScore(1), 'low');
});

test('an unscored risk has no band rather than counting as low', () => {
  assert.equal(riskBandForScore(null), null);
  assert.equal(riskBandForScore(undefined), null);
  assert.equal(riskBandForScore(0), null);
});
