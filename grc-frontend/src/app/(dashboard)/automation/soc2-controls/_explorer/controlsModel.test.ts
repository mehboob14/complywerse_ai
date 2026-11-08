// node --test "src/app/(dashboard)/automation/soc2-controls/_explorer/controlsModel.test.ts"
// The Controls explorer's decisions: the quick views and their counts (the Overview's definitions), the sort, the board, the search text and the export.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_COLUMNS, csvCell, columnOf, exportName, frameworksOf, haystack, inQuick, isMine, nextSort, quickCounts, searchTerms, sortControls, statusWord, subline, testOverdue, toCsv, withIds, wordsOf,
  type ControlRow,
} from './controlsModel.ts';
import { CONTROL_STATUS_ORDER } from '../../../../../lib/statuses/controls.ts';

const NOW = new Date('2026-11-08T10:00:00Z');
const ctx = { me: 7, now: NOW };
const row = (id: string, over: Partial<ControlRow> = {}): ControlRow => ({
  control_id: id, title: `Title of ${id}`, category: 'Identity', sub_type: 'Manual', requirements: {}, requirement_count: 0, checks_count: 0, overall_status: 'manual',
  owner_user_id: null, owner_name: null, assigned_user_ids: [], ownership_status: 'unowned', next_test_date: null, ...over,
});
const rows = withIds([
  row('IAC-06', { overall_status: 'failed', sub_type: 'Automated', owner_user_id: 7, owner_name: 'Amina Khan', ownership_status: 'ok', requirements: { soc2: [{ code: 'CC6.1' }], iso27001: [{ code: 'A.8.2' }] }, next_test_date: '2026-10-01T00:00:00' }),
  row('GOV-02', { overall_status: 'passed', sub_type: 'Hybrid', assigned_user_ids: [7], owner_user_id: 9, owner_name: 'Bilal Noor', ownership_status: 'overdue', next_test_date: '2026-12-01T00:00:00' }),
  row('IAC-10', { overall_status: 'collection_failed', sub_type: 'Automated' }),
  row('BCD-04', { overall_status: 'not_run', custom: true }),
  row('GOV-10', { overall_status: 'weird_new_word' }),
]);

test('withIds numbers the controls in the order of the load, and keeps every field', () => {
  assert.deepEqual(rows.map((r) => r.i), [0, 1, 2, 3, 4]);
  assert.equal(rows[0].control_id, 'IAC-06');
});

test('the frameworks of a control are those with at least one requirement code', () => {
  assert.deepEqual(frameworksOf(rows[0]), ['soc2', 'iso27001']);
  assert.deepEqual(frameworksOf(row('X', { requirements: { soc2: [] } })), []);
  assert.deepEqual(frameworksOf(row('X', { requirements: null })), []);
});

test('mine is owned or assigned, never just reviewed, and nobody is nobody\'s', () => {
  assert.equal(isMine(rows[0], 7), true);
  assert.equal(isMine(rows[1], 7), true);
  assert.equal(isMine(rows[2], 7), false);
  assert.equal(isMine(rows[0], null), false);
});

test('a test is overdue when the work item\'s next test date has passed (server time is UTC)', () => {
  assert.equal(testOverdue(rows[0], NOW), true);
  assert.equal(testOverdue(rows[1], NOW), false);
  assert.equal(testOverdue(rows[2], NOW), false);
  assert.equal(testOverdue(row('X', { next_test_date: '2026-11-08T09:59:59' }), NOW), true);
  assert.equal(testOverdue(row('X', { next_test_date: '2026-11-08T10:00:01' }), NOW), false);
});

test('the quick views and their true counts', () => {
  assert.deepEqual(quickCounts(rows, ctx), { all: 5, failing: 1, mine: 2, unowned: 3, overdue: 1, automated: 2 });
  assert.equal(inQuick('all', rows[3], ctx), true);
  assert.equal(inQuick('failing', rows[0], ctx), true);
  assert.equal(inQuick('failing', rows[2], ctx), false, 'Not collected is never Failing');
});

test('the board holds every status word, in the first column that takes it, and a word nobody registered waits', () => {
  for (const word of CONTROL_STATUS_ORDER) assert.ok(BOARD_COLUMNS.some((c) => (c.words as readonly string[]).includes(word)), `${word} has a column`);
  assert.equal(columnOf('failed'), 'failing');
  assert.equal(columnOf('collection_failed'), 'attention');
  assert.equal(columnOf('passed'), 'passing');
  assert.equal(columnOf('unbound'), 'waiting');
  assert.equal(columnOf('manual'), 'manual');
  assert.equal(columnOf('weird_new_word'), 'waiting');
  assert.deepEqual(wordsOf('attention'), ['expired', 'collection_failed', 'error', 'partial']);
  assert.deepEqual(wordsOf('nope'), []);
});

test('sort: codes in reading order, status by what needs a person first, empty values last in both directions', () => {
  const codes = (rs: ControlRow[]) => rs.map((r) => r.control_id);
  assert.deepEqual(codes(sortControls(rows, { key: 'code', dir: 'asc' })), ['BCD-04', 'GOV-02', 'GOV-10', 'IAC-06', 'IAC-10']);
  assert.deepEqual(codes(sortControls(rows, { key: 'code', dir: 'desc' })), ['IAC-10', 'IAC-06', 'GOV-10', 'GOV-02', 'BCD-04']);
  assert.deepEqual(codes(sortControls(rows, { key: 'status', dir: 'asc' })), ['IAC-06', 'IAC-10', 'GOV-02', 'BCD-04', 'GOV-10']);
  assert.deepEqual(codes(sortControls(rows, { key: 'next', dir: 'asc' })).slice(0, 2), ['IAC-06', 'GOV-02']);
  assert.deepEqual(codes(sortControls(rows, { key: 'next', dir: 'desc' })).slice(0, 2), ['GOV-02', 'IAC-06']);
  assert.deepEqual(codes(sortControls(rows, { key: 'owner', dir: 'asc' })).slice(0, 2), ['IAC-06', 'GOV-02'], 'Amina before Bilal; nobody last');
  assert.deepEqual(codes(sortControls(rows, { key: 'owner', dir: 'desc' })).slice(0, 2), ['GOV-02', 'IAC-06'], 'nobody still last when it runs the other way');
  assert.deepEqual(codes(sortControls(withIds([row('A-10'), row('A-9'), row('A-100')]), { key: 'code', dir: 'asc' })), ['A-9', 'A-10', 'A-100']);
});

test('pressing a column starts it in its first direction, then turns it round', () => {
  assert.deepEqual(nextSort({ key: 'code', dir: 'asc' }, 'status'), { key: 'status', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'status', dir: 'asc' }, 'status'), { key: 'status', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'status', dir: 'desc' }, 'status'), { key: 'status', dir: 'asc' });
});

test('search reads the code, the name, the domain, the owner and every requirement code, and ignores case and accents', () => {
  const h = haystack(rows[0]);
  for (const word of ['iac-06', 'identity', 'amina khan', 'cc6.1', 'a.8.2']) assert.ok(h.includes(word), word);
  assert.deepEqual(searchTerms('  MFA  Admins '), ['mfa', 'admins']);
  assert.deepEqual(searchTerms('Café'), ['cafe']);
  assert.deepEqual(searchTerms('   '), []);
});

test('what a row says: the status word and the line under the name', () => {
  assert.equal(statusWord(rows[0]), 'Failing');
  assert.equal(statusWord(row('X', { overall_status: '' })), 'Not run');
  assert.equal(subline(rows[3]), 'Identity · Custom control');
  assert.equal(subline(rows[0]), 'Identity');
});

test('the export: one line a control, formulas defused, a name that says what it holds', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  const csv = toCsv([rows[0]], { framework: (k) => ({ soc2: 'SOC 2', iso27001: 'ISO 27001' } as Record<string, string>)[k] ?? k });
  const [head, line] = csv.split('\r\n');
  assert.ok(head.startsWith('Code,Name,Domain'));
  assert.ok(line.startsWith('IAC-06,Title of IAC-06,Identity,Automated,Failing,Amina Khan,SOC 2; ISO 27001,0,'));
  assert.equal(exportName('2026-11-08', 12, false), 'controls-2026-11-08-12.csv');
  assert.equal(exportName('2026-11-08', 3, true), 'controls-2026-11-08-selection-3.csv');
});
