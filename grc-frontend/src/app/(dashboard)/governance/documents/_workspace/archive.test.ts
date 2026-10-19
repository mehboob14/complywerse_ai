import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { bulkActionIds, libraryCounts, unlessArchivedAsked, withoutArchived } from './archive.ts';
import { buildTree, flattenTree } from './docTree.ts';

const docs = [
  { id: 1, status: 'published', owner_id: 7 },
  { id: 2, status: 'archived', owner_id: 7 },
  { id: 3, status: 'draft', owner_id: 8 },
  { id: 4, status: 'expired', owner_id: 7 },
];

test('archived documents stay out of the lists unless the Status filter asks for them', () => {
  assert.deepEqual(unlessArchivedAsked(docs, '').map((d) => d.id), [1, 3, 4]);
  assert.deepEqual(unlessArchivedAsked(docs, 'draft').map((d) => d.id), [1, 3, 4]);       // the status filter itself keeps the drafts
  assert.deepEqual(unlessArchivedAsked(docs, 'archived').map((d) => d.id), [1, 2, 3, 4]);
});

test('the tree leaves archived documents out and keeps the documents under them', () => {
  type N = { id: number; status: string; children?: N[] };
  const tree: N[] = [
    { id: 1, status: 'published', children: [{ id: 2, status: 'archived', children: [{ id: 5, status: 'draft' }] }, { id: 3, status: 'draft' }] },
    { id: 4, status: 'archived', children: [{ id: 6, status: 'published', children: [] }] },
    { id: 7, status: 'archived' },
  ];
  const ids = (nodes: N[]): unknown[] => nodes.map((n) => (n.children?.length ? [n.id, ids(n.children)] : n.id));
  assert.deepEqual(ids(withoutArchived(tree)), [[1, [5, 3]], 6]);
  assert.equal(tree[0].children?.[0].id, 2);                                                // the hierarchy itself is not changed
});

test('the Tree view under All documents shows no archived parent: the documents under it are at the top', () => {
  // 1 archived ─ 2 draft ─ 3 published; 4 published
  const scope = [
    { id: 1, status: 'archived', parent_document_id: null },
    { id: 2, status: 'draft', parent_document_id: 1 },
    { id: 3, status: 'published', parent_document_id: 2 },
    { id: 4, status: 'published', parent_document_id: null },
  ];
  const rows = (statusFilter: string) => {
    const shown = unlessArchivedAsked(scope, statusFilter).filter((d) => !statusFilter || d.status === statusFilter);   // the list
    const tree = buildTree(unlessArchivedAsked(scope, statusFilter), new Set(shown.map((d) => d.id)));                 // its scope
    return flattenTree(tree, new Set()).map((r) => [r.doc.id, r.depth, r.match]);
  };
  assert.deepEqual(rows(''), [[2, 0, true], [3, 1, true], [4, 0, true]]);       // no greyed "parent of a match" row for 1
  assert.deepEqual(rows('archived'), [[1, 0, true]]);                           // the Archived list shows it
});

test('the bulk bar of the Archived list offers Restore only', () => {
  assert.deepEqual(bulkActionIds(true), ['restore']);
  assert.deepEqual(bulkActionIds(false), ['approve', 'publish', 'assign-owner', 'set-review', 'archive']);
});

test('the register has tick boxes only when its bulk bar has an action for the person (none for an owner without the edit role)', () => {
  const src = readFileSync(new URL('./RegisterTable.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('selectable={bulkActions.length > 0}'));
});

test('the library counts archived documents only under Archived', () => {
  assert.deepEqual(libraryCounts(docs, 7), { all: 3, mine: 2, archived: 1 });
  assert.deepEqual(libraryCounts(docs, null), { all: 3, mine: 0, archived: 1 });
  assert.deepEqual(libraryCounts([], 7), { all: 0, mine: 0, archived: 0 });
});
