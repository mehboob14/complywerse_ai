// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryExpiry.test.ts"
// The optional "Expiring in 30 days" filter (`?expiry=30d`): what it counts (the Governance overview's own `expiring_30d`), how it is read from and written to the
// address, its chip, and that with it OFF nothing else moves (libraryGolden.test.ts holds the whole library to the answers of the rules before it existed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  BUILT_IN_VIEWS, EXPIRY_PARAM, NO_FILTERS, DEFAULT_SORT, expiringSoon, filterCount, fromParams, isFiltering, matchesFilters, sameState, toParams, viewMatching,
  withLibraryParams, type Filters, type LibDoc, type MatchContext,
} from './libraryModel.ts';
import { EXPIRING_LABEL, filterChips, removeChip, type FilterOptions } from './libraryFiltersLogic.ts';
import { loadViews, saveViews, type KeyValueStore } from './libraryPrefs.ts';

const NOW = new Date('2026-10-31T09:00:00Z');
const DAY = 86_400_000;
const at = (ms: number) => new Date(ms).toISOString().slice(0, 23);               // naive UTC with milliseconds, as the server writes it (isoformat keeps the fraction)

// ── the server's rule, restated from the fields the server stores ────────────────────────────────────────────────────────────────────────
// dashboard.py, scorecard: (d.status == "approved" or in_force_number(d)) and d.expiry_date and now <= d.expiry_date <= now + timedelta(days=30)
// permissions.in_force_number: published -> current_version or "1.0"; ON_ITS_WAY (draft, pending_review, pending_approval, approved, review_required) -> published_version
const ON_ITS_WAY = ['draft', 'pending_review', 'pending_approval', 'approved', 'review_required'];
const serverInForce = (s: { status: string; current_version?: string | null; published_version?: string | null }) =>
  s.status === 'published' ? (s.current_version || '1.0') : ON_ITS_WAY.includes(s.status) ? (s.published_version || null) : null;
const serverCounts = (s: { status: string; current_version?: string | null; published_version?: string | null; expiry: number | null }, now: number) =>
  (s.status === 'approved' || !!serverInForce(s)) && s.expiry != null && now <= s.expiry && s.expiry <= now + 30 * DAY;

const STATUSES = ['draft', 'pending_review', 'pending_approval', 'approved', 'published', 'expired', 'archived', 'exception_applied', 'review_required'];
const OFFSETS = [-40 * DAY, -DAY, -1000, -1, 0, 1, 1000, DAY, 15 * DAY, 30 * DAY - 1, 30 * DAY, 30 * DAY + 1, 31 * DAY, 400 * DAY, null];

test('it counts what the overview counts: approved or in force, an expiry date from now to 30 days ahead, as instants', () => {
  let checked = 0;
  for (const status of STATUSES) {
    for (const published_version of [null, '', '1.0']) {
      for (const current_version of [null, '2.0']) {
        for (const off of OFFSETS) {
          const stored = { status, current_version, published_version, expiry: off == null ? null : NOW.getTime() + off };
          const row: Pick<LibDoc, 'status' | 'version_in_force' | 'expiry_date'> = { status, version_in_force: serverInForce(stored), expiry_date: stored.expiry == null ? null : at(stored.expiry) };
          assert.equal(expiringSoon(row, NOW), serverCounts(stored, NOW.getTime()), JSON.stringify({ status, published_version, current_version, off }));
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, STATUSES.length * 3 * 2 * OFFSETS.length);
});

test('the edges: this very moment and 30 days ahead are in, a second earlier or later is out, a lapsed or missing or unreadable date is out', () => {
  const doc = (expiry_date: string | null, status = 'published') => ({ status, version_in_force: status === 'published' ? '1.0' : null, expiry_date });
  assert.equal(expiringSoon(doc(at(NOW.getTime())), NOW), true);
  assert.equal(expiringSoon(doc(at(NOW.getTime() + 30 * DAY)), NOW), true);
  assert.equal(expiringSoon(doc(at(NOW.getTime() + 30 * DAY + 1000)), NOW), false);
  assert.equal(expiringSoon(doc(at(NOW.getTime() - 1000)), NOW), false);              // lapsed a second ago: expired, not expiring
  assert.equal(expiringSoon(doc(null), NOW), false);
  assert.equal(expiringSoon(doc(''), NOW), false);
  assert.equal(expiringSoon(doc('not a date'), NOW), false);
  assert.equal(expiringSoon({ status: 'approved', version_in_force: null, expiry_date: at(NOW.getTime() + DAY) }, NOW), true);                 // approved, not yet published
  assert.equal(expiringSoon({ status: 'draft', version_in_force: null, expiry_date: at(NOW.getTime() + DAY) }, NOW), false);                    // a draft owes nothing
  assert.equal(expiringSoon({ status: 'draft', version_in_force: '1.0', expiry_date: at(NOW.getTime() + DAY) }, NOW), true);                    // a new version on its way over a published one
  assert.equal(expiringSoon({ status: 'archived', version_in_force: null, expiry_date: at(NOW.getTime() + DAY) }, NOW), false);
  assert.equal(expiringSoon({ status: 'published', version_in_force: '1.0', expiry_date: `${at(NOW.getTime() + DAY)}Z` }, NOW), true);       // a zone on the text changes nothing
});

test('the rule is the one the server writes: the overview counter line has not changed', () => {
  // Read when the backend is beside the frontend (as status.test.ts reads its lists). If the counter's definition changes, this fails until the filter follows.
  const url = new URL('../../../../../../../backend/grc/modules/governance/routers/dashboard.py', import.meta.url);
  if (!existsSync(url)) return;
  const squashed = readFileSync(url, 'utf8').replace(/\s+/g, ' ');
  assert.ok(squashed.includes('"expiring_30d": sum(1 for d in docs if (d.status == "approved" or in_force_number(d)) and d.expiry_date and now <= d.expiry_date <= now + timedelta(days=30))'),
    'dashboard.py counts expiring_30d another way: change expiringSoon in libraryModel.ts to match it');
});

// ── the address, the filter list, the chip ────────────────────────────────────────────────────────────────────────────────────────────────
const q = (s: string) => new URLSearchParams(s);

test('`?expiry=30d` turns it on, anything else leaves it off, and it is written back as the same one parameter', () => {
  assert.equal(fromParams(q('expiry=30d')).filters.expiring, true);
  for (const off of ['', 'expiry=', 'expiry=7d', 'expiry=30', 'expiry=30D', 'expiry=true', 'expiry=30d,7d']) assert.equal(fromParams(q(off)).filters.expiring, false, off);
  assert.equal(EXPIRY_PARAM, '30d');
  assert.equal(toParams(fromParams(q('expiry=30d'))).toString(), 'expiry=30d');
  assert.equal(toParams({ filters: { ...NO_FILTERS, expiring: true, mine: true, types: ['policy'] }, sort: { key: 'review', dir: 'asc' } }).toString(), 'type=policy&mine=1&expiry=30d&sort=review%3Aasc');
  assert.equal(toParams({ filters: NO_FILTERS, sort: DEFAULT_SORT }).toString(), '');                              // off: no parameter, the address is as bare as it was
  // the page's own keys are replaced, a foreign key (the Studio's "+ Draft" link) is kept, and the open document and the layout are written as before
  const kept = withLibraryParams(q('aiDraftTitle=x&expiry=30d&q=old&open=3'), { filters: { ...NO_FILTERS, search: 'new' }, sort: DEFAULT_SORT }, 9, 'folders');
  assert.equal(kept.toString(), 'aiDraftTitle=x&q=new&open=9&view=folders');                                         // expiry is gone because the state says it is off
  assert.equal(withLibraryParams(q('aiDraftTitle=x'), { filters: { ...NO_FILTERS, expiring: true }, sort: DEFAULT_SORT }, null).toString(), 'aiDraftTitle=x&expiry=30d');
});

test('turning it on counts as one filter, is a view of its own, and does not change any view that was saved without it', () => {
  assert.equal(filterCount({ ...NO_FILTERS, expiring: true }), 1);
  assert.equal(filterCount({ ...NO_FILTERS, expiring: true, mine: true, search: 'x' }), 3);
  assert.equal(isFiltering({ ...NO_FILTERS, expiring: true }), true);
  assert.equal(isFiltering(NO_FILTERS), false);
  assert.equal(sameState({ filters: { ...NO_FILTERS, expiring: true }, sort: DEFAULT_SORT }, { filters: NO_FILTERS, sort: DEFAULT_SORT }), false);
  assert.equal(viewMatching(BUILT_IN_VIEWS, { filters: { ...NO_FILTERS, expiring: true }, sort: DEFAULT_SORT }), null);              // no built-in view is for it
  assert.equal(viewMatching(BUILT_IN_VIEWS, { filters: NO_FILTERS, sort: DEFAULT_SORT })?.id, 'all');                                  // and "All documents" is still the plain state
  // a view saved by the page before the filter existed loads as it was, and a saved view that has the filter keeps it through the person's browser storage
  const mem = new Map<string, string>();
  const store: KeyValueStore = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } };
  store.setItem('k', JSON.stringify([{ id: 'old', name: 'Old one', query: 'type=policy&review=overdue&sort=title:asc' }, { id: 'new', name: 'Lapsing', query: 'expiry=30d&type=policy' }]));
  const views = loadViews(store, 'k');
  assert.equal(views[0].state.filters.expiring, false);
  assert.equal(toParams(views[0].state).toString(), 'type=policy&review=overdue&sort=title%3Aasc');
  assert.equal(views[1].state.filters.expiring, true);
  saveViews(store, 'k', views);
  assert.deepEqual(JSON.parse(store.getItem('k') as string), [{ id: 'old', name: 'Old one', query: 'type=policy&review=overdue&sort=title%3Aasc' }, { id: 'new', name: 'Lapsing', query: 'type=policy&expiry=30d' }]);
});

const OPTIONS: FilterOptions = { types: [], statuses: [], owners: [], departments: [], frameworks: [], classifications: [] };

test('its chip says "Expiring in 30 days", sits before the search chip, and comes off by itself', () => {
  assert.equal(EXPIRING_LABEL, 'Expiring in 30 days');
  const on: Filters = { ...NO_FILTERS, expiring: true, search: 'data', mine: true, types: ['policy'] };
  assert.deepEqual(filterChips(on, OPTIONS).map((c) => c.label), ['Type: policy', 'Expiring in 30 days', 'Search: “data”', 'My documents']);
  const chip = filterChips(on, OPTIONS).find((c) => c.facet === 'expiring');
  assert.ok(chip);
  assert.deepEqual(removeChip(on, chip), { ...on, expiring: false });
  assert.deepEqual(filterChips(NO_FILTERS, OPTIONS), []);
});

// ── what it keeps ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ctx: MatchContext = { departments: {}, frameworks: {}, coverage: {}, me: 1, now: NOW };
const doc = (id: number, over: Partial<LibDoc>): LibDoc => ({
  id, title: `Doc ${id}`, document_code: null, doc_type: 'policy', status: 'published', owner_id: 1, owner_name: 'A', department_id: null, next_review_date: null,
  version_in_force: '1.0', current_version: '1.0', created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00', expiry_date: null, ...over,
});

test('on, it keeps only the expiring documents and combines with every other filter; off, it keeps everything the others keep', () => {
  const docs = [
    doc(1, { expiry_date: at(NOW.getTime() + 5 * DAY) }),
    doc(2, { expiry_date: at(NOW.getTime() + 45 * DAY) }),
    doc(3, { expiry_date: at(NOW.getTime() - 5 * DAY) }),
    doc(4, { expiry_date: at(NOW.getTime() + 5 * DAY), status: 'approved', version_in_force: null }),
    doc(5, { expiry_date: at(NOW.getTime() + 5 * DAY), status: 'draft', version_in_force: null }),
    doc(6, { expiry_date: at(NOW.getTime() + 5 * DAY), doc_type: 'standard' }),
    doc(7, { expiry_date: null }),
  ];
  const ids = (f: Partial<Filters>) => docs.filter((d) => matchesFilters(d, { ...NO_FILTERS, ...f }, ctx)).map((d) => d.id);
  assert.deepEqual(ids({}), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ids({ expiring: false }), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ids({ expiring: true }), [1, 4, 6]);
  assert.deepEqual(ids({ expiring: true, types: ['policy'] }), [1, 4]);
  assert.deepEqual(ids({ expiring: true, statuses: ['approved'] }), [4]);
  assert.deepEqual(ids({ expiring: true, search: 'doc 6' }), [6]);
  assert.deepEqual(ids({ expiring: true, mine: true }), [1, 4, 6]);
  assert.deepEqual(ids({ expiring: true, statuses: ['draft'] }), []);
});
