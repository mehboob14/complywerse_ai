// node --test "src/app/(dashboard)/governance/_overview/docs/_views.test.ts"
// The views of the Governance Overview and their addresses, and what the old At a glance address becomes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_GROUP, DEFAULT_VIEW, GROUP_IDS, GROUPS, VIEW_IDS, VIEWS, legacyQuery, viewHref } from './_views.ts';

test('there are three views: the Summary (the default), the Departments and the Board', () => {
  assert.deepEqual(VIEW_IDS, ['summary', 'departments', 'board']);
  assert.equal(DEFAULT_VIEW, 'summary');
  assert.deepEqual(VIEWS.map((v) => v.label), ['Summary', 'Departments', 'Board']);
  assert.deepEqual(GROUP_IDS, ['status', 'type', 'department']);
  assert.equal(DEFAULT_GROUP, 'status');
  assert.deepEqual(GROUPS.map((g) => g.label), ['Status', 'Type', 'Department']);
});

test('the address of a department in a view leaves the defaults out and keeps the rest', () => {
  assert.equal(viewHref(''), '/governance');
  assert.equal(viewHref('12'), '/governance?dept=12');
  assert.equal(viewHref('none', 'departments'), '/governance?dept=none&view=departments');
  assert.equal(viewHref('12', 'board'), '/governance?dept=12&view=board');
  assert.equal(viewHref('12', 'board', 'department'), '/governance?dept=12&view=board&group=department');
  assert.equal(viewHref('12', 'departments', 'department'), '/governance?dept=12&view=departments', 'the grouping belongs to the board only');
});

test('the columns of the department table are kept in the Departments view, and in no other', () => {
  assert.equal(viewHref('12', 'departments', 'status', 'waiting'), '/governance?dept=12&view=departments&measure=waiting');
  assert.equal(viewHref('', 'summary', 'status', 'type'), '/governance', 'the Summary has no columns to keep');
  assert.equal(viewHref('12', 'board', 'type', 'type'), '/governance?dept=12&view=board&group=type');
  assert.equal(viewHref('12', 'departments', 'status', 'status'), '/governance?dept=12&view=departments');
});

test('the old At a glance address forwards with its department, grouping and columns, and its view mapped: table is Departments, graph and summary are the Summary', () => {
  assert.equal(legacyQuery(undefined), '');
  assert.equal(legacyQuery({}), '');
  assert.equal(legacyQuery({ dept: '12' }), '?dept=12');
  assert.equal(legacyQuery({ view: 'summary' }), '');
  assert.equal(legacyQuery({ view: 'graph', dept: 'none' }), '?dept=none');
  assert.equal(legacyQuery({ view: 'table', dept: '12', measure: 'waiting' }), '?dept=12&view=departments&measure=waiting');
  assert.equal(legacyQuery({ view: 'table', measure: 'status' }), '?view=departments');
  assert.equal(legacyQuery({ view: 'board', group: 'type' }), '?view=board&group=type');
  assert.equal(legacyQuery({ view: 'board', group: 'status' }), '?view=board');
  assert.equal(legacyQuery({ view: 'board', group: 'type' }), legacyQuery({ view: ['board', 'table'], group: ['type'] }), 'the first value of a repeated name decides');
  assert.equal(legacyQuery({ view: 'BOARD' }), '?view=board');
  assert.equal(legacyQuery({ view: 'nonsense', group: 'x', measure: 'y', dept: ' ' }), '', 'a value the Overview does not know is left out');
  assert.equal(legacyQuery({ view: 'summary', measure: 'type' }), '', 'the Summary has no columns');
});
