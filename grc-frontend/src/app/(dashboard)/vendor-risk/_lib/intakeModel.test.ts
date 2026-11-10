// node --test "src/app/(dashboard)/vendor-risk/_lib/intakeModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import {
  INTAKE_SCHEMA, PAGE_SIZE, approvalNote, asScope, byline, decisionLine, decisionPill, draftLine, emptyCopy, inQueueOrder, inScope, lastPage, listParams, listPatch, matchHref, matchNote,
  scopeCounts, screeningPill, statusesOf, stepTo, urgencyPill, waited,
} from './intakeModel.ts';

test('the switch holds what waits for the team, drafts apart, a request picked up with the approved, and All holds everything', () => {
  assert.deepEqual(['draft', 'submitted', 'in_review', 'approved', 'rejected'].map((s) => ['pending', 'drafts', 'approved', 'declined'].filter((scope) => inScope(s as never, scope as never))),
    [['drafts'], ['pending'], ['approved'], ['approved'], ['declined']]);
  assert.ok(['draft', 'submitted', 'in_review', 'approved', 'rejected'].every((s) => inScope(s as never, 'all')));
  assert.equal(inScope(null, 'pending'), false);
  assert.equal(inScope(null, 'all'), true);
});

test('what the server is asked for each switch option is the statuses the switch holds, and All asks for none', () => {
  assert.deepEqual(statusesOf('pending'), ['submitted']);
  assert.deepEqual(statusesOf('drafts'), ['draft']);
  assert.deepEqual(statusesOf('approved'), ['in_review', 'approved']);
  assert.deepEqual(statusesOf('declined'), ['rejected']);
  assert.equal(statusesOf('all'), null);
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

test('every old link reads as it did: ?scope, ?mine=1, ?request=1; and a state is written back without its defaults', () => {
  const a = readAddress(INTAKE_SCHEMA, '?scope=declined&mine=1&q=acme&page=3&open=12&request=1');
  assert.deepEqual(a, { scope: 'declined', mine: true, q: 'acme', page: 3, open: 12, request: true });
  assert.deepEqual(readAddress(INTAKE_SCHEMA, ''), { scope: 'pending', mine: false, q: '', page: 1, open: 0, request: false });
  assert.deepEqual(readAddress(INTAKE_SCHEMA, '?scope=junk&page=-4&open=abc'), { scope: 'pending', mine: false, q: '', page: 1, open: 0, request: false });
  assert.equal(writeAddress(INTAKE_SCHEMA, '', { ...a, request: false }), 'scope=declined&mine=1&q=acme&page=3&open=12');
  assert.equal(writeAddress(INTAKE_SCHEMA, '?other=1', readAddress(INTAKE_SCHEMA, '')), 'other=1');
});

test('a change of what is listed goes back to page 1 and lets go of the request on the right', () => {
  assert.deepEqual(listPatch({ scope: 'drafts' }), { scope: 'drafts', page: 1, open: 0 });
  assert.deepEqual(listPatch({ q: 'x' }), { q: 'x', page: 1, open: 0 });
});

test('the server is asked for one page of one switch option; the queue is its order, the others latest change first', () => {
  assert.deepEqual(listParams({ scope: 'pending', mine: false, q: '', page: 1 }), { scope: 'all', search: undefined, statuses: 'submitted', sort: 'queue', skip: 0, limit: PAGE_SIZE });
  assert.deepEqual(listParams({ scope: 'approved', mine: true, q: '  acme ', page: 3 }), { scope: 'mine', search: 'acme', statuses: 'in_review,approved', sort: undefined, skip: 2 * PAGE_SIZE, limit: PAGE_SIZE });
  assert.equal(listParams({ scope: 'all', mine: false, q: '', page: 2 }).statuses, undefined);
  assert.equal(listParams({ scope: 'all', mine: false, q: '', page: 0 }).skip, 0);
  assert.deepEqual([lastPage(0), lastPage(25), lastPage(26), lastPage(101)], [1, 1, 2, 5]);
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
  assert.deepEqual(decisionPill(null), { label: 'Draft', tone: 'neutral' });
  assert.deepEqual(screeningPill('flagged'), { label: 'Possible duplicate', tone: 'warning' });
  assert.deepEqual(screeningPill('screened'), { label: 'No duplicate found', tone: 'success' });
  assert.equal(screeningPill(null), null);
  assert.deepEqual(urgencyPill('high'), { label: 'High urgency', tone: 'warning' });
  assert.deepEqual(urgencyPill('whatever'), { label: 'Normal urgency', tone: 'progress' });
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

test('how long a request has waited is counted in whole days from when it was submitted, else started', () => {
  const now = new Date('2026-03-10T12:00:00Z');
  assert.equal(waited({ submitted_at: '2026-03-10T01:00:00', created_at: null }, now), 'Today');
  assert.equal(waited({ submitted_at: '2026-03-09T01:00:00', created_at: null }, now), '1 day');
  assert.equal(waited({ submitted_at: null, created_at: '2026-03-01T09:00:00' }, now), '9 days');
  assert.equal(waited({ submitted_at: '2026-03-12T00:00:00', created_at: null }, now), 'Today');         // a clock a little ahead is not "-2 days"
  assert.equal(waited({ submitted_at: null, created_at: null }, now), null);
});

test('a draft says what is left; Approve and create says what it starts and, with matches, what it may duplicate', () => {
  assert.equal(draftLine(0), 'Ready to submit');
  assert.equal(draftLine(1), '1 answer to go');
  assert.equal(draftLine(4), '4 answers to go');
  assert.deepEqual(approvalNote('Zeta Ltd', []), ['Zeta Ltd joins the vendor register and its lifecycle starts from these answers.']);
  const lines = approvalNote('Zeta Ltd', [{ name: 'Zeta' }, { name: 'Zeta Holdings' }, { name: 'Zeta Group' }, { name: 'Zetta' }, { name: 'Zeeta' }]);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /may already be on record as Zeta, Zeta Holdings, Zeta Group and 2 more\./);
});

test('j and k step through the rows of the page and stay at the ends', () => {
  assert.equal(stepTo([], null, 1), null);
  assert.equal(stepTo([4, 5, 6], null, 1), 4);
  assert.equal(stepTo([4, 5, 6], null, -1), 6);
  assert.equal(stepTo([4, 5, 6], 5, 1), 6);
  assert.equal(stepTo([4, 5, 6], 6, 1), 6);
  assert.equal(stepTo([4, 5, 6], 4, -1), 4);
  assert.equal(stepTo([4, 5, 6], 99, 1), 4);                                      // a row the page no longer holds: start again
});

test('an empty list says whether nothing is there or nothing matches', () => {
  assert.equal(emptyCopy('pending', false).title, 'No pending requests');
  assert.equal(emptyCopy('drafts', false).title, 'No requests here');
  assert.equal(emptyCopy('pending', true).title, 'No requests match');
});
