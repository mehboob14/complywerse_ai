// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryCalendar.test.ts"
// The Calendar: Overdue, the next twelve calendar months by next review date, Later, No review date; only documents that owe a review; today is passed in, so the dates are fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CALENDAR_MONTHS, buildCalendar, calendarAria, calendarEmpty, calendarLine, calendarShowAll, monthLabel, shortDay } from './libraryCalendar.ts';
import type { LibDoc } from './libraryModel.ts';

const NOW = new Date('2026-11-11T10:00:00Z');
const doc = (id: number, over: Partial<LibDoc> = {}): LibDoc => ({
  id, title: `Doc ${id}`, document_code: null, doc_type: 'policy', status: 'published', owner_id: 1, owner_name: 'Dana Okoro', department_id: null,
  next_review_date: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00', ...over,
});

test('the columns are Overdue and the next twelve calendar months from this one; Later and No review date only when something is in them', () => {
  const cal = buildCalendar([doc(1, { next_review_date: '2026-11-20T00:00:00' })], NOW);
  assert.equal(cal.columns.length, 1 + CALENDAR_MONTHS);
  assert.deepEqual(cal.columns.slice(0, 3).map((c) => [c.id, c.label, c.current]), [['overdue', 'Overdue', false], ['m2026-11', 'November 2026', true], ['m2026-12', 'December 2026', false]]);
  assert.equal(cal.columns[12].label, 'October 2027');                                // twelve months: this one and the eleven after it
  assert.ok(!cal.columns.some((c) => c.kind === 'later' || c.kind === 'none'));
});

test('a document goes in exactly one column: overdue by the library\'s rule (the instant has passed), else its month, else later, else no date', () => {
  const docs = [
    doc(1, { next_review_date: '2026-11-11T09:00:00' }),                              // an hour ago today: overdue (reviewState compares instants)
    doc(2, { next_review_date: '2026-11-11T18:00:00' }),                              // later today: due this month
    doc(3, { next_review_date: '2026-03-01T00:00:00' }),                              // long past: overdue, not in March
    doc(4, { next_review_date: '2026-12-01T00:00:00' }),
    doc(5, { next_review_date: '2027-10-31T23:00:00' }),                              // the last month of the horizon
    doc(6, { next_review_date: '2027-11-01T00:00:00' }),                              // one month past it: later
    doc(7, { next_review_date: null }),                                               // in force, no date
    doc(8, { status: 'approved', next_review_date: '2027-01-15T00:00:00' }),           // approved and waiting to be published owes a review too
  ];
  const cal = buildCalendar(docs, NOW);
  const at = (id: string) => cal.columns.find((c) => c.id === id)?.docs.map((d) => d.id);
  assert.deepEqual(at('overdue'), [3, 1]);                                            // the oldest date first
  assert.deepEqual(at('m2026-11'), [2]);
  assert.deepEqual(at('m2026-12'), [4]);
  assert.deepEqual(at('m2027-01'), [8]);
  assert.deepEqual(at('m2027-10'), [5]);
  assert.deepEqual(at('later'), [6]);
  assert.deepEqual(at('none'), [7]);
  assert.equal(cal.total, docs.length);
  assert.equal(cal.columns.reduce((n, c) => n + c.docs.length, 0), docs.length);
  assert.deepEqual(cal.columns.slice(-2).map((c) => c.kind), ['later', 'none']);
});

test('a document that owes no review (draft, expired, archived) is left out and counted', () => {
  const docs = [
    doc(1, { status: 'draft', next_review_date: '2026-11-20T00:00:00' }),
    doc(2, { status: 'expired', next_review_date: '2026-01-20T00:00:00' }),
    doc(3, { status: 'archived', next_review_date: '2026-12-20T00:00:00' }),
    doc(4, { next_review_date: '2026-11-20T00:00:00' }),
  ];
  const cal = buildCalendar(docs, NOW);
  assert.equal(cal.notOwed, 3);
  assert.equal(cal.total, 1);
});

test('a newer version on its way over a published one still owes its review (the version in force)', () => {
  const cal = buildCalendar([doc(1, { status: 'pending_review', version_in_force: '1.0', next_review_date: '2026-12-02T00:00:00' })], NOW);
  assert.equal(cal.columns.find((c) => c.id === 'm2026-12')?.docs.length, 1);
});

test('within a column the soonest date is first, ties by title; the year rolls over', () => {
  const docs = [
    doc(1, { title: 'B', next_review_date: '2027-01-10T00:00:00' }),
    doc(2, { title: 'A', next_review_date: '2027-01-10T00:00:00' }),
    doc(3, { title: 'C', next_review_date: '2027-01-02T00:00:00' }),
  ];
  const col = buildCalendar(docs, NOW).columns.find((c) => c.id === 'm2027-01');
  assert.deepEqual(col?.docs.map((d) => d.id), [3, 2, 1]);
  assert.equal(buildCalendar(docs, new Date('2026-12-31T23:59:00Z')).columns[1].id, 'm2026-12');
});

test('a calendar of nothing is still the twelve quiet months', () => {
  const cal = buildCalendar([], NOW);
  assert.equal(cal.total, 0);
  assert.equal(cal.columns.length, 13);
  assert.equal(calendarEmpty('month'), 'Nothing due');
  assert.equal(calendarEmpty('overdue'), 'Nothing overdue');
});

test('the line under a title says when and who: a date for a month, how late for an overdue one, the owner or "No owner"', () => {
  assert.equal(calendarLine(doc(1, { next_review_date: '2026-12-02T00:00:00' }), 'month', NOW), '2 Dec · Dana Okoro');
  assert.equal(calendarLine(doc(2, { next_review_date: '2026-11-01T00:00:00' }), 'overdue', NOW), '10 d overdue · Dana Okoro');
  assert.equal(calendarLine(doc(3, { next_review_date: '2028-02-29T00:00:00', owner_id: null, owner_name: null }), 'later', NOW), '29 Feb 2028 · No owner');
  assert.equal(calendarLine(doc(4, { owner_name: '  ' }), 'none', NOW), 'No owner');
});

test('words: the month, the short day, what a card is called for a screen reader, what "+N more" can set', () => {
  assert.equal(monthLabel(2026, 10), 'November 2026');
  assert.equal(shortDay(new Date('2026-03-05T23:59:00Z')), '5 Mar');
  assert.equal(calendarAria({ label: 'Overdue', docs: [1] }), 'Overdue, 1 document');
  assert.equal(calendarAria({ label: 'May 2027', docs: [] }), 'May 2027, 0 documents');
  assert.deepEqual(calendarShowAll({ kind: 'overdue' }), { review: ['overdue'] });
  assert.deepEqual(calendarShowAll({ kind: 'none' }), { review: ['unscheduled'] });
  assert.deepEqual(calendarShowAll({ kind: 'month' }), { group: 'review' });
  assert.deepEqual(calendarShowAll({ kind: 'later' }), { group: 'review' });
});
