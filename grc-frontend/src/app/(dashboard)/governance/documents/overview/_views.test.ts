// node --test "src/app/(dashboard)/governance/documents/overview/_views.test.ts"
// The views of At a glance and their addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_GROUP, DEFAULT_VIEW, GROUP_IDS, GROUPS, VIEW_IDS, VIEWS, viewHref } from './_views.ts';

test('there are four views and the Summary, the mix of the figures, the graphs, the table and the board, is the first and the default', () => {
  assert.deepEqual(VIEW_IDS, ['summary', 'table', 'graph', 'board']);
  assert.equal(DEFAULT_VIEW, 'summary');
  assert.deepEqual(VIEWS.map((v) => v.label), ['Summary', 'Table', 'Graph', 'Board']);
  assert.deepEqual(GROUP_IDS, ['status', 'type', 'department']);
  assert.equal(DEFAULT_GROUP, 'status');
  assert.deepEqual(GROUPS.map((g) => g.label), ['Status', 'Type', 'Department']);
});

test('the address of a department in a view leaves the defaults out and keeps the rest', () => {
  assert.equal(viewHref(''), '/governance/documents/overview');
  assert.equal(viewHref('12'), '/governance/documents/overview?dept=12');
  assert.equal(viewHref('none', 'table'), '/governance/documents/overview?dept=none&view=table');
  assert.equal(viewHref('', 'graph'), '/governance/documents/overview?view=graph');
  assert.equal(viewHref('12', 'board'), '/governance/documents/overview?dept=12&view=board');
  assert.equal(viewHref('12', 'board', 'department'), '/governance/documents/overview?dept=12&view=board&group=department');
  assert.equal(viewHref('12', 'table', 'department'), '/governance/documents/overview?dept=12&view=table');         // the grouping belongs to the board only
});

test('the columns of the department table are kept in the summary and the table, and in no other view', () => {
  assert.equal(viewHref('12', 'table', 'status', 'waiting'), '/governance/documents/overview?dept=12&view=table&measure=waiting');
  assert.equal(viewHref('', 'summary', 'status', 'type'), '/governance/documents/overview?measure=type');
  assert.equal(viewHref('12', 'graph', 'status', 'type'), '/governance/documents/overview?dept=12&view=graph');
  assert.equal(viewHref('12', 'board', 'type', 'type'), '/governance/documents/overview?dept=12&view=board&group=type');
  assert.equal(viewHref('12', 'table', 'status', 'status'), '/governance/documents/overview?dept=12&view=table');
});
