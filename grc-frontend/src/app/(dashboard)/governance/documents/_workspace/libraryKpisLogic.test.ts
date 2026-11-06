import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HEALTH_COLOUR, HEALTH_ORDER, donutArcs, healthCount, percent } from './libraryKpisLogic.ts';
import { REVIEW_BUCKETS, type Health } from './libraryModel.ts';

const health = (over: Partial<Omit<Health, 'reviewable'>> = {}): Health => {
  const h = { upToDate: 0, dueSoon: 0, overdue: 0, unscheduled: 0, ...over };
  return { ...h, reviewable: h.upToDate + h.dueSoon + h.overdue + h.unscheduled };
};
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const RADIUS = 39;
const CIRCLE = 2 * Math.PI * RADIUS;
const GAP_DEGREES = 2;
const GAP = (CIRCLE * GAP_DEGREES) / 360;

test('the donut and the legend cover every review bucket once, each with its own colour', () => {
  assert.deepEqual([...HEALTH_ORDER].sort(), [...REVIEW_BUCKETS].sort());
  assert.equal(new Set(HEALTH_ORDER.map((b) => HEALTH_COLOUR[b])).size, 4);
  assert.deepEqual(HEALTH_ORDER.map((b) => healthCount(health({ upToDate: 1, dueSoon: 2, overdue: 3, unscheduled: 4 }), b)), [1, 2, 3, 4]);
});

test('percentages are rounded, and never rounded to an extreme that is not true', () => {
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(2, 3), 67);
  assert.equal(percent(1, 2), 50);
  assert.equal(percent(3, 3), 100);
  assert.equal(percent(0, 7), 0);
  assert.equal(percent(1, 300), 1);          // one document is not "0%"
  assert.equal(percent(299, 300), 99);       // and 299 of 300 is not "100% up to date"
  assert.equal(percent(5, 0), 0);            // nothing to share out
  assert.equal(percent(-1, 10), 0);
  assert.equal(percent(Number.NaN, 10), 0);
});

test('no documents in force: no arcs (the card draws a grey ring)', () => {
  assert.deepEqual(donutArcs(health(), { radius: RADIUS, gapDegrees: GAP_DEGREES }), []);
});

test('one bucket is a whole ring with no gap', () => {
  const arcs = donutArcs(health({ overdue: 4 }), { radius: RADIUS, gapDegrees: GAP_DEGREES });
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0].bucket, 'overdue');
  assert.equal(arcs[0].colour, HEALTH_COLOUR.overdue);
  near(arcs[0].dash, CIRCLE);
  near(arcs[0].gap, 0);
  near(arcs[0].offset, 0);
});

test('all four buckets: in order, the arcs add up to the ring minus the gaps, and each starts where the last ended plus a gap', () => {
  const h = health({ upToDate: 6, dueSoon: 2, overdue: 1, unscheduled: 1 });
  const arcs = donutArcs(h, { radius: RADIUS, gapDegrees: GAP_DEGREES });
  assert.deepEqual(arcs.map((a) => a.bucket), ['ok', 'due_soon', 'overdue', 'unscheduled']);
  assert.deepEqual(arcs.map((a) => a.colour), ['#10b981', '#f59e0b', '#f43f5e', '#cbd5e1']);
  near(arcs.reduce((n, a) => n + a.dash, 0), CIRCLE - 4 * GAP);
  arcs.forEach((a) => near(a.dash + a.gap, CIRCLE));
  near(arcs[0].dash + GAP, (CIRCLE * 6) / 10);                         // 6 of 10 documents, plus its gap
  arcs.slice(1).forEach((a, i) => near(-a.offset - (-arcs[i].offset + arcs[i].dash), GAP));
  near(-arcs[0].offset, GAP / 2);                                      // the gap between the last and the first is centred on 12 o'clock
  near(-arcs[3].offset + arcs[3].dash + GAP / 2, CIRCLE);
});

test('empty buckets are skipped and the rest share the whole ring', () => {
  const arcs = donutArcs(health({ upToDate: 3, unscheduled: 1 }), { radius: RADIUS, gapDegrees: GAP_DEGREES });
  assert.deepEqual(arcs.map((a) => a.bucket), ['ok', 'unscheduled']);
  near(arcs[0].dash + GAP, CIRCLE * 0.75);
  near(arcs[1].dash + GAP, CIRCLE * 0.25);
});

test('without a gap the arcs touch and add up to the ring', () => {
  const arcs = donutArcs(health({ upToDate: 1, dueSoon: 1 }), { radius: RADIUS });
  near(arcs.reduce((n, a) => n + a.dash, 0), CIRCLE);
  near(-arcs[1].offset, -arcs[0].offset + arcs[0].dash);
});

test('a bucket too small to show next to its gap keeps a visible sliver', () => {
  const arcs = donutArcs(health({ upToDate: 999, overdue: 1 }), { radius: RADIUS, gapDegrees: GAP_DEGREES });
  const overdue = arcs.find((a) => a.bucket === 'overdue');
  assert.ok(overdue && overdue.dash >= 1.5);
  assert.ok(arcs.every((a) => a.dash <= CIRCLE && a.gap >= 0));
});
