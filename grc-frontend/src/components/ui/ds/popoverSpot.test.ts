// node --test "src/components/ui/ds/popoverSpot.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { popoverSpot } from './popoverSpot.ts';

const VIEW = { width: 1000, height: 700 };
const box = (left: number, top: number, w = 24, h = 24) => ({ left, top, right: left + w, bottom: top + h });

test('under the anchor, lined up with its left edge', () => {
  assert.deepEqual(popoverSpot(box(100, 100), VIEW), { left: 100, width: 256, top: 130, maxHeight: 700 - 124 - 6 - 8 });
});

test('kept on screen: not past the right edge, not past the left', () => {
  assert.equal(popoverSpot(box(950, 100), VIEW).left, 1000 - 256 - 8);
  assert.equal(popoverSpot(box(2, 100), VIEW).left, 8);
});

test('a narrow window narrows the note', () => {
  const spot = popoverSpot(box(20, 100), { width: 260, height: 600 });
  assert.equal(spot.width, 244);                                               // the window less a margin on each side
  assert.equal(spot.left, 8);                                                  // 20 would push the right edge past the window
});

test('above the anchor when the list needs more room than there is below, and there is more above', () => {
  const spot = popoverSpot(box(100, 600), VIEW, { need: 200 });             // 700 - 624 - 14 = 62 below; 600 - 14 = 586 above
  assert.equal(spot.top, undefined);
  assert.equal(spot.bottom, 700 - 600 + 6);
  assert.equal(spot.maxHeight, 586);
});

test('below even when tight, if there is less room above', () => {
  const spot = popoverSpot(box(100, 20), { width: 1000, height: 120 }, { need: 200 });
  assert.equal(spot.top, 50);
  assert.equal(spot.bottom, undefined);
});

test('a list that fits below stays below, whatever is above', () => {
  const spot = popoverSpot(box(100, 500), VIEW, { need: 100 });             // 700 - 524 - 14 = 162 below
  assert.equal(spot.top, 530);
});

test('no room at all never gives a negative height', () => {
  assert.equal(popoverSpot(box(0, 0), { width: 100, height: 10 }).maxHeight >= 0, true);
});
