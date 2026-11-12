// node --test "src/app/(dashboard)/governance/_overview/docs/_chart.test.ts"
// What the graphs draw: one level of departments at a time (so no document is drawn twice), the series of each stack and their colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OTHER, SERIES, STATUS } from '../../../../../components/overview/charts/palette.ts';
import { IN_OPERATIONS, WHOLE, row } from './_fixture.ts';
import { MAX_BARS, STATUS_COLOR, TYPE_COLORS, capStack, departmentStack, statusSeries, typeSeries, waitingStack } from './_chart.ts';

const names = (s: { rows: { name: string }[] }) => s.rows.map((r) => r.name);

test('every status has a colour of its own and the series are the steps of the flow, with a lapsed status only while it is there', () => {
  const series = statusSeries(WHOLE);
  assert.deepEqual(series.map((s) => s.label), ['Draft', 'In review', 'In approval', 'Approved', 'Published']);
  assert.equal(new Set(Object.values(STATUS_COLOR)).size, Object.keys(STATUS_COLOR).length, 'no two statuses share a colour');
  assert.ok(series.every((s) => Object.values(STATUS).concat(SERIES as never, OTHER as never).includes(s.color as never)), 'the colours are those of the kit palette, none written here');
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

test('the Summary draws the biggest five departments, ranked by size with a tie by name, and counts the ones it leaves for the Departments view', () => {
  const many = Array.from({ length: 9 }, (_, i) => row({ department_id: 100 + i, name: `D${i}`, documents: 1 + (i % 3), by_status: { published: 1 + (i % 3) } }));
  const stack = departmentStack({ ...WHOLE, by_department: many }, 'status');
  const top = capStack(stack, 5);
  assert.equal(top.rows.length, 5);
  assert.deepEqual(top.rows.map((r) => r.total), [3, 3, 3, 2, 2]);
  assert.deepEqual(top.rows.slice(0, 3).map((r) => r.name), ['D2', 'D5', 'D8'], 'a tie is by name');
  assert.equal(top.more, 4);
  assert.deepEqual(capStack(departmentStack(WHOLE, 'status'), 5).rows.length, 3, 'fewer departments than the cap: all of them, none left out');
  assert.equal(capStack(departmentStack(WHOLE, 'status'), 5).more, 0);
  assert.equal(capStack(stack, 0).rows.length, 1, 'never an empty chart because of a bad cap');
});
