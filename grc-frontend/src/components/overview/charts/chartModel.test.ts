// node --test "src/components/overview/charts/chartModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Slice } from './chartModel.ts';
import { changeOf, deltaOf, foldTail, heatStep, positive, ringDash, shareText, shares, sliceData, sparkGeometry, sum, trendText, withColors } from './chartModel.ts';
import { OTHER, SERIES, seriesColor } from './palette.ts';

const s = (key: string, value: number, extra: Partial<Slice> = {}): Slice => ({ key, label: key.toUpperCase(), value, ...extra });

test('foldTail keeps the largest slices and folds the rest into one Other that holds their sum', () => {
  const out = foldTail([s('a', 5), s('b', 9), s('c', 1), s('d', 2), s('e', 3)], 2);
  assert.deepEqual(out.map((x) => x.key), ['b', 'a', '__other']);
  assert.equal(out[2].value, 6);
  assert.equal(out[2].label, 'Other');
  assert.equal(out[2].color, OTHER);
  assert.equal(sum(out.map((x) => x.value)), 20, 'nothing is dropped');
});

test('foldTail does not turn one slice into an Other, and drops zero and negative slices', () => {
  assert.deepEqual(foldTail([s('a', 5), s('b', 9), s('c', 1)], 2).map((x) => x.key), ['b', 'a', 'c']);
  assert.deepEqual(foldTail([s('a', 0), s('b', -2), s('c', 4)], 5).map((x) => x.key), ['c']);
  assert.deepEqual(foldTail([], 3), []);
});

test('shares add up to 100 and never read 0 for a slice that has something', () => {
  assert.deepEqual(shares([1, 1, 1]), [34, 33, 33]);
  assert.equal(sum(shares([7, 2, 1, 1, 1])), 100);
  assert.deepEqual(shares([0, 0]), [0, 0]);
  assert.deepEqual(shares([10, 0, 90]), [10, 0, 90]);
  assert.equal(shareText(0, 1), '<1%');
  assert.equal(shareText(0, 0), '0%');
  assert.equal(shareText(42, 5), '42%');
});

test('withColors follows the position, never cycles, and a slice that has a colour does not use up a hue', () => {
  const out = withColors([s('a', 1), s('b', 2, { color: '#123456' }), s('c', 3)]);
  assert.equal(out[0].color, SERIES[0]);
  assert.equal(out[1].color, '#123456');
  assert.equal(out[2].color, SERIES[1]);
  assert.equal(seriesColor(8), OTHER);
  assert.equal(seriesColor(-1), OTHER);
  const nine = withColors(Array.from({ length: 10 }, (_, i) => s(`k${i}`, 1)));
  assert.equal(nine[7].color, SERIES[7]);
  assert.equal(nine[8].color, OTHER);
});

test('changeOf reads the last two recorded points and skips a missing one (never a 0)', () => {
  assert.equal(changeOf([4]), null);
  assert.equal(changeOf([null, undefined]), null);
  assert.deepEqual(changeOf([1, 4, null, 7]), { latest: 7, previous: 4, change: 3, direction: 'up' });
  assert.equal(changeOf([5, 5])?.direction, 'flat');
  assert.equal(changeOf([9, 2])?.direction, 'down');
});

test('deltaOf says which way is good for THIS figure, and says it in words as well as a tone', () => {
  const up = changeOf([10, 14]);
  assert.deepEqual(deltaOf(up, 'up'), { text: 'Up 4', direction: 'up', tone: 'good' });
  assert.deepEqual(deltaOf(up, 'down'), { text: 'Up 4', direction: 'up', tone: 'bad' });
  assert.equal(deltaOf(up)?.tone, 'neutral');
  assert.equal(deltaOf(changeOf([3, 3]), 'down')?.text, 'No change');
  assert.equal(deltaOf(changeOf([3, 3]), 'down')?.tone, 'neutral');
  assert.equal(deltaOf(null, 'up'), null);
  assert.equal(deltaOf(changeOf([80, 83]), 'up', ' pts')?.text, 'Up 3 pts');
  assert.equal(deltaOf(changeOf([67, 67.1]), 'up')?.text, 'Up 0.1', 'a small change is not rounded to nothing');
  assert.equal(deltaOf(changeOf([67.4, 63]), 'up')?.text, 'Down 4.4');
  assert.equal(deltaOf(changeOf([1000, 2500]), 'up')?.text, 'Up 1,500');
  assert.equal(deltaOf(changeOf([80, 81]), 'up', [' point', ' points'])?.text, 'Up 1 point');
  assert.equal(deltaOf(changeOf([80, 83]), 'up', [' point', ' points'])?.text, 'Up 3 points');
});

test('trendText names the first and the last recorded point and the way it went', () => {
  const pts = [{ label: 'Jun', value: 3 }, { label: 'Jul', value: null }, { label: 'Oct', value: 7 }];
  assert.equal(trendText('Created', pts), 'Created: from 3 in Jun to 7 in Oct, up 4.');
  assert.equal(trendText('Created', [{ label: 'Jun', value: 3 }, { label: 'Jul', value: 3 }]), 'Created: from 3 in Jun to 3 in Jul, no change.');
  assert.equal(trendText('Created', [{ label: 'Jun', value: 3 }]), 'Created: 3 in Jun.');
  assert.equal(trendText('Created', [{ label: 'Jun', value: null }]), 'Created: no data.');
});

test('sparkGeometry draws recorded points only: a gap breaks the line, fewer than two points draw none', () => {
  assert.deepEqual(sparkGeometry([], 80, 24).lines, []);
  assert.equal(sparkGeometry([5], 80, 24).last !== null, true);
  const flat = sparkGeometry([4, 4, 4], 80, 24);
  assert.equal(flat.lines.length, 1);
  assert.match(flat.lines[0], /^M3,12 L40,12 L77,12$/, 'a flat series is a line in the middle');
  const gap = sparkGeometry([1, 2, null, 4, 5], 80, 24);
  assert.equal(gap.lines.length, 2);
  const up = sparkGeometry([0, 10], 80, 24);
  assert.match(up.lines[0], /^M3,21 L77,3$/, 'higher is higher on the page');
  assert.ok(up.area.startsWith('M3,21') && up.area.endsWith('Z'));
  assert.equal(sparkGeometry([80, 90], 80, 24, 3, 0).lines[0].startsWith('M3,'), true);
});

test('ringDash is clamped to 0-100 and a missing value is an empty ring', () => {
  const full = ringDash(100, 40);
  assert.equal(full.dash, full.circumference);
  assert.equal(ringDash(0, 40).dash, 0);
  assert.equal(ringDash(250, 40).dash, full.circumference);
  assert.equal(ringDash(Number.NaN, 40).dash, 0);
  assert.equal(ringDash(50, 40).dash, Math.round(full.circumference * 50) / 100);
});

test('heatStep: 0 only for nothing, the darkest step for the largest, and a small value is never read as empty', () => {
  assert.equal(heatStep(0, 10), 0);
  assert.equal(heatStep(null, 10), 0);
  assert.equal(heatStep(10, 10), 4);
  assert.equal(heatStep(1, 100), 1);
  assert.equal(heatStep(5, 10), 2);
  assert.equal(heatStep(3, 0), 0);
});

test('sliceData is the table of a donut: name, count and share, with the shares adding up', () => {
  const data = sliceData([s('a', 3), s('b', 1)], 'Status', 'Documents');
  assert.deepEqual(data.columns, ['Status', 'Documents', 'Share']);
  assert.deepEqual(data.rows, [['A', 3, '75%'], ['B', 1, '25%']]);
  assert.deepEqual(sliceData([], 'Status').rows, []);
  assert.equal(positive([s('a', 0), s('b', 2)]).length, 1);
});
