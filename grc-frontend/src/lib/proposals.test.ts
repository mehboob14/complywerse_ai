// node --test src/lib/proposals.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  acceptLine, compareTitles, deciderName, fieldRows, gapJustification, holdLine, mayProposeAgain, pageBanner, pendingFor, pick, proposalHref,
  proposedOf, proposedStatements, proposedToast, rejectLine, sessionProposal, signRoleOf, staleLine, staleOf, whatLine, type Proposal, type ProposedAnswer,
} from './proposals.ts';

const rana = { id: 7, name: 'Rana Reviewer' };
const olivia = { id: 2, name: 'Olivia Owner' };
const prop = (over: Partial<Proposal> = {}): Proposal => ({
  id: 1, document_id: 3, kind: 'document', source: 'studio', status: 'pending', stale: false, proposed_by: rana, proposed_at: '2026-10-21T09:00:00',
  message: 'Section 2 names who approves exceptions.', change_type: 'minor', base: { version_id: 11, number: '3.1' }, statement: null, finding: null,
  has_file: false, decided_by: null, decided_at: null, decision_note: null, applied_version: null, may_accept: false, may_reject: false, may_withdraw: false,
  ...over,
});

test('what was proposed reads in plain words, with its statement, its clause and its size', () => {
  assert.equal(whatLine(prop()), 'Edited in the AI Studio (minor change)');
  assert.equal(whatLine(prop({ source: 'gap_fix', change_type: null, finding: { id: 4, clause_reference: 'A.5.1', clause_title: 'Policies for information security' } })),
    'Gap fix: A.5.1 Policies for information security');
  assert.equal(whatLine(prop({ kind: 'statement', source: 'statement_edit', change_type: null, statement: { id: 9, code: 'PS-0003-004', before: null, after: null } })),
    'Change statement PS-0003-004');
  assert.equal(whatLine(prop({ source: 'something_new', change_type: 'major' })), 'A change to the document (major change)');   // a source added later
});

test('the owner decides, else the author; a document with neither says "the owner"', () => {
  assert.equal(deciderName({ owner_name: 'Olivia Owner', author_name: 'Sara' }), 'Olivia Owner');
  assert.equal(deciderName({ owner_name: '  ', author_name: 'Sara' }), 'Sara');
  assert.equal(deciderName(null), 'the owner');
});

test('a writer that made a proposal is told apart from one that changed the document, and its sentence is the toast', () => {
  const answer: ProposedAnswer = { proposed: true, proposal: prop(), message: 'Sent to Olivia Owner to accept. The document does not change until then.' };
  assert.equal(proposedOf(answer), answer);
  for (const other of [{ version: '1.3', status: 'draft' }, { proposed: false }, null, undefined, 'proposed']) assert.equal(proposedOf(other), null);
  assert.deepEqual(proposedToast(answer), { title: 'Change proposed', message: answer.message });
  assert.equal(proposedToast({ ...answer, message: '' }, 'Olivia').message, 'Sent to Olivia to accept. The document does not change until then.');
});

test('accepting a stale proposal is refused with the server\'s sentence; other refusals are not "stale"', () => {
  const detail = 'This change was made on v1.2; the document is now v1.3. Ask Rana to propose it again.';
  assert.equal(staleOf({ response: { status: 409, data: { detail, code: 'proposal_stale' } } }), detail);
  assert.equal(staleOf({ response: { status: 409, data: { detail: { detail, code: 'proposal_stale' } } } }), detail);      // HTTPException(detail={…})
  assert.equal(staleOf({ response: { status: 409, data: { code: 'proposal_stale' } } }), 'The document changed since this was proposed. It can only be rejected now.');
  assert.equal(staleOf({ response: { status: 409, data: { detail: 'Another conflict' } } }), null);
  assert.equal(staleOf({ response: { status: 400, data: { code: 'proposal_stale' } } }), null);
  assert.equal(staleOf(new Error('Network Error')), null);
  assert.equal(staleLine(prop({ base: { version_id: 1, number: '1.2' } }), '1.3', false),
    'This change was made on v1.2; the document is now v1.3. It can only be rejected now: ask Rana Reviewer to propose it again.');
  assert.match(staleLine(prop(), '3.2', true), /Propose it again on the current version, or withdraw it\.$/);
});

test('Accept says the version it makes and what happens to the review', () => {
  const review = { status: 'pending_review', current: '3.1' };
  assert.equal(acceptLine(prop(), review, 'Legal review'), 'It becomes v3.2 and the review continues — everyone at Legal review reviews again.');
  assert.equal(acceptLine(prop({ change_type: 'major' }), { ...review, status: 'pending_approval' }, 'Approval'), 'It becomes v4.0 and the review starts again from the first stage.');
  assert.equal(acceptLine(prop({ change_type: null }), review, null), 'It becomes the next version and the review continues — everyone at this stage reviews again.');
  assert.equal(acceptLine(prop(), { status: 'draft', current: '1.9' }), 'It becomes v1.10.');
  assert.equal(acceptLine(prop(), { status: 'published', current: '2.0', inForce: '2.0' }),
    'It becomes v2.1. It goes back to review with the same reviewers and approvers; with nobody set it becomes a draft again. Everyone else keeps reading the published version v2.0 until this one is approved and published.');
  assert.equal(acceptLine(prop({ kind: 'statement', change_type: null }), { status: 'published', current: '2.0' }), 'The statement changes as proposed.');
  assert.equal(acceptLine(prop({ kind: 'statement', change_type: 'major' }), review, 'Review'), 'The statement changes as proposed and the review continues — everyone at Review reviews again.');
});

test('Reject says what the proposer is asked to do, in review and outside it', () => {
  assert.match(rejectLine('Rana', 'pending_review'), /asked to sign it as it is or propose another change\. The review stays on hold until then\.$/);
  assert.match(rejectLine('Rana', 'published'), /can revise it and propose it again\. The document stays as it is\.$/);
});

test('the two columns of a comparison name the library version and who proposed it when', () => {
  const day = (iso: string | null) => (iso ? '21 Oct 2026' : '-');
  assert.deepEqual(compareTitles(prop(), '3.1', day), { before: 'In the library now (v3.1)', after: 'Proposed by Rana Reviewer · 21 Oct 2026' });
  assert.equal(compareTitles(prop({ stale: true, base: { version_id: 1, number: '1.2' } }), '1.3', day).before, 'v1.2, the version it was made on');
  assert.equal(compareTitles(prop({ base: { version_id: null, number: null }, proposed_at: null }), '2.0', day).after, 'Proposed by Rana Reviewer');
});

test('the list opens on the one asked for, else the oldest waiting, else the newest', () => {
  const items = [prop({ id: 5, status: 'rejected' }), prop({ id: 4 }), prop({ id: 3 }), prop({ id: 2, status: 'accepted' })];   // newest first
  assert.equal(pick(items, 2)?.id, 2);
  assert.equal(pick(items, 99)?.id, 3);
  assert.equal(pick(items.filter((p) => p.status !== 'pending'), null)?.id, 5);
  assert.equal(pick([], 1), null);
});

test('the page banner: the decider\'s waiting changes, else the person\'s own newest change', () => {
  const waiting = [prop({ id: 6 }), prop({ id: 5 }), prop({ id: 4, status: 'accepted' })];
  assert.deepEqual(pageBanner({ items: waiting, can_decide: true, pending: 2 }, olivia.id, 'Olivia Owner'),
    { kind: 'decide', text: '2 changes are waiting for your decision', action: 'Review them', proposalId: 5 });
  assert.equal(pageBanner({ items: [prop()], can_decide: true, pending: 1 }, olivia.id, 'Olivia Owner')?.text, '1 change is waiting for your decision');
  assert.deepEqual(pageBanner({ items: waiting, can_decide: false, pending: 2 }, rana.id, 'Olivia Owner'),
    { kind: 'waiting', text: "Your change is waiting for Olivia Owner's decision", action: 'See it', proposalId: 6 });
  const rejected = [prop({ id: 8, status: 'rejected', decided_by: olivia, decision_note: 'Keep the old wording.' })];
  assert.equal(pageBanner({ items: rejected, can_decide: false, pending: 0 }, rana.id, 'Olivia Owner')?.text, 'Olivia Owner did not accept your change');
  assert.equal(pageBanner({ items: [prop({ status: 'rejected' })], can_decide: false, pending: 0 }, rana.id, 'the owner')?.text, 'The owner did not accept your change');
  assert.equal(pageBanner({ items: waiting, can_decide: false, pending: 2 }, 99, 'Olivia Owner'), null);              // someone else's changes
  assert.equal(pageBanner({ items: [prop({ status: 'accepted' })], can_decide: false, pending: 0 }, rana.id, 'Olivia'), null);
  assert.equal(pageBanner(undefined, rana.id, 'Olivia'), null);
});

test('the AI Studio shows the change sent from this session while it waits or after it was not accepted', () => {
  const items = [prop({ id: 3, source: 'statement_edit', kind: 'statement' }), prop({ id: 2, studio_session_id: 40 }), prop({ id: 1, studio_session_id: 41 })];
  assert.equal(sessionProposal(items, 41, rana.id)?.id, 1);
  assert.equal(sessionProposal(items, 40, rana.id)?.id, 2);
  assert.equal(sessionProposal([prop({ id: 9, status: 'accepted' }), prop({ id: 8, status: 'rejected' })], 40, rana.id), null);     // the newest was accepted
  assert.equal(sessionProposal([prop({ id: 8, status: 'rejected' })], 40, rana.id)?.id, 8);       // a server without the session id: the person's own
  assert.equal(sessionProposal([prop({ id: 8 })], 40, olivia.id), null);
  assert.equal(sessionProposal(undefined, 40, rana.id), null);
});

test('a hold of kind proposal says who proposed it and who decides, and after a rejection what the proposer does', () => {
  assert.equal(holdLine({ proposer: 'Rana', decider: 'Olivia', me: 'other' }), "Rana proposed a change — waiting for Olivia's decision");
  assert.equal(holdLine({ proposer: 'Rana', decider: 'Olivia', me: 'decider' }), 'Rana proposed a change — waiting for your decision');
  assert.equal(holdLine({ proposer: 'Rana', decider: 'Olivia', me: 'proposer' }), "Your change is waiting for Olivia's decision");
  assert.equal(holdLine({ proposer: 'Rana', decider: 'Olivia', me: 'proposer', status: 'rejected' }), 'Olivia did not accept your change');
  assert.equal(holdLine({ proposer: 'Rana', decider: 'Olivia', me: 'decider', status: 'rejected' }),
    "You did not accept Rana's change — waiting for Rana to sign it as it is or propose another change");
  assert.equal(holdLine({ proposer: 'Rana', decider: 'the owner', me: 'other', status: 'rejected' }),
    "The owner did not accept Rana's change — waiting for Rana to sign it as it is or propose another change");
});

test('the proposer after a rejection signs with their own step; everyone else as before', () => {
  assert.equal(signRoleOf({ my_actionable_role: 'approver' }), 'approver');
  assert.equal(signRoleOf({ my_actionable_role: null, my_step: { role_type: 'reviewer', may_sign_as_is: true } }), 'reviewer');
  assert.equal(signRoleOf({ my_actionable_role: null, my_step: { role_type: 'reviewer' } }), null);
  assert.equal(signRoleOf(undefined), null);
});

test('only the proposer proposes again, after a rejection or when the document moved on', () => {
  assert.equal(mayProposeAgain(prop({ status: 'rejected' }), rana.id), true);
  assert.equal(mayProposeAgain(prop({ stale: true }), rana.id), true);
  assert.equal(mayProposeAgain(prop(), rana.id), false);
  assert.equal(mayProposeAgain(prop({ status: 'rejected' }), olivia.id), false);
  assert.equal(mayProposeAgain(prop({ status: 'rejected' }), null), false);
});

test('a gap fix\'s justification is its clause and why, as the server fills it', () => {
  assert.equal(gapJustification({ clause_reference: 'A.5.1', clause_title: 'Policies', gap_description: 'No review cycle.', missing_requirement: 'Review it every year.' }),
    'A.5.1 Policies: No review cycle. Review it every year.');
  assert.equal(gapJustification({ clause_reference: '4.2', gap_description: ' ', missing_requirement: null, ai_reasoning: 'The policy is silent on  scope.' }),
    '4.2: The policy is silent on scope.');
  assert.equal(gapJustification({ clause_title: 'Access control' }), 'Access control');
  assert.equal(gapJustification({}), '');
});

test('a statement proposal is a before and after table: changed fields marked, a new one and a removed one', () => {
  const before = { statement_text: 'Passwords have 8 characters.', category: 'risk_management', priority: 'medium', is_mandatory: true, source_section: '4.1' };
  const rows = fieldRows(before, { ...before, statement_text: 'Passwords have 12 characters.', is_mandatory: false });
  assert.deepEqual(rows.map((r) => [r.label, r.before, r.after, r.changed]), [
    ['Wording', 'Passwords have 8 characters.', 'Passwords have 12 characters.', true],
    ['Category', 'Risk management', 'Risk management', false],
    ['Priority', 'Medium', 'Medium', false],
    ['Mandatory', 'Yes', 'No', true],
    ['Section', '4.1', '4.1', false],
  ]);
  assert.deepEqual(fieldRows(null, { ...before, category: 'it' }).map((r) => r.before), ['—', '—', '—', '—', '—']);
  assert.equal(fieldRows(null, { ...before, category: 'it' })[1].after, 'IT');
  assert.deepEqual(fieldRows(before, null).map((r) => r.after), ['Removed', '—', '—', '—', '—']);
});

test('a statement shows its own waiting proposal; new statements proposed are listed apart', () => {
  const st = (id: number | null, source: string, status: Proposal['status'] = 'pending') =>
    prop({ kind: 'statement', source, status, statement: { id, code: id ? `PS-${id}` : null, before: null, after: null } });
  const items = [st(4, 'statement_edit'), st(null, 'statement_add'), st(5, 'statement_delete', 'rejected'), prop()];
  assert.equal(pendingFor(items, 4)?.statement?.id, 4);
  assert.equal(pendingFor(items, 5), null);
  assert.deepEqual(proposedStatements(items).map((p) => p.source), ['statement_add']);
});

test('links open the document on the proposal', () => {
  assert.equal(proposalHref(3, 12), '/governance/documents/3?tab=proposals&proposal=12');
  assert.equal(proposalHref(3), '/governance/documents/3?tab=proposals');
});
