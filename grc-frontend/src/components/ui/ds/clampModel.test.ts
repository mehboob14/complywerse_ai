// node --test "src/components/ui/ds/clampModel.test.ts"
// The rules of a clamped text apart from React: how many lines, the class that cuts there, when a text really is cut, and when the toggle shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CLAMP_CLASS, DEFAULT_LINES, clampLines, isCut, showsToggle, toggleWords } from './clampModel.ts';

test('a clamp is a whole number of lines from 1 to 6; anything else is three', () => {
  assert.equal(DEFAULT_LINES, 3);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(clampLines), [1, 2, 3, 4, 5, 6]);
  assert.equal(clampLines(2.9), 2);
  assert.equal(clampLines(9), 6);
  for (const odd of [undefined, null, 0, -1, NaN, Infinity, 0.5, '3' as unknown as number]) assert.equal(clampLines(odd as number), 3, String(odd));
});

test('every line count has its own class written out whole', () => {
  assert.deepEqual(Object.values(CLAMP_CLASS), ['line-clamp-1', 'line-clamp-2', 'line-clamp-3', 'line-clamp-4', 'line-clamp-5', 'line-clamp-6']);
  assert.equal(CLAMP_CLASS[clampLines(4)], 'line-clamp-4');
});

test('a text is cut when its content is taller than its box; a pixel of rounding is not a cut', () => {
  assert.equal(isCut({ scrollHeight: 60, clientHeight: 60 }), false);
  assert.equal(isCut({ scrollHeight: 61, clientHeight: 60 }), false);
  assert.equal(isCut({ scrollHeight: 62, clientHeight: 60 }), true);
  assert.equal(isCut({ scrollHeight: 0, clientHeight: 0 }), false);                  // not laid out yet
});

test('the toggle says what a press does, and shows while open even if all of it now fits', () => {
  assert.equal(toggleWords(false), 'Show more');
  assert.equal(toggleWords(true), 'Show less');
  assert.equal(showsToggle({ cut: true, open: false }), true);
  assert.equal(showsToggle({ cut: false, open: false }), false);
  assert.equal(showsToggle({ cut: false, open: true }), true);                        // it can always be shut again
  assert.equal(showsToggle({ cut: true, open: true }), true);
});
