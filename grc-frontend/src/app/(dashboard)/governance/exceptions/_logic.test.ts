// node --test "src/app/(dashboard)/governance/exceptions/_logic.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADDRESS, DATA_COLS, DEFAULT_PAGE_SIZE, DOC_TYPES, HIDDEN_DOCUMENT, NO_DOCUMENT, PAGE_SIZES, PICKER_LIMIT, TITLE_MIN_WIDTH,
  NARROW_HIDDEN, WIDE_WINDOW, browseDocuments, countLabel, countText, countsSummary, cutNotice, docTypeLabel, documentGroupName, documentOf, draftPatch, emptyForm, formFrom, formForPolicy, formatDate, hiddenColumns, listParams, nextSort,
  pagerOf, payloadOf, sameForm, schedulePatch, searchExceptions, serverList, shownCols, sortRows, stillSuggested, tableMinWidth, toCsv, toggleHidden, uniqueDocuments, withDocumentDetail,
  unitChipText, unitPlaceholder, unitText, visibleUnits, waitingKindLabel, waitingRows,
  type DataCol, type ExceptionFields, type Filters,
} from './_logic.ts';
import { readAddress, writeAddress } from '../../../../lib/addressState.ts';

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

test('a narrow window leaves the least used columns out until the person chooses their own, and then their choice stands', () => {
  assert.deepEqual(hiddenColumns(null, true), []);
  assert.deepEqual(hiddenColumns(null, false), ['type', 'requester', 'created']);
  assert.deepEqual(hiddenColumns([], false), []);                    // they ticked everything on: it stays on
  assert.deepEqual(hiddenColumns(['unit'], true), ['unit']);
  assert.deepEqual(hiddenColumns(['unit'], false), ['unit']);
  assert.ok(WIDE_WINDOW >= 1440);
  assert.equal(NARROW_HIDDEN.length, 3);
  hiddenColumns(null, false).push('x');
  assert.deepEqual(hiddenColumns(null, false), ['type', 'requester', 'created']);   // the answer is a copy: pushing to it changes nothing
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
  assert.equal(toCsv(cols, []), 'Title,Document,Unit,Status,Priority,Type,Created,Expiry');
});

test('the CSV holds the raw values: the status as the server names it, the date as it was sent, nothing for no expiry', () => {
  const rows = [
    row({ title: 'Legacy VPN', status: 'pending_approval', priority: 'high', exception_type_label: 'Technical', created_at: '2026-10-01T09:30:00', expiry_date: null,
      department_path: ['Operations', 'Support'], department_inherited: true }),
    row({ title: 'Old FTP', status: 'approved', priority: 'critical', created_at: '2026-09-20T07:00:00', expiry_date: '2026-12-31', document_title: null }),
  ];
  assert.equal(toCsv(cols, rows), [
    'Title,Document,Unit,Status,Priority,Type,Created,Expiry',
    'Legacy VPN,Remote Access Policy,Operations › Support,pending_approval,high,Technical,2026-10-01T09:30:00,',
    'Old FTP,,,approved,critical,,2026-09-20T07:00:00,2026-12-31',          // no type, no unit, no document: nothing
  ].join('\n'));
});

test('commas, quotes and line breaks in a value are quoted so the line stays one row', () => {
  const rows = [row({ title: 'He said "no", then\nleft' })];
  assert.equal(toCsv(cols, rows).split('\n').slice(1).join('\n'), '"He said ""no"", then\nleft",Remote Access Policy,,draft,medium,,2026-10-01T09:30:00,');
  // each of the three on its own
  assert.equal(toCsv([cols[0]], [row({ title: 'plain' }), row({ title: 'a,b' })]), 'Title\nplain\n"a,b"');
  assert.equal(toCsv([cols[0]], [row({ title: 'say "hi"' })]), 'Title\n"say ""hi"""');
  assert.equal(toCsv([cols[0]], [row({ title: 'two\nlines' })]), 'Title\n"two\nlines"');
});

test('the CSV also names the kind and the code of the document, right after it, and nothing when the Document column is off', () => {
  const rows = [row({ title: 'One', document_title: 'Backup Standard', document_type: 'standard', document_code: 'STD-001' }), row({ title: 'Two', document_title: null, document_id: null })];
  const all = withDocumentDetail(cols);
  assert.equal(toCsv(all, []), 'Title,Document,Document type,Document code,Unit,Status,Priority,Type,Created,Expiry');
  const lines = toCsv(all, rows).split('\n');
  assert.ok(lines[1].startsWith('One,Backup Standard,Standard,STD-001,'), lines[1]);
  assert.ok(lines[2].startsWith('Two,,,,'), lines[2]);                                                          // about no document: three empty cells
  const off = cols.filter((c) => c.id !== 'document');
  assert.deepEqual(withDocumentDetail(off), off);                                                               // the person switched the document off: the file has none of it
});

test('a column switched off is not exported, and a column that only draws never is', () => {
  const rows = [row({ title: 'One', status: 'draft' })];
  assert.equal(toCsv(cols.filter((c) => !['priority', 'created', 'type', 'document', 'unit'].includes(c.id)), rows), 'Title,Status,Expiry\nOne,draft,');
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

// ── D62: the Unit and Document columns, the search ────────────────────────────────────────────────────────────────────────

test('the Unit is its path from the top down; an exception with no unit has none', () => {
  assert.equal(unitText({ department_path: ['Operations', 'Support', 'Helpdesk'] }), 'Operations › Support › Helpdesk');
  assert.equal(unitText({ department_path: [] }), '');
  assert.equal(unitText({}), '');
});

test('the Document is its title, its kind as a word and its code; a document the person may not open is named without its number', () => {
  assert.deepEqual(documentOf({ document_title: 'Password Standard', document_id: 7, document_type: 'standard', document_code: 'STD-004' }),
    { title: 'Password Standard', hidden: false, type: 'Standard', code: 'STD-004' });
  assert.deepEqual(documentOf({ document_title: null, document_id: 7, document_type: 'procedure', document_code: null }),
    { title: HIDDEN_DOCUMENT, hidden: true, type: 'Procedure', code: '' });
  assert.equal(HIDDEN_DOCUMENT, 'A document you cannot open');
  assert.equal(documentOf({ document_title: null, document_id: null }), null);                              // about no document
  assert.equal(documentOf({ policy_name: 'Acceptable Use' })?.title, 'Acceptable Use');                      // older payloads
  assert.ok(!JSON.stringify(documentOf({ document_title: null, document_id: 7 })).includes('7'));
});

test('a document kind is said as a word, and a kind nobody listed reads as itself', () => {
  assert.deepEqual(DOC_TYPES.map((t) => t.value), ['policy', 'standard', 'procedure', 'guideline', 'charter', 'framework']);
  assert.equal(docTypeLabel('standard'), 'Standard');
  assert.equal(docTypeLabel('Charter'), 'Charter');
  assert.equal(docTypeLabel('work_instruction'), 'Work instruction');
  assert.equal(docTypeLabel(null), '');
});

test('the Unit and Document columns sort and export their words', () => {
  const rows = [
    row({ id: 1, title: 'a', document_title: 'Zeta Standard', department_path: ['Operations', 'Support'] }),
    row({ id: 2, title: 'b', document_title: 'Alpha Policy', department_path: ['Finance'] }),
    row({ id: 3, title: 'c', document_title: null, document_id: 9, department_path: [] }),
  ];
  assert.equal(ids(sortRows(rows, cols, { id: 'document', dir: 'asc' })), '3,2,1');                      // 'A document you cannot open', then A to Z
  assert.equal(ids(sortRows(rows, cols, { id: 'unit', dir: 'asc' })), '3,2,1');
  assert.equal(toCsv(cols.filter((c) => c.id === 'document'), [rows[2]]), `Document\n${HIDDEN_DOCUMENT}`);
});

test('a search also finds an exception by its document\'s code and by its unit', () => {
  const list = [
    row({ id: 1, title: 'Legacy VPN', document_title: 'Remote Access Standard', document_code: 'STD-004', department_path: ['Operations', 'Support'] }),
    row({ id: 2, title: 'Old FTP', document_title: 'Data Transfer Policy', document_code: 'POL-011', department_path: ['Finance'] }),
  ];
  assert.equal(ids(searchExceptions(list, 'std-004')), '1');
  assert.equal(ids(searchExceptions(list, 'support')), '1');
  assert.equal(ids(searchExceptions(list, 'finance')), '2');
  assert.deepEqual(searchExceptions(list, 'hr'), []);
});

test('a document of By document is named by its title; one the person may not open (it has a kind and no title) and the exceptions about none (neither) are told apart', () => {
  assert.equal(documentGroupName({ title: 'Password Standard', doc_type: 'standard' }), 'Password Standard');
  assert.equal(documentGroupName({ title: null, doc_type: 'procedure' }), HIDDEN_DOCUMENT);
  assert.equal(documentGroupName({ title: null, doc_type: null }), NO_DOCUMENT);
  assert.equal(NO_DOCUMENT, 'No document');
});

// ── D62: what the address keeps ───────────────────────────────────────────────────────────────────────────────────────────

test('no address is the list with no filter', () => {
  assert.deepEqual(readAddress(ADDRESS, ''), { view: 'list', q: '', status: '', priority: '', unit: '', doctype: '', waiting: false });
  assert.equal(writeAddress(ADDRESS, '', readAddress(ADDRESS, '')), '');
});

test('the view and the filters are read from the address, any case', () => {
  const state = readAddress(ADDRESS, '?view=Unit&unit=12&status=approved&priority=high&doctype=standard&waiting=1&q=vpn');
  assert.deepEqual(state, { view: 'unit', q: 'vpn', status: 'approved', priority: 'high', unit: '12', doctype: 'standard', waiting: true });
  assert.equal(readAddress(ADDRESS, 'view=document').view, 'document');
});

test('an address that says something unusable is the default, so a link can never make the server answer 422', () => {
  const state = readAddress(ADDRESS, '?view=tree&unit=abc&status=bogus&priority=urgent&doctype=memo&waiting=maybe');
  assert.deepEqual(state, { view: 'list', q: '', status: '', priority: '', unit: '', doctype: '', waiting: false });
  for (const bad of ['0', '-3', '1.5', '12abc', '12345678901', ' ']) assert.equal(readAddress(ADDRESS, `unit=${encodeURIComponent(bad)}`).unit, '', bad);
  assert.equal(readAddress(ADDRESS, 'unit=%2012').unit, '12');
});

test('the address of a state: the list is the plain address, a view and the filters are named, and an alert\'s ?open= is left alone', () => {
  const state = { ...readAddress(ADDRESS, ''), view: 'unit' as const, unit: '12' };
  assert.equal(writeAddress(ADDRESS, '', state), 'view=unit&unit=12');
  assert.equal(writeAddress(ADDRESS, '?open=7', { ...state, view: 'list' as const }), 'open=7&unit=12');
  assert.equal(writeAddress(ADDRESS, '?view=unit&unit=12', readAddress(ADDRESS, '')), '');
});

test('the chip of a unit filter says the unit covers what is under it', () => {
  assert.equal(unitChipText('Support'), 'Unit: Support and below');
  assert.equal(unitChipText(null), 'Unit: This unit and below');
  assert.equal(unitChipText('  '), 'Unit: This unit and below');
});

// ── D62: what the list asks of the server ─────────────────────────────────────────────────────────────────────────────────

test('the list sends only the filters that are set, the unit as its number, and never a limit', () => {
  assert.deepEqual(listParams({ status: '', priority: '' }), {});
  assert.deepEqual(listParams({ status: 'approved', priority: '', unit: '12', documentType: 'standard' }), { status: 'approved', unit: 12, document_type: 'standard' });
  assert.deepEqual(listParams({ status: '', priority: 'high' }), { priority: 'high' });
  assert.ok(!('limit' in listParams({ status: 'a', priority: 'b', unit: '1', documentType: 'x' })));
});

test('a full page for a unit or a kind of document cannot be counted from the analytics: it is cut and the total is not known', () => {
  const counts = { total: 172, by_status: { draft: 54 }, by_priority: { high: 39 } };
  assert.deepEqual(serverList(100, { status: '', priority: '', unit: '12' }, counts), { cut: true, total: null });
  assert.deepEqual(serverList(100, { status: 'draft', priority: '', documentType: 'standard' }, counts), { cut: true, total: null });
  assert.deepEqual(serverList(40, { status: '', priority: '', unit: '12' }, counts), { cut: false, total: 40 });      // fewer than the server's limit is all of it
  assert.deepEqual(serverList(100, { status: '', priority: '' }, counts), { cut: true, total: 172 });               // as it was
  assert.equal(cutNotice(100, { cut: true, total: null }, { status: '', priority: '', unit: '12' } as Filters)?.title, 'Showing the first 100 exceptions, there may be more');
});

test('"Waiting for me" is narrowed by the kind of document and by the unit with everything under it, as it is by status and priority', () => {
  const rows = [
    { id: 1, status: 'pending_approval', priority: 'high', document_type: 'standard', department_path: ['Operations', 'Support', 'Helpdesk'] },
    { id: 2, status: 'approved', priority: 'high', document_type: 'policy', department_path: ['Operations', 'Support'] },
    { id: 3, status: 'approved', priority: 'low', document_type: null, department_path: ['Finance'] },
    { id: 4, status: 'approved', priority: 'low', document_type: 'standard' },
  ];
  const f = (over: Partial<Filters>): Filters => ({ status: '', priority: '', ...over });
  assert.deepEqual(waitingRows(rows, f({})).map((r) => r.id), [1, 2, 3, 4]);
  assert.deepEqual(waitingRows(rows, f({ documentType: 'standard' })).map((r) => r.id), [1, 4]);
  assert.deepEqual(waitingRows(rows, f({ unit: '5', unitPath: ['Operations', 'Support'] })).map((r) => r.id), [1, 2]);       // Support and Helpdesk under it
  assert.deepEqual(waitingRows(rows, f({ unit: '6', unitPath: ['Operations', 'Support', 'Helpdesk'] })).map((r) => r.id), [1]);
  assert.deepEqual(waitingRows(rows, f({ unit: '9', unitPath: ['Treasury'] })).map((r) => r.id), []);
  assert.deepEqual(waitingRows(rows, f({ unit: '5', unitPath: ['Operations', 'Support'], documentType: 'policy', status: 'approved' })).map((r) => r.id), [2]);
});

test('a row that waits is a Decide or an Implement; one that waits for nothing has no chip', () => {
  assert.equal(waitingKindLabel('decision'), 'Decide');
  assert.equal(waitingKindLabel('implementation'), 'Implement');
  assert.equal(waitingKindLabel(null), null);
  assert.equal(waitingKindLabel(undefined), null);
  assert.equal(waitingKindLabel('something else'), null);
});

// ── D62: by unit and by document ─────────────────────────────────────────────────────────────────────────────────────────

test('a count is the number, or a dash for none', () => {
  assert.equal(countText(0), '—');
  assert.equal(countText(null), '—');
  assert.equal(countText(7), '7');
  assert.equal(countText(1200), '1,200');
});

test('a unit or a document says its total, then each count it has', () => {
  assert.equal(countsSummary({ total: 5, open: 2, approved: 2, expiring: 1, to_implement: 1 }), '5 exceptions · 2 open · 2 approved · 1 expiring · 1 to implement');
  assert.equal(countsSummary({ total: 1, open: 1, approved: 0, expiring: 0, to_implement: 0 }), '1 exception · 1 open');
  assert.equal(countsSummary({ total: 0, open: 0, approved: 0, expiring: 0, to_implement: 0 }), '0 exceptions');
});

test('a closed unit hides the units under it, and only those', () => {
  const units = [
    { department_id: 1, depth: 0 }, { department_id: 2, depth: 1 }, { department_id: 3, depth: 2 }, { department_id: 4, depth: 1 },
    { department_id: 5, depth: 0 }, { department_id: 6, depth: 1 },
  ];
  const shown = (closed: number[]) => visibleUnits(units, new Set(closed)).map((u) => u.department_id);
  assert.deepEqual(shown([]), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(shown([1]), [1, 5, 6]);                       // 2, 3 and 4 are under 1
  assert.deepEqual(shown([2]), [1, 2, 4, 5, 6]);                 // 3 is under 2, 4 is beside it
  assert.deepEqual(shown([2, 4, 5]), [1, 2, 4, 5]);              // 6 is under 5
  assert.deepEqual(shown([3]), [1, 2, 3, 4, 5, 6]);              // nothing is under 3
  assert.deepEqual(shown([1, 2]), [1, 5, 6]);                    // a unit inside a closed one stays closed
  assert.deepEqual(visibleUnits([], new Set([1])), []);
});

// ── D62: the form ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the form has a business impact and no longer the two long texts: Edit starts with what the exception has', () => {
  assert.deepEqual(emptyForm(), {
    title: '', document_id: '', justification: '', business_impact: '', priority: 'medium', department_id: '', exception_type: '', effective_date: '', expiry_date: '', asset_ids: [],
  });
  const form = formFrom({ title: 'Legacy VPN', document_id: 44, justification: '["Vendor cannot patch"]', business_impact: 'Remote staff lose access', linked_asset_ids: [3, 1],
    effective_date: '2026-10-01T08:22:49', expiry_date: '2026-12-15T08:22:49' });
  assert.deepEqual(form, {
    title: 'Legacy VPN', document_id: 44, justification: 'Vendor cannot patch', business_impact: 'Remote staff lose access', priority: 'medium', department_id: '', exception_type: '',
    effective_date: '2026-10-01', expiry_date: '2026-12-15', asset_ids: [3, 1],
  });
  assert.equal(formFrom({ title: 'x', document_id: null, business_impact: null }).business_impact, '');
  assert.equal(formForPolicy(5).business_impact, '');
});

test('what is sent never holds the two long texts, so an edit wipes nothing; the business impact goes when it has words, and an edit clears it with null', () => {
  const form = { ...emptyForm(), title: 'T', justification: 'J', document_id: '44', business_impact: 'Staff lose access', asset_ids: [1] };
  const created = payloadOf(form, false);
  assert.deepEqual(created, { title: 'T', justification: 'J', priority: 'medium', business_impact: 'Staff lose access', document_id: 44, department_id: null, exception_type: null, asset_ids: [1] });
  for (const editing of [false, true]) {
    const sent = payloadOf(form, editing);
    assert.ok(!('risk_assessment' in sent) && !('compensating_controls' in sent), `editing ${editing}`);
  }
  assert.ok(!('business_impact' in payloadOf({ ...form, business_impact: '  ' }, false)));
  assert.equal(payloadOf({ ...form, business_impact: '' }, true).business_impact, null);
});

test('closing the form has something to lose when the business impact changed', () => {
  const start = formFrom({ title: 'T', document_id: 4, justification: 'J', business_impact: 'B' });
  assert.ok(sameForm(start, { ...start }));
  assert.ok(!sameForm(start, { ...start, business_impact: 'B2' }));
});

test('the unit chooser says which unit the exception will follow when none was chosen', () => {
  assert.equal(unitPlaceholder(['Operations', 'Support'], ''), 'Operations › Support (from the document)');
  assert.equal(unitPlaceholder(['Operations', 'Support'], 'Finance'), 'Operations › Support (from the document)');          // the document in the form wins over what it followed
  assert.equal(unitPlaceholder([], 'Finance'), 'No unit');                                                                  // a document with no unit
  assert.equal(unitPlaceholder(undefined, 'Finance › Treasury'), 'Finance › Treasury (from the document)');                  // not known here: what it already follows
  assert.equal(unitPlaceholder(undefined, ''), "The document's unit");
});

test('AI Assist writes into the empty boxes only, so what the person wrote is kept', () => {
  const answer = { justification: 'The vendor cannot patch.', business_impact: 'Remote staff lose access.' };
  assert.deepEqual(draftPatch({ justification: '', business_impact: '' }, answer), { justification: 'The vendor cannot patch.', business_impact: 'Remote staff lose access.' });
  assert.deepEqual(draftPatch({ justification: 'Mine', business_impact: '' }, answer), { business_impact: 'Remote staff lose access.' });
  assert.deepEqual(draftPatch({ justification: 'Mine', business_impact: 'Mine too' }, answer), {});
  assert.deepEqual(draftPatch({ justification: '  ', business_impact: '' }, { justification: '', business_impact: '  ' }), {});
});

test('Suggest period fills the priority and both days as a draft, and its reason stays only while they are the suggested ones', () => {
  const s = { priority: 'high', effective_date: '2026-11-05', expiry_date: '2027-02-03', rationale: 'The vendor patch is due in three months.' };
  assert.deepEqual(schedulePatch(s), { priority: 'high', effective_date: '2026-11-05', expiry_date: '2027-02-03' });
  assert.deepEqual(schedulePatch({ ...s, effective_date: '2026-11-05T00:00:00' }).effective_date, '2026-11-05');
  assert.ok(stillSuggested(schedulePatch(s), s));
  assert.ok(!stillSuggested({ ...schedulePatch(s), expiry_date: '2027-03-01' }, s));
  assert.ok(!stillSuggested({ ...schedulePatch(s), priority: 'low' }, s));
  assert.ok(!stillSuggested(schedulePatch(s), null));
});

// ── D62: the document picker ─────────────────────────────────────────────────────────────────────────────────────────────

test('with nothing typed the picker lists the documents of the kind chosen by title, as many as it lists', () => {
  const docs = [
    { id: 1, title: 'zeta', doc_type: 'policy' }, { id: 2, title: 'Alpha', doc_type: 'standard' }, { id: 3, title: 'beta', doc_type: 'Standard' }, { id: 4, title: 'Gamma', doc_type: 'procedure' },
  ];
  assert.deepEqual(browseDocuments(docs, '').map((d) => d.id), [2, 3, 4, 1]);
  assert.deepEqual(browseDocuments(docs, 'standard').map((d) => d.id), [2, 3]);
  assert.deepEqual(browseDocuments(docs, 'charter'), []);
  assert.deepEqual(browseDocuments(docs, '', 2).map((d) => d.id), [2, 3]);
  assert.deepEqual(docs.map((d) => d.id), [1, 2, 3, 4]);                                  // the list it was given is not reordered
  assert.equal(PICKER_LIMIT, 20);
});

test('a document the search found in its title and in its clauses is listed once', () => {
  const hits = [{ document_id: 4, match_field: 'title' }, { document_id: 9, match_field: 'content' }, { document_id: 4, match_field: 'policy_statement' }];
  assert.deepEqual(uniqueDocuments(hits).map((h) => `${h.document_id}:${h.match_field}`), ['4:title', '9:content']);
});
