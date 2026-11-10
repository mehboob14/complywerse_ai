// node --test "src/app/(dashboard)/reports/_library/libraryModel.test.ts"
// The Reports library's rules: what a row is, the facets and their live counts, the quick views, the search, the order, the chips, and the address (every old link still opens the right page).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countOf, evaluate } from '../../../../components/records/facetEngine.ts';
import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import {
  BANDS, DEFAULT_SORT, GONE, NO_FILTERS, filterChips, filterCount, indexLibrary, chosenOf, nextSort, orderedOptions, railOptions, removeChip, ruleOf, sortRows, toRows, updatedBand,
  type DatasetFacts, type Filters, type LibraryRow, type SavedItem,
} from './libraryModel.ts';
import { LIBRARY_SCHEMA, builderHref, drillHref, filtersOf, filtersPatch, legacyTarget, newReportHref, type LibraryAddress } from './libraryAddress.ts';

const NOW = new Date('2026-11-08T12:00:00Z');
const FACTS: Record<string, DatasetFacts> = {
  risks: { label: 'Risk Register', module: 'Risk Management', openable: true },
  controls: { label: 'Controls Library', module: 'Control Testing & Assurance', openable: true },
  vendors: { label: 'Vendors', module: 'Third-Party Risk', openable: false },
};
const ITEMS: SavedItem[] = [
  { id: 'rep_1', name: 'Open risks', dataset: 'risks', mine: true, shared: false, updatedAt: '2026-11-08T09:00:00' },
  { id: 'rep_2', name: 'Controls without evidence', description: 'for the audit', dataset: 'controls', mine: true, shared: true, updatedAt: '2026-11-03T09:00:00' },
  { id: 'rep_3', name: 'Vendor tiers', dataset: 'vendors', mine: false, shared: true, updatedAt: '2026-09-01T09:00:00', measures: [{ id: 'n' }] },
  { id: 'rep_4', name: '', dataset: 'removed_module', mine: true, updatedAt: null },
];
const STATE: Record<string, 'synced' | 'device' | 'refused'> = { rep_1: 'synced', rep_2: 'synced', rep_3: 'synced', rep_4: 'device' };
const rows = (): LibraryRow[] => toRows(ITEMS, (k) => FACTS[k], (id) => STATE[id]);

test('a row: the explorer number is the place in the list, a missing name reads "Untitled report", a module that is gone is said in words, never as a key', () => {
  const r = rows();
  assert.deepEqual(r.map((x) => x.id), [1, 2, 3, 4]);
  assert.equal(r[3].name, 'Untitled report');
  assert.equal(r[3].dataset, GONE.label);
  assert.equal(r[3].module, 'Not available');
  assert.equal(r[3].openable, false);
  assert.doesNotMatch(JSON.stringify(r[3]), /removed_module(?!")/, 'the key is kept for the link, not shown as a label');
  assert.deepEqual(r.map((x) => x.visibility), ['private', 'shared', 'shared_with_me', 'private']);
  assert.deepEqual(r.map((x) => x.summary), [false, false, true, false]);
  assert.equal(r[2].mine, false);
  assert.equal(r[2].openable, false, 'the person may not open the vendor module');
});

test('how long ago: a day, a week, a month, older; no date is the oldest; a naive server time is UTC', () => {
  assert.equal(updatedBand('2026-11-08T09:00:00', NOW), 'today');
  assert.equal(updatedBand('2026-11-03T09:00:00', NOW), 'week');
  assert.equal(updatedBand('2026-10-20T09:00:00', NOW), 'month');
  assert.equal(updatedBand('2026-09-01T09:00:00', NOW), 'older');
  assert.equal(updatedBand(null, NOW), 'older');
  assert.equal(updatedBand('not a date', NOW), 'older');
  assert.deepEqual(BANDS, ['today', 'week', 'month', 'older']);
});

test('the live counts: each option counts what choosing it would show with the other facets as they are', () => {
  const idx = indexLibrary(rows(), NOW);
  const none = evaluate(idx, chosenOf(NO_FILTERS), ruleOf(NO_FILTERS));
  assert.equal(none.matches.length, 4);
  assert.equal(countOf(none.counts, 'owner', 'mine'), 3);
  assert.equal(countOf(none.counts, 'owner', 'others'), 1);
  assert.equal(countOf(none.counts, 'sharing', 'shared'), 2, 'shared by me and shared with me');
  assert.equal(countOf(none.counts, 'module', 'Risk Management'), 1);
  const mine: Filters = { ...NO_FILTERS, owner: ['mine'] };
  const r = evaluate(idx, chosenOf(mine), ruleOf(mine));
  assert.deepEqual(r.matches.map((x) => x.slug), ['rep_1', 'rep_2', 'rep_4']);
  assert.equal(countOf(r.counts, 'owner', 'others'), 1, "a facet's own choice never empties its own list");
  assert.equal(countOf(r.counts, 'module', 'Third-Party Risk'), 0, 'the others report is not a "mine" report');
});

test('the quick views: Mine, Shared with me and Not saved yet (a report waiting on this device or refused)', () => {
  const idx = indexLibrary(rows(), NOW);
  const pick = (quick: Filters['quick']) => evaluate(idx, chosenOf({ ...NO_FILTERS, quick }), ruleOf({ ...NO_FILTERS, quick })).matches.map((x) => x.slug);
  assert.deepEqual(pick(null), ['rep_1', 'rep_2', 'rep_3', 'rep_4']);
  assert.deepEqual(pick('all'), ['rep_1', 'rep_2', 'rep_3', 'rep_4']);
  assert.deepEqual(pick('mine'), ['rep_1', 'rep_2', 'rep_4']);
  assert.deepEqual(pick('shared'), ['rep_3']);
  assert.deepEqual(pick('attention'), ['rep_4']);
});

test('the search finds words in the name, the description, the dataset and the module, ignoring case and accents, all words at once', () => {
  const idx = indexLibrary(rows(), NOW);
  const find = (q: string) => evaluate(idx, chosenOf({ ...NO_FILTERS, search: q }), ruleOf({ ...NO_FILTERS, search: q })).matches.map((x) => x.slug);
  assert.deepEqual(find('OPEN'), ['rep_1']);
  assert.deepEqual(find('audit'), ['rep_2']);
  assert.deepEqual(find('risk register'), ['rep_1']);
  assert.deepEqual(find('third-party'), ['rep_3']);
  assert.deepEqual(find('control evidence'), ['rep_2']);
  assert.deepEqual(find('zzz'), []);
  assert.deepEqual(find('   '), ['rep_1', 'rep_2', 'rep_3', 'rep_4']);
});

test('the order: last saved first by default, a report with no date last whichever way it runs, ties by name', () => {
  const r = rows();
  assert.deepEqual(sortRows(r, DEFAULT_SORT).map((x) => x.slug), ['rep_1', 'rep_2', 'rep_3', 'rep_4']);
  assert.deepEqual(sortRows(r, { key: 'updated', dir: 'asc' }).map((x) => x.slug), ['rep_3', 'rep_2', 'rep_1', 'rep_4']);
  assert.deepEqual(sortRows(r, { key: 'name', dir: 'asc' }).map((x) => x.name), ['Controls without evidence', 'Open risks', 'Untitled report', 'Vendor tiers']);
  assert.deepEqual(sortRows(r, { key: 'module', dir: 'asc' }).map((x) => x.slug), ['rep_2', 'rep_4', 'rep_1', 'rep_3']);
  assert.deepEqual(nextSort(DEFAULT_SORT, 'updated'), { key: 'updated', dir: 'asc' });
  assert.deepEqual(nextSort(DEFAULT_SORT, 'name'), { key: 'name', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
});

test('the rail lists the modules that have reports and any chosen one (dimmed), and the chips come off one by one', () => {
  const opts = railOptions(rows());
  assert.deepEqual(opts.module.map((o) => o.label), ['Control Testing & Assurance', 'Not available', 'Risk Management', 'Third-Party Risk']);
  assert.deepEqual(opts.owner.map((o) => o.label), ['Mine', 'Shared with me']);
  assert.deepEqual(orderedOptions(opts.module, ['Risk Management'], (v) => (v === 'Third-Party Risk' ? 0 : 1)).map((o) => o.value), ['Control Testing & Assurance', 'Not available', 'Risk Management']);
  assert.equal(orderedOptions(opts.module, [], () => 0).length, 4, 'nothing has a count: show them all rather than an empty list');
  const f: Filters = { search: ' risk ', module: ['Risk Management'], owner: ['mine'], sharing: [], updated: ['week'], quick: 'attention' };
  assert.equal(filterCount(f), 5);
  const chips = filterChips(f, opts);
  assert.deepEqual(chips.map((c) => c.label), ['Search: risk', 'Not saved yet', 'Module: Risk Management', 'Owner: Mine', 'Updated: Last 7 days']);
  assert.deepEqual(removeChip(f, chips[2]).module, []);
  assert.equal(removeChip(f, chips[0]).search, '');
  assert.equal(removeChip(f, chips[1]).quick, null);
  assert.equal(filterCount(NO_FILTERS), 0);
});

test('the address keeps the view: the defaults have the plain address, every filter round-trips, junk is the default', () => {
  const a = readAddress(LIBRARY_SCHEMA, '') as LibraryAddress;
  assert.deepEqual(filtersOf(a), NO_FILTERS);
  assert.deepEqual(a.sort, DEFAULT_SORT);
  const f: Filters = { search: 'risk', module: ['Risk Management'], owner: ['mine'], sharing: ['shared'], updated: ['week', 'month'], quick: 'attention' };
  const written = writeAddress(LIBRARY_SCHEMA, '', { ...a, ...filtersPatch(f), sort: { key: 'name', dir: 'asc' } } as never);
  assert.equal(written, 'q=risk&mod=Risk+Management&owner=mine&share=shared&upd=week%2Cmonth&quick=attention&sort=name%3Aasc');
  const back = readAddress(LIBRARY_SCHEMA, `?${written}`) as LibraryAddress;
  assert.deepEqual(filtersOf(back), f);
  assert.deepEqual(back.sort, { key: 'name', dir: 'asc' });
  const junk = readAddress(LIBRARY_SCHEMA, '?owner=x&upd=never&quick=zzz&sort=name:sideways') as LibraryAddress;
  assert.deepEqual(filtersOf(junk), NO_FILTERS);
  assert.deepEqual(junk.sort, DEFAULT_SORT);
  assert.equal(filtersOf(readAddress(LIBRARY_SCHEMA, '?quick=all') as LibraryAddress).quick, null, '"all" is no filter');
});

test('links into the builder: a saved report by its address, a new one by its module, a drill-through with its category; an id is encoded', () => {
  assert.equal(builderHref('rep_abc1'), '/reports/builder?id=rep_abc1');
  assert.equal(builderHref('a b&c'), '/reports/builder?id=a%20b%26c');
  assert.equal(newReportHref('risks'), '/reports/builder?dataset=risks');
  assert.equal(drillHref('rep_1'), '/reports/builder?id=rep_1');
  assert.equal(drillHref('rep_1', { col: 'status', value: 'Open & late' }), '/reports/builder?id=rep_1&drillCol=status&drillValue=Open+%26+late');
});

test('an old address of the library page forwards: ?edit=ID (with the drill), ?mode=new or build; the library itself is not forwarded', () => {
  assert.equal(legacyTarget('?edit=rep_1'), '/reports/builder?id=rep_1');
  assert.equal(legacyTarget('edit=rep_1&drillCol=status&drillValue=Open'), '/reports/builder?id=rep_1&drillCol=status&drillValue=Open');
  assert.equal(legacyTarget('?edit=rep_1&drillCol=status'), '/reports/builder?id=rep_1', 'a drill with no value is dropped');
  assert.equal(legacyTarget('?mode=new'), '/reports/builder?mode=new');
  assert.equal(legacyTarget('?mode=build'), '/reports/builder?mode=new');
  assert.equal(legacyTarget('?mode=other'), null);
  assert.equal(legacyTarget('?q=risk&sort=name:asc'), null);
  assert.equal(legacyTarget(''), null);
});
