// node --test "src/components/overview/cockpitModel.test.ts"
// The cockpit frame's rules: which layout the page takes (a short strip when the person has little to do, only their own work when the programme's
// scores are refused), how the counters are ordered and folded on a phone, and how long the worklist is.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PHONE_COUNTERS, SOLO_AT, WORK_ROWS, foldCounters, foldLabel, layoutOf, orderCounters, workRowLimit, type Countable } from './cockpitModel.ts';

test('a worklist of three items or fewer is a short strip, a longer one (or one not yet known) is the full layout', () => {
  assert.equal(SOLO_AT, 3);
  assert.equal(layoutOf({ refused: false, workCount: 0 }), 'solo');
  assert.equal(layoutOf({ refused: false, workCount: 3 }), 'solo');
  assert.equal(layoutOf({ refused: false, workCount: 4 }), 'full');
  assert.equal(layoutOf({ refused: false, workCount: 150 }), 'full');
  assert.equal(layoutOf({ refused: false, workCount: null }), 'full', 'while the list loads or failed, the page keeps the room the list would need');
});

test('a refusal wins over everything: the person\'s own work takes the page', () => {
  assert.equal(layoutOf({ refused: true, workCount: 0 }), 'work-only');
  assert.equal(layoutOf({ refused: true, workCount: 40 }), 'work-only');
  assert.equal(layoutOf({ refused: true, workCount: null }), 'work-only');
});

test('the worklist shows ten rows, five on a phone, and three as a strip (a strip is a strip on a phone too)', () => {
  assert.deepEqual(WORK_ROWS, { full: 10, narrow: 5, solo: 3 });
  assert.equal(workRowLimit('full', false), 10);
  assert.equal(workRowLimit('full', true), 5);
  assert.equal(workRowLimit('work-only', false), 10);
  assert.equal(workRowLimit('work-only', true), 5);
  assert.equal(workRowLimit('solo', false), 3);
  assert.equal(workRowLimit('solo', true), 3);
});

const c = (key: string, state: Countable['state'], value?: number) => ({ key, state, value });

test('counters with something to look at come first; zeros, loading and failed counters after them, each group in its own order', () => {
  const list = [c('a', 'ready', 0), c('b', 'ready', 6), c('c', 'error'), c('d', 'ready', 2), c('e', 'loading'), c('f', 'none'), c('g', 'ready', 0)];
  assert.deepEqual(orderCounters(list).map((x) => x.key), ['b', 'd', 'a', 'c', 'e', 'f', 'g']);
  assert.deepEqual(orderCounters([]), []);
  const same = [c('x', 'ready', 1), c('y', 'ready', 1)];
  assert.deepEqual(orderCounters(same).map((x) => x.key), ['x', 'y'], 'equal counters are never shuffled');
});

test('ordering does not change the input and keeps every counter', () => {
  const list = [c('a', 'ready', 0), c('b', 'ready', 6)];
  const copy = list.slice();
  const ordered = orderCounters(list);
  assert.deepEqual(list, copy);
  assert.equal(ordered.length, list.length);
});

test('a phone shows the first three counters and a button for the rest; a wide screen shows all', () => {
  const eight = Array.from({ length: 8 }, (_, i) => i);
  assert.equal(PHONE_COUNTERS, 3);
  assert.deepEqual(foldCounters(eight, { narrow: true, all: false }), { shown: [0, 1, 2], foldable: true, folded: true });
  assert.deepEqual(foldCounters(eight, { narrow: true, all: true }), { shown: eight, foldable: true, folded: false });
  assert.deepEqual(foldCounters(eight, { narrow: false, all: false }), { shown: eight, foldable: false, folded: false });
  assert.deepEqual(foldCounters([1, 2, 3], { narrow: true, all: false }), { shown: [1, 2, 3], foldable: false, folded: false }, 'three or fewer need no button');
});

test('the fold button says how many there are, or offers fewer', () => {
  assert.equal(foldLabel(8, true), 'Show all 8');
  assert.equal(foldLabel(8, false), 'Show fewer');
});
