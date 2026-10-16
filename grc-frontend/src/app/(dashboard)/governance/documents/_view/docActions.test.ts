// Run from this folder (node --test reads [id] in a path as a glob): node --test _docActions.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { primaryAction, stepLine, type PrimaryInput } from './docActions.ts';

const base: PrimaryInput = { status: 'draft', myAck: false, myRole: null, canEdit: false, canPublish: false };
const kind = (over: Partial<PrimaryInput>) => primaryAction({ ...base, ...over })?.kind ?? null;

test('acknowledge only on a published document', () => {
  assert.deepEqual(primaryAction({ ...base, myAck: true, status: 'published' }), { kind: 'acknowledge', label: 'Acknowledge' });
  assert.equal(kind({ myAck: true, status: 'approved' }), null);
  assert.equal(kind({ myAck: true, status: 'draft' }), null);
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
