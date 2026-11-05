// node --test "src/app/(dashboard)/governance/documents/overview/_chart.test.ts"
// What the graphs draw: one level of departments at a time (so no document is drawn twice), the series of each stack, the slices, the table a screen reader gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chartTable } from '../../../../../components/ui/ds/chartText.ts';
import { IN_OPERATIONS, WHOLE, row } from './_fixture.ts';
import { MAX_BARS, STATUS_COLOR, TYPE_COLORS, departmentStack, sliceTable, stackTable, statusBars, statusSeries, typeSeries, typeSlices, waitingStack } from './_chart.ts';

const names = (s: { rows: { name: string }[] }) => s.rows.map((r) => r.name);

test('every status has a colour of its own and the series are the steps of the flow, with a lapsed status only while it is there', () => {
  const series = statusSeries(WHOLE);
  assert.deepEqual(series.map((s) => s.label), ['Draft', 'In review', 'In approval', 'Approved', 'Published']);
  assert.equal(new Set(Object.values(STATUS_COLOR)).size, Object.keys(STATUS_COLOR).length, 'no two statuses share a colour');
  assert.ok(series.every((s) => /^#[0-9A-F]{6}$/i.test(s.color)));
  assert.equal(statusSeries({ by_status: [...WHOLE.by_status.slice(0, 5), { key: 'status:expired', status: 'expired', count: 1 }] }).length, 6);
  assert.deepEqual(typeSeries(WHOLE).map((s) => [s.label, s.color]), [['Policy', TYPE_COLORS[0]], ['Guideline', TYPE_COLORS[1]], ['Procedure', TYPE_COLORS[2]], ['Standard', TYPE_COLORS[3]]]);
});

test('the whole organisation: every top department, the biggest first, and "No department" last; the departments under one are not drawn again', () => {
  const stack = departmentStack(WHOLE, 'status');
  assert.deepEqual(names(stack), ['Operations', 'Finance', 'No department']);
  assert.deepEqual(stack.rows.map((r) => r.total), [5, 1, 1]);
  assert.equal(stack.rows.reduce((n, r) => n + r.total, 0), WHOLE.totals.documents);        // each document once
  assert.deepEqual(stack.rows[0].cells, { draft: 1, pending_review: 1, pending_approval: 1, approved: 0, published: 2 });
  assert.deepEqual(stack.rows.map((r) => r.value), ['10', '13', 'none']);
  assert.equal(stack.more, 0);
  const byType = departmentStack(WHOLE, 'type');
  assert.deepEqual(byType.rows[0].cells, { policy: 3, guideline: 0, procedure: 1, standard: 1 });
});

test('inside a department: what is filed in it itself first (its figure less the departments under it), then each department directly under it', () => {
  const stack = departmentStack(IN_OPERATIONS, 'status');
  assert.deepEqual(names(stack), ['Filed in Operations', 'Support']);
  assert.equal(stack.rows[0].value, null);
  assert.deepEqual(stack.rows[0].cells, { draft: 1, pending_review: 0, pending_approval: 0, approved: 0, published: 0 });
  assert.deepEqual(stack.rows[1].cells, { draft: 0, pending_review: 1, pending_approval: 1, approved: 0, published: 2 });         // Support counts Helpdesk too
  assert.equal(stack.rows.reduce((n, r) => n + r.total, 0), IN_OPERATIONS.totals.documents);
  const support = { ...IN_OPERATIONS, scope: { ...IN_OPERATIONS.scope, value: '11', department_id: 11 }, by_department: IN_OPERATIONS.by_department.slice(1).map((r) => ({ ...r, depth: r.depth - 1 })) };
  assert.deepEqual(names(departmentStack(support, 'type')), ['Filed in Support', 'Helpdesk']);
  const nobody = { ...IN_OPERATIONS, scope: { ...IN_OPERATIONS.scope, value: 'none', department_id: null }, by_department: [] };
  assert.deepEqual(departmentStack(nobody, 'status').rows, []);
});

test('a long list of departments is cut at the limit, the smallest left out and counted; "No department" always stays', () => {
  const many = Array.from({ length: 20 }, (_, i) => row({ department_id: 100 + i, name: `D${String(i).padStart(2, '0')}`, documents: 20 - i, by_status: { published: 20 - i } }));
  const data = { ...WHOLE, by_department: [...many, row({ department_id: null, name: 'No department', documents: 1, by_status: { published: 1 } })] };
  const stack = departmentStack(data, 'status');
  assert.equal(stack.rows.length, MAX_BARS);
  assert.equal(stack.rows[0].name, 'D00');                                                  // the biggest first
  assert.equal(stack.rows[MAX_BARS - 1].name, 'No department');
  assert.equal(stack.more, 20 - (MAX_BARS - 1));
});

test('waiting on people by department: the requests overdue and the ones not yet due, all kinds added', () => {
  const stack = waitingStack(WHOLE);
  assert.deepEqual(names(stack), ['Finance', 'Operations', 'No department']);                // two requests each: a tie is by name
  assert.deepEqual(stack.rows[0].cells, { overdue: 1, pending: 1 });                         // Finance: two acknowledgements asked, one late
  assert.deepEqual(stack.rows[1].cells, { overdue: 1, pending: 1 });                         // Operations: the review is late; the approval is waiting
  assert.deepEqual(stack.series.map((s) => s.label), ['Overdue', 'Not yet due']);
  assert.deepEqual(waitingStack(IN_OPERATIONS).rows[0].cells, { overdue: 0, pending: 0 });   // Operations' own documents are asked of nobody
});

test('the slices and bars carry where they open, and the table a screen reader reads has every number the chart draws', () => {
  const slices = typeSlices(WHOLE);
  assert.deepEqual(slices.map((s) => [s.label, s.value, s.href]), [
    ['Policy', 4, '/governance/documents?type=policy'], ['Guideline', 1, '/governance/documents?type=guideline'],
    ['Procedure', 1, '/governance/documents?type=procedure'], ['Standard', 1, '/governance/documents?type=standard'],
  ]);
  assert.deepEqual(statusBars(WHOLE).map((s) => [s.label, s.value]), [['Draft', 1], ['In review', 1], ['In approval', 1], ['Approved', 0], ['Published', 4]]);
  // a kind nobody has is no slice, and the kinds after it keep their colours: a slice and its bar in the stacks are one colour
  const gap = { ...WHOLE, by_type: [WHOLE.by_type[0], { ...WHOLE.by_type[1], count: 0 }, WHOLE.by_type[2]] };
  assert.deepEqual(typeSlices(gap).map((s) => [s.label, s.color]), [['Policy', TYPE_COLORS[0]], ['Procedure', TYPE_COLORS[2]]]);
  assert.deepEqual(typeSeries(gap).map((s) => s.color), [TYPE_COLORS[0], TYPE_COLORS[1], TYPE_COLORS[2]]);
  const table = chartTable(stackTable(departmentStack(WHOLE, 'status')));
  assert.deepEqual(table.columns, ['Department', 'Draft', 'In review', 'In approval', 'Approved', 'Published']);
  assert.deepEqual(table.rows[0], ['Operations', '1', '1', '1', '0', '2']);
  assert.deepEqual(chartTable(sliceTable(slices, 'Type')).rows[0], ['Policy', '4']);
});
