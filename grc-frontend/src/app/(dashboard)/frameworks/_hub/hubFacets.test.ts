// node --test "src/app/(dashboard)/frameworks/_hub/hubFacets.test.ts"
// The hub's facets and its address: the engine's matches and live counts equal the plain filter, the rail lists only options somebody has (a chosen one stays), the chips say what is on and
// each removes only itself, and the address round-trips (a link opens the same view; a facet of the other register is no filter here; an old overview link opens the drawer).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countOf, evaluate } from '../../../../components/records/facetEngine.ts';
import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import {
  FACET_TITLE, NO_FILTERS, RAIL, authorityKey, bandKey, chosenOf, filterChips, filterCount, indexHub, isFiltering, orderedOptions, railOptions, removeChip, ruleOf, type Filters,
} from './hubFacets.ts';
import { HUB_SCHEMA, filtersPatch, libraryOpenHref, openPatch, pageOf, sortPatch, tabHref, type HubAddress } from './hubAddress.ts';
import { inQuick, journeyRows, libraryRows, NONE, searchTerms, haystack, DEFAULT_SORT, type JourneyItem, type LibraryItem, type OnboardingRow } from './hubModel.ts';

const TODAY = new Date(2026, 10, 8);
const progress = (total: number, implemented: number, approved: number) => ({ total_controls: total, implemented_count: implemented, approved_evidence_controls: approved, not_started_count: total - implemented });
const j = (id: number, fw: number, status: string, over: Partial<JourneyItem> = {}): JourneyItem => ({ id, uploaded_framework_id: fw, name: `F${fw}`, status, started_at: '2026-01-01T00:00:00', progress: progress(100, 50, 40), ...over });
const f = (id: number, name: string, over: Partial<LibraryItem> = {}): LibraryItem => ({ id, name, version: '1', framework_type: 'iso', upload_status: 'classified', classification: 'certification', certification_body: 'BSI', ...over });
const LIB = [f(1, 'ISO 27001'), f(5, 'SAMA', { classification: 'regulatory', certification_body: null, regulatory_authority: 'SAMA' }), f(2, 'PCI DSS', { classification: 'compliance', regulatory_authority: 'PCI SSC', certification_body: null, framework_type: 'pci_dss' }), f(3, 'NCA ECC', { classification: 'compliance', regulatory_authority: 'NCA', certification_body: null, framework_type: 'other' }), f(4, 'SOC 2', { certification_body: null })];
const JOURNEYS = [j(1, 1, 'in_progress', { progress: progress(100, 90, 85) }), j(2, 2, 'in_progress', { target_date: '2026-11-01T00:00:00', progress: progress(100, 20, 10) }), j(3, 3, 'on_hold', { progress: undefined }), j(4, 1, 'completed')];
const REGISTER: OnboardingRow[] = [{ uploaded_framework_id: 4, onboarding_id: 40, state: 'draft', progress: { done: 2, total: 5 } }];

const plain = (rows: ReturnType<typeof journeyRows>, f: Filters, scope: 'journeys' | 'library') => rows.filter((r) => {
  const c = chosenOf(f, scope);
  const facets: Record<string, string> = { status: r.state, state: r.state, kind: r.kind, authority: authorityKey(r), band: bandKey(r), due: r.target.state, type: r.typeKey };
  for (const k of Object.keys(c)) if (c[k].length > 0 && !c[k].includes(facets[k])) return false;
  const q = f.quick && f.quick !== 'all' ? f.quick : null;
  return searchTerms(f.search).every((t) => haystack(r).includes(t)) && (!q || inQuick(q, r));
});

test('the engine\'s matches equal the plain filter, for every mix of facets, a search and a quick view, in both registers', () => {
  const journeys = journeyRows(JOURNEYS, LIB, TODAY);
  const library = libraryRows(LIB, JOURNEYS, REGISTER, TODAY);
  const cases: Array<[Filters, 'journeys' | 'library']> = [
    [{ ...NO_FILTERS, status: ['in_progress'] }, 'journeys'],
    [{ ...NO_FILTERS, status: ['in_progress', 'on_hold'], kind: ['compliance'] }, 'journeys'],
    [{ ...NO_FILTERS, band: ['none', 'strong'] }, 'journeys'],
    [{ ...NO_FILTERS, due: ['overdue'], authority: ['PCI SSC'] }, 'journeys'],
    [{ ...NO_FILTERS, search: 'nca' }, 'journeys'],
    [{ ...NO_FILTERS, quick: 'attention' }, 'journeys'],
    [{ ...NO_FILTERS, state: ['onboarding', 'in_progress'] }, 'library'],
    [{ ...NO_FILTERS, kind: ['certification'], type: ['iso'] }, 'library'],
    [{ ...NO_FILTERS, quick: 'running', search: 'iso' }, 'library'],
    [{ ...NO_FILTERS, authority: [NONE] }, 'library'],
    [{ ...NO_FILTERS, band: ['strong'] }, 'library'],                                  // a facet of the other register: no filter here
  ];
  for (const [filters, scope] of cases) {
    const rows = scope === 'journeys' ? journeys : library;
    const got = evaluate(indexHub(rows), chosenOf(filters, scope), ruleOf(filters)).matches.map((r) => r.id).sort();
    assert.deepEqual(got, plain(rows, filters, scope).map((r) => r.id).sort(), JSON.stringify([filters, scope]));
  }
});

test('the live count of an option is what choosing it would show, and the rail drops an option nobody has unless it is chosen', () => {
  const rows = journeyRows(JOURNEYS, LIB, TODAY);
  const filters: Filters = { ...NO_FILTERS, kind: ['certification'] };
  const result = evaluate(indexHub(rows), chosenOf(filters, 'journeys'), ruleOf(filters));
  assert.equal(countOf(result.counts, 'status', 'in_progress'), 1, 'F1 in progress (the certification), not F2');
  assert.equal(countOf(result.counts, 'status', 'completed'), 1);
  assert.equal(countOf(result.counts, 'kind', 'compliance'), 2, 'a facet\'s own choice never empties its own list');
  const options = railOptions(rows, 'journeys');
  const shown = orderedOptions(options.status, [], (v) => countOf(result.counts, 'status', v)).map((o) => o.value);
  assert.deepEqual(shown, ['in_progress', 'completed'], 'on hold has none among the certifications; cancelled and not started have none anywhere');
  assert.ok(orderedOptions(options.status, ['on_hold'], (v) => countOf(result.counts, 'status', v)).some((o) => o.value === 'on_hold'), 'a chosen option stays, with its 0');
  assert.deepEqual(options.authority.map((o) => o.value), ['BSI', 'NCA', 'PCI SSC'], 'the authorities the rows have, by name');
  const withOrphan = railOptions(journeyRows([j(9, 99, 'in_progress')], LIB, TODAY), 'journeys');
  assert.deepEqual(withOrphan.authority.map((o) => [o.value, o.label]), [[NONE, 'Not recorded']], 'a journey of a framework the library did not list: not recorded');
  assert.equal(options.band.at(-1)?.label, 'No figures', 'a journey without figures has its own option, not a zero');
});

test('each register has the facets it needs, with a title', () => {
  assert.deepEqual(RAIL.journeys, ['status', 'kind', 'authority', 'band', 'due']);
  assert.deepEqual(RAIL.library, ['state', 'kind', 'authority', 'type']);
  for (const k of [...RAIL.journeys, ...RAIL.library]) assert.ok(FACET_TITLE[k].length > 2, k);
  assert.equal(filterCount({ ...NO_FILTERS, status: ['a'], band: ['x'] }, 'library'), 0, 'a journeys facet in the address is not a filter of the library');
  assert.equal(filterCount({ ...NO_FILTERS, status: ['a'], band: ['x'], search: ' q ', quick: 'attention' }, 'journeys'), 4);
  assert.equal(isFiltering(NO_FILTERS, 'journeys'), false);
  assert.equal(filterCount({ ...NO_FILTERS, quick: 'all' }, 'journeys'), 0, '"All" is no filter');
});

test('chips say what is on, and removing one removes only that one', () => {
  const rows = journeyRows(JOURNEYS, LIB, TODAY);
  const options = railOptions(rows, 'journeys');
  const filters: Filters = { ...NO_FILTERS, search: 'iso', quick: 'attention', status: ['in_progress', 'on_hold'], due: ['overdue'] };
  const chips = filterChips(filters, 'journeys', options);
  assert.deepEqual(chips.map((c) => c.label), ['Search: iso', 'Needs attention', 'Status: In progress', 'Status: On hold', 'Target date: Overdue']);
  const onHold = chips.find((c) => c.key === 'status:on_hold');
  assert.deepEqual(removeChip(filters, onHold!).status, ['in_progress']);
  assert.equal(removeChip(filters, chips[0]).search, '');
  assert.equal(removeChip(filters, chips[1]).quick, null);
  assert.deepEqual(removeChip(filters, chips[4]).due, []);
});

test('the address round-trips: a link opens the same view, junk is the default, a sort of the other register falls back, the plain address is the Journeys list', () => {
  const read = (search: string) => readAddress(HUB_SCHEMA, search) as unknown as HubAddress;
  const plainPage = pageOf(read(''));
  assert.deepEqual([plainPage.scope, plainPage.view, plainPage.openId, plainPage.sort], ['journeys', 'list', null, DEFAULT_SORT.journeys]);
  const a = read('?tab=library&state=ready,onboarding&kind=certification&q=iso&quick=ready&sort=name:desc&view=board&open=12');
  const page = pageOf(a);
  assert.deepEqual([page.scope, page.view, page.openId, page.sort], ['library', 'board', 12, { key: 'name', dir: 'desc' }]);
  assert.deepEqual(page.filters.state, ['ready', 'onboarding']);
  assert.equal(page.filters.quick, 'ready');
  assert.equal(writeAddress(HUB_SCHEMA, '', a as never), 'tab=library&q=iso&state=ready%2Conboarding&kind=certification&quick=ready&sort=name%3Adesc&view=board&open=12');
  const junk = pageOf(read('?tab=nope&quick=zzz&sort=ready:asc&view=cards&open=abc&status=in_progress'));
  assert.deepEqual([junk.scope, junk.filters.quick, junk.view, junk.openId], ['journeys', null, 'list', null]);
  assert.deepEqual(pageOf(read('?tab=library&sort=ready:asc')).sort, DEFAULT_SORT.library, 'Ready is a column of the journeys');
  assert.deepEqual(pageOf(read('?sort=ready:asc')).sort, { key: 'ready', dir: 'asc' });
});

test('patches compose, the default order has the plain address, and the old overview address has a place to go', () => {
  assert.deepEqual(filtersPatch({ ...NO_FILTERS, search: 'x', quick: 'attention', due: ['soon'] }), { q: 'x', status: [], state: [], kind: [], authority: [], band: [], due: ['soon'], type: [], quick: 'attention' });
  assert.deepEqual(openPatch(5), { open: 5 });
  assert.deepEqual(openPatch(null), { open: 0 });
  assert.deepEqual(sortPatch('journeys', DEFAULT_SORT.journeys), { sort: null });
  assert.deepEqual(sortPatch('journeys', { key: 'ready', dir: 'desc' }), { sort: { key: 'ready', dir: 'desc' } });
  assert.deepEqual(sortPatch('library', { key: 'name', dir: 'desc' }), { sort: { key: 'name', dir: 'desc' } });
  assert.equal(tabHref('journeys'), '/frameworks');
  assert.equal(tabHref('library'), '/frameworks?tab=library');
  assert.equal(libraryOpenHref(12), '/frameworks?tab=library&open=12');
  const a = readAddress(HUB_SCHEMA, libraryOpenHref(12).split('?')[1]) as unknown as HubAddress;
  assert.deepEqual([pageOf(a).scope, pageOf(a).openId], ['library', 12]);
});
