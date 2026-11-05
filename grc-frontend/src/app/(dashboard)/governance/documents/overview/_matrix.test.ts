// node --test "src/app/(dashboard)/governance/documents/overview/_matrix.test.ts"
// The department table as data: the columns of each measure, a line for every department with its cells and where each figure opens, the totals, what is filed in
// a department itself, and the CSV of the whole matrix.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PARAM_KEYS } from '../_workspace/libraryModel.ts';
import { IN_OPERATIONS, OPERATIONS, SUPPORT, WHOLE, row } from './_fixture.ts';
import { ISSUE_COLUMNS, MEASURE_IDS, MEASURES, REVIEW_COLUMNS, TABLE_MEASURE_IDS, WAITING_COLUMNS, columnsFor, csvLabel, matrixCsv, matrixLines, matrixTotals, ownOf, statusColumns, typeColumns } from './_matrix.ts';

const ids = (cols: readonly { id: string }[]) => cols.map((c) => c.id);
const cells = (line: { cells: { value: number }[] }) => line.cells.map((c) => c.value);

test('the measures are status, type, waiting on people, reviews, issues, and all of them', () => {
  assert.deepEqual(MEASURE_IDS, ['status', 'type', 'waiting', 'reviews', 'issues', 'all']);
  assert.ok(MEASURES.every((m) => m.label && m.info.length > 20));
  assert.deepEqual(TABLE_MEASURE_IDS, ['status', 'type', 'waiting', 'reviews', 'issues'], 'the page\'s table shows one group of columns at a time; all of them are the export\'s');
});

test('the status columns are the steps of the approval flow, in the interface\'s words, and a lapsed status only while some document has it', () => {
  const cols = statusColumns(WHOLE);
  assert.deepEqual(cols.map((c) => c.label), ['Draft', 'In review', 'In approval', 'Approved', 'Published']);
  assert.deepEqual(ids(cols), ['status:draft', 'status:pending_review', 'status:pending_approval', 'status:approved', 'status:published']);
  assert.equal(cols[4].tone, 'success');
  const lapsed = statusColumns({ by_status: [...WHOLE.by_status.slice(0, 5), { key: 'status:expired', status: 'expired', count: 2 }, { key: 'status:exception_applied', status: 'exception_applied', count: 0 }] });
  assert.deepEqual(lapsed.map((c) => c.label).slice(5), ['Expired']);
  assert.equal(lapsed[5].tone, 'danger');
});

test('the type columns are the kinds the server lists, most first, and a document with no type has a column but no address', () => {
  const cols = typeColumns(WHOLE);
  assert.deepEqual(cols.map((c) => c.label), ['Policy', 'Guideline', 'Procedure', 'Standard']);
  assert.deepEqual(cols[0].params, { type: 'policy' });
  const none = typeColumns({ by_type: [{ key: 'type:', doc_type: '', label: '—', count: 1, in_force: 0, in_force_key: 'type::in_force' }] });
  assert.deepEqual([none[0].label, none[0].params, none[0].value(row({ department_id: 1, name: 'A', by_type: { '': 3 } }))], ['—', null, 3]);
});

test('waiting on people: pending and overdue for each kind; an overdue review or approval opens the late approvals, a pending acknowledgement has no address', () => {
  assert.deepEqual(WAITING_COLUMNS.map((c) => c.label), ['Reviews pending', 'Reviews late', 'Approvals pending', 'Approvals late', 'Acknowledgements pending', 'Acknowledgements late']);
  const by = Object.fromEntries(WAITING_COLUMNS.map((c) => [c.id, c.params]));
  assert.deepEqual(by['waiting:review:pending'], { status: 'pending_review' });
  assert.deepEqual(by['waiting:approval:pending'], { status: 'pending_approval' });
  assert.deepEqual(by['waiting:review:overdue'], { attn: 'late_approvals' });
  assert.deepEqual(by['waiting:approval:overdue'], { attn: 'late_approvals' });
  assert.deepEqual(by['waiting:acknowledgement:overdue'], { attn: 'late_acknowledgements' });
  assert.equal(by['waiting:acknowledgement:pending'], null);
});

test('reviews: where the review dates stand; issues: the documents with any issue (no single address) and each issue', () => {
  assert.deepEqual(REVIEW_COLUMNS.map((c) => c.label), ['Overdue reviews', 'Due in 30 days', 'No review date']);
  assert.deepEqual(REVIEW_COLUMNS.map((c) => Object.keys(c.params ?? {})[0]), ['review', 'review', 'review']);
  assert.deepEqual(ISSUE_COLUMNS.map((c) => c.label), ['With issues', 'Stuck', 'On hold', 'Late approvals', 'Late acknowledgements', 'No owner']);
  assert.equal(ISSUE_COLUMNS[0].params, null);
  assert.deepEqual(ISSUE_COLUMNS.slice(1).map((c) => Object.keys(c.params ?? {})[0]), ['attn', 'attn', 'attn', 'attn', 'owner']);
});

test('every address a column can open is a parameter the library reads', () => {
  const all = columnsFor('all', WHOLE);
  assert.equal(all.length, 5 + 4 + 6 + 9);
  const names = new Set(all.flatMap((c) => Object.keys(c.params ?? {})));
  assert.ok(names.size >= 5);
  for (const n of Array.from(names)) assert.ok(PARAM_KEYS.includes(n), `the table writes ?${n}= and the library does not read it`);
  assert.deepEqual(ids(columnsFor('waiting', WHOLE)), ids(WAITING_COLUMNS));
});

test('a line for every department, in the tree\'s order: its cells, where its name and its figures open', () => {
  const lines = matrixLines(WHOLE, columnsFor('status', WHOLE));
  assert.deepEqual(lines.map((l) => [l.row.name, l.here, l.open]), [
    ['Finance', false, '/governance/documents/overview?dept=13'], ['Operations', false, '/governance/documents/overview?dept=10'],
    ['Support', false, '/governance/documents/overview?dept=11'], ['Helpdesk', false, '/governance/documents/overview?dept=12'],
    ['No department', false, '/governance/documents/overview?dept=none'],
  ]);
  const ops = lines[1];
  assert.deepEqual(cells(ops), [1, 1, 1, 0, 2]);
  assert.equal(ops.cells[4].href, '/governance/documents?dept=10&status=published');
  assert.equal(ops.cells[1].noun, 'documents with status In review');
  assert.equal(lines[4].cells[4].href, '/governance/documents?dept=none&status=published');
  assert.equal(ops.title, 'Department · 1 filed in it, 4 below it');                       // a top department is its own name already; a deeper one adds its path
  assert.equal(lines[3].title, 'Operations › Support › Helpdesk · Unit');
  // the scope's own row is the page itself
  const mine = matrixLines(IN_OPERATIONS, columnsFor('status', IN_OPERATIONS));
  assert.deepEqual(mine.map((l) => [l.row.name, l.here, l.open]), [['Operations', true, null], ['Support', false, '/governance/documents/overview?dept=11'], ['Helpdesk', false, '/governance/documents/overview?dept=12']]);
  // a figure the library cannot filter on is text; the others are addresses
  const waiting = matrixLines(WHOLE, columnsFor('waiting', WHOLE))[0];
  assert.deepEqual(waiting.cells.map((c) => [c.value, c.href !== null]), [[0, true], [0, true], [0, true], [0, true], [2, false], [1, true]]);
  assert.equal(waiting.cells[5].href, '/governance/documents?dept=13&attn=late_acknowledgements');
  // the types, and the reviews
  assert.deepEqual(cells(matrixLines(WHOLE, columnsFor('type', WHOLE))[1]), [3, 0, 1, 1]);
  assert.deepEqual(cells(matrixLines(WHOLE, columnsFor('reviews', WHOLE))[1]), [1, 0, 1]);
  assert.deepEqual(cells(matrixLines(WHOLE, columnsFor('issues', WHOLE))[1]), [2, 1, 0, 1, 0, 1]);
  assert.equal(matrixLines(WHOLE, columnsFor('issues', WHOLE))[1].cells[5].href, '/governance/documents?dept=10&owner=none');
});

test('the totals are the top rows added up (a row counts everything under it), with the scope\'s own addresses', () => {
  const status = matrixTotals(WHOLE, columnsFor('status', WHOLE));
  assert.deepEqual(status.map((c) => c.value), [1, 1, 1, 0, 4]);
  assert.equal(status.reduce((n, c) => n + c.value, 0), WHOLE.totals.documents);
  assert.equal(status[4].href, '/governance/documents?status=published');                  // the whole organisation: no department in the address
  assert.deepEqual(matrixTotals(IN_OPERATIONS, columnsFor('status', IN_OPERATIONS)).map((c) => c.value), [1, 1, 1, 0, 2]);       // Operations alone: its row is the total
  assert.equal(matrixTotals(IN_OPERATIONS, columnsFor('status', IN_OPERATIONS))[4].href, '/governance/documents?dept=10&status=published');
  assert.deepEqual(matrixTotals(WHOLE, columnsFor('waiting', WHOLE)).map((c) => c.value), [1, 1, 1, 0, 2, 1]);
});

test('what is filed in a department itself is its figure less the figures of the departments directly under it', () => {
  const rows = IN_OPERATIONS.by_department;
  assert.equal(ownOf(rows, 0, (r) => r.documents), OPERATIONS.own);
  assert.equal(ownOf(rows, 1, (r) => r.documents), SUPPORT.own);
  assert.equal(ownOf(rows, 2, (r) => r.documents), 2);                                       // nothing under it
  assert.equal(ownOf(rows, 0, (r) => r.by_status.draft ?? 0), 1);
  assert.equal(ownOf(rows, 0, (r) => r.by_status.published ?? 0), 0);
  assert.equal(ownOf(rows, 0, (r) => r.waiting.review.pending), 0);                          // the review is Helpdesk's, counted in Support and in Operations
});

test('the CSV has every department and the columns given, in words of their groups, and a department named like a formula is text', () => {
  const text = matrixCsv(WHOLE, columnsFor('status', WHOLE));
  const lines = text.split('\r\n');
  assert.ok(text.startsWith('﻿Department,Path,Level,Owner,Documents,Filed in it,Status: Draft,Status: In review,Status: In approval,Status: Approved,Status: Published\r\n'));
  assert.equal(lines[2], 'Operations,Operations,Department,Tom,5,1,1,1,1,0,2');
  assert.equal(lines[4], 'Helpdesk,Operations > Support > Helpdesk,Unit,,2,2,0,1,1,0,0');
  assert.equal(lines[5], 'No department,,,,1,1,0,0,0,0,1');
  assert.equal(lines.length, 1 + 5 + 1);
  assert.equal(csvLabel(columnsFor('waiting', WHOLE)[1]), 'Waiting: Reviews late');
  const tricky = matrixCsv({ by_department: [row({ department_id: 1, name: '=cmd|\'/c calc\'!A1', owner: '@boss' })] }, []);
  assert.ok(tricky.includes('\'=cmd|\'/c calc\'!A1') && tricky.includes('\'@boss'));
  assert.equal(matrixCsv(WHOLE, columnsFor('all', WHOLE)).split('\r\n')[0].split(',').length, 6 + columnsFor('all', WHOLE).length);
});
