// node --test "src/app/(dashboard)/vendor-risk/_lib/attentionModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DID, EMPTY, FORM_WORDS, SNOOZE_DEFAULT_DAYS, SNOOZE_MAX_DAYS, aboutOf, didWhat, perCondition, snoozeDay } from './attentionModel.ts';

test('every action says what was done, in the words of the history and of the line after it', () => {
  assert.deepEqual(Object.keys(DID).sort(), ['assign', 'close', 'note', 'reopen', 'snooze', 'unsnooze']);
  assert.equal(didWhat({ action: 'note', assignee_name: null }), 'added a note');
  assert.equal(didWhat({ action: 'assign', assignee_name: 'Sam Ali' }), 'assigned it to Sam Ali');
  assert.equal(didWhat({ action: 'assign', assignee_name: null }), 'unassigned it');
});

test('the four forms each have a title, a field and a button; the three views each say what an empty list means', () => {
  for (const form of ['note', 'assign', 'snooze', 'close'] as const) {
    const w = FORM_WORDS[form];
    assert.ok(w.title && w.field && w.submit, form);
  }
  assert.deepEqual(Object.keys(EMPTY).sort(), ['closed', 'open', 'snoozed']);
});

test('a snooze runs from tomorrow to a year from today on the UTC calendar, a week by default', () => {
  const now = new Date('2026-11-08T23:30:00Z');
  assert.equal(snoozeDay(1, now), '2026-11-09');
  assert.equal(snoozeDay(SNOOZE_DEFAULT_DAYS, now), '2026-11-15');
  assert.equal(snoozeDay(SNOOZE_MAX_DAYS, now), '2027-11-08');
  assert.equal(snoozeDay(30, new Date('2026-12-15T00:00:00Z')), '2027-01-14');
});

test('the filter chips count each condition of the list shown', () => {
  assert.deepEqual(perCondition([{ condition: 'a' }, { condition: 'b' }, { condition: 'a' }]), { a: 2, b: 1 });
  assert.deepEqual(perCondition([]), {});
});

test('the pill of a row says what the item is about in one word, and a record type nobody listed reads Vendor', () => {
  assert.deepEqual(['finding', 'acceptance', 'contract', 'obligation', 'action', 'checkin', 'supplier_request'].map(aboutOf), ['Finding', 'Finding', 'Contract', 'Contract', 'Action', 'Check-in', 'Supplier']);
  assert.equal(aboutOf('brand_new'), 'Vendor');
});
