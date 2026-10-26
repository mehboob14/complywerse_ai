// node --test "src/app/(dashboard)/governance/exceptions/_logic.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DATA_COLS, DEFAULT_PAGE_SIZE, PAGE_SIZES, TITLE_MIN_WIDTH,
  countLabel, formatDate, nextSort, pagerOf, searchExceptions, shownCols, sortRows, tableMinWidth, toCsv, toggleHidden,
  type DataCol, type ExceptionFields,
} from './_logic.ts';

type Row = ExceptionFields & { id: number };
let n = 0;
const row = (over: Partial<Row> = {}): Row => ({
  id: ++n, title: `Exception ${n}`, status: 'draft', priority: 'medium', created_at: '2026-10-01T09:30:00', expiry_date: null,
  document_title: 'Remote Access Policy', requested_by: 'u7', requested_by_name: 'Rana Khan', ...over,
});
const ids = (rows: { id: number }[]) => rows.map((r) => r.id).join(',');

// The columns as the page builds them: the data ones from DATA_COLS, in the page's order.
const cols: DataCol<Row>[] = (Object.keys(DATA_COLS) as (keyof typeof DATA_COLS)[]).map((id) => ({ id, ...DATA_COLS[id] }));

// ── order ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a click on a header: ascending, then descending, then off; another header starts again at ascending', () => {
  assert.deepEqual(nextSort(null, 'title'), { id: 'title', dir: 'asc' });
  assert.deepEqual(nextSort({ id: 'title', dir: 'asc' }, 'title'), { id: 'title', dir: 'desc' });
  assert.equal(nextSort({ id: 'title', dir: 'desc' }, 'title'), null);
  assert.deepEqual(nextSort({ id: 'title', dir: 'desc' }, 'status'), { id: 'status', dir: 'asc' });
  assert.deepEqual(nextSort({ id: 'title', dir: 'asc' }, 'expiry'), { id: 'expiry', dir: 'asc' });
});

test('titles sort as text whatever the case, both ways', () => {
  const rows = [row({ id: 1, title: 'beta' }), row({ id: 2, title: 'Alpha' }), row({ id: 3, title: 'gamma' })];
  assert.equal(ids(sortRows(rows, cols, { id: 'title', dir: 'asc' })), '2,1,3');
  assert.equal(ids(sortRows(rows, cols, { id: 'title', dir: 'desc' })), '3,1,2');
});

test('status and priority sort on the raw value the server sends, as the shared table did, not on their label or their weight', () => {
  const statuses = ['rejected', 'draft', 'pending_approval', 'approved', 'revoked', 'expired'].map((status, i) => row({ id: i + 1, status }));
  assert.deepEqual(sortRows(statuses, cols, { id: 'status', dir: 'asc' }).map((r) => r.status),
    ['approved', 'draft', 'expired', 'pending_approval', 'rejected', 'revoked']);
  const priorities = ['medium', 'critical', 'low', 'high'].map((priority, i) => row({ id: i + 1, priority }));
  assert.deepEqual(sortRows(priorities, cols, { id: 'priority', dir: 'asc' }).map((r) => r.priority), ['critical', 'high', 'low', 'medium']);
  assert.deepEqual(sortRows(priorities, cols, { id: 'priority', dir: 'desc' }).map((r) => r.priority), ['medium', 'low', 'high', 'critical']);
});

test('dates sort as they were sent, and an exception with no expiry sorts first when ascending', () => {
  const rows = [
    row({ id: 1, expiry_date: '2026-11-08', created_at: '2026-10-03T08:00:00' }),
    row({ id: 2, expiry_date: null, created_at: '2026-10-01T08:00:00' }),
    row({ id: 3, expiry_date: '2026-01-02', created_at: '2026-10-02T08:00:00' }),
  ];
  assert.equal(ids(sortRows(rows, cols, { id: 'expiry', dir: 'asc' })), '2,3,1');
  assert.equal(ids(sortRows(rows, cols, { id: 'expiry', dir: 'desc' })), '1,3,2');
  assert.equal(ids(sortRows(rows, cols, { id: 'created', dir: 'asc' })), '2,3,1');
});

test('two numbers compare as numbers, not as text', () => {
  const byN: DataCol<{ id: number; n: number }>[] = [{ id: 'n', header: 'N', sort: (r) => r.n }];
  const rows = [{ id: 1, n: 10 }, { id: 2, n: 9 }, { id: 3, n: 100 }];
  assert.equal(ids(sortRows(rows, byN, { id: 'n', dir: 'asc' })), '2,1,3');
  assert.equal(ids(sortRows(rows, byN, { id: 'n', dir: 'desc' })), '3,1,2');
});

test('no sort, a hidden column or a column with no key leaves the rows as they are (the same array)', () => {
  const rows = [row({ title: 'b' }), row({ title: 'a' })];
  assert.equal(sortRows(rows, cols, null), rows);
  assert.equal(sortRows(rows, cols.filter((c) => c.id !== 'title'), { id: 'title', dir: 'asc' }), rows);     // Title is not among the columns drawn
  assert.equal(sortRows(rows, [{ id: 'policy', header: 'Policy' }], { id: 'policy', dir: 'asc' }), rows);   // a column that only draws
  assert.equal(sortRows(rows, cols, { id: 'nothing', dir: 'asc' }), rows);
});

test('sorting never reorders its input, and equal keys keep their order', () => {
  const rows = [row({ id: 1, status: 'draft' }), row({ id: 2, status: 'approved' }), row({ id: 3, status: 'draft' }), row({ id: 4, status: 'approved' })];
  const sorted = sortRows(rows, cols, { id: 'status', dir: 'asc' });
  assert.equal(ids(sorted), '2,4,1,3');
  assert.equal(ids(rows), '1,2,3,4');
});

// ── columns ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the title and the actions always show; the others go when the Columns menu says so', () => {
  const all = [
    { id: 'title', always: true }, { id: 'policy' }, { id: 'status' }, { id: 'actions', always: true },
  ];
  assert.deepEqual(shownCols(all, []).map((c) => c.id), ['title', 'policy', 'status', 'actions']);
  assert.deepEqual(shownCols(all, ['policy', 'title', 'actions']).map((c) => c.id), ['title', 'status', 'actions']);
});

test('the Columns menu ticks a column off and on again without touching the list it was given', () => {
  const hidden = ['policy'];
  assert.deepEqual(toggleHidden(hidden, 'status'), ['policy', 'status']);
  assert.deepEqual(toggleHidden(hidden, 'policy'), []);
  assert.deepEqual(hidden, ['policy']);
});

test('the table is never narrower than the title column plus the others\' fixed widths', () => {
  assert.equal(TITLE_MIN_WIDTH, 240);
  assert.equal(tableMinWidth([{ width: 160 }, { width: 140 }, {}]), 240 + 160 + 140);
  assert.equal(tableMinWidth([{}, {}]), 240);
  assert.equal(tableMinWidth([]), 240);
});

// ── pages ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the pager says which rows of how many are on the page, and how many pages there are', () => {
  assert.deepEqual(pagerOf(40, 1, 15), { page: 1, pages: 3, start: 0, end: 15, label: '1–15 of 40' });
  assert.deepEqual(pagerOf(40, 2, 15), { page: 2, pages: 3, start: 15, end: 30, label: '16–30 of 40' });
  assert.deepEqual(pagerOf(40, 3, 15), { page: 3, pages: 3, start: 30, end: 45, label: '31–40 of 40' });     // the last page is short
  assert.equal(pagerOf(30, 1, 15).pages, 2);                                                                    // a full last page is not a third one
  assert.equal(pagerOf(31, 1, 15).pages, 3);
  assert.equal(pagerOf(7, 1, 15).label, '1–7 of 7');
});

test('a page outside the pages there are is brought inside them, so a list that shrank leaves a page and not an empty one', () => {
  assert.equal(pagerOf(40, 9, 15).page, 3);
  assert.equal(pagerOf(40, 0, 15).page, 1);
  assert.equal(pagerOf(40, -4, 15).page, 1);
  assert.equal(pagerOf(20, 3, 15).page, 2);          // on page 3 of 40 rows, a search leaves 20
  assert.equal(pagerOf(0, 5, 15).page, 1);
});

test('an empty list is one page, and the slice the pager gives is the rows of that page', () => {
  assert.deepEqual({ ...pagerOf(0, 1, 15), label: '' }, { page: 1, pages: 1, start: 0, end: 15, label: '' });
  const list = Array.from({ length: 40 }, (_, i) => i + 1);
  const three = pagerOf(list.length, 3, 15);
  assert.deepEqual(list.slice(three.start, three.end), [31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
  const one = pagerOf(list.length, 1, 10);
  assert.deepEqual(list.slice(one.start, one.end), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('the page sizes offered include the one the page starts with, smallest first', () => {
  assert.ok(PAGE_SIZES.includes(DEFAULT_PAGE_SIZE));
  assert.equal(DEFAULT_PAGE_SIZE, 15);
  assert.deepEqual([...PAGE_SIZES].sort((a, b) => a - b), PAGE_SIZES);
});

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the CSV has the data columns, named as the table names them, in the table\'s order', () => {
  assert.equal(toCsv(cols, []), 'Title,Status,Priority,Created,Expiry');
});

test('the CSV holds the raw values: the status as the server names it, the date as it was sent, nothing for no expiry', () => {
  const rows = [
    row({ title: 'Legacy VPN', status: 'pending_approval', priority: 'high', created_at: '2026-10-01T09:30:00', expiry_date: null }),
    row({ title: 'Old FTP', status: 'approved', priority: 'critical', created_at: '2026-09-20T07:00:00', expiry_date: '2026-12-31' }),
  ];
  assert.equal(toCsv(cols, rows), [
    'Title,Status,Priority,Created,Expiry',
    'Legacy VPN,pending_approval,high,2026-10-01T09:30:00,',
    'Old FTP,approved,critical,2026-09-20T07:00:00,2026-12-31',
  ].join('\n'));
});

test('commas, quotes and line breaks in a value are quoted so the line stays one row', () => {
  const rows = [row({ title: 'He said "no", then\nleft' })];
  assert.equal(toCsv(cols, rows).split('\n').slice(1).join('\n'), '"He said ""no"", then\nleft",draft,medium,2026-10-01T09:30:00,');
  // each of the three on its own
  assert.equal(toCsv([cols[0]], [row({ title: 'plain' }), row({ title: 'a,b' })]), 'Title\nplain\n"a,b"');
  assert.equal(toCsv([cols[0]], [row({ title: 'say "hi"' })]), 'Title\n"say ""hi"""');
  assert.equal(toCsv([cols[0]], [row({ title: 'two\nlines' })]), 'Title\n"two\nlines"');
});

test('a column switched off is not exported, and a column that only draws never is', () => {
  const rows = [row({ title: 'One', status: 'draft' })];
  assert.equal(toCsv(cols.filter((c) => c.id !== 'priority' && c.id !== 'created'), rows), 'Title,Status,Expiry\nOne,draft,');
  assert.equal(toCsv([{ id: 'policy', header: 'Policy' }, ...cols.slice(0, 1)], rows), 'Title\nOne');
});

// ── search, counts, dates ─────────────────────────────────────────────────────────────────────────────────────────────────

test('a search keeps the exceptions with the words in the title, the policy or the requester, in any case', () => {
  const list = [
    row({ id: 1, title: 'Legacy VPN', document_title: 'Remote Access Policy', requested_by_name: 'Rana Khan' }),
    row({ id: 2, title: 'Old FTP', document_title: 'Data Transfer Policy', requested_by_name: 'Olivia Owner' }),
    row({ id: 3, title: 'Guest Wi-Fi', document_title: 'Network Policy', requested_by_name: 'Mina Shah' }),
  ];
  assert.equal(ids(searchExceptions(list, 'vpn')), '1');                  // title
  assert.equal(ids(searchExceptions(list, '  vpn ')), '1');                // a space before or after is not part of the words
  assert.equal(ids(searchExceptions(list, 'TRANSFER')), '2');             // policy
  assert.equal(ids(searchExceptions(list, 'mina')), '3');                 // requester
  assert.equal(ids(searchExceptions(list, 'policy')), '1,2,3');
  assert.deepEqual(searchExceptions(list, 'nothing like this'), []);
});

test('with no document title the policy is searched by its name, and with no requester name by the user', () => {
  const list = [
    row({ id: 1, title: 'A', document_title: undefined, policy_name: 'Acceptable Use', requested_by_name: undefined, requested_by: 'jdoe' }),
    row({ id: 2, title: 'B', document_title: 'Other', policy_name: undefined, requested_by_name: 'Someone', requested_by: 'zzz' }),
  ];
  assert.equal(ids(searchExceptions(list, 'acceptable')), '1');
  assert.equal(ids(searchExceptions(list, 'jdoe')), '1');
  assert.equal(ids(searchExceptions(list, 'zzz')), '');                    // the name is what is shown, so the name is what is searched
  assert.equal(ids(searchExceptions(list, 'someone')), '2');
});

test('a blank search keeps every exception, as the very same list', () => {
  const list = [row(), row()];
  assert.equal(searchExceptions(list, ''), list);
  assert.equal(searchExceptions(list, '   '), list);
});

test('the count says how many there are, and how many of them while a search narrows the list', () => {
  assert.equal(countLabel(12, 12, false), '12 exceptions');
  assert.equal(countLabel(1, 1, false), '1 exception');
  assert.equal(countLabel(0, 0, false), '0 exceptions');
  assert.equal(countLabel(3, 12, true), '3 of 12 exceptions');
  assert.equal(countLabel(0, 12, true), '0 of 12 exceptions');
});

test('dates read "08 Nov 2026", on the day the server means, whatever zone the viewer is in', () => {
  assert.equal(formatDate('2026-11-08'), '08 Nov 2026');                       // a date field
  assert.equal(formatDate('2026-11-08T23:30:00'), '08 Nov 2026');              // the server's time has no zone and is UTC, not local
  assert.equal(formatDate('2026-11-08T23:30:00Z'), '08 Nov 2026');
  assert.equal(formatDate('2026-01-02T00:00:00+05:00'), '01 Jan 2026');        // a time that names its zone is honoured
});

test('no date, or one that is not a date, reads as a dash', () => {
  for (const none of [null, undefined, '', 'not a date']) assert.equal(formatDate(none), '—');
});
