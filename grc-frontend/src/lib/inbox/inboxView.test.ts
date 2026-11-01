// node --test "src/lib/inbox/inboxView.test.ts"
// What the Needs-my-action page decides before it draws: sections, ?section=, pages of 50, due lines, chips, the line of facts, the state of the whole page.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'UTC';       // a due line counts calendar days on the viewer's clock: the test fixes the viewer's zone (each test file runs in its own process)

import { buildInbox, type SourceInput, type SourceState } from './buildInbox.ts';
import { PAGE_SIZE, SECTIONS, chipsOf, clockOf, dueLine, factsOf, metaLine, openByDefault, pageOf, pageState, sectionParam, sectionStatus, sectionVisible } from './inboxView.ts';

const NOW = new Date('2026-11-01T12:00:00Z');
const day = (n: number, hour = 12) => new Date(NOW.getTime() + n * 86_400_000 + (hour - 12) * 3_600_000).toISOString().replace(/\.\d+Z$/, '');
const READY: SourceState = { state: 'ready', at: 1 };
const lifeRow = (id: number, kind: string, over: Record<string, unknown> = {}) => ({ id, kind, document_id: id, title: `T${id}`, doc_type: 'policy', status: 'pending_review', due_date: day(2), overdue: false, escalation_level: 0, ...over });
const input = (id: SourceInput['id'], raw: unknown, state: SourceState = READY): SourceInput => ({ id, state, raw });
const down = (id: SourceInput['id']): SourceInput => ({ id, state: { state: 'unavailable', error: 'Network Error' } });
const loading = (id: SourceInput['id']): SourceInput => ({ id, state: { state: 'loading' } });
const build = (...i: SourceInput[]) => buildInbox(i, NOW);

test('?section= names a section by its three words and a few spellings; anything else asks for nothing', () => {
  assert.equal(sectionParam('ack'), 'ack');
  assert.equal(sectionParam('Acknowledgements'), 'ack');
  assert.equal(sectionParam('acknowledgement'), 'ack');
  assert.equal(sectionParam('decide'), 'decide');
  assert.equal(sectionParam('sent'), 'sent');
  for (const bad of [null, undefined, '', 'nope', '__proto__', 'constructor', 'toString']) assert.equal(sectionParam(bad), null, String(bad));
});

test('the decisions start open; the acknowledgements when there is nothing to decide or a link asks for them; Sent by me only when asked', () => {
  assert.deepEqual(openByDefault(3, null), { decide: true, ack: false, sent: false });
  assert.deepEqual(openByDefault(0, null), { decide: true, ack: true, sent: false });
  assert.deepEqual(openByDefault(3, 'ack'), { decide: true, ack: true, sent: false }, 'the digest lands on acknowledgements');
  assert.deepEqual(openByDefault(3, 'sent'), { decide: true, ack: false, sent: true });
});

test('a section shows 50 rows and the true total; "Show 50 more" is only as many as are left', () => {
  const items = Array.from({ length: 150 }, (_, i) => i);
  assert.equal(PAGE_SIZE, 50);
  let p = pageOf(items, 50);
  assert.deepEqual([p.rows.length, p.total, p.next, p.summary, p.more], [50, 150, 50, 'Showing 50 of 150', 'Show 50 more']);
  p = pageOf(items, 100);
  assert.deepEqual([p.rows.length, p.next], [100, 50]);
  p = pageOf(items, 140);
  assert.deepEqual([p.rows.length, p.next, p.more], [140, 10, 'Show 10 more']);
  p = pageOf(items, 200);
  assert.deepEqual([p.rows.length, p.next, p.summary, p.more], [150, 0, '', '']);
  assert.deepEqual(pageOf([1, 2, 3], 50).rows, [1, 2, 3]);
  assert.equal(pageOf(Array.from({ length: 1200 }, (_, i) => i), 50).summary, 'Showing 50 of 1,200');
});

test('the due line says how late, how soon, or that there is no date', () => {
  const at = (n: number, extra: Partial<{ overdue: boolean }> = {}) => dueLine({ dueAt: day(n), overdue: n < 0, ...extra }, NOW);
  assert.deepEqual(at(-3), { text: 'Overdue 3 days', tone: 'danger' });
  assert.deepEqual(at(-1), { text: 'Overdue 1 day', tone: 'danger' });
  assert.deepEqual(dueLine({ dueAt: day(0, 8), overdue: true }, NOW), { text: 'Overdue', tone: 'danger' });
  assert.deepEqual(dueLine({ dueAt: day(0, 18), overdue: false }, NOW), { text: 'Due today', tone: 'warning' });
  assert.deepEqual(at(1), { text: 'Due tomorrow', tone: 'warning' });
  assert.deepEqual(at(3), { text: 'Due in 3 days', tone: 'warning' });
  assert.deepEqual(at(6), { text: 'Due in 6 days', tone: 'neutral' });
  assert.deepEqual(at(30), { text: 'Due 1 Dec 2026', tone: 'neutral' });
  assert.deepEqual(dueLine({ dueAt: null, overdue: false }, NOW), { text: 'No due date', tone: 'neutral' });
  assert.deepEqual(dueLine({ dueAt: 'not a date', overdue: false }, NOW), { text: 'No due date', tone: 'neutral' });
});

test('a row carries a word for what is escalated, asked again, archived or only possible to decide; never for what is plain', () => {
  const base = { escalation: 0, docStatus: 'pending_review', again: null, counted: true, section: 'decision' } as const;
  assert.deepEqual(chipsOf(base), []);
  assert.deepEqual(chipsOf({ ...base, escalation: 2 }), ['escalated']);
  assert.deepEqual(chipsOf({ ...base, escalation: 1, again: {} as never, docStatus: 'archived', counted: false }), ['escalated', 'asked_again', 'archived', 'can_decide']);
  assert.deepEqual(chipsOf({ ...base, counted: false, section: 'acknowledgement' }), [], 'only a decision can be "you can decide"');
});

test('the line of facts under the title is the counts in words; blank while nothing is counted', () => {
  const inbox = build(input('doc.lifecycle', { items: [lifeRow(1, 'approval', { overdue: true }), lifeRow(2, 'review'), lifeRow(3, 'acknowledgement')] }),
    input('assessment.evidence', { pending_approvals: [{ id: 1, addressed_to_me: false }] }), input('doc.sent', { items: [{ document_id: 9, kind: 'review', pending: 1 }] }));
  assert.equal(metaLine(inbox), '2 to decide · 1 overdue · 1 more you can decide · 1 to acknowledge · 1 sent');
  assert.equal(metaLine(build(loading('doc.lifecycle'))), '');
});

test('the page is loading, unavailable, empty or content; "nothing needs you" is never said over a source that is loading or failed', () => {
  assert.equal(pageState(build(loading('doc.lifecycle'), loading('doc.signoff'))), 'loading');
  assert.equal(pageState(build(input('doc.lifecycle', { items: [] }), loading('doc.signoff'))), 'loading');
  assert.equal(pageState(build(down('doc.lifecycle'), input('doc.signoff', { items: [] }))), 'unavailable');
  assert.equal(pageState(build(input('doc.lifecycle', { items: [] }), input('doc.signoff', { items: [] }), input('assessment.evidence', { pending_approvals: [] }))), 'empty');
  assert.equal(pageState(build(input('doc.lifecycle', { enabled: false, items: [] }), input('doc.signoff', { items: [] }))), 'empty');
  assert.equal(pageState(build(down('doc.lifecycle'), input('doc.signoff', { items: [{ document_id: 3 }] }))), 'content', 'something to list is content, with a notice');
});

test('a section knows when a source that feeds it is loading and which notices are its own', () => {
  const inbox = build(input('doc.lifecycle', { items: [lifeRow(1, 'approval')] }), loading('assessment.evidence'), down('doc.sent'));
  const decide = sectionStatus(inbox, 'decision');
  assert.deepEqual([decide.loading, decide.notices.length], [true, 0]);
  const sent = sectionStatus(inbox, 'sent');
  assert.deepEqual([sent.loading, sent.notices.map((n) => n.label)], [false, ['Requests you sent']]);
  assert.deepEqual([sectionStatus(inbox, 'acknowledgement').loading, sectionStatus(inbox, 'acknowledgement').notices.length], [false, 0]);
});

test('the decisions are always drawn; the others only when they hold something, are loading or have a notice', () => {
  const [decide, ack, sent] = SECTIONS;
  const empty = build(input('doc.lifecycle', { items: [lifeRow(1, 'approval')] }));
  assert.deepEqual([sectionVisible(empty, decide), sectionVisible(empty, ack), sectionVisible(empty, sent)], [true, false, false]);
  const some = build(input('doc.lifecycle', { items: [lifeRow(1, 'acknowledgement')] }), loading('doc.sent'));
  assert.deepEqual([sectionVisible(some, decide), sectionVisible(some, ack), sectionVisible(some, sent)], [true, true, true]);
  const failed = build(input('doc.lifecycle', { items: [] }), down('doc.sent'));
  assert.equal(sectionVisible(failed, sent), true, 'a failed source says so where its items would be');
});

test('the three sections and what each says when it is empty', () => {
  assert.deepEqual(SECTIONS.map((s) => [s.key, s.title]), [['decide', 'To decide'], ['ack', 'To acknowledge'], ['sent', 'Sent by me']]);
  assert.equal(SECTIONS[0].empty, 'Nothing needs your decision.');
});

test('the time a stale answer is from is the viewer\'s clock, two digits each; none for no time', () => {
  assert.match(clockOf(Date.now()), /^\d\d:\d\d$/);
  assert.equal(clockOf(null), '');
  assert.equal(clockOf(0), '');
});

test('the facts under a row: what is asked and of what and who asked; for a sent request what it is and who it waits for', () => {
  const [a] = build(input('doc.lifecycle', { items: [lifeRow(1, 'approval', { doc_type: 'standard', version: '2.1', requested_by_name: 'Bina Branch' })] })).items;
  assert.deepEqual(factsOf(a), ['To approve', 'Standard · v2.1', 'asked by Bina Branch']);
  const [again] = build(input('doc.lifecycle', { items: [lifeRow(2, 'review', { again: { kind: 'signed', changed: true } })] })).items;
  assert.equal(factsOf(again)[0], 'To review again');
  const [ack] = build(input('doc.lifecycle', { items: [lifeRow(4, 'acknowledgement', { doc_type: 'policy', version: '3.0' })] })).items;
  assert.deepEqual(factsOf(ack), ['Policy · v3.0'], 'an acknowledgement is in the To acknowledge section: its kind is not repeated on every row');
  const [plain] = build(input('doc.lifecycle', { items: [lifeRow(3, 'acknowledgement', { doc_type: null, version: null })] })).items;
  assert.deepEqual(factsOf(plain), ['To acknowledge'], 'nothing is invented for what the source does not say; a row is never blank');
  const [sent] = build(input('doc.sent', { items: [{ document_id: 9, kind: 'review', title: 'S', doc_type: 'policy', pending: 4, waiting: ['Rana Reviewer', 'Rafay Reviewer'], waiting_more: 2 }] })).items;
  assert.deepEqual(factsOf(sent), ['Review requested', 'Policy', 'waiting for Rana Reviewer, Rafay Reviewer +2', '4 pending']);
});
