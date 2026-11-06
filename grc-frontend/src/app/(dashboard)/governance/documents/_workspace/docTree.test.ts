import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NOTHING_OPEN, buildTree, collapseAll, expandAll, flip, openness, treeEntries, type TreeDoc } from './docTree.ts';

const d = (id: number, parent: number | null = null): TreeDoc => ({ id, parent_document_id: parent });
const ids = (rows: { doc: TreeDoc }[]) => rows.map((r) => r.doc.id);

// 1 policy ─ 2 standard ─ 4 procedure
//          └ 3 standard
// 5 policy (alone)
const LIB = [d(5), d(4, 2), d(3, 1), d(2, 1), d(1)];

test('documents nest under their parent at any depth; siblings keep the order they came in', () => {
  const rows = treeEntries(buildTree(LIB, null));
  assert.deepEqual(ids(rows), [5, 1, 3, 2, 4]);
  assert.deepEqual(rows.map((r) => r.depth), [0, 0, 1, 1, 2]);
  assert.deepEqual(rows.map((r) => r.children.map((c) => c.id)), [[], [3, 2], [], [4], []]);
  assert.ok(rows.every((r) => r.match));
  assert.deepEqual(buildTree(LIB, null).map((n) => n.doc.id), [5, 1]);      // the top-level rows of the table
});

test('a filter keeps the ancestors of a match, greyed, and drops what does not match', () => {
  const rows = treeEntries(buildTree(LIB, new Set([4])));
  assert.deepEqual(ids(rows), [1, 2, 4]);
  assert.deepEqual(rows.map((r) => r.match), [false, false, true]);
  assert.deepEqual(rows[0].children.map((c) => c.id), [2]);                // 3 is filtered out
});

test('a match under a match: both stay matches', () => {
  const rows = treeEntries(buildTree(LIB, new Set([1, 4])));
  assert.deepEqual(ids(rows), [1, 2, 4]);
  assert.deepEqual(rows.map((r) => r.match), [true, false, true]);
});

test('a document whose parent is out of scope or missing is at the top', () => {
  // the scope holds only 2 and 4: 2's parent 1 is not in it
  assert.deepEqual(ids(treeEntries(buildTree([d(4, 2), d(2, 1)], null))), [2, 4]);
  // a parent that was deleted or is not readable
  const rows = treeEntries(buildTree([d(8, 99), d(9)], null));
  assert.deepEqual(ids(rows), [8, 9]);
  assert.ok(rows.every((r) => r.depth === 0));
});

test('nothing matches: no rows', () => {
  assert.deepEqual(treeEntries(buildTree(LIB, new Set())), []);
  assert.deepEqual(treeEntries(buildTree([], null)), []);
});

test('a parent loop in the data is cut, no document is lost and nothing loops for ever', () => {
  const rows = treeEntries(buildTree([d(1, 2), d(2, 1), d(3, 3), d(4, 1)], null));
  assert.deepEqual(ids(rows).sort(), [1, 2, 3, 4]);
  assert.equal(rows.filter((r) => r.doc.id === 3)[0].depth, 0);   // its own parent: top level
  // the filter walks up a loop too
  assert.deepEqual(ids(treeEntries(buildTree([d(1, 2), d(2, 1)], new Set([1])))).sort(), [1, 2]);
});

test('every row starts closed; its arrow opens it all the way (versions and documents) and closes it again', () => {
  assert.equal(openness(NOTHING_OPEN, 1, true, false), null);
  assert.equal(openness(NOTHING_OPEN, 5, false, false), null);
  const opened = flip(NOTHING_OPEN, 5, false);                               // a document with nothing under it still opens: its versions
  assert.equal(openness(opened, 5, false, false), 'all');
  assert.equal(openness(flip(opened, 5, true), 5, false, false), null);
  assert.equal(NOTHING_OPEN.open.size + NOTHING_OPEN.shut.size, 0);          // a flip makes a new fold, the old one is left alone
});

test('a search or filter opens the way to every match (documents only, no versions are read) until the person closes it', () => {
  assert.equal(openness(NOTHING_OPEN, 1, true, true), 'docs');
  assert.equal(openness(NOTHING_OPEN, 4, false, true), null);                 // the match itself stays closed
  const closed = flip(NOTHING_OPEN, 1, true);
  assert.equal(openness(closed, 1, true, true), null);
  assert.equal(openness(flip(closed, 1, false), 1, true, true), 'all');       // opened again: all the way
});

test('Expand all shows the documents under every document; Collapse all closes everything, the way to a match too', () => {
  const someOpen = flip(flip(NOTHING_OPEN, 5, false), 2, true);              // 5 opened, 2 closed by hand
  const all = expandAll(someOpen);
  assert.deepEqual([1, 2, 5].map((id) => openness(all, id, id !== 5, false)), ['docs', 'docs', 'all']);
  assert.equal(openness(all, 4, false, false), null);                         // nothing under it: closed
  const none = collapseAll([1, 2]);
  assert.deepEqual([1, 2, 5].map((id) => openness(none, id, id !== 5, true)), [null, null, null]);
});
