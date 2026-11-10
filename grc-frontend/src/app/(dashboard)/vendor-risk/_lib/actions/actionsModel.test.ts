// node --test "src/app/(dashboard)/vendor-risk/_lib/actions/actionsModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EMPTY, STATES, errText, stateOptions, whenLabel } from './actionsModel.ts';

const TODAY = new Date(2026, 10, 8, 10, 0, 0);          // 8 Nov 2026, the viewer's own day

test('a planned action says its day in words: in N days, today, N days overdue; a finished one says just the day', () => {
  assert.equal(whenLabel({ due_on: '2026-11-12', status: 'scheduled' }, TODAY), '12 Nov 2026 · in 4 days');
  assert.equal(whenLabel({ due_on: '2026-11-09', status: 'scheduled' }, TODAY), '9 Nov 2026 · in 1 day');
  assert.equal(whenLabel({ due_on: '2026-11-08', status: 'scheduled' }, TODAY), '8 Nov 2026 · today');
  assert.equal(whenLabel({ due_on: '2026-11-06', status: 'scheduled' }, TODAY), '6 Nov 2026 · 2 days overdue');
  assert.equal(whenLabel({ due_on: '2026-11-07', status: 'scheduled' }, TODAY), '7 Nov 2026 · 1 day overdue');
  for (const status of ['done', 'failed', 'cancelled'] as const) assert.equal(whenLabel({ due_on: '2026-11-06', status }, TODAY), '6 Nov 2026');
  assert.equal(whenLabel({ due_on: '', status: 'scheduled' }, TODAY), '—', 'no day recorded is a dash, never "Invalid Date"');
});

test('the four states keep their order, and only "Due now" and "Could not happen" carry a count', () => {
  assert.deepEqual(STATES.map((s) => s.value), ['due', 'open', 'failed', 'done']);
  assert.deepEqual(stateOptions({ due: 3, failed: 12 }).map((o) => o.label), ['Due now 3', 'All planned', 'Could not happen 12', 'Done']);
  assert.deepEqual(stateOptions({ due: 0, failed: 0 }).map((o) => o.label), ['Due now', 'All planned', 'Could not happen', 'Done']);
  assert.deepEqual(stateOptions(undefined).map((o) => o.label), ['Due now', 'All planned', 'Could not happen', 'Done']);
  assert.deepEqual(Object.keys(EMPTY).sort(), ['done', 'due', 'failed', 'open']);
});

test('a failure is said in the server\'s words, else in the page\'s own', () => {
  assert.equal(errText({ response: { data: { detail: 'The day has passed.' }, status: 400 } }, 'Try again.'), 'The day has passed.');
  assert.equal(errText(new Error('x'), 'Try again.'), 'Try again.');
});
