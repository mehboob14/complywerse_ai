// node --test changeLog.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ChainEvent, ChainVersion } from './documentChain';
import {
  NO_FILTERS, buildLog, dateRange, dayLabel, dayName, eventGroup, exportParams, filtersOn, groupByDay, personIndex, readQuery, sortRows, sourceCounts,
  tableRows, versionAt, whatCounts, writeQuery, type LogFilters, type TableRow,
} from './changeLog.ts';

const NOW = new Date(2026, 9, 21, 15, 30);                              // 21 Oct 2026, 15:30 where the viewer is
const utc = (d: Date) => d.toISOString().slice(0, 19);                  // the server's times: naive UTC
const on = (day: number, hour = 10) => utc(new Date(2026, 9, day, hour, 0));

type Extra = Record<string, unknown>;
const item = (n: number, origin: string, by: string, byId: number | null, extra: Extra = {}) => ({
  n, status: 'modified', section: '3. Access Control', locked: false, blocks: 1, words_added: 1, words_removed: 1, format_only: false,
  before_text: 'reviewed every year', after_text: 'reviewed every quarter', truncated: false, origin, by, by_id: byId, at: null, request: '',
  reason: '', sources: [], coverage: 1, ...extra,
});
const version = (id: number, number: string, by: string, byId: number, day: number, origin: string, items: unknown[] = [], extra: Extra = {}) => ({
  id, number, kind: 'minor', status: 'superseded', at: on(day), by, by_id: byId, stage: 'draft', stage_label: 'Draft', origin, origin_label: origin,
  summary: '', reason: '', comparable: true, has_file: false, title: 'Policy', items, sources: [], words_added: 0, words_removed: 0,
  changes: items.length, approved_by: null, approved_at: null, session_id: null, ...extra,
});
const event = (kind: string, actor: string, actorId: number, day: number, extra: Extra = {}) => ({
  at: on(day, 12), kind, actor, actor_id: actorId, detail: '', from: null, to: null, stage: 'draft', ...extra,
});

const ISO = { ref: 'R1', kind: 'framework', title: 'ISO/IEC 27001', locator: 'A.8.2', quote: 'privileged access rights', basis: 'reference', verified: true };
// 1.0 the original (1 Oct), 1.1 Olivia by hand (14 Oct), 1.2 saved by Sam (20 Oct): a Comply Agent change Olivia accepted and his own
// edit (recorded without his id); sent for review (15 Oct), a statement Sam edited (20 Oct), an owner change and a publication (today)
const CHAIN = {
  versions: [
    version(1, '1.0', 'Olivia Owner', 1, 1, 'initial'),
    version(2, '1.1', 'Olivia Owner', 1, 14, 'manual', [item(1, 'manual', 'Olivia Owner', 1)], { reason: 'Review frequency' }),
    version(3, '1.2', 'Sam Other', 2, 20, 'mixed', [
      item(1, 'ai', 'Olivia Owner', 1, { reason: 'An approval leaves a record', sources: [ISO] }),
      item(2, 'manual', 'Sam Other', null, { status: 'inserted', before_text: '', after_text: 'Third parties with access are in scope.' }),
    ], { summary: 'Révision of the scope' }),
  ],
  events: [
    event('sent_for_review', 'Olivia Owner', 1, 15, { from: 'draft', to: 'pending_review' }),
    event('statement_edited', 'Sam Other', 2, 20, { before: 'Accounts are reviewed every year.', after: 'Accounts are reviewed every quarter.' }),
    event('owner_assigned', 'Olivia Owner', 1, 21, { detail: 'Owner: Sam Other' }),
    event('status_changed', 'Olivia Owner', 1, 21, { from: 'approved', to: 'published' }),
  ],
} as unknown as { versions: ChainVersion[]; events: ChainEvent[] };

const log = (f: Partial<LogFilters> = {}, now = NOW) => buildLog(CHAIN, { ...NO_FILTERS, ...f }, now);
const keys = (f: Partial<LogFilters> = {}) => log(f).entries.map((e) => e.key);
const itemsOf = (f: Partial<LogFilters>, key: string) => {
  const e = log(f).entries.find((x) => x.key === key);
  return e && e.type === 'version' ? { shown: e.items.map((i) => i.n), hidden: e.hidden } : null;
};

test('without filters the log holds everything, newest first, a version before an event at the same time', () => {
  assert.deepEqual(keys(), ['e3', 'e2', 'e1', 'v3', 'e0', 'v2', 'v1']);
  assert.equal(log().total, 7);
  assert.deepEqual(itemsOf({}, 'v3'), { shown: [1, 2], hidden: 0 });
});

test('the split shows the versions and their changes, or the activity, or both', () => {
  assert.deepEqual(keys({ split: 'changes' }), ['v3', 'v2', 'v1']);
  assert.deepEqual(keys({ split: 'activity' }), ['e3', 'e2', 'e1', 'e0']);
  assert.deepEqual([log({ split: 'changes' }).total, log({ split: 'activity' }).total, log({ split: 'all' }).total], [3, 4, 7]);
});

test('a person keeps their own changes in each version and their own steps', () => {
  assert.deepEqual(keys({ people: ['2'] }), ['e1', 'v3']);
  assert.deepEqual(itemsOf({ people: ['2'] }, 'v3'), { shown: [2], hidden: 1 });       // his edit, known by name only, is his
  assert.deepEqual(keys({ people: ['1'] }), ['e3', 'e2', 'v3', 'e0', 'v2', 'v1']);       // 1.0 is hers: she made it
  assert.deepEqual(itemsOf({ people: ['1'] }, 'v3'), { shown: [1], hidden: 1 });
  assert.deepEqual(keys({ people: ['1', '2'] }), keys());
  assert.deepEqual(personIndex(CHAIN).people, [{ key: '1', name: 'Olivia Owner', count: 6 }, { key: '2', name: 'Sam Other', count: 2 }]);
});

test('a source narrows the changes and never removes activity', () => {
  assert.deepEqual(keys({ sources: ['ai'] }), ['e3', 'e2', 'e1', 'v3', 'e0']);
  assert.deepEqual(itemsOf({ sources: ['ai'] }, 'v3'), { shown: [1], hidden: 1 });
  assert.deepEqual(keys({ split: 'changes', sources: ['manual'] }), ['v3', 'v2']);
  assert.deepEqual(keys({ split: 'changes', sources: ['initial'] }), ['v1']);              // the original, by itself
  assert.deepEqual(keys({ split: 'activity', sources: ['ai'] }), keys({ split: 'activity' }));      // a source is not asked of activity
  assert.deepEqual(sourceCounts(CHAIN), [{ key: 'ai', changes: 1, versions: 0 }, { key: 'manual', changes: 2, versions: 0 }, { key: 'initial', changes: 0, versions: 1 }]);
});

test('what chooses the kinds of entries: text, reviews and approvals, statements, other activity', () => {
  assert.deepEqual(keys({ what: ['review'] }), ['e3', 'e0']);                             // published by hand counts as an approval
  assert.deepEqual(keys({ what: ['statement', 'other'] }), ['e2', 'e1']);
  assert.deepEqual(keys({ what: ['text'] }), ['v3', 'v2', 'v1']);
  assert.deepEqual(keys({ split: 'activity', what: ['text'] }), keys({ split: 'activity' }));        // no text in activity: no narrowing
  assert.deepEqual(keys({ split: 'changes', what: ['review'] }), keys({ split: 'changes' }));
  assert.deepEqual(whatCounts(CHAIN), { text: 3, review: 2, statement: 1, other: 1 });
  const group = (kind: string, to: string | null = null) => eventGroup({ kind, to });
  assert.deepEqual(['created', 'archived', 'restored', 'version_rollback', 'owner_assigned', 'department_changed'].map((k) => group(k)), Array(6).fill('other'));
  assert.equal(group('status_changed', 'pending_review'), 'other');
  assert.equal(group('status_changed', 'approved'), 'review');
  for (const k of ['statement_added', 'statements_reparsed', 'statements_written_to_document', 'statements_updated_from_document']) assert.equal(group(k), 'statement', k);
  for (const k of ['sent_for_review', 'signed', 'acknowledged', 'changes_requested', 'resubmitted', 'route_set', 'reviewers_asked_again']) assert.equal(group(k), 'review', k);
});

test("the date presets are the viewer's days up to now, and a custom span takes in its last day", () => {
  assert.deepEqual(dateRange({ when: 'any', from: '', to: '' }, NOW), { start: null, end: null });
  assert.deepEqual(dateRange({ when: 'today', from: '', to: '' }, NOW), { start: new Date(2026, 9, 21), end: null });
  assert.deepEqual(dateRange({ when: '7d', from: '', to: '' }, NOW).start, new Date(2026, 9, 15));
  assert.deepEqual(dateRange({ when: '30d', from: '', to: '' }, NOW).start, new Date(2026, 8, 22));
  assert.deepEqual(dateRange({ when: '90d', from: '', to: '' }, NOW).start, new Date(2026, 6, 24));
  assert.deepEqual(dateRange({ when: '7d', from: '', to: '' }, new Date(2026, 10, 3, 8)).start, new Date(2026, 9, 28));    // across a month
  assert.deepEqual(dateRange({ when: 'custom', from: '2026-10-14', to: '2026-10-15' }, NOW), { start: new Date(2026, 9, 14), end: new Date(2026, 9, 16) });
  assert.deepEqual(dateRange({ when: 'custom', from: '2026-10-15', to: '2026-10-14' }, NOW), { start: new Date(2026, 9, 14), end: new Date(2026, 9, 16) });
  assert.deepEqual(dateRange({ when: 'custom', from: '2026-10-14', to: '' }, NOW), { start: new Date(2026, 9, 14), end: null });
  assert.deepEqual(dateRange({ when: '30d', from: '2026-10-14', to: '' }, NOW).end, null);                                // dates only when custom
  assert.deepEqual(keys({ when: 'today' }), ['e3', 'e2']);
  assert.deepEqual(keys({ when: '7d' }), ['e3', 'e2', 'e1', 'v3', 'e0']);
  assert.deepEqual(keys({ when: 'custom', from: '2026-10-14', to: '2026-10-15' }), ['e0', 'v2']);
  assert.deepEqual(keys({ when: 'custom', from: '', to: '' }), keys());
});

test('a search finds every word in the changes, the reasons and the details, accents folded', () => {
  assert.deepEqual(keys({ q: 'third PARTIES' }), ['v3']);
  assert.deepEqual(itemsOf({ q: 'third PARTIES' }, 'v3'), { shown: [2], hidden: 1 });     // only the change that says it
  assert.deepEqual(itemsOf({ q: 'revision' }, 'v3'), { shown: [1, 2], hidden: 0 });       // "Révision": the version itself, all of it
  assert.deepEqual(itemsOf({ q: 'iso a.8.2' }, 'v3'), { shown: [1], hidden: 1 });         // the source a change rests on
  assert.deepEqual(keys({ q: 'v1.1' }), ['v2']);
  assert.deepEqual(keys({ q: 'quarter' }), ['e1', 'v3', 'v2']);                            // a statement's new wording, the changes' words
  assert.deepEqual(keys({ q: 'owner sam' }), ['e2']);                                       // every word, in one entry
  assert.deepEqual(keys({ q: '   ' }), keys());
});

test('entries are grouped by the viewer\'s day: Today, Yesterday, then the date', () => {
  const groups = groupByDay(log().entries, NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Yesterday', '15 Oct 2026', '14 Oct 2026', '1 Oct 2026']);
  assert.deepEqual(groups.map((g) => g.entries.map((e) => e.key)), [['e3', 'e2'], ['e1', 'v3'], ['e0'], ['v2'], ['v1']]);
  assert.deepEqual(groupByDay([{ at: on(21) }, { at: null }], NOW).map((g) => g.label), ['Today', 'Date not recorded']);
  assert.equal(dayLabel(new Date(2026, 0, 31, 23), new Date(2026, 1, 1, 9)), 'Yesterday');
  assert.equal(dayLabel(new Date(2025, 11, 31), NOW), '31 Dec 2025');
  assert.deepEqual([dayName('2026-10-14'), dayName('14/10/2026')], ['14 Oct 2026', '']);           // a custom span's day, in a chip
});

test('the filters live in the URL, next to the page\'s own parameters, and come back the same', () => {
  const f: LogFilters = { split: 'activity', layout: 'table', people: ['1', 'Sam Other'], when: 'custom', from: '2026-10-01', to: '2026-10-21',
    sources: ['ai'], what: ['review', 'statement'], q: 'access review' };
  const url = writeQuery(new URLSearchParams('tab=versions&read=5'), f);
  assert.equal(url.get('tab'), 'versions');
  assert.equal(url.get('read'), '5');
  assert.deepEqual(readQuery(url), f);
  assert.deepEqual(readQuery(new URLSearchParams(url.toString())), f);
  assert.equal(writeQuery(url, NO_FILTERS).toString(), 'tab=versions&read=5');              // the defaults leave a plain link
  assert.equal(writeQuery(new URLSearchParams(), { ...NO_FILTERS, when: '30d', from: '2026-10-01', q: ' x ' }).toString(), 'when=30d&q=x');
  assert.deepEqual(readQuery(new URLSearchParams('log=nope&as=grid&when=yesterday&source=robot&what=all&from=21/10/2026')), NO_FILTERS);
});

test('export filtered sends what the log shows, its days as UTC times', () => {
  assert.deepEqual(exportParams(NO_FILTERS, NOW), []);
  assert.deepEqual(exportParams({ ...NO_FILTERS, people: ['2'], when: '7d', sources: ['ai'], q: ' third ' }, NOW),
    [['people', '2'], ['date_from', utc(new Date(2026, 9, 15))], ['sources', 'ai'], ['search', 'third']]);
  assert.deepEqual(exportParams({ ...NO_FILTERS, split: 'changes', what: ['review'] }, NOW), [['kinds', 'text']]);
  assert.deepEqual(exportParams({ ...NO_FILTERS, split: 'activity', sources: ['ai'] }, NOW), [['kinds', 'review'], ['kinds', 'statement'], ['kinds', 'other']]);
  assert.deepEqual(exportParams({ ...NO_FILTERS, split: 'activity', what: ['text', 'review'] }, NOW), [['kinds', 'review']]);
  assert.deepEqual(exportParams({ ...NO_FILTERS, when: 'custom', from: '2026-10-14', to: '2026-10-15' }, NOW),
    [['date_from', utc(new Date(2026, 9, 14))], ['date_to', utc(new Date(2026, 9, 16))]]);
  assert.equal(filtersOn(NO_FILTERS, NOW), false);
  assert.equal(filtersOn({ ...NO_FILTERS, when: 'custom' }, NOW), false);                    // no day chosen yet
  assert.equal(filtersOn({ ...NO_FILTERS, split: 'activity', sources: ['ai'] }, NOW), false);
  assert.equal(filtersOn({ ...NO_FILTERS, q: ' x ' }, NOW), true);
});

test('the table has a row per change and per event, and sorts by when, who, what, source and version', () => {
  const labels = { kind: (s: string) => (s === 'inserted' ? 'Added' : s === 'deleted' ? 'Removed' : 'Changed'), event: (k: string) => k, source: (k: string) => k };
  const rows = tableRows(CHAIN, log().entries, labels);
  assert.deepEqual(rows.map((r) => r.key), ['e3', 'e2', 'e1', 'v3.1', 'v3.2', 'e0', 'v2.1', 'v1']);
  assert.deepEqual(rows.map((r) => r.version), ['1.2', '1.2', '1.2', '1.2', '1.2', '1.1', '1.1', '1.0']);   // an event: the version then
  assert.deepEqual([rows[4].who, rows[4].what, rows[4].source], ['Sam Other', 'Added', 'manual']);
  assert.deepEqual([rows[7].what, rows[7].source], ['Version', 'initial']);
  assert.deepEqual(sortRows(rows, 'when', 'asc').map((r) => r.key), ['v1', 'v2.1', 'e0', 'v3.1', 'v3.2', 'e1', 'e3', 'e2']);
  assert.deepEqual(sortRows(rows, 'who', 'asc').map((r) => r.who), ['Olivia Owner', 'Olivia Owner', 'Olivia Owner', 'Olivia Owner', 'Olivia Owner', 'Olivia Owner', 'Sam Other', 'Sam Other']);
  assert.deepEqual(sortRows(rows, 'source', 'desc').map((r) => r.source).slice(0, 3), ['manual', 'manual', 'initial']);
  const v = (version: string) => ({ key: version, version, at: null }) as unknown as TableRow;
  assert.deepEqual(sortRows([v('1.10'), v('2.0'), v('1.9')], 'version', 'asc').map((r) => r.version), ['1.9', '1.10', '2.0']);
  assert.equal(versionAt(CHAIN.versions, on(1, 9)), '');
});
