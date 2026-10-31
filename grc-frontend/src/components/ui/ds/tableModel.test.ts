// node --test "src/components/ui/ds/tableModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INTERACTIVE_SELECTOR, ariaSort, isInteractiveTarget, nextSort, priorityClass, rowCountText, shouldActivateRow, sortRows,
  type SortState, type SortValue,
} from './tableModel.ts';

// ── nextSort ─────────────────────────────────────────────────────────────────
test('a column sorts ascending, then descending, then the sort clears', () => {
  let s: SortState = null;
  s = nextSort(s, 'title');
  assert.deepEqual(s, { key: 'title', dir: 'asc' });
  s = nextSort(s, 'title');
  assert.deepEqual(s, { key: 'title', dir: 'desc' });
  s = nextSort(s, 'title');
  assert.equal(s, null);
  assert.deepEqual(nextSort(s, 'title'), { key: 'title', dir: 'asc' });         // and round again
});

test('the asc-desc cycle only toggles', () => {
  let s: SortState = nextSort(null, 'due', 'asc-desc');
  assert.deepEqual(s, { key: 'due', dir: 'asc' });
  s = nextSort(s, 'due', 'asc-desc');
  assert.deepEqual(s, { key: 'due', dir: 'desc' });
  s = nextSort(s, 'due', 'asc-desc');
  assert.deepEqual(s, { key: 'due', dir: 'asc' });
});

test('another column starts ascending, whatever the current sort is', () => {
  assert.deepEqual(nextSort({ key: 'title', dir: 'asc' }, 'owner'), { key: 'owner', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'title', dir: 'desc' }, 'owner'), { key: 'owner', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'title', dir: 'desc' }, 'owner', 'asc-desc'), { key: 'owner', dir: 'asc' });
});

test('a column that answers its question the other way round starts descending (Updated: newest first)', () => {
  let s: SortState = nextSort(null, 'updated', 'asc-desc-none', 'desc');
  assert.deepEqual(s, { key: 'updated', dir: 'desc' });
  s = nextSort(s, 'updated', 'asc-desc-none', 'desc');
  assert.deepEqual(s, { key: 'updated', dir: 'asc' });
  assert.equal(nextSort(s, 'updated', 'asc-desc-none', 'desc'), null);
  assert.deepEqual(nextSort(s, 'updated', 'asc-desc', 'desc'), { key: 'updated', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'title', dir: 'desc' }, 'updated', 'asc-desc-none', 'desc'), { key: 'updated', dir: 'desc' });
});

test('nextSort leaves the state it was given alone', () => {
  const before: SortState = { key: 'title', dir: 'asc' };
  const after = nextSort(before, 'title');
  assert.deepEqual(before, { key: 'title', dir: 'asc' });
  assert.notEqual(after, before);
});

// ── ariaSort ─────────────────────────────────────────────────────────────────
test('aria-sort: left off for a column that cannot be sorted, else the direction or none', () => {
  assert.equal(ariaSort('title', { key: 'title', dir: 'asc' }, false), undefined);
  assert.equal(ariaSort('title', null, false), undefined);
  assert.equal(ariaSort('title', null, true), 'none');
  assert.equal(ariaSort('title', { key: 'owner', dir: 'asc' }, true), 'none');
  assert.equal(ariaSort('title', { key: 'title', dir: 'asc' }, true), 'ascending');
  assert.equal(ariaSort('title', { key: 'title', dir: 'desc' }, true), 'descending');
});

// ── sortRows ─────────────────────────────────────────────────────────────────
interface Row { id: string; v: SortValue }
const rowsOf = (...values: SortValue[]): Row[] => values.map((v, i) => ({ id: `r${i}`, v }));
const idsAfter = (rows: Row[], dir: 'asc' | 'desc'): string[] => sortRows(rows, { key: 'v', dir }, (r) => r.v).map((r) => r.id);
const valuesAfter = (rows: Row[], dir: 'asc' | 'desc'): SortValue[] => sortRows(rows, { key: 'v', dir }, (r) => r.v).map((r) => r.v);

test('numbers sort by value, not as text: 10 comes after 9', () => {
  const rows = rowsOf(10, 9, 100, 2, 1);
  assert.deepEqual(valuesAfter(rows, 'asc'), [1, 2, 9, 10, 100]);
  assert.deepEqual(valuesAfter(rows, 'desc'), [100, 10, 9, 2, 1]);
});

test('text sorts in natural order, ignoring case: Item 2 before Item 10, a with A', () => {
  const rows = rowsOf('Item 10', 'item 2', 'Banana', 'apple', 'Item 1');
  assert.deepEqual(valuesAfter(rows, 'asc'), ['apple', 'Banana', 'Item 1', 'item 2', 'Item 10']);
  assert.deepEqual(valuesAfter(rows, 'desc'), ['Item 10', 'item 2', 'Item 1', 'Banana', 'apple']);
});

test('digits inside text count as numbers (v9 before v10), and a number among text is compared as text', () => {
  assert.deepEqual(valuesAfter(rowsOf('v10', 'v9', 'v2'), 'asc'), ['v2', 'v9', 'v10']);
  assert.deepEqual(valuesAfter(rowsOf('10', 9, 'x', 2), 'asc'), [2, 9, '10', 'x']);
});

test('empty values (null, undefined, blank text, NaN) are last whichever way the column sorts', () => {
  const rows = rowsOf('b', null, 'a', undefined, '', 'c', '   ', NaN);
  assert.deepEqual(valuesAfter(rows, 'asc').slice(0, 3), ['a', 'b', 'c']);
  assert.deepEqual(valuesAfter(rows, 'desc').slice(0, 3), ['c', 'b', 'a']);
  for (const dir of ['asc', 'desc'] as const) {
    const sorted = valuesAfter(rows, dir);
    assert.equal(sorted.length, 8);
    assert.ok(sorted.slice(3).every((v) => v == null || v === '' || v === '   ' || Number.isNaN(v)), `empties last (${dir})`);
  }
  // and the empties keep the order they came in
  assert.deepEqual(idsAfter(rows, 'asc').slice(3), ['r1', 'r3', 'r4', 'r6', 'r7']);
  assert.deepEqual(idsAfter(rows, 'desc').slice(3), ['r1', 'r3', 'r4', 'r6', 'r7']);
});

test('0 is a value, not an empty: it sorts before 1', () => {
  assert.deepEqual(valuesAfter(rowsOf(1, 0, null, 3), 'asc'), [0, 1, 3, null]);
  assert.deepEqual(valuesAfter(rowsOf(1, 0, null, 3), 'desc'), [3, 1, 0, null]);
});

test('the sort is stable: equal keys keep the order they came in, descending too', () => {
  const rows = rowsOf('b', 'a', 'B', 'A', 'b');
  assert.deepEqual(idsAfter(rows, 'asc'), ['r1', 'r3', 'r0', 'r2', 'r4']);
  assert.deepEqual(idsAfter(rows, 'desc'), ['r0', 'r2', 'r4', 'r1', 'r3']);          // not the reverse of the line above
  const numbers = rowsOf(2, 1, 2, 1, 2);
  assert.deepEqual(idsAfter(numbers, 'asc'), ['r1', 'r3', 'r0', 'r2', 'r4']);
  assert.deepEqual(idsAfter(numbers, 'desc'), ['r0', 'r2', 'r4', 'r1', 'r3']);
});

test('sortRows does not touch its input and hands back a new array', () => {
  const rows = rowsOf(3, 1, 2);
  const frozen = Object.freeze(rows.slice());
  const out = sortRows(frozen, { key: 'v', dir: 'asc' }, (r) => r.v);
  assert.deepEqual(rows.map((r) => r.v), [3, 1, 2]);
  assert.notEqual(out, frozen);
  assert.deepEqual(out.map((r) => r.v), [1, 2, 3]);
  assert.equal(out[0], rows[1]);                                                       // the same row objects, only moved
});

test('no sort: a copy in the order the rows came in', () => {
  const rows = rowsOf(3, 1, 2);
  const out = sortRows(rows, null, (r) => r.v);
  assert.deepEqual(out.map((r) => r.v), [3, 1, 2]);
  assert.notEqual(out, rows);
});

test('dates sort by their moment, and an invalid date is empty', () => {
  const rows = rowsOf(new Date('2026-03-01T00:00:00Z'), new Date('nope'), new Date('2025-12-31T00:00:00Z'), null);
  assert.deepEqual(idsAfter(rows, 'asc'), ['r2', 'r0', 'r1', 'r3']);
  assert.deepEqual(idsAfter(rows, 'desc'), ['r0', 'r2', 'r1', 'r3']);
});

test('valueOf is asked for the column being sorted, row by row', () => {
  const asked: string[] = [];
  const rows = [{ a: 2, b: 'x' }, { a: 1, b: 'y' }];
  const out = sortRows(rows, { key: 'b', dir: 'desc' }, (r, key) => { asked.push(key); return key === 'a' ? r.a : r.b; });
  assert.deepEqual(out.map((r) => r.b), ['y', 'x']);
  assert.ok(asked.length > 0 && asked.every((k) => k === 'b'));
});

test('an empty list, and a list of one, sort to themselves', () => {
  assert.deepEqual(sortRows([], { key: 'v', dir: 'asc' }, () => 1), []);
  assert.deepEqual(valuesAfter(rowsOf(null), 'desc'), [null]);
});

// ── priorityClass ────────────────────────────────────────────────────────────
test('priority 1 is always shown, 2 from md, 3 from lg', () => {
  assert.equal(priorityClass(1), '');
  assert.equal(priorityClass(), '');
  assert.equal(priorityClass(2), 'hidden md:table-cell');
  assert.equal(priorityClass(3), 'hidden lg:table-cell');
});

// ── pressing a row ───────────────────────────────────────────────────────────
test('Enter and Space on the row itself activate it; nothing else does', () => {
  assert.equal(shouldActivateRow({ key: 'Enter', targetIsRow: true }), true);
  assert.equal(shouldActivateRow({ key: ' ', targetIsRow: true }), true);
  for (const key of ['Tab', 'Escape', 'ArrowDown', 'a', 'Shift', 'Backspace']) assert.equal(shouldActivateRow({ key, targetIsRow: true }), false, key);
});

test('Enter or Space on something inside the row is that thing\'s, not the row\'s', () => {
  assert.equal(shouldActivateRow({ key: 'Enter', targetIsRow: false }), false);
  assert.equal(shouldActivateRow({ key: ' ', targetIsRow: false }), false);
});

/** A stand-in for a DOM element: `closest` answers with `hit`, `contains` is the row's own. */
const fake = (hit: object | null) => ({ closest: () => hit }) as unknown as Element;
const rowOf = (inside: object[]) => ({ contains: (n: object) => inside.includes(n) }) as unknown as Element;

test('a click on a control inside the row belongs to the control', () => {
  const button = {};
  assert.equal(isInteractiveTarget(fake(button), rowOf([button])), true);
  assert.equal(isInteractiveTarget(fake(button)), true);                               // no row to bound the search: any control counts
});

test('a click anywhere else on the row activates it', () => {
  assert.equal(isInteractiveTarget(fake(null), rowOf([])), false);
  assert.equal(isInteractiveTarget(null, rowOf([])), false);
  assert.equal(isInteractiveTarget(undefined), false);
});

test('a control around the row, a menu portaled out of it and the row itself do not count', () => {
  const around = {};
  assert.equal(isInteractiveTarget(fake(around), rowOf([])), false);                   // outside the row
  const row = rowOf([]);
  assert.equal(isInteractiveTarget({ closest: () => row } as unknown as Element, row), false);   // the row matches the selector itself
});

test('the controls that handle their own click are listed', () => {
  const listed = INTERACTIVE_SELECTOR.split(',').map((s) => s.trim());
  for (const s of ['a', 'button', 'input', 'select', 'textarea', '[role="button"]', '[data-row-ignore]']) assert.ok(listed.includes(s), s);
});

// ── rowCountText ─────────────────────────────────────────────────────────────
test('a cut list says how many of how many; a whole one just how many', () => {
  assert.equal(rowCountText({ shown: 25, total: 312, noun: 'document' }), '25 of 312 documents');
  assert.equal(rowCountText({ shown: 312, total: 312, noun: 'document' }), '312 documents');
  assert.equal(rowCountText({ shown: 0, total: 312, noun: 'document' }), '0 of 312 documents');
});

test('one is singular, and so is "of 1"; zero is a count when the list answered', () => {
  assert.equal(rowCountText({ shown: 1, total: 1, noun: 'document' }), '1 document');
  assert.equal(rowCountText({ shown: 0, total: 1, noun: 'document' }), '0 of 1 document');
  assert.equal(rowCountText({ shown: 0, total: 0, noun: 'document' }), '0 documents');
});

test('numbers are grouped, and a noun with its own plural gets it', () => {
  assert.equal(rowCountText({ shown: 1000, total: 12345, noun: 'exception' }), '1,000 of 12,345 exceptions');
  assert.equal(rowCountText({ shown: 2, total: 2, noun: 'policy', plural: 'policies' }), '2 policies');
  assert.equal(rowCountText({ shown: 1, total: 1, noun: 'policy', plural: 'policies' }), '1 policy');
});

test('no count while the list loads or after it failed, and none for a total nobody knows', () => {
  assert.equal(rowCountText({ shown: 0, total: 0, noun: 'document', loading: true }), null);
  assert.equal(rowCountText({ shown: 25, total: 312, noun: 'document', loading: true }), null);
  assert.equal(rowCountText({ shown: 0, total: 0, noun: 'document', failed: true }), null);
  assert.equal(rowCountText({ shown: 25, total: 312, noun: 'document', failed: true }), null);
  assert.equal(rowCountText({ shown: 25, total: null, noun: 'document' }), null);
  assert.equal(rowCountText({ shown: 25, total: undefined, noun: 'document' }), null);
  assert.equal(rowCountText({ shown: 25, total: Number.NaN, noun: 'document' }), null);
});
