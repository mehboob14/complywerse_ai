// node --test "src/lib/inbox/decisionModel.test.ts"
// The decision dialog's rules. No new transition: the choices and payloads equal what SignoffAction (the document page) and the assessment approvals page already send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NEEDS_SIGNATURE, doneWords, documentChoices, documentRequest, evidenceChoices, evidenceRequest, failureOf, keysAfterDecision, problemWith,
} from './decisionModel.ts';

const http = (status: number | null, detail?: unknown) => ({ isAxiosError: true, code: status ? undefined : 'ERR_NETWORK', response: status ? { status, data: { detail } } : undefined });

test('a reviewer or approver may sign it, ask for changes or reject it; where the stage forbids rejecting there is no Reject', () => {
  assert.deepEqual(documentChoices({ kind: 'approval', can_reject: true }, 'approver').map((c) => c.id), ['sign', 'changes', 'reject']);
  assert.deepEqual(documentChoices({ kind: 'concurrence', can_reject: false }, 'reviewer').map((c) => c.id), ['sign', 'changes']);
  assert.deepEqual(documentChoices(null, 'approver').map((c) => c.id), ['sign', 'changes', 'reject'], 'an older server sends no step: the default stage allows it');
});

test('the signing button speaks the stage\'s own words (the same ones the document page uses)', () => {
  assert.equal(documentChoices({ kind: 'review' }, 'reviewer')[0].submit, 'Sign as reviewed');
  assert.equal(documentChoices({ kind: 'approval' }, 'approver')[0].submit, 'Sign and approve');
  assert.equal(documentChoices({ kind: 'concurrence' }, 'reviewer')[0].submit, 'Concur and sign');
  assert.equal(documentChoices(null, 'reviewer')[0].submit, 'Sign as reviewed');
  assert.equal(documentChoices(null, 'approver')[0].submit, 'Sign and approve');
});

test('a proposer signing a change that was not accepted "as it is" has only the signature', () => {
  assert.deepEqual(documentChoices({ kind: 'review', may_sign_as_is: true }, 'reviewer', true).map((c) => c.id), ['sign']);
});

test('signing needs the drawn signature (the server refuses without); asking for changes and rejecting need a reason; evidence needs nothing', () => {
  const [sign, changes, reject] = documentChoices({ kind: 'approval' }, 'approver');
  assert.equal(problemWith(sign, { signature: null, comment: '' }), NEEDS_SIGNATURE);
  assert.equal(problemWith(sign, { signature: 'data:image/png;base64,AAA', comment: '' }), '');
  assert.equal(problemWith(changes, { signature: null, comment: '   ' }), 'Say what should change.');
  assert.equal(problemWith(changes, { signature: null, comment: 'Clause 4' }), '');
  assert.equal(problemWith(reject, { signature: null, comment: '' }), 'Say why you reject it.');
  for (const c of evidenceChoices()) assert.equal(problemWith(c, { signature: null, comment: '' }), '', c.id);
});

test('the three document requests carry what SignoffAction sends: comment, signature, the version shown and the review round', () => {
  const shown = { version: '2.1', round_at: '2026-10-30T08:00:00' };
  assert.deepEqual(documentRequest('sign', { signature: 'sig', comment: ' Agreed ' }, shown), { api: 'sign', body: { comment: 'Agreed', signature_image: 'sig', version: '2.1', round_at: '2026-10-30T08:00:00' } });
  assert.deepEqual(documentRequest('sign', { signature: 'sig', comment: '' }, shown).body.comment, undefined);
  assert.deepEqual(documentRequest('reject', { signature: null, comment: ' No ' }, shown), { api: 'reject', body: { comment: 'No', version: '2.1', round_at: '2026-10-30T08:00:00' } });
  assert.deepEqual(documentRequest('changes', { signature: null, comment: 'Fix 3' }, { version: null, round_at: null }), { api: 'changes', body: { comment: 'Fix 3', version: undefined, round_at: null } });
});

test('the three evidence requests are the actions the approval endpoint takes: approve, return, reject', () => {
  assert.deepEqual(evidenceRequest('approve', ''), { action: 'approve', comments: undefined });
  assert.deepEqual(evidenceRequest('return', ' Blurry '), { action: 'return', comments: 'Blurry' });
  assert.deepEqual(evidenceRequest('reject', 'No'), { action: 'reject', comments: 'No' });
});

test('the payloads and endpoints match the pages that already send them (source pin)', () => {
  const signoff = readFileSync('src/app/(dashboard)/governance/documents/_SignoffControl.tsx', 'utf8');
  assert.match(signoff, /signDocumentOff\(documentId, \{ comment: comment \|\| undefined, signature_image: signature \|\| undefined, version: shown \?\? data\?\.version, round_at: data\?\.round_at \}\)/);
  assert.match(signoff, /rejectDocumentSignoff\(documentId, \{ comment: reason, version: shown \?\? data\?\.version, round_at: data\?\.round_at \}\)/);
  assert.match(signoff, /requestSignoffChanges\(documentId, \{ comment: reason\.trim\(\), version: shown \?\? data\?\.version, round_at: data\?\.round_at \}\)/);
  const approvals = readFileSync('src/app/(dashboard)/compliance/assessments/approvals/page.tsx', 'utf8');
  assert.match(approvals, /apiClient\.post\(`\/compliance\/assessments\/evidence\/\$\{approval\.id\}\/approval`, \{\s*action,\s*comments: comments \|\| undefined,/);
});

test('a failure is told in the server\'s words under a headline that says what to do', () => {
  assert.deepEqual(failureOf(http(403, 'You are not an assigned signer for this document at its current stage, or you have already signed.')),
    { kind: 'stale', headline: 'This is no longer waiting for you', message: 'You are not an assigned signer for this document at its current stage, or you have already signed.' });
  assert.equal(failureOf(http(404, 'Document not found')).kind, 'stale');
  assert.deepEqual(failureOf(http(409, 'The document changed since you opened it. Reload it and read it again.')),
    { kind: 'changed', headline: 'The document changed', message: 'The document changed since you opened it. Reload it and read it again.' });
  assert.equal(failureOf(http(500, 'boom')).kind, 'retry');
  assert.equal(failureOf(http(null)).kind, 'retry');
  assert.match(failureOf(http(null)).message, /reach the server/);
  assert.deepEqual(failureOf(http(400, 'Draw your signature to sign this document.')), { kind: 'refused', headline: 'Your decision was not accepted', message: 'Draw your signature to sign this document.' });
});

test('a failure never shows a vendor name or markup', () => {
  assert.equal(failureOf(http(500, 'OpenAI exploded <b>now</b>')).message, 'AI exploded now');
});

test('what a decision refreshes: the four lists and the legacy approvals list, and with a document its sign-off, its page and its life cycle', () => {
  assert.deepEqual(keysAfterDecision(null), [['my-document-requests'], ['my-signoff-pending'], ['header-pending-approvals'], ['my-document-requests-sent'], ['pending-approvals']]);
  assert.deepEqual(keysAfterDecision(7).slice(5), [['doc-signoff', 7], ['governance-document', 7], ['document-lifecycle']]);
});

test('the confirmation of every choice is a title and a sentence', () => {
  for (const [choice, evidence] of [['sign', false], ['changes', false], ['reject', false], ['reject', true], ['approve', true], ['return', true]] as const) {
    const words = doneWords(choice, evidence);
    assert.ok(words.title && words.message, `${choice}/${evidence}`);
  }
  assert.notEqual(doneWords('reject', true).message, doneWords('reject', false).message);
});
