// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryTracker.test.ts"
// The Tracker's rules: the six steps and where each status stands, the plain badge, the one line for now and the one for next (only what the data holds: a name only when the row or
// the inbox carries it), and the order of the cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildInbox, type SourceInput } from '../../../../../lib/inbox/buildInbox.ts';
import { BADGE_TERM, GLOSSARY, HOW_STEPS } from './glossary.ts';
import {
  BADGE_MEANING, CARDS_AT_A_TIME, STAGES, agoWords, attentionOf, cardsShown, isLive, nameList, peopleOf, standingOf, stepsOf, trackOf, trackerOrder,
  type DocPeople, type TrackerContext, type TrackerDoc,
} from './libraryTracker.ts';

const NOW = new Date('2026-11-11T12:00:00Z');
const ctx = (o: Partial<TrackerContext> = {}): TrackerContext => ({ lookups: { coverage: {} }, now: NOW, ...o });
let n = 0;
const doc = (o: Partial<TrackerDoc> = {}): TrackerDoc => ({
  id: ++n, title: `Document ${n}`, document_code: null, doc_type: 'policy', status: 'published', owner_id: 7, owner_name: 'Maria Lopez', author_name: 'Omar Tariq', department_id: null,
  next_review_date: '2027-03-01T00:00:00', created_at: '2026-01-01T00:00:00', updated_at: '2026-01-02T00:00:00', version_in_force: '1.0', current_version: '1.0', ...o,
});
const where = (d: TrackerDoc, c = ctx()) => standingOf(d, c).at;

test('six steps with the sample’s names, and the "How it works" sheet says the same six', () => {
  assert.deepEqual(STAGES.map((s) => s.name), ['Being written', 'Being checked', 'Being signed off', 'Ready to publish', 'Live', 'Everyone’s read it']);
  assert.deepEqual(HOW_STEPS.map((s) => s.title), STAGES.map((s) => s.name));
  for (const s of STAGES) assert.ok(s.name.split(/\s+/).length <= 3, s.name);
});

test('where each status stands: the five of the approval workflow, then Live, and "Everyone’s read it" only when the document has an acknowledgement campaign', () => {
  assert.equal(where(doc({ status: 'draft', version_in_force: null })), 0);
  assert.equal(where(doc({ status: 'pending_review', version_in_force: null })), 1);
  assert.equal(where(doc({ status: 'pending_approval', version_in_force: null })), 2);
  assert.equal(where(doc({ status: 'approved', version_in_force: null })), 3);
  assert.equal(where(doc({ status: 'published' })), 4);
  assert.equal(where(doc({ status: 'published', attestation: { pct: 40, done: 4, total: 10 } })), 5);
  assert.equal(where(doc({ status: 'published' }), ctx({ lookups: { coverage: { 99: 55 } } })), 4);
  const d = doc({ status: 'published', id: 99 });
  assert.equal(where(d, ctx({ lookups: { coverage: { 99: 55 } } })), 5);                       // the coverage map says it too, when the row has no counts
  assert.equal(where(doc({ status: 'archived' })), null);
  assert.equal(where(doc({ status: 'expired' })), 4);
  assert.equal(where(doc({ status: 'exception_applied' })), 4);
  assert.equal(where(doc({ status: 'something_new' })), null);
});

test('the plain badge: Live, Needs a fresh look (live and late), Out of date (expired), Not live yet, On its way, Update on its way (a newer version over one in force), Exception applied, Archived', () => {
  const word = (d: TrackerDoc) => standingOf(d, ctx()).badge.word;
  assert.equal(word(doc()), 'Live');
  assert.equal(word(doc({ next_review_date: '2026-10-01T00:00:00' })), 'Needs a fresh look');
  assert.equal(word(doc({ status: 'expired' })), 'Out of date');
  assert.equal(word(doc({ status: 'draft', version_in_force: null })), 'Not live yet');
  assert.equal(word(doc({ status: 'pending_review', version_in_force: null })), 'On its way');
  assert.equal(word(doc({ status: 'approved', version_in_force: null })), 'On its way');
  assert.equal(word(doc({ status: 'pending_review', version_in_force: '1.0', current_version: '1.1' })), 'Update on its way');
  assert.equal(word(doc({ status: 'exception_applied' })), 'Exception applied');
  assert.equal(word(doc({ status: 'archived' })), 'Archived');
  assert.equal(word(doc({ status: 'weird_status' })), 'Weird status');                         // a status nobody registered is said readably, never blank
  // a draft is not "late": no review is owed on a document that is not in force
  assert.equal(word(doc({ status: 'draft', version_in_force: null, next_review_date: '2026-10-01T00:00:00' })), 'Not live yet');
  // a workflow flagged a live document for review
  assert.equal(word(doc({ status: 'review_required' })), 'Update on its way');
  assert.equal(word(doc({ status: 'review_required', version_in_force: null })), 'On its way');
  for (const b of BADGE_MEANING) assert.ok(b.word && b.meaning);
  // a label that leans on a word of the glossary gets that word's (i); every such label is one the page can draw
  for (const [label, term] of Object.entries(BADGE_TERM)) assert.ok(BADGE_MEANING.some((b) => b.word === label) && GLOSSARY[term], label);
  assert.ok(isLive(doc()) && !isLive(doc({ status: 'draft', version_in_force: null })) && !isLive(doc({ status: 'expired' })));
});

test('the steps are done behind, here at the document, next ahead; a problem is marked and worded, and nothing rests on colour: every step has a word', () => {
  const steps = (d: TrackerDoc, c = ctx()) => stepsOf(standingOf(d, c)).map((s) => `${s.state}${s.problem ? '!' : ''}:${s.word}`);
  assert.deepEqual(steps(doc({ status: 'pending_approval', version_in_force: null })), ['done:Done', 'done:Done', 'here:Now', 'next:Not yet', 'next:Not yet', 'next:Not yet']);
  assert.deepEqual(steps(doc()), ['done:Done', 'done:Done', 'done:Done', 'done:Done', 'here:Now', 'next:Not asked']);
  assert.deepEqual(steps(doc({ attestation: { pct: 60, done: 6, total: 10 } })), ['done:Done', 'done:Done', 'done:Done', 'done:Done', 'done:Done', 'here:Under way']);
  assert.deepEqual(steps(doc({ attestation: { pct: 100, done: 10, total: 10 } })), Array(6).fill('done:Done'));
  assert.deepEqual(steps(doc({ status: 'expired' })), ['done:Done', 'done:Done', 'done:Done', 'done:Done', 'here!:Expired', 'next:Not yet']);
  assert.deepEqual(steps(doc({ next_review_date: '2026-10-01T00:00:00' })), ['done:Done', 'done:Done', 'done:Done', 'done:Done', 'here!:Check-up late', 'next:Not asked']);
  assert.deepEqual(steps(doc({ status: 'archived' })), Array(6).fill('off:Not in use'));
});

test('Now and Next name only what the data holds: no name for who a review waits on unless the inbox says it', () => {
  const t = (o: Partial<TrackerDoc>, c: Partial<TrackerContext> = {}) => trackOf(doc(o), ctx(c));
  // draft: the author writes it (the owner when there is no author); a newer version over one in force says so
  assert.equal(t({ status: 'draft', version_in_force: null }).now, 'Omar Tariq is writing it. Nobody has to follow it yet.');
  assert.equal(t({ status: 'draft', version_in_force: null, author_name: null }).now, 'Maria Lopez is writing it. Nobody has to follow it yet.');
  assert.equal(t({ status: 'draft', version_in_force: null, author_name: null, owner_name: null }).now, 'Still being written. Nobody has to follow it yet.');
  assert.equal(t({ status: 'draft', version_in_force: '1.0', current_version: '1.1' }).now, 'Omar Tariq is writing it. v1.0 is still published.');
  // in review with no names anywhere: generic, and neither the owner nor the author is made the reviewer
  const generic = t({ status: 'pending_review', version_in_force: null });
  assert.equal(generic.now, 'Waiting for review.');
  assert.ok(!/Maria|Omar/.test(generic.now + generic.next));
  assert.equal(t({ status: 'pending_approval', version_in_force: null }).now, 'Waiting for sign-off.');
  // the people the signed-in person asked, and what waits for them
  const d = doc({ status: 'pending_review', version_in_force: null });
  const sent: ReadonlyMap<number, DocPeople> = new Map([[d.id, { sent: { waiting: ['Bina Branch', 'Chen Wei'], more: 2, overdue: false } }]]);
  assert.equal(trackOf(d, ctx({ people: sent })).now, 'Waiting for review from Bina Branch, Chen Wei and 2 more.');
  const a = doc({ status: 'pending_approval', version_in_force: null });
  const mine: ReadonlyMap<number, DocPeople> = new Map([[a.id, { mine: { kind: 'approval', overdue: true, dueAt: null, requester: null, createdAt: null } }]]);
  const you = trackOf(a, ctx({ people: mine }));
  assert.equal(you.now, 'Waiting for your sign-off.');
  assert.deepEqual(you.you, { word: 'You’re late', what: 'Approve and sign' });
  assert.equal(trackOf(doc(), ctx()).you, null);
  // approved: the date it was signed off, when the row has it
  assert.equal(t({ status: 'approved', version_in_force: null, approved_at: '2026-11-05T09:00:00' }).now, 'Signed off 6 days ago. Not published yet.');
  assert.equal(t({ status: 'approved', version_in_force: null }).now, 'Signed off. Not published yet.');
});

test('a live document says how many still have to confirm, only when the row carries the counts; late, expired, exception and archived are named', () => {
  const t = (o: Partial<TrackerDoc>) => trackOf(doc(o), ctx());
  assert.equal(t({ attestation: { pct: 70, done: 28, total: 40 } }).now, 'Live. 12 of 40 people still have to confirm they have read it.');
  assert.equal(t({ attestation: { pct: 97, done: 39, total: 40 } }).now, 'Live. 1 of 40 people still has to confirm they have read it.');
  assert.equal(t({ attestation: { pct: 70, done: NaN, total: NaN } }).now, 'Live. 30% still have to confirm they have read it.');
  assert.equal(t({ attestation: { pct: 100, done: 40, total: 40 } }).now, 'Live. Everyone has confirmed they have read it.');
  assert.equal(t({}).now, 'Live. Nobody has been asked to confirm they have read it.');
  assert.equal(t({}).next, 'Nothing until the next check-up on 1 Mar 2027.');
  assert.equal(t({ next_review_date: null }).next, 'No check-up date is set.');
  const late = t({ next_review_date: '2026-11-01T00:00:00' });
  assert.equal(late.now, 'Live, but its check-up was due 1 Nov 2026, 10 days ago.');
  assert.equal(late.next, 'Maria Lopez needs to confirm it is still correct.');
  assert.equal(t({ next_review_date: '2026-11-01T00:00:00', owner_name: null }).next, 'It has no owner. Someone needs to take it on.');
  assert.equal(t({ status: 'expired', expiry_date: '2026-10-20T00:00:00' }).now, 'It ran out on 20 Oct 2026 and no longer applies.');
  assert.equal(t({ status: 'expired' }).now, 'It has run out and no longer applies.');
  assert.equal(t({ status: 'exception_applied' }).now, 'An exception is in place, so it is not enforced.');
  assert.equal(t({ status: 'archived' }).next, 'It can be restored as a draft.');
  assert.equal(t({ status: 'weird' }).now, '');
});

test('Now and Next are one short line each: no line is a paragraph, none holds an id or a hash', () => {
  const people: ReadonlyMap<number, DocPeople> = new Map();
  for (const status of ['draft', 'pending_review', 'pending_approval', 'approved', 'published', 'expired', 'archived', 'exception_applied', 'review_required']) {
    for (const o of [{}, { attestation: { pct: 10, done: 1, total: 10 } }, { next_review_date: '2026-01-01T00:00:00' }]) {
      const t = trackOf(doc({ status, ...o }), ctx({ people }));
      for (const line of [t.now, t.next]) {
        assert.ok(line.length <= 120, line);
        assert.ok(!/[0-9a-f]{12,}|#\d+|\bid\b/i.test(line), line);
      }
    }
  }
});

test('a narrow card says where it is in one line', () => {
  assert.equal(trackOf(doc({ status: 'pending_review', version_in_force: null }), ctx()).where, 'Step 2 of 6: Being checked');
  assert.equal(trackOf(doc({ attestation: { pct: 100, done: 1, total: 1 } }), ctx()).where, 'All 6 steps done');
  assert.equal(trackOf(doc({ status: 'archived' }), ctx()).where, 'Not in use');
});

test('the cards: yours first (late before the rest), then expired, late for a check-up (longest first), exception, live and not yet read (least first), on its way, drafts, live and fine, archived', () => {
  const live = doc({ title: 'fine' });
  const draft = doc({ status: 'draft', version_in_force: null, title: 'draft' });
  const onItsWay = doc({ status: 'pending_review', version_in_force: null, title: 'onway' });
  const archived = doc({ status: 'archived', title: 'archived' });
  const unread = doc({ attestation: { pct: 20, done: 2, total: 10 }, title: 'unread20' });
  const unread2 = doc({ attestation: { pct: 80, done: 8, total: 10 }, title: 'unread80' });
  const exception = doc({ status: 'exception_applied', title: 'exception' });
  const late5 = doc({ next_review_date: '2026-11-06T00:00:00', title: 'late5' });
  const late40 = doc({ next_review_date: '2026-10-01T00:00:00', title: 'late40' });
  const expired = doc({ status: 'expired', title: 'expired' });
  const yours = doc({ status: 'pending_review', version_in_force: null, title: 'yours' });
  const yoursLate = doc({ status: 'pending_review', version_in_force: null, title: 'yoursLate' });
  const people: ReadonlyMap<number, DocPeople> = new Map([
    [yours.id, { mine: { kind: 'review', overdue: false, dueAt: null, requester: null, createdAt: null } }],
    [yoursLate.id, { mine: { kind: 'review', overdue: true, dueAt: null, requester: null, createdAt: null } }],
  ]);
  const all = [live, archived, draft, onItsWay, unread2, unread, exception, late5, late40, expired, yours, yoursLate];
  assert.deepEqual(trackerOrder(all, ctx({ people })).map((d) => d.title), ['yoursLate', 'yours', 'expired', 'late40', 'late5', 'exception', 'unread20', 'unread80', 'onway', 'draft', 'fine', 'archived']);
  // documents of the same standing keep the order they came in (the list's own sort)
  const twins = [doc({ title: 'b' }), doc({ title: 'a' }), doc({ title: 'c' })];
  assert.deepEqual(trackerOrder(twins, ctx()).map((d) => d.title), ['b', 'a', 'c']);
  assert.equal(attentionOf(live, ctx()).rank, 7);
});

test('the inbox as it concerns each document: the person’s own request (a decision before an acknowledgement) and who the requests they sent wait for', () => {
  const ready: SourceInput['state'] = { state: 'ready', at: 1 };
  const inbox = buildInbox([
    { id: 'doc.lifecycle', state: ready, raw: { enabled: true, items: [
      { id: 1, document_id: 10, kind: 'acknowledgement', title: 'A', doc_type: 'policy', version: '1.0', status: 'published', requested_by_name: 'Sara', requested_at: '2026-11-05T09:00:00', due_date: '2026-11-20' },
      { id: 2, document_id: 10, kind: 'review', title: 'A', doc_type: 'policy', version: '1.0', status: 'pending_review', requested_by_name: 'Bina Branch', requested_at: '2026-11-05T09:00:00' },
      { id: 3, document_id: 11, kind: 'acknowledgement', title: 'B', doc_type: 'policy', version: '1.0', status: 'published' },
    ] } },
    { id: 'doc.sent', state: ready, raw: { enabled: true, items: [
      { document_id: 12, kind: 'review', title: 'C', pending: 2, waiting: ['Chen Wei', 'Aamir'], waiting_more: 1, status: 'pending_review' },
      { document_id: 12, kind: 'approval', title: 'C', pending: 1, waiting: ['Aamir', 'Nadia'], waiting_more: 0, status: 'pending_review' },
    ] } },
  ], NOW);
  const p = peopleOf(inbox);
  assert.equal(p.get(10)?.mine?.kind, 'review');
  assert.equal(p.get(10)?.mine?.requester, 'Bina Branch');
  assert.equal(p.get(11)?.mine?.kind, 'acknowledgement');
  assert.deepEqual([...(p.get(12)?.sent?.waiting ?? [])].sort(), ['Aamir', 'Chen Wei', 'Nadia']);          // a name once, though two requests wait for it
  assert.equal(p.get(12)?.sent?.more, 1);
  assert.equal(p.get(12)?.mine, undefined);
  assert.equal(p.get(99), undefined);
  // nothing asked of the person and nothing sent: nobody is named
  assert.equal(peopleOf(buildInbox([], NOW)).size, 0);
});

test('small words: a list of names, how long ago, how many cards are drawn', () => {
  assert.equal(nameList([]), '');
  assert.equal(nameList(['A']), 'A');
  assert.equal(nameList(['A', 'B']), 'A and B');
  assert.equal(nameList(['A', 'B', 'C']), 'A, B and C');
  assert.equal(nameList(['A', 'B'], 3), 'A, B and 3 more');
  assert.equal(agoWords('2026-11-11T01:00:00', NOW), 'today');
  assert.equal(agoWords('2026-11-10T20:00:00', NOW), 'yesterday');
  assert.equal(agoWords('2026-11-05T09:00:00', NOW), '6 days ago');
  assert.equal(agoWords('2026-05-11T09:00:00', NOW), '6 months ago');
  assert.equal(agoWords(null, NOW), '');
  assert.deepEqual(cardsShown(0, 5), { count: 5, more: 0 });
  assert.deepEqual(cardsShown(0, 100), { count: CARDS_AT_A_TIME, more: CARDS_AT_A_TIME });
  assert.deepEqual(cardsShown(24, 30), { count: 24, more: 6 });
  assert.deepEqual(cardsShown(99, 30), { count: 30, more: 0 });
});
