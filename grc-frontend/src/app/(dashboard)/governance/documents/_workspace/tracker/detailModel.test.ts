// node --test "src/app/(dashboard)/governance/documents/_workspace/tracker/detailModel.test.ts"
// The detail of one document: the stepper from the real states (a status, a hold, a late review, an attestation, the acknowledgements, a phase nobody is asked at), the sections step by step
// (the route's stages with each person's state and due date, the changes asked for or proposed, the published version, the attestation campaign, who has not read it yet, the exceptions,
// the facts), what a part that has not arrived does to them, and the address of a document's views.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { TrackerCampaign, TrackerLine, TrackerSignoff } from '../../../../../../lib/documentTrackerApi.ts';
import type { LifecycleReply } from '../../../../../../lib/documentLifecycle.ts';
import type { ProposalList } from '../../../../../../lib/proposals.ts';
import { setsOf, type TrackerContext } from '../libraryTracker.ts';
import { STEPS, FIRST_NAMES, ok, ruleWords, sectionsOf, stepsOf, tabHref, requestsOf, type DetailDoc, type DetailInput, type Part } from './detailModel.ts';

const NOW = new Date('2026-11-12T12:00:00Z');
const ctx = (o: Partial<TrackerContext> = {}): TrackerContext => ({ lookups: { coverage: {}, departmentPaths: { 5: 'Operations › Support' }, frameworks: { 1: { short: 'ISO 27001', name: 'ISO/IEC 27001' }, 2: { short: 'DORA', name: 'DORA' } } }, now: NOW, ...o });
let n = 0;
const doc = (o: Partial<DetailDoc> = {}): DetailDoc => ({
  id: ++n, title: `Document ${n}`, document_code: null, doc_type: 'policy', status: 'pending_review', owner_id: 7, owner_name: 'Olivia Owner', author_id: 8, author_name: 'Arun Author', department_id: 5,
  next_review_date: '2027-03-01T00:00:00', created_at: '2026-10-01T00:00:00', updated_at: '2026-11-10T00:00:00', version_in_force: null, current_version: '1.0', classification: 'confidential',
  framework_ids: [1, 2], ...o,
});
const NONE: Omit<DetailInput, 'doc'> = { signoff: { state: 'loading' }, lifecycle: { state: 'loading' }, proposals: { state: 'loading' }, campaigns: { state: 'off' }, exceptions: { state: 'off' } };
const input = (d: DetailDoc, o: Partial<Omit<DetailInput, 'doc'>> = {}): DetailInput => ({ doc: d, ...NONE, ...o });
const line = (id: number, o: Partial<TrackerLine> = {}): TrackerLine => ({ id, stage: { name: 'Review', kind: 'review' }, waiting: null, hold: null, asked: null, proposals: null, versions: null, flags: [], ...o });
const word = (i: DetailInput, c = ctx()) => stepsOf(i, c).map((s) => `${s.state}${s.problem ? '!' : ''}:${s.word}`);

const person = (o: Record<string, unknown>) => ({ assignment_id: 1, target_type: 'user', target_id: 1, display: 'Sara Reviewer', state: 'waiting', signer: null, on_behalf_of: null, at: null, comment: null, due_date: null, delegated_to: null, ...o });
const stage = (o: Record<string, unknown>) => ({ position: 1, name: 'Review', kind: 'review', kind_label: 'Reviewed by', order: 'together', rule: 'all', min_count: null, due_days: null, signature: true, allow_reject: true, allow_delegate: true, status: 'current', people: [person({})], restarted: false, progress: { required: 1, signed: 0 }, ...o });
const signoff = (stages: unknown[], o: Record<string, unknown> = {}): TrackerSignoff => ({
  status: 'pending_review', round_started_at: '2026-11-01T00:00:00', version: '1.0', participants: { prepared_by: [], reviewer: [], approver: [] }, signatures: [], decide: null,
  route: { custom: false, current: 1, stages, hold: null }, ...o,
}) as unknown as TrackerSignoff;
const lifecycle = (o: Record<string, unknown> = {}): LifecycleReply => ({
  enabled: true, document: { id: 1, title: 'x', status: 'published', version: '1.0', owner: null, author: null }, approvals: [],
  acknowledgements: { total: 0, done: 0, pending: 0, overdue: 0, percent: 0, people: [], history: [] }, mine: [], me: { id: 77 }, timeline: [], ...o,
}) as unknown as LifecycleReply;
const ackRow = (o: Record<string, unknown>) => ({ id: 1, kind: 'acknowledgement', user_id: 1, user: 'Sara', status: 'pending', version: '1.0', requested_at: '2026-11-01T00:00:00', due_date: '2026-11-20T00:00:00', done_at: null, comment: null, overdue: false, escalation_level: 0, ...o });

test('the seven steps of the life cycle', () => {
  assert.deepEqual(STEPS.map((s) => s.name), ['Draft', 'In review', 'In approval', 'Approved', 'Published', 'Attestation', 'Acknowledgement']);
});

test('the stepper follows the status: done behind, here at it, next ahead, with the dates the platform has', () => {
  const d = doc({ status: 'pending_approval', approved_at: null });
  const s = stepsOf(input(d), ctx());
  assert.deepEqual(s.map((x) => x.state), ['done', 'done', 'here', 'next', 'next', 'next', 'next']);
  assert.equal(s[0].date, '2026-10-01T00:00:00');
  assert.deepEqual(word(input(doc({ status: 'draft' }))), ['here:Now', 'next:Not yet', 'next:Not yet', 'next:Not yet', 'next:Not yet', 'next:Not yet', 'next:Not yet']);
  assert.deepEqual(word(input(doc({ status: 'approved', approved_at: '2026-11-08T00:00:00' }))).slice(0, 5), ['done:Done', 'done:Done', 'done:Done', 'here:Ready to publish', 'next:Not yet']);
  assert.equal(stepsOf(input(doc({ status: 'approved', approved_at: '2026-11-08T00:00:00' })), ctx())[3].date, '2026-11-08T00:00:00');
  assert.deepEqual(word(input(doc({ status: 'archived' }))), ['off:Archived', ...Array(6).fill('off:Not in use')]);
});

test('published: here at Published when nothing follows; Attestation and Acknowledgement carry their own numbers; a late review, an expiry and an exception are marked', () => {
  const pub = (o: Partial<DetailDoc> = {}) => doc({ status: 'published', version_in_force: '1.0', published_at: '2026-10-20T00:00:00', ...o });
  const quiet = word(input(pub(), { lifecycle: ok(lifecycle()) }));
  assert.deepEqual(quiet.slice(4), ['here:Now', 'next:Not requested', 'next:Not asked']);
  const going = word(input(pub({ attestation: { pct: 33, done: 4, total: 12 } }), { lifecycle: ok(lifecycle({ acknowledgements: { total: 10, done: 3, pending: 7, overdue: 0, percent: 30, people: [], history: [] } })) }));
  assert.deepEqual(going.slice(4), ['done:Done', 'here:4 of 12', 'here:3 of 10']);
  assert.deepEqual(word(input(pub({ attestation: { pct: 0, done: 0, total: 12 } }), { lifecycle: ok(lifecycle()) })).slice(5, 6), ['here:Not started']);
  const finished = word(input(pub({ attestation: { pct: 100, done: 12, total: 12 } }), { lifecycle: ok(lifecycle({ acknowledgements: { total: 10, done: 10, pending: 0, overdue: 0, percent: 100, people: [], history: [] } })) }));
  assert.deepEqual(finished.slice(4), ['here:Now', 'done:Everyone acknowledged', 'done:Everyone read it']);
  assert.deepEqual(word(input(pub({ next_review_date: '2026-10-01T00:00:00' }), { lifecycle: ok(lifecycle()) })).slice(4, 5), ['here!:Review overdue']);
  assert.deepEqual(word(input(doc({ status: 'expired' }))).slice(3), ['done:Done', 'here!:Expired', 'off:Not in use', 'off:Not in use']);
  assert.equal(word(input(doc({ status: 'exception_applied' })))[4], 'here!:Exception applied');
  assert.equal(word(input(pub(), { lifecycle: ok({ enabled: false }) }))[6], 'next:Not switched on');
  // a newer version in review over a published one: the published one keeps its attestation and acknowledgements
  const over = word(input(doc({ status: 'pending_review', version_in_force: '1.0', current_version: '1.1', attestation: { pct: 50, done: 5, total: 10 } })));
  assert.deepEqual(over.slice(1, 2).concat(over.slice(4, 6)), ['here:Now', 'done:v1.0 still applies', 'here:5 of 10']);
});

test('on hold marks the step the route waits at; a phase nobody is asked at is skipped once the document has moved past it', () => {
  const d = doc({ status: 'pending_approval' });
  const held = signoff([stage({ position: 1, status: 'done', people: [person({ state: 'signed' })] }), stage({ position: 2, name: 'Approval', kind: 'approval', status: 'on_hold', people: [person({})] })], {
    route: { custom: false, current: 2, stages: [stage({ position: 1, status: 'done', people: [person({ state: 'signed' })] }), stage({ position: 2, name: 'Approval', kind: 'approval', status: 'on_hold', people: [person({})] })], hold: { id: 1, stage_position: 2, requested_by: 'Olivia', requested_at: '2026-11-09T00:00:00', comment: 'Tighten section 3', kind: 'changes' } },
  });
  const s = stepsOf(input(d, { signoff: ok(held) }), ctx());
  assert.deepEqual([s[2].state, s[2].problem, s[2].word, s[2].date], ['here', true, 'On hold', '2026-11-09T00:00:00']);
  const onlyApprovers = signoff([stage({ position: 1, status: 'skipped', people: [] }), stage({ position: 2, name: 'Approval', kind: 'approval', status: 'current', people: [person({})] })]);
  assert.deepEqual(stepsOf(input(d, { signoff: ok(onlyApprovers) }), ctx()).slice(0, 3).map((x) => `${x.state}:${x.word}`), ['done:Done', 'off:Skipped', 'here:Now']);
  assert.equal(stepsOf(input(d, { signoff: ok(onlyApprovers), line: line(d.id, { hold: { kind: 'changes', by: 'Olivia', since: '2026-11-09T00:00:00', stage: null } }) }), ctx())[2].problem, true);
});

test('rule words for a stage: who signs, in turn or together, days to act; nothing for a stage of one person', () => {
  const s = (o: Record<string, unknown>) => ruleWords({ rule: 'all', order: 'together', min_count: null, due_days: null, kind: 'review', people: [1, 2, 3], ...o } as never);
  assert.equal(s({}), 'Everyone signs, all at once');
  assert.equal(s({ rule: 'any' }), 'Any one signs, all at once');
  assert.equal(s({ rule: 'at_least', min_count: 2, order: 'in_turn' }), 'At least 2 sign, one after another');
  assert.equal(s({ people: [1], due_days: 5 }), '5 days to act');
  assert.equal(s({ people: [1] }), '');
  assert.equal(s({ kind: 'information' }), 'Told, nobody waits');
});

test('the sections run in life cycle order, then changes, exceptions and facts; the route’s stages carry each person’s state, due date and how long they have waited', () => {
  const d = doc({ status: 'pending_review' });
  const sig = signoff([stage({ order: 'in_turn', rule: 'at_least', min_count: 1, due_days: 7, progress: { required: 1, signed: 1 }, people: [
    person({ display: 'Sara Reviewer', state: 'signed', signer: 'Sara Reviewer', at: '2026-11-08T10:00:00' }),
    person({ display: 'Ed Editor', state: 'waiting', due_date: '2026-11-20T00:00:00' }),
    person({ display: 'Role: Auditors', state: 'waiting', due_date: '2026-11-05T00:00:00' }),
    person({ display: 'Nadia', state: 'not_yet' }),
    person({ display: 'Khalid', state: 'changes_requested', comment: 'Please tighten section 3 and add the owner of each control so that the review can go on' }),
  ] })]);
  const lc = lifecycle({ approvals: [{ id: 1, kind: 'review', user_id: 2, user: 'Ed Editor', status: 'pending', version: '1.0', requested_at: '2026-11-06T00:00:00', due_date: '2026-11-20T00:00:00', done_at: null, comment: null, overdue: false, escalation_level: 0 }] });
  const secs = sectionsOf(input(d, { signoff: ok(sig), lifecycle: ok(lc), proposals: ok({ items: [], can_decide: false, pending: 0 } as ProposalList) }), ctx());
  assert.deepEqual(secs.map((s) => s.id), ['draft', 'review', 'approval', 'approved', 'published', 'attestation', 'acknowledgement', 'facts']);
  const review = secs.find((s) => s.id === 'review')!;
  assert.deepEqual([review.stages.length, review.stages[0].name, review.stages[0].word, review.stages[0].progress, review.stages[0].rule], [1, 'Review', 'Now', '1 of 1 signed', 'At least 1 sign, one after another, 7 days to act'.replace('At least 1 sign, one after another', 'At least 1 sign, one after another')]);
  const people = review.stages[0].people;
  assert.deepEqual(people.map((p) => `${p.name}|${p.word}|${p.tone}`), ['Sara Reviewer|Signed|success', 'Ed Editor|Waiting|progress', 'Role: Auditors|Waiting|danger', 'Nadia|Not asked yet|neutral', 'Khalid|Asked for changes|warning']);
  assert.equal(people[0].note, '8 Nov 2026');
  assert.equal(people[1].note, 'waiting 6 days · due 20 Nov 2026');                // the lifecycle says when Ed was asked
  assert.equal(people[2].note, 'due 5 Nov 2026, 7 days late');
  assert.ok(people[4].note.startsWith('“Please tighten section 3') && people[4].note.endsWith('…”'));
  assert.equal(secs.find((s) => s.id === 'approval')!.rows[0].text, 'Nobody chosen yet');
});

test('a document whose route names nobody still shows who it waits for: the requests the lifecycle holds', () => {
  const d = doc({ status: 'pending_review' });
  const rows = [
    { id: 1, kind: 'review', user_id: 2, user: 'Bina Branch', status: 'pending', version: '1.0', requested_at: '2026-08-14T07:30:00', due_date: '2026-10-18T07:30:00', done_at: null, comment: null, overdue: true, escalation_level: 0 },
    { id: 2, kind: 'review', user_id: 3, user: 'Sara', status: 'done', version: '1.0', requested_at: '2026-08-14T07:30:00', due_date: null, done_at: '2026-08-20T00:00:00', comment: null, overdue: false, escalation_level: 0 },
    { id: 3, kind: 'review', user_id: 4, user: 'Old round', status: 'done', version: '0.9', requested_at: '2026-05-01T00:00:00', due_date: null, done_at: '2026-05-02T00:00:00', comment: null, overdue: false, escalation_level: 0 },
    { id: 4, kind: 'review', user_id: 5, user: 'Cancelled one', status: 'cancelled', version: '1.0', requested_at: '2026-08-14T07:30:00', due_date: null, done_at: null, comment: null, overdue: false, escalation_level: 0 },
  ];
  const sig = signoff([stage({ status: 'skipped', people: [] }), stage({ position: 2, name: 'Approval', kind: 'approval', status: 'skipped', people: [] })], { round_started_at: '2026-08-01T00:00:00' });
  assert.equal(requestsOf(lifecycle({ approvals: rows }) as never, 'review', '2026-08-01T00:00:00').length, 2);
  const secs = sectionsOf(input(d, { signoff: ok(sig), lifecycle: ok(lifecycle({ approvals: rows })) }), ctx());
  const block = secs.find((s) => s.id === 'review')!.stages[0];
  assert.deepEqual([block.name, block.progress], ['Review', '1 of 2 signed']);
  assert.deepEqual(block.people.map((p) => `${p.name}|${p.word}|${p.tone}`), ['Bina Branch|Waiting|danger', 'Sara|Signed|success']);
  assert.ok(block.people[0].note.startsWith('waiting 3 months') && block.people[0].note.includes('late'));
  assert.equal(stepsOf(input(d, { signoff: ok(sig), lifecycle: ok(lifecycle({ approvals: rows })) }), ctx())[1].state, 'here');
});

test('changes: a hold says who asked, since when, what and who can release it; proposed changes say how many wait, since when and who proposed them', () => {
  const d = doc({ status: 'pending_approval' });
  const sig = signoff([stage({ position: 1, name: 'Approval', kind: 'approval', status: 'on_hold' })], { route: { custom: false, current: 1, stages: [stage({ position: 1, name: 'Approval', kind: 'approval', status: 'on_hold' })], hold: { id: 1, stage_position: 1, requested_by: 'Olivia', requested_at: '2026-11-08T00:00:00', comment: 'Tighten section 3', kind: 'changes' } } });
  const secs = sectionsOf(input(d, { signoff: ok(sig), line: line(d.id, { asked: { kind: 'changes', names: ['Arun Author'], more: 0, since: null } }) }), ctx());
  const c = secs.find((s) => s.id === 'changes')!;
  assert.deepEqual(c.rows.map((r) => `${r.label}: ${r.text}`), ['On hold: Since 8 Nov 2026 (4 days ago)', 'Changes requested: Olivia: “Tighten section 3”', 'Who can release it: Arun Author makes the changes and resubmits it']);
  assert.deepEqual(c.sources, ['signoff', 'proposals']);

  const p = doc({ status: 'published', version_in_force: '1.0' });
  const items = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: i, status: 'pending', kind: i === 2 ? 'statement' : 'document', proposed_by: { id: i, name: `Person ${i}` }, proposed_at: `2026-11-0${i}T00:00:00`, message: `Because of reason ${i}` }));
  const withProposals = sectionsOf(input(p, { proposals: ok({ items: [...items, { ...items[0], id: 9, status: 'rejected' }], can_decide: true, pending: 7 } as unknown as ProposalList) }), ctx()).find((s) => s.id === 'changes')!;
  assert.equal(withProposals.rows[0].text, '7 changes wait for Olivia Owner since 1 Nov 2026');
  assert.equal(withProposals.people?.people.length, FIRST_NAMES);
  assert.equal(withProposals.people?.more, 2);
  assert.deepEqual(withProposals.people?.people[1], { name: 'Person 2', word: 'Statement', tone: 'warning', note: '2 Nov 2026 · Because of reason 2' });
  // a proposal that holds the route is a proposal, not changes asked for
  const proposalHold = sectionsOf(input(d, { line: line(d.id, { hold: { kind: 'proposal', by: 'Sara', since: '2026-11-09T00:00:00', stage: 'Approval' }, asked: { kind: 'decide', names: ['Olivia Owner'], more: 0, since: null } }) }), ctx()).find((s) => s.id === 'changes')!;
  assert.deepEqual(proposalHold.rows.map((r) => r.label), ['On hold', 'Change proposed', 'Who can release it']);
  assert.equal(proposalHold.rows[2].text, 'Olivia Owner accepts or rejects the proposed change');
  // nothing held and nothing proposed: no section
  assert.equal(sectionsOf(input(d, { signoff: ok(signoff([stage({})])), proposals: ok({ items: [], can_decide: false, pending: 0 } as ProposalList) }), ctx()).some((s) => s.id === 'changes'), false);
});

test('published: the version, when, the next review and how late, the cycle, the previous version and a newer one on its way', () => {
  const d = doc({ status: 'published', version_in_force: '1.2', current_version: '1.2', published_at: '2026-10-20T00:00:00', next_review_date: '2026-11-01T00:00:00', review_cycle_months: 12, expiry_date: '2027-10-20T00:00:00' });
  const p = sectionsOf(input(d, { line: line(d.id, { stage: null, versions: { count: 3, previous: '1.1' } }) }), ctx()).find((s) => s.id === 'published')!;
  assert.deepEqual(p.rows.map((r) => `${r.label}: ${r.text}`), ['Version: v1.2', 'Published: 20 Oct 2026 (23 days ago)', 'Next review: 1 Nov 2026 · Overdue by 11 days', 'Review cycle: Every 12 months', 'Expires: 20 Oct 2027', 'Previous version: v1.1']);
  assert.equal(p.rows[2].tone, 'danger');
  const over = sectionsOf(input(doc({ status: 'pending_review', version_in_force: '1.2', current_version: '1.3' })), ctx()).find((s) => s.id === 'published')!;
  assert.ok(over.rows.some((r) => r.label === 'Newer version' && r.text === 'v1.3 is in review; v1.2 still applies'));
  assert.deepEqual(sectionsOf(input(doc({ status: 'draft' })), ctx()).find((s) => s.id === 'published')!.rows.map((r) => r.text), ['Not published yet']);
});

test('attestation: not requested, or the campaign with its status, due date and how many have acknowledged; the row’s numbers when the campaigns are not readable', () => {
  const camp = (o: Partial<TrackerCampaign> = {}): TrackerCampaign => ({ id: 1, document_id: 1, name: 'Read and understood', status: 'active', due_date: '2026-11-05T00:00:00', created_at: null, acknowledgment_count: 4, active_domain_users: 12, attestation_percent: 33, ...o });
  const pub = (o: Partial<DetailDoc> = {}) => doc({ status: 'published', version_in_force: '1.0', ...o });
  const at = (d: DetailDoc, campaigns: Part<TrackerCampaign[]>) => sectionsOf(input(d, { campaigns }), ctx()).find((s) => s.id === 'attestation')!;
  assert.deepEqual(at(pub(), { state: 'off' }).rows.map((r) => r.text), ['Not requested: nobody was asked to attest to it']);
  const d = pub({ attestation: { pct: 33, done: 4, total: 12 } });
  const s = at(d, ok([camp({ status: 'closed' }), camp()]));
  assert.deepEqual(s.rows.map((r) => `${r.label}: ${r.text}`), ['Campaign: Read and understood', 'Status: Open', 'Due: 5 Nov 2026, 7 days late', 'Acknowledged: 4 of 12 acknowledged']);
  assert.equal(s.rows[2].tone, 'danger');
  assert.deepEqual(s.bar, { pct: 33, label: '4 of 12 acknowledged', tone: 'progress' });
  assert.deepEqual(at(d, { state: 'off' }).rows.map((r) => r.label), ['Acknowledged']);
  assert.equal(at(pub({ attestation: { pct: 0, done: 0, total: 12 } }), { state: 'off' }).rows[0].text, 'Requested, not started: 0 of 12 acknowledged');
  assert.equal(at(pub({ attestation: { pct: 0, done: 0, total: 12 } }), { state: 'off' }).bar?.tone, 'warning');
  const done = at(pub({ attestation: { pct: 100, done: 12, total: 12 } }), ok([camp({ due_date: '2026-11-01T00:00:00' })]));
  assert.equal(done.rows[2].tone, undefined);                                                  // a finished campaign is not late
  assert.equal(done.bar?.tone, 'success');
});

test('acknowledgement: how many have read it, who has not (the first five and how many more), the next due date, and the person’s own status', () => {
  const pending = Array.from({ length: 8 }, (_, i) => ackRow({ id: i + 1, user_id: 100 + i, user: `Person ${i + 1}`, overdue: i === 0, due_date: i === 0 ? '2026-11-01T00:00:00' : '2026-11-20T00:00:00' }));
  const lc = lifecycle({ acknowledgements: { total: 10, done: 2, pending: 8, overdue: 1, percent: 20, people: [...pending, ackRow({ id: 20, user_id: 77, user: 'Me', status: 'done', done_at: '2026-11-03T00:00:00' })], history: [] } });
  const d = doc({ status: 'published', version_in_force: '1.0' });
  const s = sectionsOf(input(d, { lifecycle: ok(lc) }), ctx()).find((x) => x.id === 'acknowledgement')!;
  assert.deepEqual(s.rows.map((r) => `${r.label}: ${r.text}`), ['Read it: 2 of 10 (20%)', 'Late: 1 person', 'Next due: 1 Nov 2026', 'You: You read it on 3 Nov 2026']);
  assert.equal(s.people?.heading, 'Not read yet');
  assert.equal(s.people?.people.length, FIRST_NAMES);
  assert.equal(s.people?.more, 3);
  assert.deepEqual(s.people?.people[0], { name: 'Person 1', word: 'Late', tone: 'danger', note: 'due 1 Nov 2026' });
  const mine = sectionsOf(input(d, { lifecycle: ok({ ...lc, mine: [ackRow({ user_id: 77, overdue: true, due_date: '2026-11-04T00:00:00' })] } as unknown as LifecycleReply) }), ctx()).find((x) => x.id === 'acknowledgement')!;
  assert.equal(mine.rows.at(-1)?.text, 'You have not read it yet, due 4 Nov 2026');
  assert.equal(mine.rows.at(-1)?.tone, 'danger');
  const none = sectionsOf(input(d, { lifecycle: ok(lifecycle()) }), ctx()).find((x) => x.id === 'acknowledgement')!;
  assert.equal(none.rows[0].text, 'Nobody has been asked to read it yet');
  assert.equal(sectionsOf(input(d, { lifecycle: ok({ enabled: false }) }), ctx()).find((x) => x.id === 'acknowledgement')!.rows[0].text, 'Acknowledgements are not switched on for this organisation');
  assert.deepEqual(sectionsOf(input(d), ctx()).find((x) => x.id === 'acknowledgement')!.rows, []);        // not here yet: nothing is said
});

test('draft facts, the exceptions of a document under one, and the other facts a person looks for', () => {
  const d = doc({ status: 'draft', owner_id: null, owner_name: null, author_name: 'Arun Author' });
  const sig = signoff([], { participants: { prepared_by: [], reviewer: [{ display: 'Sara Reviewer', target_type: 'user' }], approver: [] } });
  const draft = sectionsOf(input(d, { signoff: ok(sig) }), ctx()).find((s) => s.id === 'draft')!;
  assert.deepEqual(draft.rows.map((r) => `${r.label}: ${r.text}`), ['Owner: No owner', 'Author: Arun Author', 'Last edited: 10 Nov 2026 (2 days ago)', 'Version: v1.0', 'Will review: Sara Reviewer', 'Will approve: Nobody chosen yet']);
  assert.equal(draft.rows[0].tone, 'danger');
  const ex = doc({ status: 'exception_applied' });
  const e = sectionsOf(input(ex, { exceptions: ok([{ id: 1, title: 'Legacy server', status: 'approved', expiry_date: '2027-01-31T00:00:00', exception_type_label: 'Time-bound' }]) }), ctx()).find((s) => s.id === 'exceptions')!;
  assert.deepEqual(e.rows, [{ label: 'Time-bound', text: 'Legacy server · approved · until 31 Jan 2027' }]);
  const facts = sectionsOf(input(doc(), {}), ctx()).find((s) => s.id === 'facts')!;
  assert.deepEqual(facts.rows.map((r) => `${r.label}: ${r.text}`), ['Unit: Operations › Support', 'Type: Policy', 'Classification: Confidential', 'Frameworks: ISO 27001 and DORA']);
  assert.equal(sectionsOf(input(doc({ department_id: null, framework_ids: [], classification: null }), {}), ctx()).find((s) => s.id === 'facts')!.rows.map((r) => r.text).join('|'), 'No unit|Policy|—|None');
  assert.equal(sectionsOf(input(doc()), ctx()).some((s) => s.id === 'exceptions'), false);
});

test('no screen holds an id: nothing the sections say is a bare number key, a hash or a record number', () => {
  const d = doc({ status: 'pending_review' });
  const text = JSON.stringify(sectionsOf(input(d, { signoff: ok(signoff([stage({})])), lifecycle: ok(lifecycle()) }), ctx()));
  assert.ok(!/#\d|[0-9a-f]{24,}|"assignment_id"|"target_id"/i.test(text));
});

test('the address of a document opened at one of its views keeps what it already carries', () => {
  assert.equal(tabHref('/governance/documents/12', 'approvals'), '/governance/documents/12?tab=approvals');
  assert.equal(tabHref('/governance/documents/12?from=%2Fgovernance%2Fdocuments%3Fview%3Dtracker', 'versions'), '/governance/documents/12?from=%2Fgovernance%2Fdocuments%3Fview%3Dtracker&tab=versions');
  assert.equal(tabHref('/governance/documents/12?tab=proposals', 'approvals'), '/governance/documents/12?tab=approvals');
  assert.equal(tabHref('/x#top', 'approvals'), '/x?tab=approvals#top');
});

test('without the sets or the parts, nothing is guessed', () => {
  const d = doc();
  const secs = sectionsOf(input(d), ctx({ sets: setsOf(null) }));
  assert.ok(secs.length >= 6 && secs.every((s) => s.rows.every((r) => r.text.length > 0)));
  assert.equal(secs.find((s) => s.id === 'review')!.stages.length, 0);
});
