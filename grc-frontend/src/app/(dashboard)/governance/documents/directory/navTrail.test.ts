// node --test "src/app/(dashboard)/governance/documents/directory/navTrail.test.ts"
// Back and Forward in the Directory: the page's mirror of the browser's history of folders. The first Back from the first folder visited has nowhere to go (its button is off, so the
// Directory is not left silently); going somewhere new drops what was ahead; an address that changed by itself is placed as a Back, a Forward or a new place.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TRAIL_MAX, back, canBack, canForward, follow, forward, hereOf, replaceHere, startTrail, visit, type Folder, type Trail } from './navTrail.ts';

const stackOf = (t: Trail): Folder[] => [...t.stack];
const walk = (...folders: Folder[]): Trail => folders.slice(1).reduce((t, f) => visit(t, f), startTrail(folders[0]));

test('a new trail is one folder with nowhere to go: Back and Forward are off', () => {
  const t = startTrail(4);
  assert.deepEqual([hereOf(t), canBack(t), canForward(t)], [4, false, false]);
  assert.equal(back(t), t, 'Back from the first folder visited does nothing');
  assert.equal(forward(t), t);
  assert.deepEqual([hereOf(startTrail(null)), canBack(startTrail(null))], [null, false], 'the Organisation is a folder too');
});

test('visiting pushes; visiting where you already are changes nothing', () => {
  const t = walk(null, 4, 5);
  assert.deepEqual([stackOf(t), t.at], [[null, 4, 5], 2]);
  assert.equal(visit(t, 5), t);
  assert.deepEqual([canBack(t), canForward(t)], [true, false]);
});

test('Back and Forward move along it and stop at its ends', () => {
  let t = walk(null, 4, 5);
  t = back(t); assert.equal(hereOf(t), 4);
  t = back(t); assert.equal(hereOf(t), null);
  assert.equal(canBack(t), false);
  assert.equal(back(t), t);
  t = forward(t); t = forward(t);
  assert.equal(hereOf(t), 5);
  assert.equal(canForward(t), false);
  assert.equal(forward(t), t);
});

test('going somewhere new from the middle drops what was ahead, as a browser does', () => {
  let t = walk(null, 4, 5);
  t = back(t);                                         // at 4, 5 ahead
  t = visit(t, 1);
  assert.deepEqual([stackOf(t), t.at, canForward(t)], [[null, 4, 1], 2, false]);
});

test('Up is a visit to the folder above: it is a step Back undoes', () => {
  let t = walk(5);
  t = visit(t, 4);
  assert.deepEqual([stackOf(t), hereOf(back(t))], [[5, 4], 5]);
});

test('replacing changes this step and keeps the rest (a key moved the selection in the tree)', () => {
  let t = walk(null, 4);
  t = replaceHere(t, 1);
  assert.deepEqual([stackOf(t), t.at], [[null, 1], 1]);
  assert.equal(replaceHere(t, 1), t);
  t = back(t);
  assert.equal(hereOf(t), null);
});

test('an address that changed by itself: the neighbour behind is a Back, the one ahead a Forward, anything else a new place', () => {
  const t = back(back(walk(null, 4, 5, 6)));          // at 4: [null, 4, 5, 6]
  assert.deepEqual([hereOf(follow(t, 4)), follow(t, 4) === t], [4, true], 'the same folder: nothing');
  assert.equal(hereOf(follow(t, null)), null);
  assert.equal(follow(t, null).at, 0, 'the one behind: Back');
  assert.equal(follow(t, 5).at, 2, 'the one ahead: Forward');
  const fresh = follow(t, 9);
  assert.deepEqual([stackOf(fresh), fresh.at], [[null, 4, 9], 2], 'a place the trail has not seen is a push, and drops what was ahead');
});

test('the direction the page asked for settles it when both neighbours name the folder; without one, Back wins', () => {
  const t = back(walk(1, 2, 1));                       // [1, 2, 1], at 2: both neighbours are 1
  assert.equal(follow(t, 1, 'forward').at, 2);
  assert.equal(follow(t, 1, 'back').at, 0);
  assert.equal(follow(t, 1).at, 0, 'no hint: Back (what the browser\'s own button is)');
  assert.equal(follow(t, 1, 'forward').stack.length, 3);
});

test('a hint that does not match is ignored (the address went somewhere else)', () => {
  const t = walk(1, 2, 3);                             // at 3
  assert.equal(follow(t, 2, 'forward').at, 1, 'asked Forward, got the folder behind: it is Back');
  assert.equal(follow(t, 7, 'back').at, 3, 'asked Back, got a new folder: a push');
});

test('the trail keeps at most TRAIL_MAX folders, dropping the oldest, and the pointer stays on the folder you are in', () => {
  let t = startTrail(0);
  for (let i = 1; i <= TRAIL_MAX + 20; i++) t = visit(t, i);
  assert.equal(t.stack.length, TRAIL_MAX);
  assert.equal(hereOf(t), TRAIL_MAX + 20);
  assert.equal(t.at, TRAIL_MAX - 1);
  assert.equal(t.stack[0], 21, 'the oldest 21 are gone');
  assert.equal(hereOf(back(t)), TRAIL_MAX + 19);
});
