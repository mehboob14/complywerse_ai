// Run from this folder (node --test reads [id] in a path as a glob): node --test _docActions.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inForceLine, lastAcknowledged, primaryAction, publishLine, rejectionOf, stepLine, type PrimaryInput } from './docActions.ts';

const base: PrimaryInput = { status: 'draft', myAck: false, myRole: null, canEdit: false, canPublish: false };
const kind = (over: Partial<PrimaryInput>) => primaryAction({ ...base, ...over })?.kind ?? null;

test('acknowledge only on a published document', () => {
  assert.deepEqual(primaryAction({ ...base, myAck: true, status: 'published' }), { kind: 'acknowledge', label: 'Acknowledge' });
  assert.equal(kind({ myAck: true, status: 'approved' }), null);
  assert.equal(kind({ myAck: true, status: 'draft' }), null);
});

test('acknowledge while a new version is on its way: the published one stays in force', () => {
  for (const status of ['draft', 'pending_review', 'pending_approval', 'approved']) {
    assert.equal(kind({ myAck: true, inForce: true, status }), 'acknowledge', status);
    assert.equal(kind({ myAck: true, inForce: false, status }), null, status);
  }
  assert.equal(kind({ myAck: false, inForce: true, status: 'pending_review' }), null);
  assert.equal(kind({ myAck: true, inForce: true, myRole: 'reviewer', status: 'pending_review' }), 'acknowledge');
});

test('the line about the version in force says who reads which version', () => {
  assert.equal(inForceLine({ status: 'pending_review', current: '1.0', inForce: '1.0', newer: { number: '1.1', status: 'pending_review' } }),
    'You are reading the published version v1.0. Version 1.1 is in review; it replaces this one when it is approved and published.');
  assert.equal(inForceLine({ status: 'approved', current: '1.0', inForce: '1.0', newer: { number: '2.0', status: 'approved' } }),
    'You are reading the published version v1.0. Version 2.0 is approved; it replaces this one when it is published.');
  assert.equal(inForceLine({ status: 'pending_review', current: '1.1', inForce: '1.0' }),
    'This is version 1.1 (in review). Everyone else reads the published version v1.0 until this one is published.');
  assert.match(inForceLine({ status: 'draft', current: '1.2', inForce: '1.0' }) ?? '', /^This is version 1\.2 \(being revised\)/);
  assert.equal(inForceLine({ status: 'published', current: '1.0', inForce: '1.0' }), null);         // the one in force itself
  assert.equal(inForceLine({ status: 'draft', current: '1.0', inForce: '1.0' }), null);             // set back to draft, no new version
  assert.equal(inForceLine({ status: 'draft', current: '1.0', inForce: null }), null);              // never published
  assert.equal(inForceLine({ status: 'archived', current: '1.1', inForce: null }), null);
  // staff read the version published last of an archived document: no "it replaces this one" line
  assert.equal(inForceLine({ status: 'archived', current: '1.0', inForce: null, newer: { number: '1.1', status: 'archived' } }), null);
});

test('acknowledge beats every other rule', () => {
  assert.equal(kind({ myAck: true, status: 'published', myRole: 'reviewer', canEdit: true, canPublish: true }), 'acknowledge');
});

test('reviewer and approver get their own step', () => {
  assert.deepEqual(primaryAction({ ...base, myRole: 'reviewer', status: 'in_review' }), { kind: 'review', label: 'Review and sign' });
  assert.deepEqual(primaryAction({ ...base, myRole: 'approver', status: 'in_review' }), { kind: 'approve', label: 'Approve and sign' });
});

test('a personal step beats publish and submit', () => {
  assert.equal(kind({ myRole: 'reviewer', status: 'approved', canPublish: true }), 'review');
  assert.equal(kind({ myRole: 'approver', status: 'approved', canPublish: true }), 'approve');
  assert.equal(kind({ myRole: 'reviewer', status: 'draft', canEdit: true }), 'review');
  assert.equal(kind({ myAck: true, myRole: 'approver', status: 'approved' }), 'approve');
});

test('publish needs the right and an approved document', () => {
  assert.deepEqual(primaryAction({ ...base, canPublish: true, status: 'approved' }), { kind: 'publish', label: 'Publish' });
  assert.equal(kind({ canPublish: true, status: 'published' }), null);
  assert.equal(kind({ canPublish: false, canEdit: true, status: 'approved' }), null);
});

test('submit needs edit rights and a draft', () => {
  assert.deepEqual(primaryAction({ ...base, canEdit: true, status: 'draft' }), { kind: 'submit', label: 'Submit for review' });
  assert.equal(kind({ canEdit: true, canPublish: true, status: 'draft' }), 'submit');
  assert.equal(kind({ canEdit: true, status: 'in_review' }), null);
  assert.equal(kind({ canEdit: false, status: 'draft' }), null);
});

test('nothing to do -> null', () => {
  assert.equal(primaryAction(base), null);
  assert.equal(kind({ myRole: undefined, status: 'published' }), null);
});

test('stepLine without a due date', () => {
  assert.equal(stepLine({ kind: 'acknowledge' }), 'You are asked to read and acknowledge this document');
  assert.equal(stepLine({ kind: 'review', due: null }), 'You are asked to review and sign this document');
  assert.equal(stepLine({ kind: 'approve', due: '' }), 'You are asked to approve and sign this document');
  assert.equal(stepLine({ kind: 'publish', due: 'soon' }), 'It is approved: publish it so everyone reads it');
  assert.equal(stepLine({ kind: 'submit' }), 'This is a draft: choose reviewers and send it for review');
});

test('stepLine with a due date keeps the day the server sent', () => {
  assert.equal(stepLine({ kind: 'review', due: '2026-10-30' }), 'You are asked to review and sign this document by 30 Oct 2026');
  assert.equal(stepLine({ kind: 'approve', due: '2026-01-01T00:00:00' }), 'You are asked to approve and sign this document by 1 Jan 2026');
  assert.equal(stepLine({ kind: 'acknowledge', due: '2026-12-31T23:59:59.000Z' }), 'You are asked to read and acknowledge this document by 31 Dec 2026');
  assert.equal(stepLine({ kind: 'submit', due: '2026-13-01' }), 'This is a draft: choose reviewers and send it for review');
});

test('publishing a major version asks everyone, a minor one only those who have not acknowledged this major version', () => {
  assert.match(publishLine('1.0', true), /every active user is asked/);
  assert.match(publishLine('3', true), /every active user is asked/);
  assert.match(publishLine('1.1', true), /not acknowledged a version 1\.x yet/);
  assert.match(publishLine('v2.10', true), /version 2\.x/);
  assert.equal(publishLine('1.1', false), 'It becomes the version everyone reads.');
});

const ob = (id: number, kind: string, status: string, over: Record<string, unknown> = {}) =>
  ({ id, kind, status, user_id: 5, version: '1.0', requested_at: '2026-10-17T07:00:00', done_at: null as string | null, ...over });

test('a draft shows its newest rejection until someone is asked to sign again', () => {
  const rejected = ob(2, 'review', 'rejected', { done_at: '2026-10-17T08:00:00.5' });
  const rows = [ob(1, 'review', 'done', { done_at: '2026-10-16T08:00:00' }), rejected, ob(3, 'approval', 'cancelled', { done_at: '2026-10-17T08:00:00.5' })];
  assert.equal(rejectionOf('draft', rows), rejected);
  assert.equal(rejectionOf('pending_review', rows), null);
  assert.equal(rejectionOf('draft', [...rows, ob(4, 'review', 'cancelled', { requested_at: '2026-10-17T09:00:00' })]), null);
  assert.equal(rejectionOf('draft', [ob(1, 'review', 'done')]), null);
});

test('the version a person last acknowledged, when it is not the one asked about now', () => {
  const rows = [ob(10, 'acknowledgement', 'done', { user_id: 7, done_at: '2026-10-17T07:40:35' }),
    ob(32, 'acknowledgement', 'pending', { user_id: 7, version: '2.0' }), ob(11, 'acknowledgement', 'done', { user_id: 8 })];
  assert.equal(lastAcknowledged(rows, 7, '2.0'), '1.0');
  assert.equal(lastAcknowledged(rows, 7, '1.0'), null);
  assert.equal(lastAcknowledged(rows, 9, '2.0'), null);
  assert.equal(lastAcknowledged(rows, undefined, '2.0'), null);
});
