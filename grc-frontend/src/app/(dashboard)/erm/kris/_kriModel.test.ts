import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeFromLast, dueText, sortIndicators, thresholdChangeLines, thresholdLabels, thresholdLegend, trendOf } from './_kriModel.ts';

test('the legend follows the direction, as the backend rates a value', () => {
  assert.deepEqual(thresholdLegend('lower_is_better', 5, 10), ['≤5', '≤10', '>10']);
  assert.deepEqual(thresholdLegend('higher_is_better', 99, 97), ['≥99', '≥97', '<97']);
  assert.deepEqual(thresholdLegend('lower_is_better', 0, 0), ['≤0', '≤0', '>0'], 'a 0 threshold is a threshold');
  assert.equal(thresholdLegend('lower_is_better', null, 10), null, 'no legend without both thresholds');
  assert.equal(thresholdLegend('higher_is_better', 5, undefined), null);
});

test('the trend is the last move, good or bad by direction', () => {
  assert.equal(trendOf([], 'lower_is_better'), null);
  assert.equal(trendOf([4], 'lower_is_better'), null);
  assert.equal(trendOf([4, 4], 'lower_is_better'), null, 'no move, no arrow');
  assert.deepEqual(trendOf([1, 4, 6], 'lower_is_better'), { delta: 2, better: false }, 'more incidents is worse');
  assert.deepEqual(trendOf([6, 3], 'lower_is_better'), { delta: -3, better: true });
  assert.deepEqual(trendOf([97, 99], 'higher_is_better'), { delta: 2, better: true });
  assert.deepEqual(trendOf([99, 98], 'higher_is_better'), { delta: -1, better: false });
});

test('red first, then amber, then the rest; drafts last', () => {
  const kris = [
    { id: 1, current_status: 'green' }, { id: 2, current_status: 'amber' }, { id: 3, current_status: 'red', status: 'draft' },
    { id: 4, current_status: 'red' }, { id: 5 }, { id: 6, current_status: 'amber' },
  ];
  assert.deepEqual(sortIndicators(kris).map((k) => k.id), [4, 2, 6, 1, 5, 3]);
});

test('threshold labels follow the direction', () => {
  assert.deepEqual(thresholdLabels('lower_is_better'), ['Green up to', 'Amber up to']);
  assert.deepEqual(thresholdLabels('higher_is_better'), ['Green from', 'Amber from']);
});

test('the change from the last published value', () => {
  assert.equal(changeFromLast(7, 4), 3);
  assert.equal(changeFromLast(0.3, 0.1), 0.2, 'rounded, not 0.19999');
  assert.equal(changeFromLast(5, null), null, 'nothing published yet');
  assert.equal(changeFromLast(0, 0), 0);
});

test('due text counts whole days', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  assert.equal(dueText('2026-11-08T09:00:00Z', now), 'Overdue 3 days');
  assert.equal(dueText('2026-11-10T09:00:00Z', now), 'Overdue 1 day');
  assert.equal(dueText('2026-11-11T09:00:00Z', now), 'Due today');
  assert.equal(dueText('2026-11-13T12:00:00Z', now), 'Due in 2 days');
  assert.equal(dueText(null, now), null);
});

test('a threshold change reads as what moves from the values in force', () => {
  const inForce = { green_threshold: 1, amber_threshold: 3, threshold_direction: 'lower_is_better' };
  assert.deepEqual(thresholdChangeLines(inForce, { changes: { green_threshold: 2, amber_threshold: 5 } }),
    ['Green threshold: 1 → 2', 'Amber threshold: 3 → 5']);
  assert.deepEqual(thresholdChangeLines(inForce, { changes: { threshold_direction: 'higher_is_better' } }),
    ['Direction: lower is better → higher is better']);
  assert.deepEqual(thresholdChangeLines({ green_threshold: null }, { changes: { green_threshold: 0 } }),
    ['Green threshold: — → 0'], 'a 0 threshold is a threshold');
});
