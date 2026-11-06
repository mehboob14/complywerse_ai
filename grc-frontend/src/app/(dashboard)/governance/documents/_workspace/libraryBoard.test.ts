// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryBoard.test.ts"
// The Board puts every matching document in exactly one column by its status (the counts add up), read-only, with "Needs attention" taking everything outside the life cycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boardColumns, columnTitle, groupDocuments, statusesOfColumn } from './libraryBoard.ts';

const docs = ['draft', 'pending_review', 'pending_approval', 'approved', 'published', 'published', 'expired', 'exception_applied', 'review_required', 'something_new', 'draft']
  .map((status, i) => ({ id: i + 1, status }));

test('every document is in exactly one column and the columns add up', () => {
  const board = groupDocuments(docs, false);
  assert.deepEqual(board.map((c) => c.id), ['draft', 'review', 'approval', 'approved', 'published', 'attention']);
  assert.deepEqual(board.map((c) => c.rows.length), [2, 1, 1, 1, 2, 4]);
  assert.equal(board.reduce((n, c) => n + c.rows.length, 0), docs.length);
  assert.deepEqual(board[5].rows.map((d) => d.status), ['expired', 'exception_applied', 'review_required', 'something_new']);
});

test('the Archived list has the one column it is', () => {
  const archived = [{ id: 1, status: 'archived' }, { id: 2, status: 'archived' }];
  assert.deepEqual(groupDocuments(archived, true).map((c) => [c.id, c.rows.length]), [['archived', 2]]);
  assert.deepEqual(boardColumns(true).map((c) => c.statuses), [['archived']]);
});

test('"Show all" on a column asks for the statuses the column holds', () => {
  assert.deepEqual(statusesOfColumn('review', docs), ['pending_review']);
  assert.deepEqual(statusesOfColumn('attention', docs), ['exception_applied', 'expired', 'review_required', 'something_new']);
  assert.deepEqual(statusesOfColumn('archived', docs), ['archived']);
  assert.equal(columnTitle(['pending_review', 'published']), 'In review, Published');
});
