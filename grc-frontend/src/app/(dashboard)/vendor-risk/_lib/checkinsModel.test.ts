// node --test "src/app/(dashboard)/vendor-risk/_lib/checkinsModel.test.ts"
// The Check-ins page's model: the views keep the server's states, the due date is said in words, the address reads what a reminder links to (?vendor=7), and a check-in is ready only when it is answered.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { CHECKIN_SCHEMA, SHOWS, cadence, ready, rowsFor, when, type CheckinRow } from './checkinsModel.ts';

const row = (state: CheckinRow['state'], id: number): CheckinRow => ({ vendor_id: id, name: `Supplier ${id}`, tier: 'high', owner: null, last: null, due_date: '2026-11-01', state, days: 0, can_check_in: true });
const rows = [row('overdue', 1), row('due_soon', 2), row('upcoming', 3), row('done', 4), row('overdue', 5)];

test('each view keeps the server\'s state; All keeps everything, in the order sent', () => {
  assert.deepEqual(rowsFor(rows, 'overdue').map((r) => r.vendor_id), [1, 5]);
  assert.deepEqual(rowsFor(rows, 'done').map((r) => r.vendor_id), [4]);
  assert.equal(rowsFor(rows, 'all').length, 5);
  assert.deepEqual(SHOWS.map((s) => s.key), ['overdue', 'due_soon', 'upcoming', 'done', 'all']);
});

test('the due date is said in words, with the plural right', () => {
  assert.equal(when(-1), '1 day overdue');
  assert.equal(when(-12), '12 days overdue');
  assert.equal(when(0), 'due today');
  assert.equal(when(1), 'in 1 day');
  assert.equal(when(30), 'in 30 days');
  assert.equal(cadence(365), 'a year');
  assert.equal(cadence(undefined), 'a year');
  assert.equal(cadence(180), 'every 180 days');
});

test('the address: a reminder\'s ?vendor=7 opens that supplier; the default is my overdue ones; junk is the default', () => {
  assert.deepEqual(readAddress(CHECKIN_SCHEMA, ''), { state: 'overdue', scope: 'mine', q: '', vendor: 0 });
  const s = readAddress(CHECKIN_SCHEMA, '?vendor=7&scope=all&state=all&q=acme');
  assert.deepEqual([s.vendor, s.scope, s.state, s.q], [7, 'all', 'all', 'acme']);
  assert.equal(readAddress(CHECKIN_SCHEMA, '?state=nonsense&scope=everyone&vendor=x').state, 'overdue');
  assert.equal(writeAddress(CHECKIN_SCHEMA, '?vendor=7', { state: 'overdue', scope: 'mine', q: '', vendor: 0 }), '');
});

test('a check-in is ready when all three questions are answered, a new owner is named if it changed hands, and a change is described', () => {
  const base = { stillOwner: true, newOwner: '' as const, changed: false, notes: '', contactOk: true };
  assert.equal(ready(base), true);
  assert.equal(ready({ ...base, stillOwner: null }), false);
  assert.equal(ready({ ...base, changed: null }), false);
  assert.equal(ready({ ...base, contactOk: null }), false);
  assert.equal(ready({ ...base, stillOwner: false }), false, 'someone else owns it: who?');
  assert.equal(ready({ ...base, stillOwner: false, newOwner: 4 }), true);
  assert.equal(ready({ ...base, changed: true, notes: 'new data' }), false, 'a change needs at least 10 characters');
  assert.equal(ready({ ...base, changed: true, notes: 'New data and a new country' }), true);
});
