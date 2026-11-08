// node --test "src/app/(dashboard)/vendor-risk/_overview/trendModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clamp100, monthWords, runs } from './trendModel.ts';

const x = (i: number) => i * 10;
const y = (v: number) => 100 - v;

test('a line is drawn in runs: a month with no score breaks it instead of dropping to zero', () => {
  assert.deepEqual(runs([10, 20, null, 40, 50, null], x, y), ['0.0,90.0 10.0,80.0', '30.0,60.0 40.0,50.0']);
  assert.deepEqual(runs([null, null], x, y), []);
  assert.deepEqual(runs([], x, y), []);
  assert.deepEqual(runs([NaN, 5], x, y), ['10.0,95.0']);
});

test('months are said in words; a value the page does not know is left alone', () => {
  assert.equal(monthWords('2026-11'), 'Nov 2026');
  assert.equal(monthWords('2027-01-01'), 'Jan 2027');
  assert.equal(monthWords('2026-13'), '2026-13');
  assert.equal(monthWords('last month'), 'last month');
});

test('a score stays inside the picture', () => {
  assert.deepEqual([-5, 0, 42.5, 100, 140].map(clamp100), [0, 0, 42.5, 100, 100]);
});
