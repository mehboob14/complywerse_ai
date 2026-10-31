// node --test "src/app/(dashboard)/governance/reviews/reviewsModel.test.ts"
// What the Reviews page's address says and how its list is searched, put in order, merged and paged: pure rules, no React.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CALENDAR_PATH, REVIEWS_PATH, REVIEW_FETCH_LIMIT, actionTypeLabel, coverage, mergeAll, pageOf, parseLocation, reviewsHref, rowState, searchReviews, sortReviews, typeLabel,
  type ReviewDoc, type ReviewsLocation,
} from './reviewsModel.ts';

const doc = (id: number, o: Partial<ReviewDoc> = {}): ReviewDoc => ({
  id, document_code: `DOC-${id}`, title: `Document ${id}`, doc_type: 'policy', owner_name: 'Olivia Owner', review_cycle_months: 12, next_review_date: '2026-11-12T00:00:00',
  last_reviewed_at: null, days_until_review: 12, is_overdue: false, ...o,
});

const DEFAULT: ReviewsLocation = { section: 'documents', view: 'list', tab: 'overdue', month: null, day: null };

// ── the address ──────────────────────────────────────────────────────────────
test('the plain address is the default state: the documents section, the list, the Overdue tab, this month, no day', () => {
  assert.deepEqual(parseLocation(REVIEWS_PATH, ''), DEFAULT);
  assert.deepEqual(parseLocation(REVIEWS_PATH, null), DEFAULT);
  assert.deepEqual(parseLocation(null, undefined), DEFAULT);
  assert.deepEqual(parseLocation('/governance/reviews/', '?'), DEFAULT);
});

test('every param is read, in any case, and a value that is not one of the options is the default', () => {
  assert.deepEqual(parseLocation(REVIEWS_PATH, 'section=actions&view=calendar&tab=upcoming&month=2026-11&day=2026-11-12'),
    { section: 'actions', view: 'calendar', tab: 'upcoming', month: { year: 2026, month: 11 }, day: '2026-11-12' });
  assert.equal(parseLocation(REVIEWS_PATH, 'tab=ALL').tab, 'all');
  assert.equal(parseLocation(REVIEWS_PATH, 'tab= Upcoming ').tab, 'upcoming');
  assert.equal(parseLocation(REVIEWS_PATH, '?view=Calendar').view, 'calendar');
  const wrong = parseLocation(REVIEWS_PATH, 'section=attestations&view=grid&tab=constructor&month=2026-13&day=2026-02-30');
  assert.deepEqual(wrong, DEFAULT);                                 // the old "Attestations" section was never addressable; a made-up value opens the plain page
  assert.deepEqual(parseLocation(REVIEWS_PATH, 'month=Nov&day=12 Nov 2026'), DEFAULT);
  assert.deepEqual(parseLocation(REVIEWS_PATH, 'tab=__proto__&view=toString'), DEFAULT);
});

test('the calendar\'s own address is the page on its calendar view, unless view=list says otherwise', () => {
  assert.equal(parseLocation(CALENDAR_PATH, '').view, 'calendar');
  assert.equal(parseLocation('/governance/reviews/calendar/', '').view, 'calendar');
  assert.equal(parseLocation(CALENDAR_PATH, 'view=list').view, 'list');
  assert.equal(parseLocation(CALENDAR_PATH, 'month=2026-11&day=2026-11-12').day, '2026-11-12');
  assert.equal(parseLocation(REVIEWS_PATH, '').view, 'list');
});

test('the default state has the plain address; each choice adds its own param', () => {
  assert.equal(reviewsHref(DEFAULT), '/governance/reviews');
  assert.equal(reviewsHref({ ...DEFAULT, section: 'actions' }), '/governance/reviews?section=actions');
  assert.equal(reviewsHref({ ...DEFAULT, tab: 'upcoming' }), '/governance/reviews?tab=upcoming');
  assert.equal(reviewsHref({ ...DEFAULT, tab: 'all' }), '/governance/reviews?tab=all');
  assert.equal(reviewsHref({ ...DEFAULT, view: 'calendar' }), '/governance/reviews?view=calendar');
  assert.equal(reviewsHref({ ...DEFAULT, view: 'calendar', month: { year: 2026, month: 11 }, day: '2026-11-12' }), '/governance/reviews?view=calendar&month=2026-11&day=2026-11-12');
  assert.equal(reviewsHref({ ...DEFAULT, view: 'calendar', month: { year: 2026, month: 3 } }), '/governance/reviews?view=calendar&month=2026-03');
});

test('what does not apply to the state is left out: the list has no month or day, the Actions section nothing of the documents; the list tab is kept under the calendar', () => {
  assert.equal(reviewsHref({ ...DEFAULT, tab: 'upcoming', month: { year: 2026, month: 11 }, day: '2026-11-12' }), '/governance/reviews?tab=upcoming');
  assert.equal(reviewsHref({ ...DEFAULT, view: 'calendar', tab: 'all' }), '/governance/reviews?view=calendar&tab=all');    // so that the list is as it was left when the person comes back
  assert.equal(reviewsHref({ ...DEFAULT, view: 'calendar', tab: 'all', month: { year: 2026, month: 11 }, day: '2026-11-12' }), '/governance/reviews?view=calendar&tab=all&month=2026-11&day=2026-11-12');
  assert.equal(reviewsHref({ ...DEFAULT, section: 'actions', view: 'calendar', tab: 'all', month: { year: 2026, month: 11 }, day: '2026-11-12' }), '/governance/reviews?section=actions');
});

test('on the calendar\'s own address the calendar keeps it; choosing the list leaves it for the page\'s address', () => {
  const calendar: ReviewsLocation = { ...DEFAULT, view: 'calendar' };
  assert.equal(reviewsHref(calendar, CALENDAR_PATH), '/governance/reviews/calendar');
  assert.equal(reviewsHref({ ...calendar, month: { year: 2026, month: 11 }, day: '2026-11-12' }, CALENDAR_PATH), '/governance/reviews/calendar?month=2026-11&day=2026-11-12');
  assert.equal(reviewsHref(calendar, `${CALENDAR_PATH}/`), '/governance/reviews/calendar');
  assert.equal(reviewsHref(calendar, REVIEWS_PATH), '/governance/reviews?view=calendar');
  assert.equal(reviewsHref({ ...DEFAULT, view: 'list' }, CALENDAR_PATH), '/governance/reviews');
  assert.equal(reviewsHref({ ...DEFAULT, section: 'actions' }, CALENDAR_PATH), '/governance/reviews?section=actions');
});

test('an address read back gives the state it was made from', () => {
  const states: ReviewsLocation[] = [
    DEFAULT, { ...DEFAULT, section: 'actions' }, { ...DEFAULT, tab: 'upcoming' }, { ...DEFAULT, tab: 'all' }, { ...DEFAULT, view: 'calendar' },
    { ...DEFAULT, view: 'calendar', month: { year: 2028, month: 2 }, day: '2028-02-29' }, { ...DEFAULT, view: 'calendar', month: { year: 2026, month: 12 } },
    { ...DEFAULT, view: 'calendar', tab: 'upcoming', month: { year: 2026, month: 11 }, day: '2026-11-05' },
  ];
  for (const state of states) {
    for (const door of [REVIEWS_PATH, CALENDAR_PATH]) {
      const [path, search = ''] = reviewsHref(state, door).split('?');
      assert.deepEqual(parseLocation(path, search), state, `${door}: ${path}?${search}`);
    }
  }
});

// ── rows ─────────────────────────────────────────────────────────────────────
test('rowState is the server\'s own reading of a row: its flag, then under eight days away, else on track; no date, no state', () => {
  assert.equal(rowState(doc(1, { is_overdue: true, days_until_review: -91 })), 'overdue');
  assert.equal(rowState(doc(1, { is_overdue: true, days_until_review: -1 })), 'overdue');
  assert.equal(rowState(doc(1, { days_until_review: 0 })), 'due_soon');
  assert.equal(rowState(doc(1, { days_until_review: 7 })), 'due_soon');
  assert.equal(rowState(doc(1, { days_until_review: 8 })), 'on_track');
  assert.equal(rowState(doc(1, { days_until_review: 400 })), 'on_track');
  assert.equal(rowState(doc(1, { days_until_review: null })), 'on_track');
  assert.equal(rowState(doc(1, { next_review_date: null, days_until_review: null })), null);
  assert.equal(rowState(doc(1, { next_review_date: 'soon', is_overdue: true })), null);
});

test('mergeAll: the overdue and the upcoming rows as one list, a document once, earliest date first, no date last', () => {
  const overdue = [doc(1, { next_review_date: '2026-08-02T00:00:00', is_overdue: true }), doc(2, { next_review_date: '2026-10-11T00:00:00', is_overdue: true })];
  const upcoming = [doc(3, { next_review_date: '2026-11-05T00:00:00' }), doc(2, { next_review_date: '2026-10-11T00:00:00', is_overdue: true }), doc(4, { next_review_date: null })];
  assert.deepEqual(mergeAll(overdue, upcoming).map((d) => d.id), [1, 2, 3, 4]);
  assert.deepEqual(mergeAll([], []).map((d) => d.id), []);
  assert.deepEqual(mergeAll(upcoming, overdue).map((d) => d.id), [1, 2, 3, 4]);
  const input = [doc(9)];
  mergeAll(input, []);
  assert.equal(input.length, 1);
});

test('searchReviews: every word of the query, any case, in the title, code, owner or type; nothing typed leaves the list as it is', () => {
  const rows = [
    doc(1, { title: 'Information Security Policy', document_code: 'LIB-001', owner_name: 'Olivia Owner' }),
    doc(2, { title: 'Acceptable Use Policy', document_code: 'LIB-002', owner_name: 'Paula Publisher', doc_type: 'policy' }),
    doc(3, { title: 'Secure Configuration Standard', document_code: 'LIB-022', owner_name: null, doc_type: 'standard' }),
    doc(4, { title: 'Password Manager Guideline', document_code: null, owner_name: 'Bina Branch', doc_type: 'guideline' }),
  ];
  const ids = (q: string) => searchReviews(rows, q).map((d) => d.id);
  assert.deepEqual(ids(''), [1, 2, 3, 4]);
  assert.deepEqual(ids('   '), [1, 2, 3, 4]);
  assert.deepEqual(ids('policy'), [1, 2]);                          // the title and the type label say it
  assert.deepEqual(ids('POLICY olivia'), [1]);
  assert.deepEqual(ids('lib-022'), [3]);
  assert.deepEqual(ids('paula'), [2]);
  assert.deepEqual(ids('standard'), [3]);
  assert.deepEqual(ids('guideline bina'), [4]);
  assert.deepEqual(ids('nothing like this'), []);
  assert.deepEqual(ids('  secure   standard '), [3]);
  assert.notEqual(searchReviews(rows, ''), rows, 'a copy');
});

test('sortReviews: by the day written (not by a moment), by title in natural order, an empty cell last either way, ties in the order they came', () => {
  const rows = [
    doc(1, { title: 'Item 10', owner_name: 'Zed', next_review_date: '2026-11-12T00:00:00', last_reviewed_at: '2026-01-02T10:00:00', review_cycle_months: 12 }),
    doc(2, { title: 'item 2', owner_name: null, next_review_date: '2026-11-12T23:59:59', last_reviewed_at: null, review_cycle_months: 3 }),
    doc(3, { title: 'Item 1', owner_name: 'Amy', next_review_date: '2026-02-28T00:00:00', last_reviewed_at: '2025-12-31T23:30:00', review_cycle_months: 6 }),
  ];
  const ids = (key: string, dir: 'asc' | 'desc') => sortReviews(rows, { key, dir }).map((d) => d.id);
  assert.deepEqual(ids('title', 'asc'), [3, 2, 1]);
  assert.deepEqual(ids('title', 'desc'), [1, 2, 3]);
  assert.deepEqual(ids('next', 'asc'), [3, 1, 2]);                  // 12 Nov at midnight and 12 Nov at 23:59:59 are the same day: they keep the order given
  assert.deepEqual(ids('next', 'desc'), [1, 2, 3]);
  assert.deepEqual(ids('owner', 'asc'), [3, 1, 2]);                 // no owner last
  assert.deepEqual(ids('owner', 'desc'), [1, 3, 2]);                // and last again
  assert.deepEqual(ids('last', 'asc'), [3, 1, 2]);
  assert.deepEqual(ids('cycle', 'asc'), [2, 3, 1]);
  assert.deepEqual(sortReviews(rows, null).map((d) => d.id), [1, 2, 3]);
  assert.deepEqual(ids('unknown', 'asc'), [1, 2, 3]);
});

test('pageOf: 200 rows in pages of 25, the page clamped into range, a short last page', () => {
  const rows = Array.from({ length: 200 }, (_, i) => i + 1);
  assert.equal(pageOf(rows, 1, 25).length, 25);
  assert.deepEqual(pageOf(rows, 1, 25).slice(0, 2), [1, 2]);
  assert.deepEqual(pageOf(rows, 8, 25).slice(-1), [200]);
  assert.deepEqual(pageOf(rows, 9, 25), pageOf(rows, 8, 25), 'past the end is the last page');
  assert.deepEqual(pageOf(rows, 0, 25), pageOf(rows, 1, 25));
  assert.deepEqual(pageOf(rows, Number.NaN, 25), pageOf(rows, 1, 25));
  assert.equal(pageOf(rows.slice(0, 30), 2, 25).length, 5);
  assert.deepEqual(pageOf([], 3, 25), []);
  assert.equal(pageOf(rows, 1, 1000).length, 200);
});

test('coverage: a list the server has more of than it sent says so; the server\'s total is never below what was loaded', () => {
  assert.deepEqual(coverage(100, 200), { loaded: 100, total: 200, cut: true });
  assert.deepEqual(coverage(200, 200), { loaded: 200, total: 200, cut: false });
  assert.deepEqual(coverage(5, undefined), { loaded: 5, total: 5, cut: false });
  assert.deepEqual(coverage(5, null), { loaded: 5, total: 5, cut: false });
  assert.deepEqual(coverage(5, Number.NaN), { loaded: 5, total: 5, cut: false });
  assert.deepEqual(coverage(5, 3), { loaded: 5, total: 5, cut: false });
  assert.deepEqual(coverage(0, 0), { loaded: 0, total: 0, cut: false });
  assert.ok(REVIEW_FETCH_LIMIT > 100, 'the list asks for more than the server\'s default of 100');
});

test('the words: a document type and an action type, an unknown one made readable, never a prototype key', () => {
  assert.equal(typeLabel('policy'), 'Policy');
  assert.equal(typeLabel('framework'), 'Framework');
  assert.equal(typeLabel('risk_register'), 'Risk register');
  assert.equal(typeLabel(null), '—');
  assert.equal(typeLabel('constructor'), 'Constructor');
  assert.equal(actionTypeLabel('document_draft_created'), 'Document draft');
  assert.equal(actionTypeLabel('committee_action'), 'Committee action');
  assert.equal(actionTypeLabel('some_new_action'), 'Some new action');
  assert.equal(actionTypeLabel('constructor'), 'Constructor');
  assert.equal(actionTypeLabel(undefined), '—');
});
