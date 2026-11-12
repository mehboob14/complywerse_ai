// node --test "src/app/(dashboard)/governance/documents/_workspace/tracker/lineModel.test.ts"
// The compact line: the step in a few words, the blocker in plain words with who ("Waiting on Sara and 1 more", "Stuck: nobody can be asked", "Changes requested by Olivia: Arun has to
// revise it", "3 proposed changes wait for the owner"), the age pill; a name only where the server's line or the inbox holds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { TrackerLine } from '../../../../../../lib/documentTrackerApi.ts';
import { setsOf, type DocPeople, type TrackerContext, type TrackerDoc } from '../libraryTracker.ts';
import { ageOf, blockerOf, stepWord, youOf } from './lineModel.ts';

const NOW = new Date('2026-11-12T12:00:00Z');
const ctx = (o: Partial<TrackerContext> = {}): TrackerContext => ({ lookups: { coverage: {} }, now: NOW, ...o });
let n = 0;
const doc = (o: Partial<TrackerDoc> = {}): TrackerDoc => ({
  id: ++n, title: `Document ${n}`, document_code: null, doc_type: 'policy', status: 'pending_review', owner_id: 7, owner_name: 'Olivia Owner', author_name: 'Arun Author', department_id: null,
  next_review_date: '2027-03-01T00:00:00', created_at: '2026-01-01T00:00:00', updated_at: '2026-11-01T00:00:00', version_in_force: null, current_version: '1.0', ...o,
});
const line = (id: number, o: Partial<TrackerLine> = {}): TrackerLine => ({ id, stage: { name: 'Review', kind: 'review' }, waiting: null, hold: null, asked: null, proposals: null, versions: null, flags: [], ...o });
const words = (d: TrackerDoc, l: TrackerLine | null | undefined, c = ctx()) => blockerOf(d, l, c);

test('the step in a few words; a stage of its own route is named after it', () => {
  assert.deepEqual(['draft', 'pending_review', 'pending_approval', 'approved', 'published', 'expired', 'exception_applied', 'archived', 'review_required'].map((status) => stepWord({ status })),
    ['Draft', 'In review', 'In approval', 'Approved', 'Published', 'Expired', 'Exception applied', 'Archived', 'Review required']);
  assert.equal(stepWord({ status: 'weird_one' }), 'Weird one');
  assert.equal(stepWord({ status: 'pending_review' }, line(1, { stage: { name: 'Legal check', kind: 'concurrence' } })), 'In review · Legal check');
  assert.equal(stepWord({ status: 'pending_approval' }, line(1, { stage: { name: 'Approval', kind: 'approval' } })), 'In approval');
});

test('in review or approval: who it waits for and since when; late is danger; nobody to ask is stuck; no line yet says only what the status says', () => {
  const d = doc();
  const waiting = { kind: 'review' as const, names: ['Sara Reviewer', 'Ed Editor'], more: 1, count: 3, since: '2026-11-08T08:00:00', overdue: 0, next_due: '2026-11-20T00:00:00' };
  const b = words(d, line(d.id, { waiting }));
  assert.deepEqual([b.kind, b.text, b.tone, b.late, b.since], ['waiting', 'Waiting on Sara Reviewer, Ed Editor and 1 more', 'progress', false, '2026-11-08T08:00:00']);
  const a = ageOf(b, NOW);
  assert.deepEqual([a?.days, a?.label, a?.tone, a?.title], [4, '4 d', 'neutral', 'Waiting 4 days']);
  const late = words(d, line(d.id, { waiting: { ...waiting, overdue: 1, since: '2026-10-20T00:00:00' } }));
  assert.deepEqual([late.tone, late.late], ['danger', true]);
  assert.deepEqual([ageOf(late, NOW)?.tone, ageOf(late, NOW)?.title], ['danger', 'Late: waiting 23 days']);
  const own = words(doc({ status: 'pending_approval' }), line(0, { stage: { name: 'Board sign-off', kind: 'approval' }, waiting: { ...waiting, kind: 'approval', names: ['Khalid'], more: 0 } }));
  assert.equal(own.text, 'Waiting on Khalid at Board sign-off');
  assert.equal(words(d, line(d.id)).text, 'Stuck: nobody can be asked');                      // the server answered and nobody has a request
  assert.equal(words(d, undefined).text, 'Waiting for review');                               // not loaded: no name is invented
  assert.equal(words(doc({ status: 'pending_approval' }), undefined).text, 'Waiting for sign-off');
  const s = doc();
  assert.equal(words(s, undefined, ctx({ sets: setsOf({ stuck: [s.id] }) })).text, 'Stuck: nobody can be asked');
  const sl = doc();
  const longWait = words(sl, undefined, ctx({ sets: setsOf({ stuck: [sl.id], late_approvals: [sl.id] }) }));
  assert.deepEqual([longWait.text, longWait.tone, longWait.late], ['Waiting for review', 'danger', true]);   // stuck AND late is a long wait, not a missing person
  const people = new Map<number, DocPeople>([[d.id, { sent: { waiting: ['Chen Wei'], more: 2, overdue: false } }]]);
  assert.equal(words(d, undefined, ctx({ people })).text, 'Waiting on Chen Wei and 2 more');   // the inbox's own sent list may say who
});

test('sent back for changes: who asked and who has to revise it; held for a proposed change; proposed changes that wait for the owner', () => {
  const d = doc({ status: 'pending_approval' });
  const hold = { kind: 'changes' as const, by: 'Olivia Owner', since: '2026-11-05T00:00:00', stage: 'Approval' };
  const asked = { kind: 'changes' as const, names: ['Arun Author'], more: 0, since: '2026-11-05T00:00:00' };
  const b = words(d, line(d.id, { hold, asked }));
  assert.deepEqual([b.kind, b.text, b.tone, b.since], ['changes', 'Changes requested by Olivia Owner: Arun Author has to revise it', 'warning', '2026-11-05T00:00:00']);
  assert.equal(ageOf(b, NOW)?.label, '7 d');
  assert.equal(ageOf(b, NOW)?.tone, 'warning');
  assert.equal(words(d, undefined, ctx({ sets: setsOf({ changes_requested: [d.id] }) })).text, 'Changes requested: Arun Author has to revise it');
  assert.equal(words(d, line(d.id, { hold })).text, 'Changes requested by Olivia Owner: Arun Author has to revise it');   // the author named by the row when the line does not say

  const p = doc({ status: 'published', version_in_force: '1.0' });
  const many = words(p, line(p.id, { stage: null, proposals: { count: 3, since: '2026-11-02T00:00:00', names: ['Sara', 'Ed'], more: 1 } }));
  assert.deepEqual([many.kind, many.text, many.tone, many.since], ['proposals', '3 proposed changes wait for Olivia Owner', 'warning', '2026-11-02T00:00:00']);
  assert.equal(words(p, line(p.id, { stage: null, proposals: { count: 1, since: null, names: ['Sara'], more: 0 }, asked: { kind: 'decide', names: ['Olivia Owner', 'Arun Author'], more: 0, since: null } })).text,
    'A change proposed by Sara waits for Olivia Owner and Arun Author');
  assert.equal(words(p, undefined, ctx({ sets: setsOf({ proposals_waiting: [p.id] }) })).text, 'A proposed change waits for Olivia Owner');
  // a proposal that holds the route is a proposal, not "changes requested"
  assert.equal(words(d, line(d.id, { hold: { ...hold, kind: 'proposal' }, proposals: { count: 1, since: null, names: ['Sara'], more: 0 } })).kind, 'proposals');
});

test('the other steps: a draft, approved and waiting, published (a late review, late acknowledgements, the attestation), flagged, and the ends of the road', () => {
  assert.equal(words(doc({ status: 'draft' }), undefined).text, 'Arun Author is writing it');
  assert.equal(words(doc({ status: 'draft', author_name: null, owner_name: null }), undefined).text, 'Being written');
  assert.equal(words(doc({ status: 'draft', version_in_force: '1.1' }), undefined).text, 'Arun Author is writing it. v1.1 is still published');
  const ap = words(doc({ status: 'approved', approved_at: '2026-11-08T00:00:00' }), undefined);
  assert.deepEqual([ap.kind, ap.text, ageOf(ap, NOW)?.label], ['to_publish', 'Ready to publish: approved 4 days ago', '4 d']);
  const pub = (o: Partial<TrackerDoc> = {}, c = ctx()) => words(doc({ status: 'published', version_in_force: '1.0', ...o }), undefined, c);
  assert.deepEqual([pub().kind, pub().text, pub().tone], ['none', 'Nothing waiting', 'neutral']);
  assert.equal(ageOf(pub(), NOW), null);
  const late = pub({ next_review_date: '2026-10-01T00:00:00' });
  assert.deepEqual([late.kind, late.text, late.tone, ageOf(late, NOW)?.label], ['review_late', 'Review was due 1 Oct 2026: Olivia Owner has to confirm it', 'danger', '42 d']);
  assert.equal(pub({ next_review_date: '2026-10-01T00:00:00', owner_name: null }).text, 'Review was due 1 Oct 2026: it has no owner');
  const w = doc({ status: 'published', version_in_force: '1.0' });
  assert.equal(words(w, undefined, ctx({ sets: setsOf({ late_acknowledgements: [w.id] }) })).text, 'Some acknowledgements are late');
  assert.equal(pub({ attestation: { pct: 0, done: 0, total: 12 } }).text, 'Attestation asked, not started');
  assert.deepEqual([pub({ attestation: { pct: 33, done: 4, total: 12 } }).text, pub({ attestation: { pct: 33, done: 4, total: 12 } }).tone], ['Attestation: 4 of 12 acknowledged', 'progress']);
  assert.deepEqual([pub({ attestation: { pct: 100, done: 12, total: 12 } }).text, pub({ attestation: { pct: 100, done: 12, total: 12 } }).tone], ['Everyone acknowledged', 'success']);
  assert.equal(words(doc({ status: 'review_required', version_in_force: '1.0' }), undefined).text, 'Flagged for a fresh review. The published version still applies');
  assert.equal(words(doc({ status: 'review_required' }), undefined).text, 'Flagged for review');
  const ex = words(doc({ status: 'expired', expiry_date: '2026-10-30T00:00:00' }), undefined);
  assert.deepEqual([ex.kind, ex.text, ex.tone, ageOf(ex, NOW)?.label], ['expired', 'Ran out on 30 Oct 2026: no longer applies', 'danger', '13 d']);
  assert.equal(words(doc({ status: 'exception_applied' }), undefined).text, 'An exception is in place: not enforced');
  const ar = words(doc({ status: 'archived' }), undefined);
  assert.deepEqual([ar.text, ageOf(ar, NOW)], ['Taken out of use', null]);
  assert.equal(words(doc({ status: 'weird' }), undefined).text, '');
});

test('"Needs you" and "You’re late": only for a request the inbox holds', () => {
  const d = doc();
  const mine = (overdue: boolean): ReadonlyMap<number, DocPeople> => new Map([[d.id, { mine: { kind: 'review' as const, overdue, dueAt: null, requester: null, createdAt: null } }]]);
  assert.deepEqual(youOf(d, { people: mine(false) }), { word: 'Needs you', what: 'Review and sign' });
  assert.deepEqual(youOf(d, { people: mine(true) }), { word: 'You’re late', what: 'Review and sign' });
  assert.equal(youOf(d, { people: new Map() }), null);
  assert.equal(youOf(d, {}), null);
});
