// node --test "src/app/(dashboard)/tasks/_register/taskExport.test.ts"
// The register's export (taskExport.ts): a spreadsheet cannot run a task's title as a formula, quotes and line breaks survive, every task is a line, and the name says what was exported.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RegisterTask } from '../taskRecord.ts';
import { HEADER, cell, exportName, toCsv } from './taskExport.ts';

const task = (patch: Partial<RegisterTask>): RegisterTask => ({
  id: 1, title: 'T', source: 'Manual', source_module: null, source_entity_type: null, priority: 'High', status: 'Open', category: 'Other', assigned_owner_id: 5,
  assigned_owner: { id: 5, display_name: 'Ann' }, assignees: [{ id: 5, display_name: 'Ann' }, { id: 6, display_name: 'Bo' }], reviewer_id: null, reviewer: null, created_by_id: 2, created_by: { id: 2, display_name: 'Cy' },
  due_date: '2026-11-12T00:00:00', sla_status: 'On Track', completed_at: null, created_at: '2026-10-30T08:15:00', updated_at: null, ...patch,
});

test('a cell that would be a formula is written as text; commas, quotes and line breaks are quoted', () => {
  assert.equal(cell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  for (const bad of ['+1', '-2', '@SUM(A1)', '=1+1']) assert.ok(cell(bad).startsWith("'"), bad);
  assert.equal(cell('plain'), 'plain');
  assert.equal(cell('a, b'), '"a, b"');
  assert.equal(cell('say "hi"'), '"say ""hi"""');
  assert.equal(cell('two\nlines'), '"two\nlines"');
  assert.equal(cell(null), '');
  assert.equal(cell(0), '0');
  assert.equal(cell('Q4 - plan'), 'Q4 - plan', 'a dash inside is not a formula');
});

test('every task is one line under the header, with the owners together and the dates as days', () => {
  const csv = toCsv([task({}), task({ id: 2, title: '=cmd|\' /C calc\'!A0', assignees: [], assigned_owner: null, due_date: null, approval_required: true, approval_status: 'Pending', sub_task_total: 4, sub_task_done: 1, comment_count: 2 })]);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], HEADER.join(','));
  assert.equal(lines[1], 'T,Open,High,Task,Manual,Other,Ann; Bo,,Cy,2026-10-30,2026-11-12,On Track,Not needed,0,0,0');
  assert.ok(lines[2].startsWith("'=cmd|"), lines[2]);
  assert.ok(lines[2].endsWith(',,Cy,2026-10-30,,On Track,Pending,1,4,2'), lines[2]);
});

test('the file name says what it holds', () => {
  assert.equal(exportName('2026-11-10', 184, false), 'tasks-2026-11-10-184.csv');
  assert.equal(exportName('2026-11-10', 3, true), 'tasks-selected-2026-11-10-3.csv');
});
