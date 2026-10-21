// node --test src/lib/useAutoGrow.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { growHeight } from './useAutoGrow.ts';

// the AI Studio's box: 20px lines, 8px padding top and bottom, 1px borders, two rows, min-h 44px, in a 900px window
const studio = { line: 20, padding: 16, border: 2, rows: 2, minHeight: 44, room: 900 };
const text = (lines: number, line = 20, padding = 16) => lines * line + padding;   // the copy's scrollHeight

test('an empty or short message keeps the box at its own height', () => {
  assert.deepEqual(growHeight({ ...studio, content: text(1) }), { height: 58, scrolls: false });
  assert.deepEqual(growHeight({ ...studio, content: text(2) }), { height: 58, scrolls: false });
});

test('the box grows a line at a time with its text, up to ten lines', () => {
  assert.deepEqual(growHeight({ ...studio, content: text(3) }), { height: 78, scrolls: false });
  assert.deepEqual(growHeight({ ...studio, content: text(10) }), { height: 218, scrolls: false });
});

test('past ten lines (a long paste) it stops growing and scrolls inside', () => {
  assert.deepEqual(growHeight({ ...studio, content: text(11) }), { height: 218, scrolls: true });
  assert.deepEqual(growHeight({ ...studio, content: text(400) }), { height: 218, scrolls: true });
});

test('in a short window it stops at 40% of the window, never below its own height', () => {
  assert.deepEqual(growHeight({ ...studio, room: 400, content: text(10) }), { height: 160, scrolls: true });
  assert.deepEqual(growHeight({ ...studio, room: 100, content: text(10) }), { height: 58, scrolls: true });
});

test('a CSS min-height above its rows is where it starts (the workflow AI prompt, 16px lines, min-h-28)', () => {
  const wf = { line: 16, padding: 16, border: 2, rows: 2, minHeight: 112, room: 900 };
  assert.deepEqual(growHeight({ ...wf, content: text(5, 16) }), { height: 112, scrolls: false });
  assert.deepEqual(growHeight({ ...wf, content: text(8, 16) }), { height: 146, scrolls: false });
  assert.deepEqual(growHeight({ ...wf, content: text(12, 16) }), { height: 178, scrolls: true });
});

test('a fractional border rounds the height up, so the last line is never cut', () => {
  assert.equal(growHeight({ ...studio, border: 1.5, content: text(3) }).height, 78);
});
