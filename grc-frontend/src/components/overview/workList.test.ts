// node --test "src/components/overview/workList.test.ts"
// "Needs my action" on an Overview is the shared inbox narrowed to one module's sources: what stays in, what it counts, the state of the list while a
// source loads or fails, the filter, the length, and each item as the props of a WorkRow. Fixtures are rows as the endpoints send them, run through the
// REAL buildInbox, so this list and the Needs-my-action page cannot disagree.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { KIND_META, buildInbox, type SourceId, type SourceInput, type SourceState } from '../../lib/inbox/buildInbox.ts';
import { KIND_TONE, effectiveFilter, filterOptions, itemsFor, lengthOf, rowOf, seeAllHref, workOf } from './workList.ts';

const NOW = new Date('2026-11-01T12:00:00Z');
const day = (n: number, hour = 9) => new Date(NOW.getTime() + n * 86_400_000 + (hour - 12) * 3_600_000).toISOString().replace(/\.\d+Z$/, '');
const READY: SourceState = { state: 'ready', at: 1 };
const DOCS: SourceId[] = ['doc.lifecycle', 'doc.signoff'];

let seq = 100;
const life = (kind: string, over: Record<string, unknown> = {}) => ({
  id: ++seq, kind, document_id: 10 + seq, title: `Policy ${seq}`, doc_type: 'policy', status: 'pending_review', version: '1.0', due_date: day(3), overdue: false, escalation_level: 0,
  again: null, proposal_id: null, requested_at: day(-2), requested_by_id: 7, requested_by_name: 'Olivia Owner', ...over,
});
const lifeRaw = (...rows: unknown[]) => ({ enabled: true, total: rows.length, items: rows });
const signoffRow = (documentId: number) => ({ document_id: documentId, title: `Sign-off ${documentId}`, doc_type: 'standard', status: 'pending_review', stage_name: 'Review', updated_at: day(-1), round_started_at: day(-3) });
const evidenceRow = (id: number) => ({ id, evidence_id: 50 + id, evidence_name: `scan-${id}.pdf`, assessment_name: 'SWIFT CSP', item_number: '2.3', current_tier: 1, status: 'pending_tier_1', addressed_to_me: true, submitted_at: day(-4) });
const input = (id: SourceId, raw: unknown, state: SourceState = READY): SourceInput => ({ id, state, raw });
const failed = (id: SourceId): SourceInput => ({ id, state: { state: 'unavailable', error: 'Could not reach the server.' } });
const build = (...inputs: SourceInput[]) => buildInbox(inputs, NOW);

test('only the module\'s own sources stay: assessment evidence and requests the person sent are out', () => {
  const inbox = build(
    input('doc.lifecycle', lifeRaw(life('review'), life('acknowledgement'))),
    input('doc.signoff', { total: 1, items: [signoffRow(31)] }),
    input('assessment.evidence', { pending_approvals: [evidenceRow(12)], total: 1 }),
  );
  const work = workOf(inbox, DOCS);
  assert.deepEqual(work.decide.map((i) => i.source).sort(), ['doc.lifecycle', 'doc.signoff']);
  assert.deepEqual(work.acknowledge.map((i) => i.source), ['doc.lifecycle']);
  assert.equal(inbox.counts.decision, 3, 'the top bar counts the evidence too');
  assert.deepEqual(work.counts, { decide: 2, acknowledge: 1, all: 3, overdue: 0 }, 'this list counts the module\'s own');
  assert.equal(work.state, 'content');
});

test('decisions come first, then acknowledgements, each in the inbox\'s own order (the same as the Needs-my-action page)', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(
    life('acknowledgement', { title: 'Ack late', overdue: true, due_date: day(-5) }),
    life('review', { title: 'Review soon', due_date: day(2) }),
    life('approval', { title: 'Approve late', overdue: true, due_date: day(-1) }),
  )));
  const work = workOf(inbox, DOCS);
  assert.deepEqual(itemsFor(work, 'all').map((i) => i.title), ['Approve late', 'Review soon', 'Ack late']);
  assert.deepEqual(itemsFor(work, 'decide').map((i) => i.title), ['Approve late', 'Review soon']);
  assert.deepEqual(itemsFor(work, 'ack').map((i) => i.title), ['Ack late']);
  assert.equal(work.counts.overdue, 2, 'an overdue acknowledgement is overdue too');
});

test('a source still loading is "loading", a failed one is "unavailable": never "nothing needs you"', () => {
  assert.equal(workOf(build(input('doc.lifecycle', null, { state: 'loading' }), input('doc.signoff', { total: 0, items: [] })), DOCS).state, 'loading');
  assert.equal(workOf(build(failed('doc.lifecycle'), input('doc.signoff', { total: 0, items: [] })), DOCS).state, 'unavailable');
  assert.equal(workOf(build(input('doc.lifecycle', lifeRaw()), input('doc.signoff', { total: 0, items: [] })), DOCS).state, 'empty');
  assert.equal(workOf(build(input('doc.lifecycle', { enabled: false }), input('doc.signoff', { total: 0, items: [] })), DOCS).state, 'empty', 'a life cycle that is off is not a failure');
});

test('with items from one source and the other failed, the list shows them and the notice says which could not be loaded', () => {
  const work = workOf(build(input('doc.lifecycle', lifeRaw(life('review'))), failed('doc.signoff')), DOCS);
  assert.equal(work.state, 'content');
  assert.deepEqual(work.notices.map((n) => [n.source, n.state, n.label]), [['doc.signoff', 'unavailable', 'Sign-offs']]);
});

test('a failure of a source this module does not read is no notice here', () => {
  const work = workOf(build(input('doc.lifecycle', lifeRaw(life('review'))), input('doc.signoff', { total: 0, items: [] }), failed('assessment.evidence')), DOCS);
  assert.deepEqual(work.notices, []);
  assert.equal(work.state, 'content');
});

test('a stale source (the refresh failed) keeps its last answer and says so', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('review')), { state: 'stale', at: 5, error: 'Timed out.' }), input('doc.signoff', { total: 0, items: [] }));
  const work = workOf(inbox, DOCS);
  assert.equal(work.counts.all, 1);
  assert.deepEqual(work.notices.map((n) => n.state), ['stale']);
});

test('the filter is offered only when both kinds are there, and a choice that has gone falls back to All', () => {
  const both = workOf(build(input('doc.lifecycle', lifeRaw(life('review'), life('review'), life('acknowledgement')))), DOCS);
  assert.deepEqual(filterOptions(both), [{ value: 'all', label: 'All', count: 3 }, { value: 'decide', label: 'Decide', count: 2 }, { value: 'ack', label: 'Acknowledge', count: 1 }]);
  assert.equal(effectiveFilter(both, 'ack'), 'ack');
  const onlyAcks = workOf(build(input('doc.lifecycle', lifeRaw(life('acknowledgement'), life('acknowledgement')))), DOCS);
  assert.deepEqual(filterOptions(onlyAcks), []);
  assert.equal(effectiveFilter(onlyAcks, 'decide'), 'all');
  assert.equal(effectiveFilter(onlyAcks, 'ack'), 'all');
  assert.deepEqual(filterOptions(workOf(build(input('doc.lifecycle', lifeRaw())), DOCS)), []);
});

test('the list is cut at the limit and the true total is kept (150 acknowledgements are 150, not 10)', () => {
  const rows = Array.from({ length: 150 }, () => life('acknowledgement'));
  const work = workOf(build(input('doc.lifecycle', lifeRaw(...rows))), DOCS);
  const all = itemsFor(work, 'all');
  assert.equal(work.counts.all, 150);
  const cut = lengthOf(all, 10);
  assert.deepEqual([cut.rows.length, cut.total, cut.cut], [10, 150, true]);
  const whole = lengthOf(all.slice(0, 3), 10);
  assert.deepEqual([whole.rows.length, whole.total, whole.cut], [3, 3, false]);
  assert.deepEqual(lengthOf([], 10), { rows: [], total: 0, cut: false });
});

test('"See all" opens the Needs-my-action page on the section the filter shows', () => {
  assert.equal(seeAllHref('all'), '/needs-my-action');
  assert.equal(seeAllHref('decide'), '/needs-my-action?section=decide');
  assert.equal(seeAllHref('ack'), '/needs-my-action?section=ack');
});

test('every kind the inbox knows has a tone for its pill, and the action word is the inbox page\'s own', () => {
  for (const kind of Object.keys(KIND_META) as Array<keyof typeof KIND_META>) assert.ok(KIND_TONE[kind], kind);
  const inbox = build(input('doc.lifecycle', lifeRaw(life('approval', { document_id: 7 }), life('acknowledgement', { document_id: 8 }))));
  const rows = Object.fromEntries(inbox.items.map((i) => [i.kind, rowOf(i)]));
  assert.deepEqual(rows.approval.kind, { label: 'To approve', tone: 'pending' });
  assert.equal(rows.approval.action.label, 'Approve and sign');
  assert.equal(rows.approval.action.href, '/governance/documents/7?act=sign');
  assert.deepEqual(rows.acknowledgement.kind, { label: 'To acknowledge', tone: 'progress' });
  assert.equal(rows.acknowledgement.action.label, 'Acknowledge');
  assert.equal(rows.acknowledgement.action.href, '/governance/documents/8?act=ack', '"Acknowledge" opens the document with ?act=ack');
  assert.equal(rows.acknowledgement.href, rows.acknowledgement.action.href, 'the title and the action go to the same place');
});

const AGAIN = { kind: 'signed', stage: 'Review', stage_kind: 'review', at: day(-9), version: '1.0', version_id: 55, comment: null, now: '1.1', changed: true, by: 'Rana Reviewer', note: null };

test('a row carries what the inbox page carries: who asked, when it is due, whether it is late, and the words (escalated, asked again, archived)', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(
    life('review', { document_id: 41, title: 'Access control', doc_type: 'standard', version: '2.1', due_date: day(-3), overdue: true, escalation_level: 1, status: 'archived', requested_by_name: 'Bina Branch' }),
    life('review', { document_id: 42, again: AGAIN, due_date: day(8) }),
  )));
  const [late, second] = inbox.bySection.decision.map(rowOf);
  assert.equal(late.title, 'Access control');
  assert.equal(late.context, 'Standard · v2.1 · Escalated · Archived');
  assert.deepEqual(late.requester, { name: 'Bina Branch', role: 'Asked by' });
  assert.equal(late.overdue, true);
  assert.equal(late.due, day(-3));
  assert.equal(second.action.label, 'Review and sign again');
  assert.match(second.context, /Asked again$/);
});

test('a sign-off with no requester has no "Asked by", no due date, and does not pretend to be unassigned', () => {
  const inbox = build(input('doc.signoff', { total: 1, items: [signoffRow(21)] }));
  const row = rowOf(inbox.bySection.decision[0]);
  assert.equal(row.requester, undefined);
  assert.equal(row.due, null);
  assert.equal(row.overdue, false);
  assert.equal(row.kind.label, 'To sign');
  assert.equal(row.href, '/governance/documents/21?tab=sign-off');
});

test('an "asked again" row keeps its second link ("See what changed") for the page to draw under the row; any other row has none', () => {
  const inbox = build(input('doc.lifecycle', lifeRaw(life('review', { document_id: 9, again: AGAIN }))));
  const row = rowOf(inbox.bySection.decision[0]);
  assert.deepEqual(row.extraLink, { label: 'See what changed', href: '/governance/documents/9?changes=55' });
  const plain = rowOf(build(input('doc.lifecycle', lifeRaw(life('review')))).bySection.decision[0]);
  assert.equal(plain.extraLink, undefined);
});
