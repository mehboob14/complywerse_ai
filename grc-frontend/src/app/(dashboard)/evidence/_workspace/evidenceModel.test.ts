// node --test "src/app/(dashboard)/evidence/_workspace/evidenceModel.test.ts"
// The rules of the Evidence workspace. The formulas that MOVED here from lib.tsx / EvidenceWorkspace.tsx / SnapshotView.tsx are compared with a frozen copy
// of the old code (the "old*" functions below) on the same inputs, so "the calculations are preserved" is a test, not a promise.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_FILTERS, PIPELINE_STATUSES, STALL_MS, advanceStep, approvalRate, approvedShare, boardColumns, csvCell, ownerBoard, cutNotice, deriveApplicableFrameworks, effectiveSelected, expiryReading,
  filterItems, initialsOf, isFiltered, listIsBusy, matchesStatus, maturityOf, monthName, normPct, offBoard, optionAfter, ownerOf, pageOfId, pageOfRows,
  registerCsv, reviewWord, statusSplit, tiles, topTypes, trendReading, typeLabel, typeOptions, type EvidenceItem, type EvidenceSummary,
} from './evidenceModel.ts';

// ── the old code, verbatim ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const oldExpiry = (expiry: string | null | undefined, now: number) => {            // lib.tsx expiryInfo
  if (!expiry) return { tone: 'muted', days: null };
  const days = Math.ceil((new Date(expiry).getTime() - now) / 86_400_000);
  if (days < 0) return { tone: 'danger', days };
  if (days <= 30) return { tone: 'warning', days };
  return { tone: 'success', days };
};
const oldNormPct = (v: number | null | undefined) => (v == null ? null : v <= 1 ? Math.round(v * 100) : Math.round(v));
const oldBand = (pct: number | null) => (pct == null ? 'none' : pct >= 80 ? 'emerald' : pct >= 60 ? 'amber' : pct >= 40 ? 'orange' : 'rose');   // qualityBarColor
const oldFilter = (all: EvidenceItem[], statusFilter: string, typeFilter: string, search: string) => {              // EvidenceWorkspace items memo
  const q = search.trim().toLowerCase();
  return all.filter((e) => {
    if (statusFilter === 'stale') { if (!e.is_stale) return false; } else if (statusFilter && e.status !== statusFilter) return false;
    if (typeFilter && e.evidence_type !== typeFilter) return false;
    if (q) { const hay = `${e.name} ${e.owner_name ?? ''} ${e.uploader_name ?? ''} ${e.source_system ?? ''}`.toLowerCase(); if (!hay.includes(q)) return false; }
    return true;
  });
};
function oldDerive(byFramework: Array<{ framework_name: string; controls?: unknown[] }> | undefined, clause: string[] | undefined, ai: string[] | undefined) {   // lib.tsx
  const linked = new Map<string, number>();
  for (const f of byFramework || []) if (f.framework_name) linked.set(f.framework_name, (f.controls?.length ?? 0));
  const suggested = new Map<string, number>();
  for (const n of clause || []) if (n && !linked.has(n)) suggested.set(n, (suggested.get(n) || 0) + 1);
  for (const raw of ai || []) { const n = (raw || '').split(':')[0].trim(); if (n && !linked.has(n) && !suggested.has(n)) suggested.set(n, 1); }
  const out: Array<{ name: string; count: number; linked: boolean }> = [];
  Array.from(linked.entries()).forEach(([name, count]) => out.push({ name, count: count || 1, linked: true }));
  Array.from(suggested.entries()).forEach(([name, count]) => out.push({ name, count, linked: false }));
  return out;
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let seq = 0;
const item = (over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: ++seq, tenant_id: 1, name: `Item ${seq}`, description: null, file_path: 'f', file_name: 'f.pdf', file_type: 'application/pdf', version: 1, uploaded_by: 1,
  uploader_name: 'Uma Uploader', uploaded_at: '2026-10-01T10:00:00', status: 'draft', ocr_status: 'completed', ocr_processed_at: null, evidence_type: 'policy',
  collection_date: null, validity_period_days: null, expiry_date: null, is_stale: false, source_system: null, content_summary: null, quality_score: null,
  submitted_by: null, submitted_at: null, reviewed_by: null, reviewed_at: null, review_comments: null, approved_by: null, approved_at: null, ...over,
});
const NOW = Date.parse('2026-11-01T12:00:00Z');
const DAY = 86_400_000;

const set = [
  item({ name: 'Firewall review', status: 'approved', evidence_type: 'log', owner_name: 'Olivia Owner', source_system: 'Splunk' }),
  item({ name: 'Access policy', status: 'pending_review', evidence_type: 'policy', uploader_name: 'Sam Smith' }),
  item({ name: 'Backup test', status: 'draft', evidence_type: null, is_stale: true }),
  item({ name: 'Old certificate', status: 'expired', evidence_type: 'certificate', is_stale: true }),
  item({ name: 'Pen test', status: 'rejected', evidence_type: 'policy' }),
  item({ name: 'Archive me', status: 'archived', evidence_type: 'log' }),
];

// ── filters ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the filter keeps what the old single-choice filter kept, for every status / type / search it could be given', () => {
  const statuses = ['', 'draft', 'pending_review', 'approved', 'rejected', 'expired', 'archived', 'stale'];
  const types = ['', 'policy', 'log', 'certificate', 'other', 'nothing'];
  const searches = ['', 'fire', '  OLIVIA ', 'sam', 'splunk', 'zzz', 'uma'];
  let cases = 0;
  for (const s of statuses) for (const t of types) for (const q of searches) {
    const old = oldFilter(set, s, t, q).map((e) => e.id);
    const now = filterItems(set, { q, status: s ? [s] : [], types: t ? [t] : [] }).map((e) => e.id);
    assert.deepEqual(now, old, `status=${s} type=${t} q=${q}`);
    cases++;
  }
  assert.equal(cases, 8 * 6 * 7);
});

test('several statuses or types are a union, stale is the flag, and nothing chosen keeps everything', () => {
  assert.deepEqual(filterItems(set, { q: '', status: ['draft', 'approved'], types: [] }).map((e) => e.name), ['Firewall review', 'Backup test']);
  assert.deepEqual(filterItems(set, { q: '', status: ['stale'], types: [] }).map((e) => e.name), ['Backup test', 'Old certificate']);
  assert.deepEqual(filterItems(set, { q: '', status: ['approved', 'stale'], types: [] }).map((e) => e.name), ['Firewall review', 'Backup test', 'Old certificate']);
  assert.deepEqual(filterItems(set, { q: '', status: [], types: ['log', 'certificate'] }).map((e) => e.name), ['Firewall review', 'Old certificate', 'Archive me']);
  assert.equal(filterItems(set, NO_FILTERS).length, set.length);
  assert.equal(matchesStatus(set[0], []), true);
  assert.equal(isFiltered(NO_FILTERS), false);
  assert.equal(isFiltered({ ...NO_FILTERS, q: ' x ' }), true);
  assert.equal(isFiltered({ ...NO_FILTERS, q: '   ' }), false);
});

test('QUIRK pinned: a file with no type is "Other" in words but never passes a type choice; the search reads name, owner, uploader and source only', () => {
  assert.equal(typeLabel(null), 'Other');
  assert.deepEqual(filterItems(set, { q: '', status: [], types: ['other'] }), []);
  assert.deepEqual(filterItems([item({ name: 'x', description: 'findme' })], { ...NO_FILTERS, q: 'findme' }), []);
});

test('type options: the server list when it answered, else the types found; selection falls back to the first file', () => {
  assert.deepEqual(typeOptions([{ value: 'a', label: 'A' }], set), [{ value: 'a', label: 'A' }]);
  assert.deepEqual(typeOptions([], set), [{ value: 'log', label: 'Log' }, { value: 'policy', label: 'Policy' }, { value: 'certificate', label: 'Certificate' }]);
  assert.equal(effectiveSelected(set, set[2].id), set[2].id);
  assert.equal(effectiveSelected(set, 99999), set[0].id);
  assert.equal(effectiveSelected(set, null), set[0].id);
  assert.equal(effectiveSelected([], 5), null);
});

test('words: type, owner, initials', () => {
  assert.equal(typeLabel('audit_report'), 'Audit Report');
  assert.equal(ownerOf({ owner_name: 'A', uploader_name: 'B' }), 'A');
  assert.equal(ownerOf({ owner_name: null, uploader_name: 'B' }), 'B');
  assert.equal(ownerOf({ owner_name: null, uploader_name: null }), null);
  assert.equal(initialsOf('Olivia Owner'), 'OO');
  assert.equal(initialsOf('Cher'), 'CH');
  assert.equal(initialsOf(null), '');
});

// ── true totals ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a cut list says so with the server\'s total; a whole list says nothing', () => {
  assert.equal(cutNotice(172, 172), null);
  assert.equal(cutNotice(172, undefined), null);
  assert.equal(cutNotice(0, 0), null);
  const n = cutNotice(1000, 1240);
  assert.equal(n?.title, 'Showing the newest 1,000 of 1,240 evidence items');
  assert.match(n?.text ?? '', /figures in the cards are for all of them/);
});

test('the cards read the summary only; a failed summary is null, and no evidence is not 0%', () => {
  assert.equal(tiles(undefined), null);
  assert.equal(tiles(null), null);
  const s: EvidenceSummary = { total_count: 172, by_status: { approved: 51, pending_review: 52, draft: 44 }, by_type: {}, stale_count: 8, expiring_soon_count: 43, pending_review_count: 52 };
  assert.deepEqual(tiles(s), { total: 172, approved: 51, approvedPct: 30, pending: 52, expiring: 43 });
  assert.equal(tiles({ ...s, total_count: 0, by_status: {} })?.approvedPct, null);
  assert.equal(tiles({ ...s, by_status: {} })?.approved, 0);
  assert.equal(approvalRate(s), 30);
  assert.equal(approvalRate({ ...s, total_count: 0 }), null);
  assert.equal(approvalRate(undefined), null);
});

// ── expiry and maturity ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('expiry keeps the old day count and thresholds on a range of dates (expired < 0, expiring up to 30, valid beyond)', () => {
  const tone = { expired: 'danger', expiring: 'warning', valid: 'success', none: 'muted' } as const;
  for (let hours = -24 * 70; hours <= 24 * 70; hours += 7) {
    const when = new Date(NOW + hours * 3_600_000).toISOString().slice(0, 19);       // a naive timestamp, as the server writes it
    const old = oldExpiry(when, NOW);
    const now = expiryReading(when, NOW);
    assert.equal(now.days, old.days, when);
    assert.equal(tone[now.word], old.tone, when);
  }
  assert.deepEqual(expiryReading(null, NOW), { word: 'none', days: null, text: 'No expiry' });
  assert.equal(oldExpiry(undefined, NOW).tone, 'muted');
});

test('expiry words: days, a plural only when needed, today, and an unreadable date is a dash', () => {
  const at = (days: number) => new Date(NOW + days * DAY - 1000).toISOString().slice(0, 19);
  assert.equal(expiryReading(at(12), NOW).text, '12 days left');
  assert.equal(expiryReading(at(1), NOW).text, '1 day left');
  assert.equal(expiryReading(at(0), NOW).text, 'Expires today');
  assert.equal(expiryReading(at(-3), NOW).text, 'Expired 3 days ago');
  assert.equal(expiryReading(new Date(NOW - 1.5 * DAY).toISOString().slice(0, 19), NOW).text, 'Expired 1 day ago');
  assert.equal(expiryReading('2026-11-01', NOW).word, 'expiring', 'a date-only value is read at the start of its day');
  assert.equal(expiryReading(at(30), NOW).word, 'expiring');
  assert.equal(expiryReading(at(31), NOW).word, 'valid');
  assert.deepEqual(expiryReading('not a date', NOW), { word: 'none', days: null, text: '—' });
});

test('maturity: the bands are the ones the bars were coloured by (80, 60, 40) and the percent rule is unchanged', () => {
  const band = { emerald: 'strong', amber: 'fair', orange: 'weak', rose: 'poor', none: 'unrated' } as const;
  for (const v of [null, undefined, 0, 0.2, 0.39, 0.4, 0.59, 0.6, 0.79, 0.8, 1, 1.5, 39, 39.4, 40, 59.9, 60, 79, 80, 100]) {
    assert.equal(normPct(v), oldNormPct(v), String(v));
    assert.equal(maturityOf(normPct(v)), band[oldBand(oldNormPct(v)) as keyof typeof band], String(v));
  }
});

// ── the AI review ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the AI-review word: rated wins; an active run is told by its step; failed, lost and unavailable runs say so; a stalled reading and a missing run too', () => {
  const brief = (status: 'queued' | 'running' | 'done' | 'failed' | 'unavailable' | null, extra: object = {}) => ({ status, ...extra });
  assert.equal(reviewWord({ score: 74, review: brief('failed') }), 'rated');
  assert.equal(reviewWord({ score: 0, review: brief('running') }), 'rated', 'a score of 0 is a score');
  assert.equal(reviewWord({ score: null, review: brief('queued') }), 'queued');
  assert.equal(reviewWord({ score: null, review: brief('running', { step: 'reading' }) }), 'reading');
  assert.equal(reviewWord({ score: null, review: brief('running', { step: 'rating' }) }), 'rating');
  assert.equal(reviewWord({ score: null, review: brief('running', { step: 'matching' }) }), 'matching');
  assert.equal(reviewWord({ score: null, review: brief('running') }), 'reading');
  assert.equal(reviewWord({ score: null, review: brief('failed', { error: 'x' }) }), 'failed');
  assert.equal(reviewWord({ score: null, review: brief('failed', { stopped: true }) }), 'stopped');
  assert.equal(reviewWord({ score: null, review: brief('unavailable') }), 'unavailable');
  assert.equal(reviewWord({ score: null, review: brief('done') }), 'none');
  assert.equal(reviewWord({ score: null, review: null, ocrStalled: true }), 'ocr_stalled');
  assert.equal(reviewWord({ score: null }), 'none');
});

test('the list polls while something is being read or reviewed, and a reading begun more than ten minutes ago is not waited for', () => {
  const iso = (ago: number) => new Date(NOW - ago).toISOString().slice(0, 19);
  assert.equal(listIsBusy([], NOW), false);
  assert.equal(listIsBusy([{ ocr_status: 'completed', ai_review: null, uploaded_at: iso(1000) }], NOW), false);
  assert.equal(listIsBusy([{ ocr_status: 'pending', ai_review: null, uploaded_at: iso(60_000) }], NOW), true);
  assert.equal(listIsBusy([{ ocr_status: 'processing', ai_review: null, uploaded_at: iso(STALL_MS - 1000) }], NOW), true);
  assert.equal(listIsBusy([{ ocr_status: 'processing', ai_review: null, uploaded_at: iso(STALL_MS + 1000) }], NOW), false, 'stalled: polling would never end');
  assert.equal(listIsBusy([{ ocr_status: 'completed', ai_review: { status: 'running' }, uploaded_at: iso(3 * STALL_MS) }], NOW), true, 'the server reports a lost run as failed, so a running one is live');
  assert.equal(listIsBusy([{ ocr_status: 'completed', ai_review: { status: 'queued' }, uploaded_at: null }], NOW), true);
  assert.equal(listIsBusy([{ ocr_status: 'completed', ai_review: { status: 'failed' }, uploaded_at: iso(1000) }], NOW), false);
});

// ── frameworks ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('applicable frameworks: the same tags as the old merge, linked first, each name once', () => {
  const cases: Array<[Parameters<typeof oldDerive>[0], string[] | undefined, string[] | undefined]> = [
    [undefined, undefined, undefined],
    [[], [], []],
    [[{ framework_name: 'ISO 27001', controls: [1, 2, 3] }, { framework_name: 'NIST', controls: [] }], ['ISO 27001', 'PCI DSS', 'PCI DSS'], ['SOC 2: CC6.1', 'NIST: x', '', 'ISO 27001: A.5']],
    [[{ framework_name: '' , controls: [1] }], ['A', '', 'A'], ['B: 1', 'B: 2']],
  ];
  for (const [by, clause, ai] of cases) assert.deepEqual(deriveApplicableFrameworks(by, clause, ai), oldDerive(by, clause, ai));
  assert.deepEqual(deriveApplicableFrameworks([{ framework_name: 'NIST', controls: [] }], [], []), [{ name: 'NIST', count: 1, linked: true }]);
});

// ── the board ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the board: true counts per column, the first cards of each, the rest counted; what sits in no column is said', () => {
  const many = Array.from({ length: 30 }, (_, i) => item({ status: i < 20 ? 'draft' : 'approved' })).concat(set.filter((s) => s.status === 'archived'));
  const cols = boardColumns(many, 8);
  assert.deepEqual(cols.map((c) => c.status), [...PIPELINE_STATUSES]);
  const draft = cols[0];
  assert.deepEqual([draft.count, draft.shown.length, draft.hidden], [20, 8, 12]);
  assert.deepEqual([cols[2].count, cols[2].shown.length, cols[2].hidden], [10, 8, 2]);
  assert.deepEqual([cols[1].count, cols[1].hidden], [0, 0]);
  assert.equal(offBoard(many), 1, 'the archived file is on no card');
  assert.equal(cols.reduce((s, c) => s + c.count, 0) + offBoard(many), many.length, 'the columns and the note add up to the list');
  assert.equal(boardColumns(many, 0)[0].shown.length, 0);
});

test('the one step a card can take: submit a draft, approve a pending file (only a reviewer); every other status has none', () => {
  assert.deepEqual(advanceStep('draft', false), { action: 'submit', label: 'Submit for review', done: 'Submitted for review' });
  assert.equal(advanceStep('pending_review', false), null);
  assert.deepEqual(advanceStep('pending_review', true), { action: 'approve', label: 'Approve', done: 'Approved' });
  for (const s of ['approved', 'rejected', 'expired', 'archived', 'whatever']) assert.equal(advanceStep(s, true), null, s);
});

// ── the Snapshot ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the status split adds up to the total, with archived and any other status counted', () => {
  const s: EvidenceSummary = {
    total_count: 172, by_status: { approved: 51, pending_review: 52, draft: 44, rejected: 9, expired: 8, archived: 8 }, by_type: { policy: 10, log: 30, document: 2, a: 1, b: 1, c: 1 },
    stale_count: 8, expiring_soon_count: 43, pending_review_count: 52,
  };
  const parts = statusSplit(s);
  assert.deepEqual(parts.map((p) => p.key), ['approved', 'pending_review', 'draft', 'rejected', 'expired', 'archived']);
  assert.equal(parts.reduce((t, p) => t + p.count, 0), 172);
  assert.equal(statusSplit({ ...s, by_status: { ...s.by_status, held: 3 } }).at(-1)?.count, 3, 'a status the board does not know is counted as other');
  assert.equal(statusSplit({ ...s, by_status: { approved: 1 } }).find((p) => p.key === 'pending_review')?.count, 52, 'the summary\'s own pending count backs up a missing key (as before)');
  assert.deepEqual(topTypes(s, 3), [{ type: 'log', count: 30, pctOfMax: 100 }, { type: 'policy', count: 10, pctOfMax: 33 }, { type: 'document', count: 2, pctOfMax: 7 }]);
  assert.deepEqual(topTypes({ ...s, by_type: {} }), []);
});

test('the trend: approvals over the six months (not "this quarter"), latest minus earliest, nothing when the server sent none', () => {
  const months = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((month, i) => ({ month, uploaded: i + 1, approved: i * 2 }));
  const t = trendReading({ total_count: 1, by_status: {}, by_type: {}, stale_count: 0, expiring_soon_count: 0, pending_review_count: 0, by_month: months });
  assert.equal(t?.approvedInWindow, 30);
  assert.equal(t?.delta, 10);
  assert.equal(trendReading({ total_count: 1, by_status: {}, by_type: {}, stale_count: 0, expiring_soon_count: 0, pending_review_count: 0 }), null);
  assert.equal(trendReading({ total_count: 1, by_status: {}, by_type: {}, stale_count: 0, expiring_soon_count: 0, pending_review_count: 0, by_month: months.slice(0, 1) })?.delta, null);
  assert.deepEqual(['2026-06', '2026-12', '2026-13', 'junk'].map(monthName), ['Jun', 'Dec', '2026-13', 'junk']);
});

test('the owner leaderboard: ranked by approval rate then volume, the top owner, the largest backlog, the team average (the formulas the view always used)', () => {
  const o = (name: string | null, total: number, approved: number, pending: number) => ({ owner_id: name ? name.length : null, owner_name: name, total, pending, approved, expired: 0 });
  const owners = [o('Ann', 10, 5, 2), o('Bob', 20, 10, 9), o('Cy', 4, 4, 0), o(null, 3, 0, 1)];
  const board = ownerBoard(owners);
  assert.deepEqual(board?.rows.map((r) => [r.owner_name, r.rank]), [['Cy', 1], ['Bob', 2], ['Ann', 3], [null, 4]]);       // Ann and Bob are both at 50%: the larger volume first
  assert.equal(board?.top.owner_name, 'Cy');
  assert.equal(board?.needsSupport.owner_name, 'Bob');
  assert.equal(board?.teamAvg, Math.round((19 / 37) * 100));
  assert.equal(approvedShare(o('X', 0, 0, 0)), 0);
  assert.equal(ownerBoard([]), null);
  assert.deepEqual(owners.map((x) => x.owner_name), ['Ann', 'Bob', 'Cy', null], 'the input order is not changed');
});

test('the register CSV: quoted where needed, quotes doubled, text that looks like a formula defused, one row per file', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  for (const lead of ['=SUM(A1)', '+1', '-2', '@x']) assert.equal(csvCell(lead), `'${lead}`, lead);
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0');
  const csv = registerCsv([
    item({ name: 'A, "B"', evidence_type: 'audit_report', status: 'approved', is_stale: true, owner_name: 'Olivia Owner', control_mappings_count: 3, quality_score: 0.74, expiry_date: '2026-12-01T00:00:00', uploaded_at: '2026-10-01T10:00:00' }),
    item({ name: '=cmd', evidence_type: null, uploader_name: null }),
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'Name,Type,Status,Stale,Owner,Controls linked,Maturity %,Expiry,Uploaded');
  assert.equal(lines[1], '"A, ""B""",Audit Report,approved,Yes,Olivia Owner,3,74,2026-12-01,2026-10-01');
  assert.equal(lines[2], "'=cmd,Other,draft,No,,0,,,2026-10-01");
  assert.equal(registerCsv([]), 'Name,Type,Status,Stale,Owner,Controls linked,Maturity %,Expiry,Uploaded');
});

// ── paging and keys ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a page of a list: true range, clamped, and the page a file is on', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
  const p2 = pageOfRows(rows, 2, 50);
  assert.deepEqual([p2.range.from, p2.range.to, p2.range.pages, p2.rows[0].id, p2.rows.length], [51, 100, 3, 51, 50]);
  assert.equal(pageOfRows(rows, 9, 50).range.page, 3, 'a page past the end is the last');
  assert.deepEqual(pageOfRows([], 1, 50), { range: pageOfRows([], 1, 50).range, rows: [] });
  assert.equal(pageOfId(rows, 51, 50), 2);
  assert.equal(pageOfId(rows, 50, 50), 1);
  assert.equal(pageOfId(rows, 999, 50), 1);
});

test('the keys of a list: arrows by one, Page keys by ten, Home and End, stopping at the ends; any other key is none of its business', () => {
  assert.equal(optionAfter(5, -1, 'ArrowDown'), 0);
  assert.equal(optionAfter(5, 2, 'ArrowDown'), 3);
  assert.equal(optionAfter(5, 4, 'ArrowDown'), 4);
  assert.equal(optionAfter(5, 0, 'ArrowUp'), 0);
  assert.equal(optionAfter(5, -1, 'ArrowUp'), 4);
  assert.equal(optionAfter(50, 3, 'PageDown'), 13);
  assert.equal(optionAfter(50, 45, 'PageDown'), 49);
  assert.equal(optionAfter(50, 5, 'PageUp'), 0);
  assert.equal(optionAfter(50, 20, 'Home'), 0);
  assert.equal(optionAfter(50, 20, 'End'), 49);
  assert.equal(optionAfter(5, 1, 'a'), null);
  assert.equal(optionAfter(0, -1, 'ArrowDown'), -1);
  assert.equal(optionAfter(0, -1, 'a'), null);
});
