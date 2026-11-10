// node --test "src/app/(dashboard)/reports/_reports/csvReport.test.ts"
// The builder's CSV (P-R8): a cell a person typed that begins with = + - @ is written as text, numbers stay numbers, the file is Excel-ready.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportCsv } from './csvReport.ts';
import type { ColumnDef } from './types.ts';

const cols: ColumnDef[] = [
  { key: 'title', label: 'Title' },
  { key: 'score', label: 'Residual score', type: 'number' },
  { key: 'status', label: 'Status', type: 'badge' },
];

test('a title that begins with a formula character is written as text', () => {
  const csv = reportCsv(cols, [
    { title: '=HYPERLINK("http://example.test","x")', score: 12, status: 'Open' },
    { title: '+1 call', score: 3, status: 'Open' },
    { title: '-cmd', score: 4, status: 'Open' },
    { title: '@SUM(A1)', score: 5, status: 'Open' },
  ]);
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Title,Residual score,Status');
  assert.equal(lines[1], `"'=HYPERLINK(""http://example.test"",""x"")",12,Open`);
  assert.equal(lines[2], "'+1 call,3,Open");
  assert.equal(lines[3], "'-cmd,4,Open");
  assert.equal(lines[4], "'@SUM(A1),5,Open");
});

test('a number stays a number, even a negative one; a comma or a line break is quoted; the file starts with a byte-order mark', () => {
  const csv = reportCsv(cols, [{ title: 'Plain, with comma', score: -5, status: 'Line\nbreak' }]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('"Plain, with comma",-5,"Line\nbreak"'));
});

test('a blank number cell is empty, not 0', () => {
  const csv = reportCsv(cols, [{ title: 'No score', score: null, status: '' }]);
  assert.ok(csv.includes('No score,'));
  assert.ok(!/No score,0/.test(csv));
});
