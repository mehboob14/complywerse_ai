// node --test "src/app/(dashboard)/governance/documents/attestation/_rules.test.ts"
// What the Attestation page decides since it moved onto the design-system kit: that the list is cut at 200 and has no total (so the page never says how
// many there are), the order of the loaded rows, a page of acknowledgements, and how a due date (a day) and a signing time (a moment) are said in three
// time zones. (The name a row shows, the coverage and the search are tested in _logic.test.ts, unchanged.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { SERVER_LIMIT, countLabel, cutNotice, isCut, pageOf, sortCampaigns, type CampaignSortFields } from './_logic.ts';

// ── what the server lists ─────────────────────────────────────────────────────────────────────────────────────────────────

test('the server lists at most 200 campaigns, newest first, and its `count` is only how many it sent: so a full page is "cut" and nothing is claimed beyond that', () => {
  assert.equal(SERVER_LIMIT, 200);
  assert.equal(isCut(199), false);
  assert.equal(isCut(200), true);
  assert.equal(isCut(0), false);
});

test('a notice appears only for a full page, says what is shown and that the search and sort use only that', () => {
  assert.equal(cutNotice(0), null);
  assert.equal(cutNotice(199), null);
  assert.deepEqual(cutNotice(200), {
    title: 'Showing the newest 200 campaigns',
    detail: 'Older ones are not listed. Search and sort use these 200 only.',
  });
});

test('the count in the head: as it always was, "200+" for a cut list, and "3 of 200 loaded" while a search narrows a cut list', () => {
  assert.equal(countLabel(9, 9, false), '9 campaigns');
  assert.equal(countLabel(1, 1, false), '1 campaign');
  assert.equal(countLabel(3, 9, true), '3 of 9 campaigns');
  assert.equal(countLabel(200, 200, false, true), '200+ campaigns');
  assert.equal(countLabel(3, 200, true, true), '3 of 200 loaded');
  assert.equal(countLabel(0, 200, true, true), '0 of 200 loaded');
});

// ── order of the loaded rows ──────────────────────────────────────────────────────────────────────────────────────────────

type Row = CampaignSortFields & { id: number };
const row = (id: number, over: Partial<Row> = {}): Row => ({ id, document_title: `Doc ${id}`, status: 'active', attestation_percent: 50, due_date: null, ...over });
const ids = (rows: Row[]) => rows.map((r) => r.id).join(',');

test('the document sorts by its title in natural order, whatever the case, and a document with no title by its number', () => {
  const rows = [row(1, { document_title: 'beta' }), row(2, { document_title: 'Alpha' }), row(3, { document_title: 'Doc 10' }), row(4, { document_title: 'Doc 9' })];
  assert.equal(ids(sortCampaigns(rows, { key: 'document', dir: 'asc' })), '2,1,4,3');
  assert.equal(ids(sortCampaigns(rows, { key: 'document', dir: 'desc' })), '3,4,1,2');
});

test('the coverage sorts by its percent, and a campaign nobody can acknowledge (no percent) is last both ways, never first', () => {
  const rows = [row(1, { attestation_percent: 90 }), row(2, { attestation_percent: null }), row(3, { attestation_percent: 0 }), row(4, { attestation_percent: 56 })];
  assert.equal(ids(sortCampaigns(rows, { key: 'coverage', dir: 'asc' })), '3,4,1,2');
  assert.equal(ids(sortCampaigns(rows, { key: 'coverage', dir: 'desc' })), '1,4,3,2');
});

test('the due date sorts by the day, and a campaign with none is last both ways', () => {
  const rows = [
    row(1, { due_date: '2026-12-31T00:00:00' }), row(2, { due_date: null }), row(3, { due_date: '2026-11-12T00:00:00' }), row(4, { due_date: '2027-03-31T00:00:00' }),
  ];
  assert.equal(ids(sortCampaigns(rows, { key: 'due', dir: 'asc' })), '3,1,4,2');
  assert.equal(ids(sortCampaigns(rows, { key: 'due', dir: 'desc' })), '4,1,3,2');
});

test('the status sorts by its word; no sort keeps the order the server sent (newest first); the input is never touched', () => {
  const rows = [row(1, { status: 'draft' }), row(2, { status: 'closed' }), row(3, { status: 'active' })];
  assert.equal(ids(sortCampaigns(rows, { key: 'status', dir: 'asc' })), '3,2,1');
  assert.equal(ids(sortCampaigns(rows, null)), '1,2,3');
  assert.equal(ids(rows), '1,2,3');
});

// ── a page of acknowledgements ────────────────────────────────────────────────────────────────────────────────────────────

test('a long list of acknowledgements is shown a page at a time, with where the page stands in the whole', () => {
  const acks = Array.from({ length: 800 }, (_, i) => i + 1);
  const first = pageOf(acks, 1, 25);
  assert.equal(first.rows.length, 25);
  assert.deepEqual([first.rows[0], first.rows[24]], [1, 25]);
  assert.deepEqual([first.range.from, first.range.to, first.range.pages], [1, 25, 32]);
  const last = pageOf(acks, 32, 25);
  assert.deepEqual([last.rows[0], last.rows.length], [776, 25]);
  assert.equal(pageOf(acks, 99, 25).range.page, 32);                                     // a page that is not there is brought inside the pages
  assert.equal(pageOf(acks, 0, 25).range.page, 1);
});

test('a short or empty list is one page', () => {
  assert.deepEqual(pageOf([1, 2, 3], 1, 25).rows, [1, 2, 3]);
  const none = pageOf([], 1, 25);
  assert.deepEqual(none.rows, []);
  assert.equal(none.range.pages, 1);
  assert.deepEqual(pageOf(Array.from({ length: 30 }, (_, i) => i), 2, 25).rows, [25, 26, 27, 28, 29]);
});

// ── dates, in three zones ─────────────────────────────────────────────────────────────────────────────────────────────────

const MODULE = new URL('./_logic.ts', import.meta.url).href;
const CHILD = `
  const m = await import(process.argv[1]);
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(JSON.stringify(JSON.parse(input).map(([fn, ...args]) => m[fn](...args))));
`;
function inZone(zone: string, calls: unknown[][]): string[] {
  const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', CHILD, MODULE], { env: { ...process.env, TZ: zone }, input: JSON.stringify(calls), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

// UTC+5 (Karachi), UTC-8 and UTC+13: a due date is a day, so it must not move with the viewer's zone
const ZONES: Array<[string, string]> = [['UTC+5', 'Asia/Karachi'], ['UTC-8', 'Etc/GMT+8'], ['UTC+13', 'Etc/GMT-13']];

for (const [name, zone] of ZONES) {
  test(`a due date is a day: it reads the same in ${name}, as the server wrote it and as the form sent it (midnight UTC)`, () => {
    const out = inZone(zone, [
      ['dayText', '2026-11-12'], ['dayText', '2026-11-12T00:00:00'], ['dayText', '2026-11-12T00:00:00.000Z'], ['dayText', '2026-12-31T23:59:59'],
      ['dayText', null], ['dayText', undefined], ['dayText', ''], ['dayText', '2027-02-29T00:00:00'],
    ]);
    assert.deepEqual(out, ['12 Nov 2026', '12 Nov 2026', '12 Nov 2026', '31 Dec 2026', 'Not set', 'Not set', 'Not set', 'Not set']);
  });
}

test('the time somebody signed is a moment: the viewer\'s own day and clock, and a dash when it was not recorded', () => {
  const at = ['momentText', '2026-12-31T23:30:00'];
  assert.deepEqual(inZone('Asia/Karachi', [at]), ['1 Jan 2027, 04:30']);
  assert.deepEqual(inZone('Etc/GMT+8', [at]), ['31 Dec 2026, 15:30']);
  assert.deepEqual(inZone('Etc/GMT-13', [at]), ['1 Jan 2027, 12:30']);
  assert.deepEqual(inZone('UTC', [['momentText', null], ['momentText', 'nonsense']]), ['—', '—']);
});
