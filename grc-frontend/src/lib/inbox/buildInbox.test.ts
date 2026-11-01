// node --test "src/lib/inbox/buildInbox.test.ts"
// "Needs my action": the sources in, the sections out, the count rule, a failed source, the order. Every case of G3_inbox_contract.md section 5 (the pure model's test plan), on fixtures
// shaped like what the four endpoints send (A1-A4 included).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BADGE_SOURCES, KIND_META, SOURCE_DEFS, badgeLabel, badgeText, buildInbox, compareItems, dropdownOf,
  type InboxItem, type Kind, type SourceId, type SourceInput, type SourceState,
} from './buildInbox.ts';
import { appPath } from '../../components/layout/headerLinks.ts';

const NOW = new Date('2026-11-01T12:00:00Z');
const day = (n: number, hour = 9) => new Date(NOW.getTime() + n * 86_400_000 + (hour - 12) * 3_600_000).toISOString().replace(/\.\d+Z$/, '');   // naive UTC, as the server writes it
const READY: SourceState = { state: 'ready', at: 1 };

// ── fixtures: a row as each endpoint sends it ────────────────────────────────
let seq = 100;
const life = (kind: string, over: Record<string, unknown> = {}) => ({
  id: ++seq, kind, document_id: 10 + seq, title: `Policy ${seq}`, doc_type: 'policy', status: 'pending_review', version: '1.0', due_date: day(3), overdue: false, escalation_level: 0,
  again: null, proposal_id: null, requested_at: day(-2), requested_by_id: 7, requested_by_name: 'Olivia Owner', ...over,
});
const lifeRaw = (...rows: unknown[]) => ({ enabled: true, total: rows.length, items: rows });
const signoffRow = (documentId: number, over: Record<string, unknown> = {}) => ({
  document_id: documentId, title: `Sign-off ${documentId}`, doc_type: 'standard', status: 'pending_review', stage_role: 'reviewer', stage_label: 'Reviewer', stage_name: 'Review',
  updated_at: day(-1), round_started_at: day(-3), ...over,
});
const evidenceRow = (id: number, over: Record<string, unknown> = {}) => ({
  id, evidence_id: 50 + id, evidence_name: `scan-${id}.pdf`, assessment_id: 3, assessment_name: 'SWIFT CSP', item_number: '2.3', control_description: 'Privileged accounts are reviewed',
  current_tier: 1, status: 'pending_tier_1', workflow_name: 'Two-tier', can_approve: true, addressed_to_me: true, submitted_by_name: 'Khalid Approver', submitted_at: day(-4), ...over,
});
const sentRow = (documentId: number, kind: string, over: Record<string, unknown> = {}) => ({
  document_id: documentId, title: `Sent ${documentId}`, doc_type: 'policy', status: 'pending_review', kind, proposal_id: null, pending: 2, overdue: false, escalated: false, next_due: day(5),
  oldest_requested_at: day(-1), waiting: ['Rana Reviewer', 'Rafay Reviewer'], waiting_more: 0, ...over,
});
const input = (id: SourceId, raw: unknown, state: SourceState = READY): SourceInput => ({ id, state, raw });
const failed = (id: SourceId, error = 'Could not reach the server.'): SourceInput => ({ id, state: { state: 'unavailable', error } });
const build = (...inputs: SourceInput[]) => buildInbox(inputs, NOW);
const keys = (items: InboxItem[]) => items.map((i) => i.key);

// ── 1. every row of the contract's table 2.3: its section, its count, its link ─────────────────
test('every request kind lands in its section by KIND_META, with the link of the contract', () => {
  const rows = ['approval', 'review', 'changes', 'decide', 'revise', 'acknowledgement'].map((k) => life(k, { document_id: 7, proposal_id: k === 'decide' || k === 'revise' ? 4 : null }));
  const inbox = build(input('doc.lifecycle', lifeRaw(...rows)));
  const by = Object.fromEntries(inbox.items.map((i) => [i.kind, i]));
  assert.deepEqual(Object.keys(by).sort(), ['acknowledgement', 'approval', 'changes', 'decide', 'review', 'revise']);
  const want: Record<string, [string, boolean, string]> = {
    approval: ['decision', true, '/governance/documents/7?act=sign'],
    review: ['decision', true, '/governance/documents/7?act=sign'],
    changes: ['decision', true, '/governance/documents/7?act=changes'],
    decide: ['decision', true, '/governance/documents/7?tab=proposals&proposal=4'],
    revise: ['decision', true, '/governance/documents/7?tab=proposals&proposal=4'],
    acknowledgement: ['acknowledgement', false, '/governance/documents/7?act=ack'],
  };
  for (const [kind, [section, counted, href]] of Object.entries(want)) assert.deepEqual([by[kind].section, by[kind].counted, by[kind].href], [section, counted, href], kind);
  assert.deepEqual([inbox.counts.decision, inbox.counts.acknowledgement, inbox.counts.sent], [5, 1, 0]);
});

test('a decide request with no proposal opens Proposed changes without a proposal parameter', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('decide', { document_id: 8, proposal_id: null }), life('revise', { document_id: 9, proposal_id: null }))));
  assert.deepEqual(inbox.items.map((i) => i.href).sort(), ['/governance/documents/8?tab=proposals', '/governance/documents/9?tab=proposals']);
});

test('a sign-off with no request is a decision that opens the sign-off tab; evidence opens its approval; a sent request opens the document\'s Approvals', () => {
  const inbox = build(input('doc.signoff', { total: 1, items: [signoffRow(21)] }), input('assessment.evidence', { pending_approvals: [evidenceRow(12)], total: 1 }),
    input('doc.sent', { enabled: true, total: 1, truncated: false, items: [sentRow(30, 'review')] }));
  const href = Object.fromEntries(inbox.items.map((i) => [i.source, [i.section, i.href]]));
  assert.deepEqual(href['doc.signoff'], ['decision', '/governance/documents/21?tab=sign-off']);
  assert.deepEqual(href['assessment.evidence'], ['decision', '/compliance/assessments/approvals#approval-compliance-12']);
  assert.deepEqual(href['doc.sent'], ['sent', '/governance/documents/30?tab=lifecycle']);
});

test('every link is a page of this app, and a request that was asked again also offers what changed', () => {
  const again = { kind: 'signed', stage: 'Review', stage_kind: 'review', at: day(-9), version: '1.0', version_id: 31, comment: null, now: '1.2', changed: true, by: 'Olivia', note: null };
  const inbox = build(input('doc.lifecycle', lifeRaw(life('review', { document_id: 40, again }), life('acknowledgement', { document_id: 41 }))),
    input('doc.signoff', { items: [signoffRow(42)] }), input('assessment.evidence', { pending_approvals: [evidenceRow(1)] }), input('doc.sent', { items: [sentRow(43, 'approval')] }));
  for (const item of inbox.items) {
    assert.equal(appPath(item.href), item.href, item.key);
    for (const link of item.extraLinks) assert.equal(appPath(link.href), link.href, item.key);
  }
  const asked = inbox.items.find((i) => i.documentId === 40) as InboxItem;
  assert.deepEqual(asked.extraLinks, [{ label: 'See what changed', href: '/governance/documents/40?changes=31' }]);
  assert.equal(asked.again?.now, '1.2');
});

test('what each row says: title in full, context, who asked, when, and the asked-again object are passed through', () => {
  const [i] = build(input('doc.lifecycle', lifeRaw(life('approval', { title: 'Encryption Key Management Standard', doc_type: 'standard', version: '2.1', due_date: day(2), requested_by_name: 'Bina Branch', requested_by_id: 9, requested_at: day(-1) })))).items;
  assert.deepEqual([i.title, i.context, i.requester, i.requesterId, i.createdAt, i.dueAt, i.overdue, i.escalation, i.docStatus], ['Encryption Key Management Standard', 'Standard · v2.1', 'Bina Branch', 9, day(-1), day(2), false, 0, 'pending_review']);
  const [e] = build(input('assessment.evidence', { pending_approvals: [evidenceRow(5, { current_tier: 2 })] })).items;
  assert.deepEqual([e.title, e.context, e.detail, e.requester, e.dueAt, e.createdAt], ['scan-5.pdf', 'SWIFT CSP · item 2.3 · tier 2', 'Privileged accounts are reviewed', 'Khalid Approver', null, day(-4)]);
  const [s] = build(input('doc.signoff', { items: [signoffRow(8)] })).items;
  assert.deepEqual([s.context, s.createdAt, s.requester, s.dueAt], ['Standard · Reviewer', day(-3), null, null]);
});

// ── 2. the count rule ────────────────────────────────────────────────────────
test('the count is the decisions: 150 acknowledgements and 3 decisions make N = 3 and M = 150', () => {
  const acks = Array.from({ length: 150 }, (_, i) => life('acknowledgement', { document_id: 1000 + i }));
  const inbox = build(input('doc.lifecycle', lifeRaw(...acks, life('approval'), life('review', { overdue: true, escalation_level: 1 }), life('revise'))));
  assert.deepEqual([inbox.counts.decision, inbox.counts.acknowledgement, inbox.counts.overdue], [3, 150, 1]);
  assert.deepEqual(inbox.badge, { kind: 'count', n: 3, overdue: 1, incomplete: false });
  assert.equal(badgeText(inbox.badge), '3');
});

test('sent requests and the acknowledgement campaigns are never in the number', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('acknowledgement'), life('acknowledgement'))), input('doc.sent', { items: [sentRow(1, 'review'), sentRow(2, 'approval')] }));
  assert.deepEqual([inbox.counts.decision, inbox.counts.acknowledgement, inbox.counts.sent], [0, 2, 2]);
  assert.equal(inbox.badge.kind, 'none');
});

test('evidence is counted for the person it is addressed to; the rest is listed as "you can decide" and is not in the number', () => {
  const inbox = build(input('assessment.evidence', { pending_approvals: [evidenceRow(1), evidenceRow(2, { addressed_to_me: false }), evidenceRow(3, { addressed_to_me: false })] }));
  assert.deepEqual([inbox.counts.decision, inbox.counts.canDecide, inbox.bySection.decision.length], [1, 2, 3]);
  assert.deepEqual(inbox.bySection.decision.map((i) => [i.recordId, i.counted]), [[1, true], [2, false], [3, false]], 'addressed first');
  assert.equal(inbox.badge.kind === 'count' && inbox.badge.n, 1);
});

test('a server from before the addressed_to_me field counts every evidence item, as it always did', () => {
  const old = evidenceRow(4) as Record<string, unknown>;
  delete old.addressed_to_me;
  const inbox = build(input('assessment.evidence', [old]));       // the bare array an older server sends is read too
  assert.deepEqual([inbox.counts.decision, inbox.counts.canDecide], [1, 0]);
});

test('a source that is still loading, unavailable or off adds nothing to the number', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('approval'))), { id: 'doc.signoff', state: { state: 'loading' } }, failed('assessment.evidence'));
  assert.equal(inbox.counts.decision, 1);
  assert.deepEqual(inbox.badge, { kind: 'count', n: 1, overdue: 0, incomplete: true });
  assert.equal(badgeText(inbox.badge), '1!');
});

test('"off" is not a failure: the life cycle answering enabled:false, and a source the server does not have', () => {
  const inbox = build(input('doc.lifecycle', { enabled: false, items: [] }), input('doc.signoff', { items: [signoffRow(5)] }), input('assessment.evidence', { pending_approvals: [] }),
    { id: 'doc.sent', state: { state: 'off' } });
  assert.deepEqual(inbox.sources['doc.lifecycle'], { state: 'off' });
  assert.deepEqual(inbox.badge, { kind: 'count', n: 1, overdue: 0, incomplete: false });
  assert.equal(inbox.notices.length, 0);
  const none = build(input('doc.lifecycle', { enabled: false, items: [] }), input('doc.signoff', { items: [] }), input('assessment.evidence', { pending_approvals: [] }));
  assert.equal(none.badge.kind, 'none');
});

test('every source answered and nothing to decide: no badge; the badge text is blank', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw()), input('doc.signoff', { items: [] }), input('assessment.evidence', { pending_approvals: [] }));
  assert.deepEqual(inbox.badge, { kind: 'none' });
  assert.equal(badgeText(inbox.badge), '');
});

test('nothing answered yet is "loading", never a 0; every source failed is "!", never a 0', () => {
  const loading = build(...BADGE_SOURCES.map((id) => ({ id, state: { state: 'loading' } as SourceState })));
  assert.deepEqual(loading.badge, { kind: 'loading' });
  assert.equal(badgeText(loading.badge), '');
  const down = build(...BADGE_SOURCES.map((id) => failed(id)));
  assert.deepEqual(down.badge, { kind: 'unknown' });
  assert.equal(badgeText(down.badge), '!');
  assert.deepEqual(build(failed('doc.lifecycle'), { id: 'doc.signoff', state: { state: 'loading' } }).badge, { kind: 'unknown' }, 'one failure and nothing answered');
});

test('a source that answered with nothing next to one that failed is "!", not a 0', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw()), failed('assessment.evidence'));
  assert.deepEqual(inbox.badge, { kind: 'unknown' });
});

test('above 99 the badge says 99+ and the label keeps the exact number', () => {
  const rows = Array.from({ length: 120 }, (_, i) => life('review', { document_id: 2000 + i }));
  const inbox = build(input('doc.lifecycle', lifeRaw(...rows)), input('doc.signoff', { items: [] }), input('assessment.evidence', { pending_approvals: [] }));
  assert.equal(badgeText(inbox.badge), '99+');
  assert.match(badgeLabel(inbox), /120 to decide/);
});

test('stale: the refresh failed, the last answer is kept in the number and a notice says when it is from', () => {
  const inbox = build({ id: 'doc.lifecycle', state: { state: 'stale', at: 1_700_000_000_000, error: 'Network Error' }, raw: lifeRaw(life('approval'), life('acknowledgement')) });
  assert.deepEqual([inbox.counts.decision, inbox.counts.acknowledgement], [1, 1]);
  assert.deepEqual(inbox.notices.map((n) => [n.source, n.state, n.at]), [['doc.lifecycle', 'stale', 1_700_000_000_000]]);
  assert.equal((inbox.badge as { incomplete: boolean }).incomplete, false);
});

// ── 3. one failed source ─────────────────────────────────────────────────────
test('documents ready and the assessments down: the number is the documents\', a notice names the assessments, the badge is flagged', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('approval'), life('review'))), failed('assessment.evidence', 'Request failed with status code 500'));
  assert.equal(inbox.counts.decision, 2);
  assert.deepEqual(inbox.notices.map((n) => [n.source, n.label, n.state, n.message, n.feeds]), [['assessment.evidence', 'Assessment approvals', 'unavailable', 'Request failed with status code 500', ['decision']]]);
  assert.equal(badgeText(inbox.badge), '2!');
  assert.match(badgeLabel(inbox), /may be incomplete: Assessment approvals could not be loaded/);
});

test('documents down and sign-offs ready: nothing is dropped as a duplicate, and the count is flagged incomplete', () => {
  const inbox = build(failed('doc.lifecycle'), input('doc.signoff', { items: [signoffRow(5), signoffRow(6)] }));
  assert.deepEqual(keys(inbox.bySection.decision).sort(), ['doc.signoff:signoff:5', 'doc.signoff:signoff:6']);
  assert.deepEqual(inbox.badge, { kind: 'count', n: 2, overdue: 0, incomplete: true });
});

// ── 4. dedupe ───────────────────────────────────────────────────────────────
test('a sign-off is dropped when the life cycle holds a review or approval for the same document', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('review', { document_id: 5 }), life('approval', { document_id: 6 }))), input('doc.signoff', { items: [signoffRow(5), signoffRow(6), signoffRow(7)] }));
  assert.deepEqual(inbox.items.filter((i) => i.source === 'doc.signoff').map((i) => i.documentId), [7]);
  assert.equal(inbox.counts.decision, 3);
});

test('a sign-off is kept when the life cycle holds only another kind for that document, or when the life cycle is off', () => {
  const other = build(input('doc.lifecycle', lifeRaw(life('acknowledgement', { document_id: 5 }), life('decide', { document_id: 5, proposal_id: 2 }))), input('doc.signoff', { items: [signoffRow(5)] }));
  assert.equal(other.items.filter((i) => i.source === 'doc.signoff').length, 1);
  const off = build(input('doc.lifecycle', { enabled: false, items: [life('review', { document_id: 5 })] }), input('doc.signoff', { items: [signoffRow(5)] }));
  assert.deepEqual(keys(off.items), ['doc.signoff:signoff:5']);
});

test('the request of another person on the same document does not hide mine: the unit is a request, not a document', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('review', { document_id: 5 }), life('decide', { document_id: 5, proposal_id: 3 }))));
  assert.equal(inbox.counts.decision, 2);
});

// ── 5. the order ─────────────────────────────────────────────────────────────
test('overdue first, then the soonest due, a request with no due date last', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(
    life('approval', { id: 1, document_id: 1, due_date: day(5) }), life('approval', { id: 2, document_id: 2, due_date: null, overdue: false }),
    life('approval', { id: 3, document_id: 3, due_date: day(-2), overdue: true }), life('approval', { id: 4, document_id: 4, due_date: day(1) }),
    life('approval', { id: 5, document_id: 5, due_date: day(-9), overdue: true }),
  )));
  assert.deepEqual(inbox.bySection.decision.map((i) => i.recordId), [5, 3, 4, 1, 2]);
});

test('the same due moment is broken by the kind\'s rank, then the oldest asked, then the key; escalation does not reorder', () => {
  const due = day(2);
  const inbox = build(input('doc.lifecycle', lifeRaw(
    life('changes', { id: 10, document_id: 10, due_date: due }), life('review', { id: 11, document_id: 11, due_date: due, requested_at: day(-1) }),
    life('review', { id: 12, document_id: 12, due_date: due, requested_at: day(-5), escalation_level: 2 }), life('approval', { id: 13, document_id: 13, due_date: due }),
    life('decide', { id: 14, document_id: 14, due_date: due, proposal_id: 1 }),
  )));
  assert.deepEqual(inbox.bySection.decision.map((i) => i.recordId), [13, 12, 11, 14, 10]);
  assert.equal(inbox.bySection.decision[1].escalation, 2);
});

test('the order is total and stable: shuffling the input changes nothing', () => {
  const rows = Array.from({ length: 30 }, (_, i) => life(i % 3 ? 'review' : 'approval', { id: 300 + i, document_id: 300 + i, due_date: i % 4 ? day(i % 5) : null, overdue: i % 7 === 0, requested_at: day(-(i % 6)) }));
  const a = build(input('doc.lifecycle', lifeRaw(...rows)));
  const b = build(input('doc.lifecycle', lifeRaw(...[...rows].reverse())));
  assert.deepEqual(keys(a.bySection.decision), keys(b.bySection.decision));
  const items = a.bySection.decision;
  for (let i = 1; i < items.length; i++) assert.ok(compareItems(items[i - 1], items[i]) < 0, `${items[i - 1].key} before ${items[i].key}`);
});

test('overdue is the server\'s flag when it sends one, else worked out from the due moment against the injected now (naive UTC)', () => {
  const [flagged] = build(input('doc.lifecycle', lifeRaw(life('review', { due_date: day(3), overdue: true })))).items;
  assert.equal(flagged.overdue, true, 'the flag wins');
  const row = life('review', { due_date: '2026-11-01T11:59:00' });          // a minute ago in UTC; read as local time it would be hours off
  delete (row as Record<string, unknown>).overdue;
  assert.equal(build(input('doc.lifecycle', lifeRaw(row))).items[0].overdue, true);
  const later = life('review', { due_date: '2026-11-01T12:01:00' });
  delete (later as Record<string, unknown>).overdue;
  assert.equal(build(input('doc.lifecycle', lifeRaw(later))).items[0].overdue, false);
});

// ── 6. caps change views, never counts; long titles; unique keys ─────────────
test('the model keeps every item: a count is the total, whatever a view shows of it', () => {
  const rows = Array.from({ length: 180 }, (_, i) => life('acknowledgement', { document_id: 3000 + i }));
  const inbox = build(input('doc.lifecycle', lifeRaw(...rows)));
  assert.equal(inbox.bySection.acknowledgement.length, 180);
  assert.equal(inbox.counts.acknowledgement, 180);
});

test('a 250-character title comes through untouched', () => {
  const long = 'Information Security Management System Policy: '.repeat(6).slice(0, 250);
  assert.equal(long.length, 250);
  assert.equal(build(input('doc.lifecycle', lifeRaw(life('review', { title: long })))).items[0].title, long);
});

test('keys are unique across sources: an evidence link 12 is not an obligation 12', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('review', { id: 12, document_id: 12 }), life('acknowledgement', { id: 13, document_id: 13 }))), input('doc.signoff', { items: [signoffRow(77)] }),
    input('assessment.evidence', { pending_approvals: [evidenceRow(12)] }), input('doc.sent', { items: [sentRow(12, 'review'), sentRow(12, 'decide', { proposal_id: 3 }), sentRow(12, 'decide', { proposal_id: 4 })] }));
  assert.equal(new Set(keys(inbox.items)).size, inbox.items.length);
  assert.equal(inbox.items.length, 7);
});

test('a row this build cannot read is skipped and counted, never a crash; the others render', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('review'), { id: 'x', kind: 'review' }, null, life('teleport'), { id: 9, kind: 'review' }, 'text')),
    input('assessment.evidence', { pending_approvals: [evidenceRow(1), { name: 'no id' }] }), input('doc.sent', { items: [sentRow(1, 'acknowledgement')] }));
  assert.equal(inbox.items.length, 2);
  assert.equal(inbox.counts.skipped, 5 + 1 + 1);
});

test('a source with an answer of an unexpected shape yields no items instead of throwing', () => {
  for (const raw of [null, undefined, 42, 'oops', {}, { items: 'x' }, { pending_approvals: {} }]) {
    const inbox = build(input('doc.lifecycle', raw), input('doc.signoff', raw), input('assessment.evidence', raw), input('doc.sent', raw));
    assert.equal(inbox.items.length, 0);
  }
});

// ── 7. parity with the formula it replaces ───────────────────────────────────
test('the old top bar added the evidence items to every request of the life cycle; the new count is the decisions and the acknowledgements, which add up to it', () => {
  const lifecycle = lifeRaw(life('approval'), life('review'), life('acknowledgement'), life('acknowledgement'), life('changes'));
  const evidence = { pending_approvals: [evidenceRow(1), evidenceRow(2)] };
  const oldTotal = evidence.pending_approvals.length + lifecycle.items.length;            // Header.tsx: pendingApprovalItems.length + docRequestItems.length
  const inbox = build(input('doc.lifecycle', lifecycle), input('doc.signoff', { items: [] }), input('assessment.evidence', evidence));
  assert.equal(inbox.counts.decision + inbox.counts.acknowledgement + inbox.counts.canDecide, oldTotal);
  assert.equal(inbox.counts.decision, 5);
});

// ── the words ────────────────────────────────────────────────────────────────
test('the badge label says every number, and what is missing', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('approval'), life('review', { overdue: true }), life('acknowledgement'))), failed('assessment.evidence'));
  assert.equal(badgeLabel(inbox), 'Needs my action: 2 to decide, 1 overdue, 1 to acknowledge, may be incomplete: Assessment approvals could not be loaded');
  assert.equal(badgeLabel(build(...BADGE_SOURCES.map((id) => ({ id, state: { state: 'loading' } as SourceState })))), 'Needs my action, loading');
  assert.equal(badgeLabel(build(input('doc.lifecycle', lifeRaw(life('acknowledgement'))), input('doc.signoff', { items: [] }), input('assessment.evidence', { pending_approvals: [] }))),
    'Needs my action, nothing to decide, 1 to acknowledge');
  assert.match(badgeLabel(build(...BADGE_SOURCES.map((id) => failed(id)))), /could not be counted, Documents and Sign-offs and Assessment approvals could not be loaded/);
});

test('the dropdown lists the first eight decisions, says how many more, one line for the acknowledgements, and the sources that are missing', () => {
  const rows = Array.from({ length: 11 }, (_, i) => life('review', { document_id: 4000 + i, due_date: day(1 + i) }));
  const inbox = build(input('doc.lifecycle', lifeRaw(...rows, life('acknowledgement'), life('acknowledgement'))), failed('assessment.evidence'));
  const drop = dropdownOf(inbox);
  assert.deepEqual([drop.items.length, drop.more, drop.acknowledgements, drop.pending, drop.notices.map((n) => n.label)], [8, 3, 2, 11, ['Assessment approvals']]);
  assert.deepEqual(drop.items.map((i) => i.documentId), rows.slice(0, 8).map((r) => r.document_id));
});

test('the kinds and sources are all described: a label, an action, a rank and the section; the dialog decides only what one endpoint can', () => {
  const ranks = Object.values(KIND_META).map((m) => m.rank);
  assert.equal(new Set(ranks).size, ranks.length, 'ranks are distinct');
  for (const [kind, meta] of Object.entries(KIND_META)) assert.ok(meta.label && meta.action && meta.authority, kind);
  assert.deepEqual((Object.keys(KIND_META) as Kind[]).filter((k) => KIND_META[k].inDialog).sort(), ['approval', 'evidence', 'review', 'signoff']);
  assert.deepEqual(Object.keys(SOURCE_DEFS).sort(), ['assessment.evidence', 'doc.lifecycle', 'doc.sent', 'doc.signoff']);
  assert.deepEqual([...BADGE_SOURCES].sort(), ['assessment.evidence', 'doc.lifecycle', 'doc.signoff']);
});

test('sent requests: grouped by document, kind and proposal, with who they wait for', () => {
  const [row] = build(input('doc.sent', { enabled: true, items: [sentRow(30, 'decide', { proposal_id: 8, pending: 5, waiting: ['A', 'B', 'C'], waiting_more: 2, overdue: true, escalated: true })] })).items;
  assert.deepEqual([row.section, row.kind, row.key, row.counted, row.overdue, row.escalation, row.proposalId], ['sent', 'decide', 'doc.sent:decide:30:8', false, true, 1, 8]);
  assert.deepEqual(row.group, { pending: 5, waiting: ['A', 'B', 'C'], more: 2 });
});

test('an archived document keeps its status so the page can say so', () => {
  const [i] = build(input('doc.lifecycle', lifeRaw(life('decide', { status: 'archived', proposal_id: 1 })))).items;
  assert.equal(i.docStatus, 'archived');
  assert.equal(i.counted, true, 'it still counts: the contract shows it with a chip rather than hiding it');
});
