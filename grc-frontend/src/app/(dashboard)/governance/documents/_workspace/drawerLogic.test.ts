import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DASH, attestationSummary, fileLine, inForceText, inWorkflow, keyInfoRows, mappedFrameworkIds, mappedLine, nextTab, tabsFor,
  timelineFromDates, versionText, utcDate,
  type DrawerDoc, type TabId,
} from './drawerLogic.ts';

let n = 0;
const doc = (over: Partial<DrawerDoc> = {}): DrawerDoc => ({
  id: ++n, title: `Doc ${n}`, document_code: 'POL-001', description: null, doc_type: 'policy', status: 'published', classification: 'internal',
  owner_id: 1, owner_name: 'Olivia Owner', author_id: 2, author_name: 'Rana Author', department_id: 10, framework_ids: [], applicable_framework_ids: [],
  tags: [], next_review_date: '2026-12-01T00:00:00', version_in_force: '1.2', current_version: '1.2',
  created_at: '2026-01-05T08:30:00', updated_at: '2026-10-25T10:00:00', file_name: null,
  effective_date: '2026-02-01', expiry_date: null, last_reviewed_at: '2026-06-15T09:00:00', review_cycle_months: 12,
  approved_at: '2026-01-20T12:00:00', published_at: '2026-01-25T12:00:00', has_file: false, file_size: null, file_type: null,
  ...over,
});
const DEPTS = { '10': 'Information Security', '11': 'Operations' };
const rows = (d: DrawerDoc) => keyInfoRows(d, { departments: DEPTS });
const byKey = (d: DrawerDoc) => Object.fromEntries(rows(d).map((r) => [r.key, r]));

// ── key information ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('the Overview lists the facts in the order the library reads them, a platform document without Expires or File', () => {
  assert.deepEqual(rows(doc()).map((r) => r.label), [
    'Owner', 'Department', 'Prepared by', 'Classification', 'Version', 'Effective date', 'Next review', 'Last reviewed',
    'Review cycle', 'Approved', 'Published',
  ]);
});

test('every fact is worded: person, department, classification, version, dates (UTC calendar days), review cycle', () => {
  const r = byKey(doc());
  assert.deepEqual(
    [r.owner.value, r.department.value, r.author.value, r.classification.value, r.version.value],
    ['Olivia Owner', 'Information Security', 'Rana Author', 'Internal', 'v1.2'],
  );
  assert.deepEqual(
    [r.effective.value, r.review.value, r.reviewed.value, r.cycle.value, r.approved.value, r.published.value],
    ['01 Feb 2026', '01 Dec 2026', '15 Jun 2026', 'Every year', '20 Jan 2026', '25 Jan 2026'],
  );
  assert.equal(Object.values(r).some((x) => x.empty), false);
  assert.equal(r.owner.kind, 'person');
  assert.equal(r.review.kind, 'review');           // drawn with how far off the date is
});

test('a fact nobody set says so in its own words, never "Invalid Date"', () => {
  const r = byKey(doc({
    owner_name: null, department_id: null, author_name: '  ', classification: null, current_version: null, version_in_force: null,
    effective_date: null, next_review_date: null, last_reviewed_at: null, review_cycle_months: 0, approved_at: null, published_at: null,
  }));
  assert.deepEqual(
    [r.owner.value, r.department.value, r.author.value, r.classification.value, r.version.value],
    ['Unassigned', DASH, DASH, DASH, DASH],
  );
  assert.deepEqual(
    [r.effective.value, r.review.value, r.reviewed.value, r.cycle.value, r.approved.value, r.published.value],
    [DASH, DASH, 'Never', 'Not set', DASH, DASH],
  );
  assert.equal(Object.values(r).every((x) => x.empty), true);
});

test('a date the server sent in a shape nobody can read is a dash, not "Invalid Date"', () => {
  const all = rows(doc({ effective_date: 'soon', approved_at: 'n/a', last_reviewed_at: '31/31/2026', next_review_date: '??' }));
  assert.equal(all.some((x) => /invalid/i.test(x.value)), false);
  const r = Object.fromEntries(all.map((x) => [x.key, x]));
  assert.deepEqual([r.effective.value, r.approved.value, r.reviewed.value, r.review.value], [DASH, DASH, 'Never', DASH]);
});

test('a department the list does not know (or one that has not loaded yet) is a dash', () => {
  assert.equal(byKey(doc({ department_id: 99 })).department.value, DASH);
  assert.equal(keyInfoRows(doc(), { departments: {} }).find((x) => x.key === 'department')?.value, DASH);
  assert.equal(byKey(doc({ department_id: 11 })).department.value, 'Operations');
});

test('classification is capitalised as a sentence', () => {
  assert.equal(byKey(doc({ classification: 'confidential' })).classification.value, 'Confidential');
  assert.equal(byKey(doc({ classification: 'TOP_SECRET' })).classification.value, 'Top secret');
});

test('the version says which one is in force while a newer one is on its way', () => {
  const r = byKey(doc({ status: 'pending_review', current_version: '1.3', version_in_force: '1.2' }));
  assert.deepEqual([r.version.value, r.version.note], ['v1.3', 'v1.2 in force']);
  assert.equal(byKey(doc()).version.note, undefined);                                 // the same number: nothing to add
  assert.equal(byKey(doc({ version_in_force: null, status: 'draft' })).version.note, undefined);
});

test('Expires appears only when the document expires, File only when it carries one', () => {
  const plain = rows(doc()).map((x) => x.key);
  assert.equal(plain.includes('expires') || plain.includes('file'), false);
  const r = byKey(doc({ expiry_date: '2027-03-31', has_file: true, file_name: 'Access Control Policy.docx', file_type: 'docx', file_size: 49152 }));
  assert.equal(r.expires.value, '31 Mar 2027');
  assert.equal(r.file.value, 'Access Control Policy.docx · Word · 48 KB');
  assert.equal(r.file.wide, true);                                                    // a long name gets the whole row
  assert.equal(rows(doc({ expiry_date: 'garbage' })).some((x) => x.key === 'expires'), false);
  const full = rows(doc({ expiry_date: '2027-03-31', has_file: true, file_name: 'a.pdf' }));
  assert.equal(new Set(full.map((x) => x.key)).size, full.length);                   // the keys React lists them by are unique
  assert.equal(full.length, 13);
});

test('the file line says whatever of name, kind and size there is', () => {
  assert.equal(fileLine({ has_file: true, file_name: 'Plan.pdf', file_type: 'pdf', file_size: 2048 }), 'Plan.pdf · PDF · 2 KB');
  assert.equal(fileLine({ has_file: true, file_name: null, file_type: 'xlsx', file_size: null }), 'Excel');
  assert.equal(fileLine({ has_file: true, file_name: 'data.bin', file_type: null, file_size: 0 }), 'data.bin · 0 B');   // no kind word for an unknown kind
  assert.equal(fileLine({ has_file: true, file_name: null, file_type: null, file_size: null }), 'Attached file');
});

test('the dates are written by the function the component passes in', () => {
  const r = keyInfoRows(doc(), { departments: DEPTS }, (d) => (d ? `D${d.getUTCDate()}` : ''));
  assert.equal(r.find((x) => x.key === 'effective')?.value, 'D1');
});

test('version words match the library: a "v" in front, a dash for none, "in force" only when it differs', () => {
  assert.deepEqual([versionText('1.2'), versionText('v2.0'), versionText(null), versionText('')], ['v1.2', 'v2.0', DASH, DASH]);
  assert.equal(inForceText({ version_in_force: '1.0', current_version: '1.1' }), 'v1.0 in force');
  assert.equal(inForceText({ version_in_force: '1.1', current_version: '1.1' }), null);
  assert.equal(inForceText({ version_in_force: null, current_version: '1.1' }), null);
});

// ── the document's own dates ──────────────────────────────────────────────────────────────────────────────────────────────

test('the fallback timeline holds the dates the document has, oldest first', () => {
  const t = timelineFromDates(doc());
  assert.deepEqual(t.map((e) => [e.key, e.label, e.text]), [
    ['created', 'Created', '05 Jan 2026'],
    ['approved', 'Approved', '20 Jan 2026'],
    ['published', 'Published', '25 Jan 2026'],
    ['effective', 'Effective', '01 Feb 2026'],
  ]);
});

test('the fallback timeline skips what is missing or unreadable, and sorts by date rather than by field', () => {
  assert.deepEqual(timelineFromDates(doc({ approved_at: null, published_at: null, effective_date: null })).map((e) => e.key), ['created']);
  assert.deepEqual(timelineFromDates(doc({ approved_at: 'x', effective_date: '' })).map((e) => e.key), ['created', 'published']);
  // effective before it was approved (a backdated policy): date order wins
  assert.deepEqual(timelineFromDates(doc({ effective_date: '2026-01-10' })).map((e) => e.key), ['created', 'effective', 'approved', 'published']);
  // the same day keeps the fixed order
  assert.deepEqual(
    timelineFromDates(doc({ created_at: '2026-01-05T00:00:00', approved_at: '2026-01-05T00:00:00', published_at: '2026-01-05T00:00:00', effective_date: '2026-01-05' })).map((e) => e.key),
    ['created', 'approved', 'published', 'effective'],
  );
});

// ── status, tabs ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the five workflow stages are drawn as dots; expired, archived and exception are outside it', () => {
  for (const s of ['draft', 'pending_review', 'pending_approval', 'approved', 'published']) assert.equal(inWorkflow(s), true, s);
  for (const s of ['expired', 'archived', 'exception_applied', 'something_new']) assert.equal(inWorkflow(s), false, s);
});

test('the tabs, with the number of frameworks the table shows (each once)', () => {
  assert.deepEqual(tabsFor(doc()).map((t) => t.label), ['Overview', 'Workflow', 'Versions', 'Frameworks (0)']);
  assert.deepEqual(tabsFor(doc()).map((t) => t.id), ['overview', 'workflow', 'versions', 'frameworks']);
  // applicable frameworks win when set; else the document's own; a repeated id counts once
  assert.equal(tabsFor(doc({ framework_ids: [1, 2, 3], applicable_framework_ids: [2, 2, 5] }))[3].label, 'Frameworks (2)');
  assert.equal(tabsFor(doc({ framework_ids: [1, 2, 3], applicable_framework_ids: [] }))[3].label, 'Frameworks (3)');
  assert.equal(tabsFor(doc({ framework_ids: null, applicable_framework_ids: null }))[3].label, 'Frameworks (0)');
  assert.deepEqual(mappedFrameworkIds(doc({ applicable_framework_ids: [4, 2, 4] })), [4, 2]);
  assert.deepEqual([mappedLine(0), mappedLine(1), mappedLine(12)], ['Mapped to 0 frameworks', 'Mapped to 1 framework', 'Mapped to 12 frameworks']);
});

test('arrow keys move between the tabs, wrapping round; Home and End jump; other keys do nothing', () => {
  const ids: TabId[] = ['overview', 'workflow', 'versions', 'frameworks'];
  assert.equal(nextTab(ids, 'overview', 'ArrowRight'), 'workflow');
  assert.equal(nextTab(ids, 'frameworks', 'ArrowRight'), 'overview');
  assert.equal(nextTab(ids, 'overview', 'ArrowLeft'), 'frameworks');
  assert.equal(nextTab(ids, 'versions', 'ArrowLeft'), 'workflow');
  assert.equal(nextTab(ids, 'versions', 'Home'), 'overview');
  assert.equal(nextTab(ids, 'versions', 'End'), 'frameworks');
  assert.equal(nextTab(ids, 'versions', 'Enter'), null);
  assert.equal(nextTab(ids, 'versions', 'ArrowDown'), null);
  assert.equal(nextTab(['overview'], 'workflow' as TabId, 'ArrowRight'), null);        // not one of the tabs
});

// ── attestation ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('attestation: nothing requested, or the counts when the server says them, or the percentage alone', () => {
  const none = attestationSummary(undefined, undefined);
  assert.deepEqual([none.requested, none.headline, none.detail], [false, 'No acknowledgement has been requested', null]);

  const some = attestationSummary(80, { done: 4, total: 5 });
  assert.deepEqual([some.requested, some.headline, some.detail, some.pct, some.done, some.total], [true, '4 of 5 people acknowledged', '1 still to acknowledge', 80, 4, 5]);

  assert.deepEqual(
    [attestationSummary(0, { done: 0, total: 3 }).headline, attestationSummary(0, { done: 0, total: 3 }).detail],
    ['0 of 3 people acknowledged', '3 still to acknowledge'],
  );
  const all = attestationSummary(100, { done: 5, total: 5 });
  assert.deepEqual([all.headline, all.detail], ['5 of 5 people acknowledged', 'Everyone has acknowledged']);
  assert.equal(attestationSummary(100, { done: 1, total: 1 }).headline, '1 of 1 person acknowledged');

  const pctOnly = attestationSummary(66.6, undefined);
  assert.deepEqual([pctOnly.requested, pctOnly.headline, pctOnly.detail, pctOnly.done], [true, '67% acknowledged', null, null]);
  assert.equal(attestationSummary(100, null).detail, 'Everyone has acknowledged');
  assert.equal(attestationSummary(0, undefined).requested, true);                       // a campaign nobody has answered yet is still a campaign
});

test('attestation: counts without a percentage (an older server) give the percentage; an empty campaign counts for nothing', () => {
  const s = attestationSummary(undefined, { done: 1, total: 4 });
  assert.deepEqual([s.requested, s.pct, s.headline], [true, 25, '1 of 4 people acknowledged']);
  assert.equal(attestationSummary(undefined, { done: 0, total: 0 }).requested, false);
});

test('the default date words are the library\'s: day, short month, year, in UTC', () => {
  assert.equal(utcDate(new Date('2026-10-26T23:30:00Z')), '26 Oct 2026');
  assert.equal(utcDate(null), '');
});
