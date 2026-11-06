// node --test "src/components/records/explorerModel.test.ts"
// The selection, the cursor, the keys, the board and the option lists of the facet explorer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canSelectAll, groupBoard, keepMatching, keyAction, moveCursor, selectAllMatching, selectedLabel, shownOptions, tickState, toggleAll, toggleOne,
} from './explorerModel.ts';

test('a header tick box ticks the rows of its page, unticks them when all are ticked, and leaves other ticks alone', () => {
  const page = [1, 2, 3];
  assert.equal(tickState(new Set(), page), 'none');
  assert.equal(tickState(new Set([2]), page), 'some');
  assert.equal(tickState(new Set([1, 2, 3, 9]), page), 'all');
  assert.equal(tickState(new Set([1]), []), 'none');
  assert.deepEqual(Array.from(toggleAll(new Set([9]), page)).sort(), [1, 2, 3, 9]);
  assert.deepEqual(Array.from(toggleAll(new Set([1, 2, 3, 9]), page)), [9]);
  assert.deepEqual(Array.from(toggleAll(new Set([1]), page)).sort(), [1, 2, 3]);
  assert.deepEqual(Array.from(toggleOne(new Set([1]), 1)), []);
  assert.deepEqual(Array.from(toggleOne(new Set([1]), 2)), [1, 2]);
});

test('"select all N matching" takes every match, also off the page; what a filter took out is not acted on', () => {
  const matching = Array.from({ length: 1247 }, (_, i) => i + 1);
  const all = selectAllMatching(matching);
  assert.equal(all.size, 1247);
  assert.equal(canSelectAll(25, 1247), true);
  assert.equal(canSelectAll(1247, 1247), false);
  assert.equal(selectedLabel(1247), '1,247 selected');
  assert.deepEqual(keepMatching(new Set([1, 2, 3, 99]), new Set([2, 3, 4])), [2, 3]);
});

test('j and k move the cursor; from nothing j is the first row and k the last; at an end it stays', () => {
  const rows = [10, 20, 30];
  assert.equal(moveCursor(rows, null, 1), 10);
  assert.equal(moveCursor(rows, null, -1), 30);
  assert.equal(moveCursor(rows, 10, 1), 20);
  assert.equal(moveCursor(rows, 30, 1), 30);
  assert.equal(moveCursor(rows, 10, -1), 10);
  assert.equal(moveCursor(rows, 999, 1), 10);                                       // the row is gone: start again
  assert.equal(moveCursor([], 10, 1), null);
});

test('the keys: "/" searches, j and k move, Enter opens from the page, Escape closes; never from a field, a modifier, a menu or a dialog', () => {
  const k = (key: string, extra = {}) => ({ key, ...extra });
  assert.equal(keyAction(k('/'), 'page', false), 'search');
  assert.equal(keyAction(k('j'), 'page', false), 'next');
  assert.equal(keyAction(k('k'), 'control', false), 'previous');
  assert.equal(keyAction(k('Enter'), 'page', false), 'open');
  assert.equal(keyAction(k('Enter'), 'control', false), null);                      // a focused button is pressed by Enter, not the row under the cursor opened
  assert.equal(keyAction(k('Escape'), 'page', false), 'escape');
  assert.equal(keyAction(k('Escape'), 'control', false), 'escape');
  assert.equal(keyAction(k('/'), 'field', false), null);
  assert.equal(keyAction(k('j'), 'field', false), null);
  assert.equal(keyAction(k('Escape'), 'field', false), null);
  assert.equal(keyAction(k('j'), 'overlay', false), null);
  assert.equal(keyAction(k('j'), 'page', true), null);                              // a panel or dialog is open: its keys are its own
  assert.equal(keyAction(k('Escape'), 'page', true), null);
  assert.equal(keyAction(k('j', { ctrl: true }), 'page', false), null);
  assert.equal(keyAction(k('/', { meta: true }), 'page', false), null);
  assert.equal(keyAction(k('k', { alt: true }), 'page', false), null);
  assert.equal(keyAction(k('j', { defaultPrevented: true }), 'page', false), null);
  assert.equal(keyAction(k('j', { composing: true }), 'page', false), null);
  assert.equal(keyAction(k('x'), 'page', false), null);
});

test('a board puts each record in the first column that takes it and keeps the order', () => {
  const rows = [{ id: 1, s: 'draft' }, { id: 2, s: 'published' }, { id: 3, s: 'draft' }, { id: 4, s: 'weird' }, { id: 5, s: 'archived' }];
  const columns = [
    { id: 'd', label: 'Draft', test: (r: (typeof rows)[number]) => r.s === 'draft' },
    { id: 'p', label: 'Published', test: (r: (typeof rows)[number]) => r.s === 'published' },
    { id: 'o', label: 'Other', test: (r: (typeof rows)[number]) => r.s !== 'archived' },
  ];
  const board = groupBoard(rows, columns);
  assert.deepEqual(board.map((c) => [c.id, c.rows.map((r) => r.id)]), [['d', [1, 3]], ['p', [2]], ['o', [4]]]);
});

test('an option list shows its first few and "Show N more", but a choice is never hidden and a search or an expanded list shows all', () => {
  const options = Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `o${i}` }));
  assert.deepEqual(shownOptions(options, 7, false, false, []).hidden, 5);
  assert.equal(shownOptions(options, 7, false, false, []).shown.length, 7);
  assert.equal(shownOptions(options, 7, true, false, []).hidden, 0);
  assert.equal(shownOptions(options, 7, false, true, []).hidden, 0);
  const chosen = shownOptions(options, 7, false, false, ['10']);
  assert.deepEqual([chosen.shown.length, chosen.hidden, chosen.shown[7].value], [8, 4, '10']);
  assert.equal(shownOptions(options, undefined, false, false, []).hidden, 0);
  assert.equal(shownOptions(options.slice(0, 5), 7, false, false, []).hidden, 0);
});
