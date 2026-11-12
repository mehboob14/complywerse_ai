import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCampaignPeriods, newCampaignPeriods } from './periods.ts';

test('a new campaign is offered this year and next, not a fixed year', () => {
  const periods = newCampaignPeriods(new Date(2027, 5, 1));
  assert.deepEqual(periods.slice(0, 5), ['Q1 2027', 'Q2 2027', 'Q3 2027', 'Q4 2027', 'Annual 2027']);
  assert.equal(periods.at(-1), 'Annual 2028');
  assert.equal(periods.length, 10);
});

test('the filter also reaches last year', () => {
  const periods = filterCampaignPeriods(new Date(2027, 0, 1));
  assert.equal(periods[0], 'Q1 2026');
  assert.equal(periods.length, 15);
});
