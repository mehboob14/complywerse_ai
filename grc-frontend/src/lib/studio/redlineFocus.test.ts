import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusRows } from './redlineFocus.ts';
import type { RedlineRow } from './api';

const row = (status: RedlineRow['status'], segments: [string, string][], kind: RedlineRow['kind'] = 'paragraph'): RedlineRow =>
  ({ status, kind, level: 0, ordered: false, base_index: null, cur_index: null, format_only: false, segments: segments as RedlineRow['segments'] });

test('the card picks its own rows out of all the changes an accept made, not the others', () => {
  const rows = [
    row('equal', [['equal', 'Purpose']], 'heading'),
    row('modified', [['equal', 'Accounts are reviewed '], ['delete', 'every year'], ['insert', 'monthly'], ['equal', '.']]),
    row('inserted', [['insert', 'Exceptions need the CISO’s approval.']]),
    row('deleted', [['delete', 'Old wording   that went.']]),
  ];
  assert.deepEqual(Array.from(focusRows(rows, { after: ['Accounts are reviewed monthly.'], before: ['Accounts are reviewed every year.'] })), [1]);
  assert.deepEqual(Array.from(focusRows(rows, { after: ['Exceptions need the CISO’s approval.'], before: [] })), [2]);
  assert.deepEqual(Array.from(focusRows(rows, { after: [], before: ['Old wording that went.'] })), [3]);     // white space does not matter
  assert.equal(focusRows(rows, undefined).size, 0);
  assert.equal(focusRows(rows, { after: ['Purpose'], before: [] }).size, 0);                         // an unchanged block is never the change
});

test('a long block is found by the start the card keeps, and a table by its cells', () => {
  const long = 'word '.repeat(300).trim();
  const rows = [
    row('inserted', [['insert', long]]),
    { ...row('inserted', [], 'table'), table: [{ status: 'inserted', cells: [[['insert', 'Role']], [['insert', 'Owner']]] }, { status: 'inserted', cells: [[['insert', 'CISO']], [['insert', 'Approves']]] }] } as RedlineRow,
  ];
  assert.deepEqual(Array.from(focusRows(rows, { after: [long.slice(0, 600)], before: [] })), [0]);
  assert.deepEqual(Array.from(focusRows(rows, { after: ['Role | Owner | CISO | Approves'], before: [] })), [1]);
  assert.equal(focusRows(rows, { after: [long.slice(0, 100)], before: [] }).size, 0);               // a short text must match whole
});
