// node --test "src/app/(dashboard)/evidence/_library/libraryModel.test.ts"
// The rules of the Evidence Library: freshness (a lapsed file is one past its date, read when the server sends it and again on the clock), the quick views and what each counts, the
// order of the list, the board, what a bulk action may touch, the export, the facets held to a plain filter, and the address (every old link keeps working).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, countOf } from '../../../../components/records/facetEngine.ts';
import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import type { EvidenceItem } from '../_workspace/evidenceModel.ts';
import { LIBRARY_SCHEMA, OLD_VIEWS, filtersPatch, pageOf, type LibraryAddress } from './libraryAddress.ts';
import {
  NO_FILTERS, RAIL_ORDER, chosenOf, filterChips, filterCount, indexLibrary, orderedOptions, railOptions, removeChip, ruleOf, type Filters,
} from './libraryFacets.ts';
import {
  QUICK_IDS, boardOf, bulkPlan, bulkSentence, exportName, freshnessOf, inQuick, isLapsed, libraryCsv, nextSort, returnedNote, sortRows, DEFAULT_SORT, type LibraryRow, type Viewer,
} from './libraryModel.ts';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW + days * DAY).toISOString().slice(0, 19);       // a naive timestamp, as the server writes it

let n = 0;
function row(over: Partial<EvidenceItem> = {}): LibraryRow {
  n += 1;
  return {
    id: n, tenant_id: 1, name: `File ${n}`, description: null, file_path: null, file_name: `f${n}.pdf`, file_type: 'pdf', version: 1, uploaded_by: 1, uploader_name: 'Ayesha Khan',
    uploaded_at: at(-n), status: 'approved', ocr_status: 'completed', ocr_processed_at: null, evidence_type: 'policy', collection_date: null, validity_period_days: null,
    expiry_date: at(200), is_stale: false, source_system: null, content_summary: null, quality_score: 0.9, submitted_by: null, submitted_at: null, reviewed_by: null, reviewed_at: null,
    review_comments: null, approved_by: null, approved_at: null, owner_id: 2, owner_name: 'Bilal Ahmed', control_mappings_count: 1, links_count: 1, frameworks: ['ISO 27001'], lapsed: false,
    ...over,
  };
}
const VIEWER: Viewer = { me: 2, canReview: true, now: NOW };

// ── freshness ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('lapsed: the server says so, or the date has gone by since it sent the row; an archived file never lapses; no date is not a lapse', () => {
  assert.equal(isLapsed(row({ lapsed: true }), NOW), true);
  assert.equal(isLapsed(row({ expiry_date: at(-1) }), NOW), true, 'the clock moved on after the row was sent');
  assert.equal(isLapsed(row({ status: 'expired', expiry_date: at(300) }), NOW), true, 'expired by hand');
  assert.equal(isLapsed(row({ status: 'archived', lapsed: true, expiry_date: at(-9) }), NOW), false);
  assert.equal(isLapsed(row({ expiry_date: null }), NOW), false);
  assert.equal(isLapsed(row({ expiry_date: at(5) }), NOW), false);
});

test('freshness: lapsed, ending within 30 days (the line the workspace always used), in date, or no date; an archived file has none that matters', () => {
  assert.equal(freshnessOf(row({ expiry_date: at(-2) }), NOW), 'lapsed');
  assert.equal(freshnessOf(row({ expiry_date: at(30) }), NOW), 'expiring');
  assert.equal(freshnessOf(row({ expiry_date: at(31) }), NOW), 'in_date');
  assert.equal(freshnessOf(row({ expiry_date: null }), NOW), 'no_expiry');
  assert.equal(freshnessOf(row({ status: 'archived', expiry_date: at(3) }), NOW), 'no_expiry');
});

test('a reviewer\'s note: only on a draft that was sent back, never after an approval, never blank', () => {
  const sent = { status: 'draft', review_comments: ' Add the signed page ', reviewed_at: at(-3), approved_at: null };
  assert.equal(returnedNote(sent), 'Add the signed page');
  assert.equal(returnedNote({ ...sent, approved_at: at(-30) }), 'Add the signed page', 'approved once long ago, sent back since');
  assert.equal(returnedNote({ ...sent, approved_at: sent.reviewed_at }), null, 'approved at the very moment of the last review: a renewed file, not a returned one');
  assert.equal(returnedNote({ ...sent, status: 'pending_review' }), null);
  assert.equal(returnedNote({ ...sent, review_comments: '   ' }), null);
  assert.equal(returnedNote({ ...sent, reviewed_at: null }), null);
});

// ── the quick views ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('quick views: what each counts, for a reviewer and for a person who may not review; archived files are in none', () => {
  const pending = row({ status: 'pending_review', owner_id: 9 });
  const returned = row({ status: 'draft', owner_id: 2, review_comments: 'fix', reviewed_at: at(-1) });
  const lapsed = row({ expiry_date: at(-5) });
  const soon = row({ expiry_date: at(12) });
  const unrated = row({ quality_score: null });
  const unlinked = row({ links_count: 0, control_mappings_count: 0 });
  const archived = row({ status: 'archived', quality_score: null, links_count: 0 });
  assert.equal(inQuick('waiting', pending, VIEWER), true);
  assert.equal(inQuick('waiting', pending, { ...VIEWER, canReview: false }), false, 'a person who may not review is not waited for');
  assert.equal(inQuick('waiting', returned, VIEWER), true, 'a file of mine that was sent back');
  assert.equal(inQuick('waiting', returned, { ...VIEWER, me: 5 }), false, 'someone else\'s returned file');
  assert.equal(inQuick('lapsed', lapsed, VIEWER), true);
  assert.equal(inQuick('expiring', soon, VIEWER), true);
  assert.equal(inQuick('expiring', lapsed, VIEWER), false);
  assert.equal(inQuick('unrated', unrated, VIEWER), true);
  assert.equal(inQuick('unrated', row({ quality_score: 0 }), VIEWER), false, 'a score of 0 is a score');
  assert.equal(inQuick('unlinked', unlinked, VIEWER), true);
  assert.equal(inQuick('mine', row({ owner_id: null, uploaded_by: 2 }), VIEWER), true, 'uploaded by me and nobody else owns it');
  assert.equal(inQuick('mine', row({ owner_id: 3, uploaded_by: 2 }), VIEWER), false);
  assert.equal(inQuick('mine', row(), { ...VIEWER, me: null }), false);
  for (const id of QUICK_IDS) assert.equal(inQuick(id, archived, VIEWER), false, id);
});

// ── the order ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('sorting: each column both ways, files without the value last whichever way it runs, ties newest first', () => {
  const a = row({ name: 'beta', expiry_date: at(10), quality_score: 0.5, owner_name: 'Zed', owner_id: 3 });
  const b = row({ name: 'Alpha', expiry_date: at(5), quality_score: 0.9, owner_name: 'Amy', owner_id: 4 });
  const c = row({ name: 'gamma', expiry_date: null, quality_score: null, owner_name: null, uploader_name: null, owner_id: null, uploaded_by: null });
  const ids = (key: Parameters<typeof sortRows>[1]['key'], dir: 'asc' | 'desc') => sortRows([a, b, c], { key, dir }).map((r) => r.id);
  assert.deepEqual(ids('name', 'asc'), [b.id, a.id, c.id], 'case does not decide');
  assert.deepEqual(ids('expiry', 'asc'), [b.id, a.id, c.id]);
  assert.deepEqual(ids('expiry', 'desc'), [a.id, b.id, c.id], 'no expiry is last in both directions');
  assert.deepEqual(ids('maturity', 'desc'), [b.id, a.id, c.id]);
  assert.deepEqual(ids('owner', 'asc'), [b.id, a.id, c.id]);
  assert.deepEqual(ids('uploaded', 'desc'), [a.id, b.id, c.id], 'the default: newest first');
  const same = [row({ expiry_date: at(3) }), row({ expiry_date: at(3) })];
  assert.deepEqual(sortRows(same, { key: 'expiry', dir: 'asc' }).map((r) => r.id), [same[0].id, same[1].id], 'a tie falls back to the newest upload');
});

test('a pressed header: a new column in its own first direction, the same one turns, a second turn returns to the default', () => {
  assert.deepEqual(nextSort(DEFAULT_SORT, 'name'), { key: 'name', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'name', dir: 'desc' }, 'name'), DEFAULT_SORT);
  assert.deepEqual(nextSort(DEFAULT_SORT, 'maturity'), { key: 'maturity', dir: 'desc' }, 'strongest first');
});

// ── the board ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the board: Draft, Pending review, Approved and in date, Lapsed; a lapsed draft stays a draft; Rejected only while there is one; archived is off the board', () => {
  const rows = [
    row({ status: 'draft' }), row({ status: 'draft', expiry_date: at(-4) }), row({ status: 'pending_review' }), row({ status: 'approved' }),
    row({ status: 'approved', expiry_date: at(-2) }), row({ status: 'expired' }), row({ status: 'archived' }),
  ];
  const cols = boardOf(rows, NOW);
  assert.deepEqual(cols.map((c) => [c.id, c.rows.length]), [['draft', 2], ['pending_review', 1], ['approved', 1], ['lapsed', 2]]);
  assert.equal(boardOf([...rows, row({ status: 'rejected' })], NOW).at(-1)?.id, 'rejected');
  assert.equal(cols.reduce((s, c) => s + c.rows.length, 0), rows.length - 1, 'every file but the archived one is somewhere');
});

// ── bulk ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('bulk: submit takes drafts, approve takes pending files for a reviewer, a package takes approved files, delete takes all for a person who may; the rest are counted with the reason', () => {
  const rows = [row({ status: 'draft' }), row({ status: 'draft' }), row({ status: 'pending_review' }), row({ status: 'approved' })];
  const rights = { canReview: true, canDelete: true };
  assert.deepEqual(bulkPlan('submit', rows, rights), { ids: [rows[0].id, rows[1].id], skipped: 2, why: 'not a draft' });
  assert.deepEqual(bulkPlan('approve', rows, rights), { ids: [rows[2].id], skipped: 3, why: 'not waiting for review' });
  assert.deepEqual(bulkPlan('approve', rows, { ...rights, canReview: false }), { ids: [], skipped: 4, why: 'you may not approve' });
  assert.deepEqual(bulkPlan('package', rows, rights), { ids: [rows[3].id], skipped: 3, why: 'not approved' });
  assert.equal(bulkPlan('delete', rows, rights).ids.length, 4);
  assert.deepEqual(bulkPlan('delete', rows, { ...rights, canDelete: false }), { ids: [], skipped: 4, why: 'you may not delete' });
  assert.equal(bulkSentence('Submitted', { done: 4, failed: 0, skipped: 0, why: '' }), 'Submitted 4 files.');
  assert.equal(bulkSentence('Approved', { done: 1, failed: 2, skipped: 1, why: 'not waiting for review' }), 'Approved 1 file. 2 files failed. 1 was skipped (not waiting for review).');
});

// ── the export ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the export: a header and a row a file in the order given; a name that looks like a formula is quoted as text; the file name says how many', () => {
  const csv = libraryCsv([row({ name: '=HYPERLINK("x")', frameworks: ['ISO 27001', 'NCA'], expiry_date: at(-3) })], NOW).split('\r\n');
  assert.equal(csv[0], 'Name,Type,Status,Freshness,Owner,Frameworks,Controls linked,Maturity %,Expiry,Uploaded');
  assert.match(csv[1], /^"'=HYPERLINK\(""x""\)",Policy,approved,lapsed,Bilal Ahmed,ISO 27001; NCA,1,90,/);
  assert.equal(exportName('2026-11-08', 42, false), 'evidence-library-2026-11-08-42-files.csv');
  assert.equal(exportName('2026-11-08', 1, true), 'evidence-library-2026-11-08-selected-1-file.csv');
});

// ── the facets, held to a plain filter ───────────────────────────────────────────────────────────────────────────────────
function corpus(): LibraryRow[] {
  const out: LibraryRow[] = [];
  for (let i = 0; i < 120; i += 1) {
    out.push(row({
      status: ['draft', 'pending_review', 'approved', 'approved', 'rejected', 'expired', 'archived'][i % 7],
      evidence_type: [null, 'policy', 'log', 'certificate'][i % 4] as string | null,
      owner_id: i % 5 === 0 ? null : 2 + (i % 3), uploaded_by: i % 10 === 0 ? null : 1, owner_name: i % 5 === 0 ? null : `Owner ${2 + (i % 3)}`, uploader_name: i % 10 === 0 ? null : 'Ayesha Khan',
      frameworks: [[], ['ISO 27001'], ['ISO 27001', 'NCA'], ['SOC 2']][i % 4], expiry_date: [null, at(-9), at(7), at(120)][i % 4], quality_score: [null, 0.3, 0.55, 0.7, 0.95][i % 5],
      links_count: i % 3, name: `Evidence ${i} ${['firewall', 'access', 'backup'][i % 3]}`,
    }));
  }
  return out;
}

function plain(rows: LibraryRow[], f: Filters, viewer: Viewer): LibraryRow[] {
  const terms = f.search.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (f.status.length ? !f.status.includes(r.status) : r.status === 'archived') return false;
    if (f.type.length && !f.type.includes(r.evidence_type || 'other')) return false;
    if (f.owner.length && !f.owner.includes(String(r.owner_id ?? r.uploaded_by ?? 'none'))) return false;
    if (f.framework.length && !(r.frameworks?.length ? r.frameworks : ['none']).some((x) => f.framework.includes(x))) return false;
    if (f.freshness.length && !f.freshness.includes(freshnessOf(r, viewer.now))) return false;
    if (f.maturity.length) {
      const pct = r.quality_score == null ? null : r.quality_score <= 1 ? r.quality_score * 100 : r.quality_score;
      const band = pct == null ? 'unrated' : pct >= 80 ? 'strong' : pct >= 60 ? 'fair' : pct >= 40 ? 'weak' : 'poor';
      if (!f.maturity.includes(band)) return false;
    }
    if (f.quick && !inQuick(f.quick, r, viewer)) return false;
    const text = `${r.name} ${r.file_name ?? ''}`.toLowerCase();
    return terms.every((t) => text.includes(t) || `${r.owner_name ?? ''} ${r.uploader_name ?? ''} ${(r.frameworks ?? []).join(' ')}`.toLowerCase().includes(t) || (r.evidence_type ?? 'other').includes(t));
  });
}

test('the facet engine decides the same files as a plain filter for every facet and value, and the counts equal what choosing the option would show', () => {
  const rows = corpus();
  const index = indexLibrary(rows, NOW);
  const options = railOptions(rows);
  const cases: Filters[] = [NO_FILTERS, { ...NO_FILTERS, search: 'firewall' }, { ...NO_FILTERS, quick: 'waiting' }, { ...NO_FILTERS, quick: 'lapsed', status: ['approved'] }];
  for (const facet of RAIL_ORDER) for (const o of options[facet]) cases.push({ ...NO_FILTERS, [facet]: [o.value] } as Filters);
  cases.push({ ...NO_FILTERS, status: ['archived'] }, { ...NO_FILTERS, status: ['approved', 'draft'], type: ['policy'], freshness: ['lapsed', 'expiring'], search: 'access iso' });
  for (const f of cases) {
    const got = evaluate(index, chosenOf(f), ruleOf(f, VIEWER)).matches.map((r) => r.id).sort((a, b) => a - b);
    const want = plain(rows, f, VIEWER).map((r) => r.id).sort((a, b) => a - b);
    assert.deepEqual(got, want, JSON.stringify(f));
  }
  // the number beside an option is what choosing it would show with the other filters as they are
  const base: Filters = { ...NO_FILTERS, status: ['approved'] };
  const result = evaluate(index, chosenOf(base), ruleOf(base, VIEWER));
  for (const o of options.freshness) {
    const chosen = { ...base, freshness: [o.value] };
    assert.equal(countOf(result.counts, 'freshness', o.value), plain(rows, chosen, VIEWER).length, o.value);
  }
});

test('the rail offers the types, owners and frameworks the files have, keeps "Unassigned" and "No framework", and drops an option nobody has unless it is chosen', () => {
  const rows = [row({ evidence_type: null, owner_id: null, uploaded_by: null, owner_name: null, uploader_name: null, frameworks: [] }), row({ evidence_type: 'log', frameworks: ['NCA'] })];
  const o = railOptions(rows);
  assert.deepEqual(o.type.map((x) => x.label), ['Log', 'Other']);
  assert.deepEqual(o.owner.map((x) => x.label), ['Bilal Ahmed', 'Unassigned']);
  assert.deepEqual(o.framework.map((x) => x.label), ['NCA', 'No framework']);
  assert.deepEqual(o.freshness.map((x) => x.label), ['In date', 'Expiring in 30 days', 'Lapsed', 'No expiry']);
  assert.deepEqual(o.maturity.map((x) => x.label), ['Strong', 'Fair', 'Weak', 'Poor', 'Not rated']);
  assert.deepEqual(orderedOptions(o.freshness, [], (v) => (v === 'in_date' ? 3 : 0)).map((x) => x.value), ['in_date']);
  assert.deepEqual(orderedOptions(o.freshness, ['lapsed'], (v) => (v === 'in_date' ? 3 : 0)).map((x) => x.value), ['in_date', 'lapsed'], 'a chosen option stays, dimmed');
});

test('chips say what is on, one by one, and each comes off alone', () => {
  const rows = corpus();
  const options = railOptions(rows);
  const f: Filters = { ...NO_FILTERS, search: ' firewall ', quick: 'lapsed', status: ['approved'], framework: ['ISO 27001'] };
  assert.equal(filterCount(f), 4);
  const chips = filterChips(f, options);
  assert.deepEqual(chips.map((c) => c.label), ['Search: firewall', 'Lapsed', 'Status: Approved', 'Framework: ISO 27001']);
  let left = f;
  chips.forEach((c) => { left = removeChip(left, c); });
  assert.deepEqual({ ...left, search: left.search.trim() }, NO_FILTERS);
});

// ── the address ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const read = (search: string) => readAddress(LIBRARY_SCHEMA, search) as unknown as LibraryAddress;

test('every old address keeps working: the five old views, ?status=stale, ?evidence_type=, ?open=, ?section=settings; a junk value is the default', () => {
  assert.equal(read('').view, 'list');
  for (const [old, now] of Object.entries(OLD_VIEWS)) assert.equal(read(`?view=${old}`).view, now, old);
  assert.deepEqual(OLD_VIEWS, { workbench: 'list', register: 'list', pipeline: 'board', snapshot: 'insights', performance: 'insights' });
  assert.equal(read('?view=Board').view, 'board');
  assert.equal(read('?view=nonsense').view, 'list');
  const p = pageOf(read('?status=pending_review,stale&evidence_type=policy,log&q=firewall&open=42&section=settings'));
  assert.deepEqual(p.filters.status, ['pending_review'], 'stale is a freshness now');
  assert.deepEqual(p.filters.freshness, ['lapsed']);
  assert.deepEqual(p.filters.type, ['policy', 'log']);
  assert.equal(p.filters.search, 'firewall');
  assert.equal(p.openId, 42);
  assert.equal(p.section, 'settings');
  assert.equal(pageOf(read('?open=-4&section=bad&sort=junk&quick=nope')).openId, null);
  assert.deepEqual(pageOf(read('?sort=expiry:asc')).sort, { key: 'expiry', dir: 'asc' });
  assert.deepEqual(pageOf(read('')).sort, DEFAULT_SORT);
});

test('the filters write back to the address in the names the old one used, and the plain page has the plain address', () => {
  const f: Filters = { ...NO_FILTERS, status: ['approved'], type: ['log'], owner: ['2'], framework: ['ISO 27001'], freshness: ['expiring'], maturity: ['poor'], quick: 'waiting', search: 'a b' };
  const state = { ...read(''), ...filtersPatch(f), view: 'board' as const, open: 9 };
  const query = writeAddress(LIBRARY_SCHEMA, '?keep=1', state as never);
  const back = pageOf(read(`?${query}`));
  assert.deepEqual(back.filters, f);
  assert.equal(back.view, 'board');
  assert.equal(back.openId, 9);
  assert.match(query, /(^|&)keep=1(&|$)/, 'a param that is not the page\'s is left alone');
  assert.equal(writeAddress(LIBRARY_SCHEMA, '', read('') as never), '', 'the defaults are the plain address');
});
