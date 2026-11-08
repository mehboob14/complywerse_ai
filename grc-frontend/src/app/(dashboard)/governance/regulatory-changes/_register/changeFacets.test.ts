// node --test "src/app/(dashboard)/governance/regulatory-changes/_register/changeFacets.test.ts"
// The Changes register: its facets and quick views over the complete load, the live counts (held to the plain filter), the options and chips, the order, the address and the export.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countOf, evaluate } from '../../../../../components/records/facetEngine.ts';
import { readAddress, writeAddress } from '../../../../../lib/addressState.ts';
import { REGISTER_SCHEMA, filtersPatch, pageOf, type RegisterAddress } from './changeAddress.ts';
import {
  NO_FILTERS, QUICK_IDS, SORT_KEYS, chosenOf, exportName, filterChips, filterCount, indexChanges, inQuick, nextSort, orderedOptions, railOptions, removeChip, ruleOf, sortChanges, toCsv,
  workOf, DEFAULT_SORT, type Filters,
} from './changeFacets.ts';
import type { ChangeRow } from '../_lib/types.ts';

const TODAY = new Date(2026, 10, 8, 12, 0);
const CTX = { me: 7, today: TODAY };
const row = (id: number, over: Partial<ChangeRow> = {}): ChangeRow => ({
  id, title: `Circular ${id}`, source: 'SBP', status: 'under_assessment', priority: 'medium', created_at: `2026-10-${String(10 + id).padStart(2, '0')}T00:00:00`, ...over,
});
const ROWS: ChangeRow[] = [
  row(1, { title: 'Cyber resilience framework', priority: 'high', assigned_to: 7, assignee_name: 'Officer', effective_date: '2026-11-20T00:00:00', task_count: 3, late_task_count: 1, to_check_count: 2, obligation_count: 5, met_count: 2 }),
  row(2, { title: 'Outsourcing guidelines', source: 'SAMA', status: 'implementation', priority: 'critical', effective_date: '2026-10-01T00:00:00', task_count: 0, obligation_count: 4, met_count: 4 }),
  row(3, { title: 'Annual report format', status: 'completed', priority: 'low', task_count: 2, completed_task_count: 2 }),
  row(4, { title: 'Closed by hand', status: 'closed', source: 'custom', assigned_to: 8, assignee_name: 'Ayesha' }),
  row(5, { title: 'Just identified', status: 'identified', analysis: { status: 'running' }, effective_date: '2027-03-01T00:00:00' }),
  row(6, { title: 'Not for us', status: 'not_applicable', priority: 'low' }),
];

const matches = (f: Filters, rows = ROWS) => evaluate(indexChanges(rows, CTX), chosenOf(f), ruleOf(f, CTX)).matches.map((r) => r.id);
/** the plain filter the engine must agree with */
function plain(f: Filters, rows = ROWS): number[] {
  const terms = f.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((c) => {
    const bucket = c.status === 'completed' || c.status === 'closed' ? 'done' : c.status;
    const eff = !c.effective_date ? 'none' : c.effective_date < '2026-11-08' ? 'past' : c.effective_date <= '2026-12-08' ? 'soon' : 'later';
    return (!f.status.length || f.status.includes(bucket)) && (!f.priority.length || f.priority.includes(c.priority)) && (!f.regulator.length || f.regulator.includes(c.source))
      && (!f.owner.length || f.owner.includes(c.assigned_to ? String(c.assigned_to) : 'none')) && (!f.effective.length || f.effective.includes(eff))
      && (!f.work.length || workOf(c).some((w) => f.work.includes(w))) && terms.every((t) => `${c.title} ${c.source}`.toLowerCase().includes(t));
  }).map((c) => c.id);
}

test('the two finished words are one status on the register, and every facet narrows', () => {
  assert.deepEqual(matches({ ...NO_FILTERS, status: ['done'] }), [3, 4]);
  assert.deepEqual(matches({ ...NO_FILTERS, status: ['implementation', 'identified'] }), [2, 5]);
  assert.deepEqual(matches({ ...NO_FILTERS, priority: ['critical', 'high'] }), [1, 2]);
  assert.deepEqual(matches({ ...NO_FILTERS, regulator: ['SAMA'] }), [2]);
  assert.deepEqual(matches({ ...NO_FILTERS, owner: ['none'] }), [2, 3, 5, 6]);
  assert.deepEqual(matches({ ...NO_FILTERS, owner: ['8'] }), [4]);
  assert.deepEqual(matches({ ...NO_FILTERS, effective: ['past'] }), [2]);
  assert.deepEqual(matches({ ...NO_FILTERS, effective: ['soon'] }), [1]);
  assert.deepEqual(matches({ ...NO_FILTERS, effective: ['none'] }), [3, 4, 6]);
});

test('the work facet: what an open change waits for; a finished change waits for nothing', () => {
  assert.deepEqual(workOf(ROWS[0]), ['late', 'tocheck', 'unmet']);
  assert.deepEqual(workOf(ROWS[1]), ['no_tasks'], 'all four obligations met, no tasks yet');
  assert.deepEqual(workOf(ROWS[2]), []);
  assert.deepEqual(workOf(ROWS[3]), []);
  assert.deepEqual(workOf(ROWS[4]), ['reading'], 'an identified change that is being read is not "no tasks"');
  assert.deepEqual(matches({ ...NO_FILTERS, work: ['late'] }), [1]);
  assert.deepEqual(matches({ ...NO_FILTERS, work: ['tocheck', 'no_tasks'] }), [1, 2]);
});

test('the quick views', () => {
  const q = (id: Filters['quick']) => matches({ ...NO_FILTERS, quick: id });
  assert.deepEqual(q('all'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(q('open'), [1, 2, 5]);
  assert.deepEqual(q('mine'), [1]);
  assert.deepEqual(q('soon'), [1]);
  assert.deepEqual(q('late'), [1]);
  assert.deepEqual(q('reading'), [5]);
  assert.equal(inQuick('mine', ROWS[0], { me: null, today: TODAY }), false, 'nobody is "me" until the account is known: nothing is shown as mine');
  assert.deepEqual(QUICK_IDS.length, 6);
});

test('the search finds the title, the reference, the regulator\'s code and full name and the owner, every word having to be there', () => {
  assert.deepEqual(matches({ ...NO_FILTERS, search: 'cyber' }), [1]);
  assert.deepEqual(matches({ ...NO_FILTERS, search: 'state bank pakistan' }), [1, 3, 5, 6], 'the full name of the regulator');
  assert.deepEqual(matches({ ...NO_FILTERS, search: 'ayesha' }), [4]);
  assert.deepEqual(matches({ ...NO_FILTERS, search: 'cyber nothing' }), []);
});

test('the engine and the plain filter agree on a sweep of filters, and the live counts are what choosing the option would show', () => {
  const sweeps: Filters[] = [
    NO_FILTERS, { ...NO_FILTERS, status: ['done'] }, { ...NO_FILTERS, priority: ['low'] }, { ...NO_FILTERS, regulator: ['SBP'], priority: ['medium', 'high'] },
    { ...NO_FILTERS, work: ['unmet'], owner: ['7'] }, { ...NO_FILTERS, search: 'circular', effective: ['none'] }, { ...NO_FILTERS, effective: ['soon', 'later'], status: ['identified', 'under_assessment'] },
  ];
  for (const f of sweeps) assert.deepEqual(matches(f), plain(f), JSON.stringify(f));
  const result = evaluate(indexChanges(ROWS, CTX), chosenOf({ ...NO_FILTERS, priority: ['medium'] }), ruleOf(NO_FILTERS, CTX));
  assert.equal(countOf(result.counts, 'status', 'identified'), 1);
  assert.equal(countOf(result.counts, 'priority', 'high'), 1, 'a facet\'s own choice does not empty its own options');
  assert.equal(countOf(result.counts, 'priority', 'critical'), 1);
});

test('options: only the regulators, owners and words that exist; Unassigned is always an owner option; chosen but empty options stay visible', () => {
  const opts = railOptions({ rows: ROWS, people: [{ id: 7, display_name: 'Officer Khan' }] });
  assert.deepEqual(opts.regulator.map((o) => o.value).sort(), ['SAMA', 'SBP', 'custom']);
  assert.deepEqual(opts.owner.map((o) => o.label), ['Ayesha', 'Officer Khan', 'Unassigned'], 'the name from the people list, else the one the row carries');
  assert.deepEqual(opts.status.map((o) => o.label), ['Identified', 'Under assessment', 'Implementation', 'Completed', 'Not applicable']);
  assert.equal(opts.effective.find((o) => o.value === 'soon')?.label, 'Within 30 days');
  assert.deepEqual(orderedOptions(opts.priority, ['low'], (v) => (v === 'low' ? 0 : v === 'high' ? 2 : 0)).map((o) => o.value), ['high', 'low']);
});

test('chips say what is on and come off one by one', () => {
  const opts = railOptions({ rows: ROWS, people: [] });
  const f: Filters = { ...NO_FILTERS, search: 'cyber', quick: 'mine', priority: ['high'], work: ['late'] };
  const chips = filterChips(f, opts);
  assert.deepEqual(chips.map((c) => c.label), ['Search: cyber', 'Assigned to me', 'Priority: High', 'Needs: Tasks late']);
  assert.equal(filterCount(f), 4);
  let cur = f;
  chips.forEach((c) => { cur = removeChip(cur, c); });
  assert.deepEqual(cur, NO_FILTERS);
  assert.equal(filterCount({ ...NO_FILTERS, quick: 'all' }), 0, '"All" is no filter');
});

test('the order: newest first by default, a date column puts undated changes last both ways, a column starts in its natural direction', () => {
  assert.deepEqual(sortChanges(ROWS, DEFAULT_SORT).map((r) => r.id), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(sortChanges(ROWS, { key: 'effective', dir: 'asc' }).map((r) => r.id), [2, 1, 5, 6, 4, 3], 'soonest first, the undated last (newest first among them)');
  assert.deepEqual(sortChanges(ROWS, { key: 'effective', dir: 'desc' }).map((r) => r.id), [5, 1, 2, 6, 4, 3]);
  assert.deepEqual(sortChanges(ROWS, { key: 'priority', dir: 'asc' }).map((r) => r.id), [2, 1, 5, 4, 6, 3], 'critical, high, then medium and low, the newest first among equals');
  assert.deepEqual(nextSort(DEFAULT_SORT, 'effective'), { key: 'effective', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'effective', dir: 'asc' }, 'effective'), { key: 'effective', dir: 'desc' });
  assert.equal(SORT_KEYS.length, 5);
});

test('the address round-trips every filter, and a value the page cannot be in is the default', () => {
  const f: Filters = { ...NO_FILTERS, search: 'cyber', status: ['done'], priority: ['high'], regulator: ['SBP'], owner: ['7', 'none'], effective: ['soon'], work: ['late', 'tocheck'], quick: 'open' };
  const base: RegisterAddress = readAddress(REGISTER_SCHEMA, '') as RegisterAddress;
  const query = writeAddress(REGISTER_SCHEMA, '', { ...base, ...filtersPatch(f), sort: { key: 'effective', dir: 'asc' }, view: 'board', open: 12 });
  const back = pageOf(readAddress(REGISTER_SCHEMA, query) as RegisterAddress);
  assert.deepEqual(back.filters, f);
  assert.deepEqual(back.sort, { key: 'effective', dir: 'asc' });
  assert.equal(back.view, 'board');
  assert.equal(back.openId, 12);
  const odd = pageOf(readAddress(REGISTER_SCHEMA, 'quick=bogus&sort=nope:up&view=cards&open=-3&add=elsewhere') as RegisterAddress);
  assert.equal(odd.filters.quick, null);
  assert.deepEqual(odd.sort, DEFAULT_SORT);
  assert.equal(odd.view, 'list');
  assert.equal(odd.openId, null);
  assert.equal(odd.add, null);
  assert.equal(pageOf(readAddress(REGISTER_SCHEMA, 'add=circular') as RegisterAddress).add, 'circular');
  assert.equal(writeAddress(REGISTER_SCHEMA, 'tab=changes', { ...base }), 'tab=changes', 'the tab stays; the plain register has no params of its own');
});

test('the export is a spreadsheet of what the list says, in words, with quotes and commas kept safe', () => {
  const csv = toCsv([row(1, { title: 'A "quoted", title', effective_date: '2026-11-20T00:00:00', assigned_to: 7, assignee_name: 'Officer', task_count: 3, completed_task_count: 1, late_task_count: 1, obligation_count: 5, met_count: 2 })]);
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Title,Regulator,Reference,Status,Priority,Takes effect,Owner,Obligations,Met by a control,Tasks,Tasks done,Tasks late');
  assert.equal(lines[1], '"A ""quoted"", title",State Bank of Pakistan,,Under assessment,Medium,2026-11-20,Officer,5,2,3,1,1');
  assert.equal(exportName('2026-11-08', 6), 'regulatory-changes-2026-11-08-6.csv');
});
