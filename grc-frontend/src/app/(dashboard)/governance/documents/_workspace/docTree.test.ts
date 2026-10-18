import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTree, flattenTree, parentIds, type TreeDoc } from './docTree.ts';

const d = (id: number, parent: number | null = null): TreeDoc => ({ id, parent_document_id: parent });
const ids = (rows: { doc: TreeDoc }[]) => rows.map((r) => r.doc.id);
const none = new Set<number>();

// 1 policy ─ 2 standard ─ 4 procedure
//          └ 3 standard
// 5 policy (alone)
const LIB = [d(5), d(4, 2), d(3, 1), d(2, 1), d(1)];

test('documents nest under their parent at any depth; siblings keep the order they came in', () => {
  const rows = flattenTree(buildTree(LIB, null), none);
  assert.deepEqual(ids(rows), [5, 1, 3, 2, 4]);
  assert.deepEqual(rows.map((r) => r.depth), [0, 0, 1, 1, 2]);
  assert.deepEqual(rows.map((r) => r.childCount), [0, 2, 0, 1, 0]);
  assert.ok(rows.every((r) => r.match));
});

test('connector lines: └ on the last sibling, a rail through rows below an ancestor that has a later sibling', () => {
  // 1 ─┬ 2 ─┬ 4 ─ 6
  //    │    └ 7
  //    └ 3
  const rows = flattenTree(buildTree([d(1), d(2, 1), d(3, 1), d(4, 2), d(7, 2), d(6, 4)], null), none);
  const by = Object.fromEntries(rows.map((r) => [r.doc.id, r]));
  assert.deepEqual(ids(rows), [1, 2, 4, 6, 7, 3]);
  assert.equal(by[2].last, false);
  assert.equal(by[3].last, true);
  assert.deepEqual(by[2].rails, []);              // under a top-level document: only its own elbow
  assert.deepEqual(by[4].rails, [true]);           // 2 has a later sibling (3): its line runs on through 4
  assert.deepEqual(by[6].rails, [true, true]);     // ... and 4 has a later sibling (7)
  assert.deepEqual(by[7].rails, [true]);
  assert.equal(by[7].last, true);
});

test('collapsing a document hides everything under it; expand all is an empty set', () => {
  const roots = buildTree(LIB, null);
  assert.deepEqual(ids(flattenTree(roots, new Set([1]))), [5, 1]);
  assert.deepEqual(ids(flattenTree(roots, new Set([2]))), [5, 1, 3, 2]);
  const folded = flattenTree(roots, new Set([1]));
  assert.equal(folded[1].expanded, false);
  assert.equal(folded[1].childCount, 2);
  assert.deepEqual(parentIds(roots).sort(), [1, 2]);
});

test('a filter keeps the ancestors of a match, greyed, and drops what does not match', () => {
  const rows = flattenTree(buildTree(LIB, new Set([4])), none);
  assert.deepEqual(ids(rows), [1, 2, 4]);
  assert.deepEqual(rows.map((r) => r.match), [false, false, true]);
  assert.equal(rows[1].last, true);                // 3 is filtered out, so 2 is the last child now
});

test('a match under a match: both stay matches', () => {
  const rows = flattenTree(buildTree(LIB, new Set([1, 4])), none);
  assert.deepEqual(ids(rows), [1, 2, 4]);
  assert.deepEqual(rows.map((r) => r.match), [true, false, true]);
});

test('a document whose parent is out of scope or missing is at the top', () => {
  // the library scope holds only 2 and 4 (e.g. "My documents"): 2's parent 1 is not in it
  assert.deepEqual(ids(flattenTree(buildTree([d(4, 2), d(2, 1)], null), none)), [2, 4]);
  // a parent that was deleted or is not readable
  const rows = flattenTree(buildTree([d(8, 99), d(9)], null), none);
  assert.deepEqual(ids(rows), [8, 9]);
  assert.ok(rows.every((r) => r.depth === 0));
});

test('nothing matches: no rows', () => {
  assert.deepEqual(flattenTree(buildTree(LIB, new Set()), none), []);
  assert.deepEqual(flattenTree(buildTree([], null), none), []);
});

test('a parent loop in the data is cut, no document is lost and nothing loops for ever', () => {
  const rows = flattenTree(buildTree([d(1, 2), d(2, 1), d(3, 3), d(4, 1)], null), none);
  assert.deepEqual(ids(rows).sort(), [1, 2, 3, 4]);
  assert.equal(rows.filter((r) => r.doc.id === 3)[0].depth, 0);   // its own parent: top level
  // the filter walks up a loop too
  assert.deepEqual(ids(flattenTree(buildTree([d(1, 2), d(2, 1)], new Set([1])), none)).sort(), [1, 2]);
});
