// node --test "src/app/(dashboard)/vendor-risk/_lib/intakeModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { asScope, byline, decisionLine, decisionPill, inQueueOrder, inScope, matchHref, matchNote, scopeCounts, screeningPill } from './intakeModel.ts';

test('the switch holds what waits for the team, drafts apart, a request picked up with the approved, and All holds everything', () => {
  assert.deepEqual(['draft', 'submitted', 'in_review', 'approved', 'rejected'].map((s) => ['pending', 'drafts', 'approved', 'declined'].filter((scope) => inScope(s as never, scope as never))),
    [['drafts'], ['pending'], ['approved'], ['approved'], ['declined']]);
  assert.ok(['draft', 'submitted', 'in_review', 'approved', 'rejected'].every((s) => inScope(s as never, 'all')));
  assert.equal(inScope(null, 'pending'), false);
  assert.equal(inScope(null, 'all'), true);
});

test('counts per switch option add up the server counts per status', () => {
  const counts = scopeCounts({ draft: 2, submitted: 3, in_review: 1, approved: 5, rejected: 4 });
  assert.deepEqual(counts, { pending: 3, drafts: 2, approved: 6, declined: 4, all: 15 });
  assert.deepEqual(scopeCounts(undefined), { pending: 0, drafts: 0, approved: 0, declined: 0, all: 0 });
  assert.equal(scopeCounts({ submitted: 1, mystery: 7 } as never).pending, 1);       // a status this page does not know is only in All
});

test('the address names a scope, and an unknown one is the first', () => {
  assert.equal(asScope('declined'), 'declined');
  assert.equal(asScope('everything'), 'pending');
  assert.equal(asScope(null), 'pending');
});

test('the queue puts the most urgent first and the longest wait before a newer one; other views keep their order', () => {
  const rows = [
    { id: 1, urgency: 'normal', submitted_at: '2026-03-01T09:00:00', created_at: null },
    { id: 2, urgency: 'high', submitted_at: '2026-03-04T09:00:00', created_at: null },
    { id: 3, urgency: 'high', submitted_at: '2026-03-02T09:00:00', created_at: null },
    { id: 4, urgency: 'low', submitted_at: null, created_at: '2026-02-20T09:00:00' },
  ];
  assert.deepEqual(inQueueOrder(rows, 'pending').map((r) => r.id), [3, 2, 1, 4]);
  assert.deepEqual(inQueueOrder(rows, 'all').map((r) => r.id), [1, 2, 3, 4]);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4]);                          // never reorders what it was given
});

test('pills say where a request stands in words, never by colour alone', () => {
  assert.deepEqual(decisionPill('submitted'), { label: 'Awaiting decision', tone: 'pending' });
  assert.deepEqual(decisionPill('in_review'), { label: 'In review', tone: 'progress' });
  assert.deepEqual(decisionPill('approved'), { label: 'Approved', tone: 'success' });
  assert.deepEqual(decisionPill('rejected'), { label: 'Declined', tone: 'danger' });
  assert.deepEqual(decisionPill('draft'), { label: 'Draft', tone: 'neutral' });
  assert.deepEqual(screeningPill('flagged'), { label: 'Flagged', tone: 'warning' });
  assert.deepEqual(screeningPill('screened'), { label: 'Screened', tone: 'success' });
  assert.equal(screeningPill(null), null);
});

test('the decision line names who, and when', () => {
  assert.equal(decisionLine('approved', { by: 'Dana Okafor', at: '2026-03-05T10:00:00' }), 'Approved by Dana Okafor · 5 Mar 2026');
  assert.equal(decisionLine('rejected', { by: null, at: '2026-03-05' }), 'Declined by the review team · 5 Mar 2026');
  assert.equal(decisionLine('in_review', { by: 'Tara', at: null }), 'Picked up by Tara');
  assert.equal(decisionLine('submitted', { by: 'Tara', at: '2026-03-05' }), null);
  assert.equal(decisionLine('approved', null), null);
});

test('a possible duplicate opens as a request while it is one, and as a supplier otherwise', () => {
  assert.equal(matchHref({ id: 9, intake_status: 'draft' }), '/vendor-risk/intake/9');
  assert.equal(matchHref({ id: 9, intake_status: 'rejected' }), '/vendor-risk/intake/9');
  assert.equal(matchHref({ id: 9, intake_status: 'in_review' }), '/vendor-risk/vendors/9');
  assert.equal(matchHref({ id: 9, intake_status: null }), '/vendor-risk/vendors/9');
  assert.equal(matchNote({ archived: true, intake_status: null }), ' (archived)');
  assert.equal(matchNote({ archived: false, intake_status: 'submitted' }), ' (a request)');
  assert.equal(matchNote({ archived: false, intake_status: 'approved' }), '');
});

test('the byline reads requester, department, date, and says when nobody is named', () => {
  assert.equal(byline({ requested_by: { name: 'Dana Okafor' }, department: 'Growth', submitted_at: '2026-03-05T10:00:00', created_at: null }), 'Dana Okafor · Growth · 5 Mar 2026');
  assert.equal(byline({ requested_by: null, department: null, submitted_at: null, created_at: '2026-03-05' }), 'Unattributed · 5 Mar 2026');
  assert.equal(byline({ requested_by: { name: null }, department: null, submitted_at: null, created_at: null }), 'Unattributed');
});
