// node --test "src/app/(dashboard)/vendor-risk/_ui/*.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_THRESHOLDS, clampPercent, donutArcs, gaugePoint, gaugeSegments, gaugeTone, markerPercent, pointsToNext, rulerBands, tierForScore,
} from './chartMath.ts';

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} vs ${b}`);

test('the ruler: four bands as wide as their ranges, Low to Critical', () => {
  assert.deepEqual(rulerBands(DEFAULT_THRESHOLDS).map((b) => [b.tier, b.from, b.to, b.width]), [
    ['low', 0, 25, 25], ['medium', 25, 50, 25], ['high', 50, 75, 25], ['critical', 75, 100, 25],
  ]);
  assert.deepEqual(rulerBands({ medium: 20, high: 45, critical: 80 }).map((b) => b.width), [20, 25, 35, 20]);
});

test('the ruler still draws a policy saved out of order, out of range or half empty', () => {
  const widths = (t: { medium: number; high: number; critical: number }) => rulerBands(t).map((b) => b.width);
  assert.deepEqual(widths({ medium: 60, high: 40, critical: 10 }), [60, 0, 0, 40]);          // never goes backwards
  assert.deepEqual(widths({ medium: -5, high: 50, critical: 140 }), [0, 50, 50, 0]);          // kept inside 0..100
  assert.deepEqual(widths({ medium: Number.NaN, high: Number.NaN, critical: Number.NaN }), [25, 25, 25, 25]);   // Verity's shipped policy
  for (const t of [DEFAULT_THRESHOLDS, { medium: 60, high: 40, critical: 10 }]) near(rulerBands(t).reduce((n, b) => n + b.width, 0), 100, 'the bands fill the axis');
});

test('a score on a line belongs to the higher tier', () => {
  const t = DEFAULT_THRESHOLDS;
  const at = (s: number) => tierForScore(s, t);
  assert.deepEqual([0, 24.9, 25, 49.9, 50, 74.9, 75, 92.5, 100].map(at), ['low', 'low', 'medium', 'medium', 'high', 'high', 'critical', 'critical', 'critical']);
});

test('"N points below the next tier"', () => {
  const t = DEFAULT_THRESHOLDS;
  assert.deepEqual(pointsToNext(40, t), { tier: 'high', points: 10 });
  assert.deepEqual(pointsToNext(10, t), { tier: 'medium', points: 15 });
  assert.deepEqual(pointsToNext(49.5, t), { tier: 'high', points: 0.5 });
  assert.deepEqual(pointsToNext(25, t), { tier: 'high', points: 25 });                       // on the Medium line: Medium, and High is 25 away
  assert.deepEqual(pointsToNext(60, { medium: 20, high: 45, critical: 80 }), { tier: 'critical', points: 20 });
  assert.equal(pointsToNext(92.5, t), null);                                                 // already Critical
  assert.equal(pointsToNext(75, t), null);
  assert.equal(pointsToNext(null, t), null);
  assert.equal(pointsToNext(Number.NaN, t), null);
  assert.equal(pointsToNext(undefined, t), null);
});

test('the marker sits on the axis, and is absent without a score', () => {
  assert.equal(markerPercent(92.5), 92.5);
  assert.equal(markerPercent(-5), 0);
  assert.equal(markerPercent(130), 100);
  for (const none of [null, undefined, Number.NaN]) assert.equal(markerPercent(none), null);
});

test('the donut: one dash per slice, a gap between neighbours', () => {
  assert.deepEqual(donutArcs([1, 1], 100, 2), [{ index: 0, length: 48, offset: 0 }, { index: 1, length: 48, offset: 50 }]);
  assert.deepEqual(donutArcs([5, 0, 0], 100, 2), [{ index: 0, length: 100, offset: 0 }]);      // a lone slice is the whole ring, no gap
  assert.deepEqual(donutArcs([3, 0, 1], 100, 2).map((a) => [a.index, a.length, a.offset]), [[0, 73, 0], [2, 23, 75]]);   // a zero is not drawn
  assert.deepEqual(donutArcs([2, -4, Number.NaN, 2], 100, 0).map((a) => [a.index, a.length, a.offset]), [[0, 50, 0], [3, 50, 50]]);   // nor is a nonsense value
  for (const none of [[], [0, 0], [-1], [Number.NaN]]) assert.deepEqual(donutArcs(none, 100), []);
  const arcs = donutArcs([7, 3, 5, 1], 400, 2);                                                 // the dashes and the gaps add up to the ring
  near(arcs.reduce((n, a) => n + a.length + 2, 0), 400);
});

test('the gauge: red below 60, amber below 85, green from there', () => {
  assert.deepEqual([0, 59.9, 60, 84.9, 85, 100].map(gaugeTone), ['danger', 'danger', 'warning', 'warning', 'success', 'success']);
  assert.equal(gaugeTone(250), 'success');
  assert.equal(gaugeTone(Number.NaN), 'danger');
  assert.deepEqual([-3, 0, 42, 100, 140, Number.NaN, null, undefined].map(clampPercent), [0, 0, 42, 100, 100, 0, 0, 0]);
});

test('the gauge zones are three dashes along a path of 100, in order, with the gaps between', () => {
  const [red, amber, green] = gaugeSegments(1.5);
  assert.deepEqual([red.tone, amber.tone, green.tone], ['danger', 'warning', 'success']);
  near(red.from, 0);
  near(red.length, 59.25);
  near(amber.from, 60.75);
  near(amber.length, 23.5);
  near(green.from, 85.75);
  near(green.length, 14.25);
  near(green.from + green.length, 100);
  near(red.length + amber.length + green.length, 100 - 3);
});

test('the needle: left end at 0%, straight up at 50%, right end at 100%', () => {
  const at = (p: number) => gaugePoint(p, 80, 80, 60);
  near(at(0).x, 20); near(at(0).y, 80);
  near(at(50).x, 80); near(at(50).y, 20);
  near(at(100).x, 140); near(at(100).y, 80);
  near(at(250).x, 140);                                                                        // kept on the arc
});
