// node --test "src/app/(dashboard)/erm/_monitoring/registerModel.test.ts"
// The common engine of the three monitoring registers: the address grammar, live facet counts, quick chips that count what they would show, sort with empty values last,
// paging, and the applied-filter chips that come off one by one.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import {
  appliedChips, buildSchema, clampPage, evaluateRegister, filterCount, indexRegister, matchKey, nextSort, pageCount, pageSlice, sortRows, stateOf, withoutChip,
  type RegisterDef, type RegisterState,
} from './registerModel.ts';

interface Row { id: number; name: string; status: string; owner: string | null; due: number | null; tags: string[] }
const rows: Row[] = [
  { id: 1, name: 'Phishing clicks', status: 'red', owner: 'Amina', due: 5, tags: ['mail'] },
  { id: 2, name: 'Patch age', status: 'amber', owner: 'Bilal', due: null, tags: [] },
  { id: 3, name: 'Backup failures', status: 'red', owner: null, due: 2, tags: ['dr', 'mail'] },
  { id: 4, name: 'Uptime', status: 'green', owner: 'Amina', due: 9, tags: [] },
];
const def: RegisterDef<Row> = {
  key: 'test', noun: { one: 'row', other: 'rows' }, idOf: (r) => r.id, text: (r) => `${r.name} ${r.owner ?? ''}`,
  facets: [
    { key: 'status', label: 'Status', values: (r) => [r.status], options: () => ['red', 'amber', 'green'].map((value) => ({ value, label: value.toUpperCase() })) },
    { key: 'owner', label: 'Owner', values: (r) => [r.owner ?? 'none'], options: () => [{ value: 'Amina', label: 'Amina' }, { value: 'Bilal', label: 'Bilal' }, { value: 'none', label: 'Unassigned' }] },
    { key: 'tag', label: 'Tag', values: (r) => r.tags, options: () => [{ value: 'mail', label: 'Mail' }, { value: 'dr', label: 'DR' }] },
  ],
  quick: [{ key: 'soon', label: 'Due soon', test: (r) => r.due !== null && r.due <= 5 }, { key: 'mine', label: 'Mine', test: (r) => r.owner === 'Amina' }],
  sorts: [{ key: 'name', label: 'Name', value: (r) => r.name, firstDir: 'asc' }, { key: 'due', label: 'Due', value: (r) => r.due, firstDir: 'asc' }],
  defaultSort: { key: 'name', dir: 'asc' },
};
const schema = buildSchema(def);
const state = (search: string): RegisterState => stateOf(def, readAddress(schema, search) as Record<string, unknown>);
const now = new Date('2026-11-08T00:00:00Z');

test('the address: defaults write nothing, a state writes its params, a link reads back the same state, junk is the default', () => {
  assert.equal(writeAddress(schema, '', readAddress(schema, '') as never), '');
  const s = state('?status=red,amber&quick=soon&view=board&sort=due:desc&page=3&id=7&q=patch');
  assert.deepEqual(s, { q: 'patch', quick: 'soon', view: 'board', sort: { key: 'due', dir: 'desc' }, page: 3, id: 7, chosen: { status: ['red', 'amber'], owner: [], tag: [] } });
  assert.deepEqual(state('?quick=nope&view=grid&sort=zzz:up&page=-4&id=abc'), state(''));
  assert.throws(() => buildSchema({ ...def, facets: [{ ...def.facets[0], key: 'page' }] }), /already uses/);
});

test('facet counts are what choosing the option would show, with the other filters as they are; a zero stays', () => {
  const index = indexRegister(def, rows);
  const none = evaluateRegister(def, index, state(''), now);
  assert.equal(none.result.matches.length, 4);
  assert.equal(none.result.counts.status.get('red'), 2);
  assert.equal(none.result.counts.tag.get('mail'), 2);
  const red = evaluateRegister(def, index, state('?status=red'), now);
  assert.deepEqual(red.result.matches.map((r) => r.id), [1, 3]);
  assert.equal(red.result.counts.status.get('amber'), 1, 'a facet\'s own choice never empties its own list');
  assert.equal(red.result.counts.tag.get('dr'), 1);
  assert.equal(red.result.counts.owner.get('Bilal') ?? 0, 0, 'Bilal has no red row: a zero, still offered');
});

test('quick chips count what they would show with the facets and the search as they are, and the chip applies as one more filter', () => {
  const index = indexRegister(def, rows);
  const base = evaluateRegister(def, index, state(''), now);
  assert.deepEqual(base.quickCounts, { all: 4, soon: 2, mine: 2 });
  const red = evaluateRegister(def, index, state('?status=red'), now);
  assert.deepEqual(red.quickCounts, { all: 2, soon: 2, mine: 1 });
  const soon = evaluateRegister(def, index, state('?quick=soon'), now);
  assert.deepEqual(soon.result.matches.map((r) => r.id), [1, 3]);
  const found = evaluateRegister(def, index, state('?q=amina'), now);
  assert.deepEqual(found.result.matches.map((r) => r.id), [1, 4]);
  assert.equal(evaluateRegister(def, index, state('?q=amina%20uptime'), now).result.matches.length, 1, 'every word has to be found');
});

test('sort: both directions, an empty value last either way, ties by id', () => {
  assert.deepEqual(sortRows(def, rows, { key: 'due', dir: 'asc' }).map((r) => r.id), [3, 1, 4, 2]);
  assert.deepEqual(sortRows(def, rows, { key: 'due', dir: 'desc' }).map((r) => r.id), [4, 1, 3, 2]);
  assert.deepEqual(sortRows(def, rows, { key: 'name', dir: 'asc' }).map((r) => r.id), [3, 2, 1, 4]);
  assert.deepEqual(sortRows(def, [{ ...rows[0], id: 9 }, { ...rows[0], id: 8 }], { key: 'name', dir: 'desc' }).map((r) => r.id), [8, 9]);
  assert.deepEqual(nextSort(def, { key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
  assert.deepEqual(nextSort(def, { key: 'name', dir: 'asc' }, 'due'), { key: 'due', dir: 'asc' });
});

test('paging: the page is kept inside the list, the slice is the page, and a new set of matches has its own key', () => {
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageCount(26, 25), 2);
  assert.equal(clampPage(9, 26, 25), 2);
  assert.equal(clampPage(-1, 26, 25), 1);
  assert.deepEqual(pageSlice([1, 2, 3, 4, 5], 2, 2), [3, 4]);
  assert.notEqual(matchKey([1, 2], { key: 'a', dir: 'asc' }), matchKey([1, 3], { key: 'a', dir: 'asc' }));
  assert.notEqual(matchKey([1, 2], { key: 'a', dir: 'asc' }), matchKey([1, 2], { key: 'a', dir: 'desc' }));
});

test('the filters that are on come off one at a time and count as filters', () => {
  const s = state('?status=red,amber&quick=soon&q=pat');
  assert.equal(filterCount(s), 4);
  const chips = appliedChips(def, s, (facet) => def.facets.find((f) => f.key === facet)!.options(rows));
  assert.deepEqual(chips.map((c) => c.label), ['Due soon', 'Status: RED', 'Status: AMBER', 'Search: pat']);
  assert.deepEqual(withoutChip(s, 'quick'), { quick: 'all' });
  assert.deepEqual(withoutChip(s, 'q'), { q: '' });
  assert.deepEqual((withoutChip(s, 'status:red') as { chosen: Record<string, string[]> }).chosen.status, ['amber']);
  assert.equal(filterCount(state('')), 0);
});
