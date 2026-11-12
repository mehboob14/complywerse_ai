// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryTracker.test.ts"
// The Tracker's grouping rules: every document in exactly one group (what needs attention first, then its step), the count and the one line of each group (only with figures that are
// known), the person's own documents first inside a group, the paging that keeps a large library cheap, and the plain helpers (names, ages, attestation).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildInbox, type SourceInput } from '../../../../../lib/inbox/buildInbox.ts';
import {
  GROUPS, GROUP_BY_ID, ROWS_AT_A_TIME, ageLabel, ageTone, agoWords, attestationOf, buildGroups, daysSince, groupOf, isLive, nameList, pagesOf, peopleOf, rowsShown, setsOf, spanWords, summaryOf,
  type TrackerContext, type TrackerDoc,
} from './libraryTracker.ts';

const NOW = new Date('2026-11-12T12:00:00Z');
const ctx = (o: Partial<TrackerContext> = {}): TrackerContext => ({ lookups: { coverage: {} }, now: NOW, ...o });
let n = 0;
const doc = (o: Partial<TrackerDoc> = {}): TrackerDoc => ({
  id: ++n, title: `Document ${n}`, document_code: null, doc_type: 'policy', status: 'published', owner_id: 7, owner_name: 'Maria Lopez', author_name: 'Omar Tariq', department_id: null,
  next_review_date: '2027-03-01T00:00:00', created_at: '2026-01-01T00:00:00', updated_at: '2026-11-10T00:00:00', version_in_force: '1.0', current_version: '1.0', ...o,
});
const sets = (o: Parameters<typeof setsOf>[0]) => setsOf(o);
const group = (d: TrackerDoc, c = ctx()) => groupOf(d, c);

test('the groups follow the life cycle: five steps, then six for what needs attention, each with a short label and an (i) note', () => {
  assert.deepEqual(GROUPS.map((g) => g.id), ['draft', 'review', 'approval', 'approved', 'published', 'changes', 'proposed', 'overdue', 'expired', 'exception', 'archived', 'other']);
  assert.deepEqual(GROUPS.map((g) => g.kind), ['step', 'step', 'step', 'step', 'step', ...Array(7).fill('attention')]);
  assert.deepEqual(GROUPS.slice(0, 5).map((g) => g.label), ['Draft', 'In review', 'In approval', 'Approved', 'Published']);
  for (const g of GROUPS) {
    assert.ok(g.label.split(/\s+/).length <= 3, g.label);
    assert.ok(g.info.length > 15 && /\.$/.test(g.info) && !/\bin force\b/i.test(g.info), g.label);
    assert.equal(GROUP_BY_ID[g.id], g);
  }
});

test('a document is in the group of its step, and what needs attention takes it out of it: archived, expired, an exception, sent back, a proposed change, a late review', () => {
  assert.equal(group(doc({ status: 'draft', version_in_force: null })), 'draft');
  assert.equal(group(doc({ status: 'pending_review', version_in_force: null })), 'review');
  assert.equal(group(doc({ status: 'pending_approval', version_in_force: null })), 'approval');
  assert.equal(group(doc({ status: 'approved', version_in_force: null })), 'approved');
  assert.equal(group(doc()), 'published');
  assert.equal(group(doc({ status: 'archived' })), 'archived');
  assert.equal(group(doc({ status: 'expired' })), 'expired');
  assert.equal(group(doc({ status: 'exception_applied' })), 'exception');
  assert.equal(group(doc({ status: 'something_new' })), 'other');
  assert.equal(group(doc({ next_review_date: '2026-10-01T00:00:00' })), 'overdue');
  // a newer version in review over a published one stays in review even when the published one's review date has passed: no review is owed on what is being replaced
  assert.equal(group(doc({ status: 'pending_review', next_review_date: '2026-10-01T00:00:00' })), 'review');
  assert.equal(group(doc({ status: 'draft', version_in_force: null, next_review_date: '2026-10-01T00:00:00' })), 'draft');
  // a workflow flagged a published document for review; one never published sits with the reviews
  assert.equal(group(doc({ status: 'review_required' })), 'overdue');
  assert.equal(group(doc({ status: 'review_required', version_in_force: null })), 'review');
  const held = doc({ status: 'pending_approval' }), proposed = doc(), both = doc({ status: 'pending_review' }), gone = doc({ status: 'archived' });
  const c = ctx({ sets: sets({ changes_requested: [held.id, both.id], proposals_waiting: [proposed.id, both.id, gone.id] }) });
  assert.equal(group(held, c), 'changes');
  assert.equal(group(proposed, c), 'proposed');
  assert.equal(group(both, c), 'changes');                     // sent back wins over a proposed change: the route is waiting for the author first
  assert.equal(group(gone, c), 'archived');                    // archived wins over everything
  assert.equal(group(doc({ status: 'published', next_review_date: '2026-10-01T00:00:00' }), ctx({ sets: sets({ proposals_waiting: [n] }) })), 'proposed');
});

test('without the server’s sets a document is in its step’s group and no figure about the sets is said', () => {
  const held = doc({ status: 'pending_approval' });
  assert.equal(group(held), 'approval');
  assert.equal(group(held, ctx({ sets: sets(null) })), 'approval');
  assert.equal(summaryOf('approval', [held], ctx()), '');
});

test('the groups hold every document once, in the order of GROUPS; an empty group is not there; the person’s own come first, late ones first', () => {
  const a = doc({ status: 'draft', version_in_force: null }), b = doc({ status: 'pending_review', version_in_force: null }), c = doc(), d = doc({ status: 'archived' });
  const e = doc(), f = doc(), g = doc();
  const mk = (overdue: boolean) => ({ mine: { kind: 'review' as const, overdue, dueAt: null, requester: null, createdAt: null } });
  const people = new Map([[g.id, mk(true)], [f.id, mk(false)]]);
  const groups = buildGroups([a, b, c, d, e, f, g], ctx({ people }));
  assert.deepEqual(groups.map((x) => x.def.id), ['draft', 'review', 'published', 'archived']);
  assert.deepEqual(groups.map((x) => x.count), [1, 1, 4, 1]);
  assert.equal(groups.reduce((s, x) => s + x.count, 0), 7);
  assert.deepEqual(groups[2].docs.map((x) => x.id), [g.id, f.id, c.id, e.id]);                  // late first, then yours, then the order they came in
  assert.equal(groups[2].mine, 2);
  assert.deepEqual(buildGroups([], ctx()), []);
});

test('the one line of a group says only what is known: late and stuck from the sets, what the rows hold, what waits for you', () => {
  const r = [doc({ status: 'pending_review', version_in_force: null }), doc({ status: 'pending_review', version_in_force: null }), doc({ status: 'pending_review', version_in_force: null }), doc({ status: 'pending_review', version_in_force: null })];
  const c = ctx({ sets: sets({ late_approvals: [r[0].id, r[1].id], stuck: [r[0].id, r[2].id], on_hold: [], waiting_week: [r[1].id, r[2].id, r[3].id] }), people: new Map([[r[3].id, { mine: { kind: 'review' as const, overdue: false, dueAt: null, requester: null, createdAt: null } }]]) });
  assert.equal(summaryOf('review', r, c), '2 late, 1 stuck, 1 waiting over a week, 1 for you');         // late and stuck are not said twice
  assert.equal(summaryOf('review', r, ctx()), '');
  assert.equal(buildGroups(r, c)[0].summary, '2 late, 1 stuck, 1 waiting over a week, 1 for you');

  const drafts = [doc({ status: 'draft', owner_id: null, updated_at: '2026-09-01T00:00:00' }), doc({ status: 'draft', updated_at: '2026-11-11T00:00:00', version_in_force: null })];
  assert.equal(summaryOf('draft', drafts, ctx()), '1 with no owner, 1 not touched for 30 days, 1 updating a published one');
  assert.equal(summaryOf('approved', [doc({ status: 'approved', approved_at: '2026-11-01T00:00:00' }), doc({ status: 'approved', approved_at: '2026-11-11T00:00:00' })], ctx()), '1 waiting over a week to be published');
  const pub = [doc({ attestation: { pct: 0, done: 0, total: 10 } }), doc({ attestation: { pct: 40, done: 4, total: 10 } }), doc({ attestation: { pct: 100, done: 10, total: 10 } }), doc({ owner_id: null })];
  assert.equal(summaryOf('published', pub, ctx({ sets: sets({ late_acknowledgements: [pub[1].id, pub[2].id] }) })), '1 attestations not started, 1 attestations under way, 2 with late acknowledgements, 1 with no owner');
  const late = [doc({ next_review_date: '2026-09-12T00:00:00' }), doc({ next_review_date: '2026-11-01T00:00:00' })];
  assert.equal(summaryOf('overdue', late, ctx()), 'longest 2 months late');
  assert.equal(summaryOf('changes', [doc()], ctx()), 'waiting for the author to revise and resubmit');
  assert.equal(summaryOf('proposed', [doc()], ctx()), 'waiting for the owner to accept or reject');
  assert.equal(summaryOf('published', [doc({ attestation: null })], ctx()), '');       // nothing holds it up: nothing is said
});

test('paging: 25 rows at a time, "Show more" adds 25, the pages are what each asks the server for', () => {
  assert.equal(ROWS_AT_A_TIME, 25);
  assert.deepEqual(rowsShown(25, 100), { count: 25, more: 25 });
  assert.deepEqual(rowsShown(50, 60), { count: 50, more: 10 });
  assert.deepEqual(rowsShown(25, 7), { count: 7, more: 0 });
  assert.deepEqual(rowsShown(0, 0), { count: 0, more: 0 });
  const ids = Array.from({ length: 60 }, (_, i) => i);
  assert.deepEqual(pagesOf(ids, 25).map((p) => p.length), [25]);
  assert.deepEqual(pagesOf(ids, 50).map((p) => p.length), [25, 25]);
  assert.deepEqual(pagesOf(ids, 75).map((p) => p.length), [25, 25, 10]);
  assert.deepEqual(pagesOf([], 25), []);
  assert.deepEqual(pagesOf(ids, 0).map((p) => p.length), [25]);
});

test('a thousand documents are grouped without a request: groups are built from rows already held, and only a group’s first page is ever drawn', () => {
  const docs = Array.from({ length: 2000 }, (_, i) => doc({ status: (['draft', 'pending_review', 'pending_approval', 'approved', 'published'] as const)[i % 5], version_in_force: i % 5 === 4 ? '1.0' : null }));
  const t0 = Date.now();
  const groups = buildGroups(docs, ctx());
  assert.ok(Date.now() - t0 < 1500);
  assert.deepEqual(groups.map((g) => g.count), [400, 400, 400, 400, 400]);
  assert.equal(pagesOf(groups[0].docs, ROWS_AT_A_TIME).flat().length, 25);
});

test('plain helpers: names, spans, ages, attestation in the Board’s words', () => {
  assert.equal(nameList([]), '');
  assert.equal(nameList(['Sara']), 'Sara');
  assert.equal(nameList(['Sara', 'Ed']), 'Sara and Ed');
  assert.equal(nameList(['Sara', 'Ed'], 3), 'Sara, Ed and 3 more');
  assert.equal(nameList(['Sara'], 1), 'Sara and 1 more');
  assert.deepEqual([0, 1, 6, 59, 61, 400, 800].map(spanWords), ['today', '1 day', '6 days', '59 days', '2 months', '13 months', '2 years']);
  assert.deepEqual([0, 4, 59, 61, 800].map(ageLabel), ['today', '4 d', '59 d', '2 mo', '2 y']);
  assert.deepEqual([[0, false], [6, false], [7, false], [13, false], [14, false], [1, true]].map(([d, l]) => ageTone(d as number, l as boolean)), ['neutral', 'neutral', 'warning', 'warning', 'danger', 'danger']);
  assert.equal(agoWords('2026-11-12T01:00:00', NOW), 'today');
  assert.equal(agoWords('2026-11-11T23:00:00', NOW), 'yesterday');
  assert.equal(agoWords('2026-11-06T00:00:00', NOW), '6 days ago');
  assert.equal(agoWords(null, NOW), '');
  assert.equal(daysSince('2026-11-20T00:00:00', NOW), 0);                       // the future is not "ago"
  assert.equal(daysSince('x', NOW), null);
  assert.ok(isLive(doc()) && isLive(doc({ status: 'draft' })) && !isLive(doc({ status: 'draft', version_in_force: null })) && !isLive(doc({ status: 'expired' })));
  const lk = { coverage: { 99: 55 } as Record<number, number> };
  const state = (o: Partial<TrackerDoc>, l = lk) => attestationOf(doc(o), l).state;
  assert.equal(state({ attestation: null }), 'none');
  assert.equal(state({ attestation: { pct: 0, done: 0, total: 9 } }), 'not_started');
  assert.equal(state({ attestation: { pct: 44, done: 4, total: 9 } }), 'in_progress');
  assert.equal(state({ attestation: { pct: 100, done: 9, total: 9 } }), 'complete');
  assert.equal(state({ id: 99, attestation: null }), 'in_progress');           // the coverage map says it when the row carries no counts
  assert.deepEqual(attestationOf(doc({ id: 99, attestation: null }), lk), { state: 'in_progress', done: null, total: null, pct: 55 });
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
  assert.equal(peopleOf(buildInbox([], NOW)).size, 0);                  // nothing asked of the person and nothing sent: nobody is named
});
