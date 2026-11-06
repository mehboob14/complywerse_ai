// node --test "src/lib/menuModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { indexForKey, nextIndex, placeMenu } from './menuModel.ts';

const on = { disabled: false };
const off = { disabled: true };
const items = (...flags: boolean[]) => flags.map((d) => (d ? off : on));      // true = disabled

// ── nextIndex / indexForKey ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('down and up step to the neighbour and wrap round the ends', () => {
  const all = items(false, false, false);
  assert.equal(nextIndex(all, 0, 1), 1);
  assert.equal(nextIndex(all, 2, 1), 0);
  assert.equal(nextIndex(all, 1, -1), 0);
  assert.equal(nextIndex(all, 0, -1), 2);
});

test('disabled items are skipped, also across the wrap', () => {
  const some = items(false, true, true, false, true);                           // enabled: 0 and 3
  assert.equal(nextIndex(some, 0, 1), 3);
  assert.equal(nextIndex(some, 3, 1), 0);                                       // 4 is disabled, wrap to 0
  assert.equal(nextIndex(some, 3, -1), 0);
  assert.equal(nextIndex(some, 0, -1), 3);                                      // wrap, 4 is disabled
});

test('from before the first or after the last starts at an end', () => {
  const some = items(true, false, false, true);
  assert.equal(nextIndex(some, -1, 1), 1);
  assert.equal(nextIndex(some, some.length, -1), 2);
});

test('with one enabled item every move lands on it; with none there is nowhere to go', () => {
  const one = items(true, false, true);
  for (const step of [1, -1] as const) for (const from of [-1, 0, 1, 2, 3]) assert.equal(nextIndex(one, from, step), 1, `${from} ${step}`);
  assert.equal(nextIndex(items(true, true), 0, 1), -1);
  assert.equal(nextIndex([], -1, 1), -1);
  assert.equal(nextIndex([], 0, -1), -1);
});

test('keys: ArrowDown, ArrowUp, Home and End; anything else is not a menu key', () => {
  const some = items(true, false, false, true, false, true);                    // enabled: 1, 2, 4
  assert.equal(indexForKey(some, 1, 'ArrowDown'), 2);
  assert.equal(indexForKey(some, 2, 'ArrowDown'), 4);
  assert.equal(indexForKey(some, 4, 'ArrowDown'), 1);
  assert.equal(indexForKey(some, 1, 'ArrowUp'), 4);
  assert.equal(indexForKey(some, 4, 'ArrowUp'), 2);
  assert.equal(indexForKey(some, 2, 'Home'), 1);                                // not item 0: it is disabled
  assert.equal(indexForKey(some, 1, 'End'), 4);                                 // not item 5: it is disabled
  for (const key of ['Enter', ' ', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'a', 'PageDown']) assert.equal(indexForKey(some, 1, key), null, key);
});

test('with focus on no item, ArrowDown goes to the first enabled one and ArrowUp to the last', () => {
  const some = items(true, false, false, true);
  assert.equal(indexForKey(some, -1, 'ArrowDown'), 1);
  assert.equal(indexForKey(some, -1, 'ArrowUp'), 2);
});

test('with nothing enabled the keys find nothing (-1), but they are still menu keys', () => {
  const none = items(true, true);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.equal(indexForKey(none, -1, key), -1, key);
});

// ── placeMenu ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const VIEW = { width: 1000, height: 700 };
const MENU = { width: 200, height: 160 };
const anchor = (left: number, top: number, w = 32, h = 32) => ({ left, top, right: left + w, bottom: top + h });

test('under the trigger, lined up with its right edge', () => {
  assert.deepEqual(placeMenu(anchor(500, 100), MENU, VIEW), { left: 332, top: 136, maxHeight: 700 - 132 - 4 - 8 });
});

test('start alignment lines up with the left edge', () => {
  assert.equal(placeMenu(anchor(500, 100), MENU, VIEW, 'start').left, 500);
});

test('it never leaves the window sideways: kept 8px from either edge', () => {
  assert.equal(placeMenu(anchor(10, 100), MENU, VIEW).left, 8);                 // end-aligned would start at -158
  assert.equal(placeMenu(anchor(960, 100), MENU, VIEW, 'start').left, 1000 - 200 - 8);
  assert.equal(placeMenu(anchor(960, 100), MENU, VIEW).left, 792);              // 992 - 200: right edge of the trigger is 992
  assert.equal(placeMenu(anchor(0, 100), { width: 2000, height: 50 }, VIEW).left, 8);   // wider than the window: starts at the margin
});

test('near the bottom it opens upwards, above the trigger', () => {
  const p = placeMenu(anchor(500, 640), MENU, VIEW);                            // 28px below the trigger, 160 needed; 628 above
  assert.equal(p.top, 640 - 4 - 160);
  assert.equal(p.maxHeight, 640 - 4 - 8);
});

test('when it fits on neither side it takes the larger side and scrolls inside it', () => {
  const tall = { width: 200, height: 900 };
  const low = placeMenu(anchor(500, 500), tall, VIEW);                          // below 700-532-12 = 156, above 500-12 = 488
  assert.equal(low.maxHeight, 488);
  assert.equal(low.top, 500 - 4 - 488);
  const high = placeMenu(anchor(500, 50), tall, VIEW);                          // below 700-82-12 = 606, above 38
  assert.equal(high.maxHeight, 606);
  assert.equal(high.top, 82 + 4);
});

test('it prefers below when it fits there, even if there is more room above', () => {
  const p = placeMenu(anchor(500, 400), MENU, VIEW);                            // below 700-432-12 = 256 >= 160
  assert.equal(p.top, 436);
});

test('a trigger scrolled off the window gives no negative room', () => {
  const p = placeMenu(anchor(500, -300), MENU, VIEW);
  assert.ok(p.maxHeight >= 0);
});
