import { test } from 'node:test';
import assert from 'node:assert/strict';

import { libraryCounts, unlessArchivedAsked, withoutArchived } from './archive.ts';

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

test('the library counts archived documents only under Archived', () => {
  assert.deepEqual(libraryCounts(docs, 7), { all: 3, mine: 2, archived: 1 });
  assert.deepEqual(libraryCounts(docs, null), { all: 3, mine: 0, archived: 1 });
  assert.deepEqual(libraryCounts([], 7), { all: 0, mine: 0, archived: 0 });
});
