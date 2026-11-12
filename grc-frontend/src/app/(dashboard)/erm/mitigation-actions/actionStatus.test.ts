import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptancesByState, isActionOverdue, isDueSoon, matchesStatusFilter, sortForTracker } from './actionStatus.ts';

const NOW = new Date('2026-11-11T12:00:00');

test('an open action past its due date is overdue', () => {
  assert.equal(isActionOverdue({ status: 'planned', due_date: '2026-11-01' }, NOW), true);
  assert.equal(isActionOverdue({ status: 'in_progress', due_date: '2026-11-01' }, NOW), true);
  assert.equal(isActionOverdue({ status: 'blocked', due_date: '2026-11-01' }, NOW), true);
});

test('a finished, future or undated action is not overdue', () => {
  for (const status of ['completed', 'verified', 'cancelled']) {
    assert.equal(isActionOverdue({ status, due_date: '2026-11-01' }, NOW), false);
  }
  assert.equal(isActionOverdue({ status: 'planned', due_date: '2026-12-01' }, NOW), false);
  assert.equal(isActionOverdue({ status: 'planned', due_date: null }, NOW), false);
});

test('due soon means open and due within 14 days', () => {
  assert.equal(isDueSoon({ status: 'planned', due_date: '2026-11-20' }, NOW), true);
  assert.equal(isDueSoon({ status: 'planned', due_date: '2026-12-20' }, NOW), false);
  assert.equal(isDueSoon({ status: 'planned', due_date: '2026-11-01' }, NOW), false);
  assert.equal(isDueSoon({ status: 'completed', due_date: '2026-11-20' }, NOW), false);
});

test('the overdue and open filters are computed; other filters match the stored status', () => {
  const late = { status: 'planned', due_date: '2026-11-01' };
  assert.equal(matchesStatusFilter(late, 'overdue', NOW), true);
  assert.equal(matchesStatusFilter(late, 'open', NOW), true);
  assert.equal(matchesStatusFilter(late, 'planned', NOW), true);
  assert.equal(matchesStatusFilter(late, 'completed', NOW), false);
  assert.equal(matchesStatusFilter(late, 'all', NOW), true);
});

test('the tracker lists overdue first, then due in 14 days, then the rest', () => {
  const rows = [
    { id: 'verified', status: 'verified', due_date: '2026-10-01' },
    { id: 'later', status: 'planned', due_date: '2027-03-01' },
    { id: 'undated', status: 'planned', due_date: null },
    { id: 'soon', status: 'in_progress', due_date: '2026-11-15' },
    { id: 'done', status: 'completed', due_date: '2026-10-01' },
    { id: 'late', status: 'planned', due_date: '2026-11-05' },
    { id: 'very late', status: 'blocked', due_date: '2026-10-05' },
  ];
  assert.deepEqual(sortForTracker(rows, NOW).map((r) => r.id),
    ['very late', 'late', 'soon', 'later', 'undated', 'done', 'verified']);
  assert.equal(rows[0].id, 'verified');   // the input is not reordered
});

test('acceptances group by the state the server derives, soonest expiry first', () => {
  const groups = acceptancesByState([
    { id: 1, acceptance_state: 'expiring', acceptance_expires_at: '2026-12-30' },
    { id: 2, acceptance_state: 'requested' },
    { id: 3, acceptance_state: 'expiring', acceptance_expires_at: '2026-12-01' },
    { id: 4, acceptance_state: 'none' },
    { id: 5, acceptance_state: 'expired', acceptance_expires_at: '2026-10-01' },
  ]);
  assert.deepEqual(groups.expiring.map((r) => r.id), [3, 1]);
  assert.deepEqual(groups.requested.map((r) => r.id), [2]);
  assert.deepEqual(groups.expired.map((r) => r.id), [5]);
  assert.deepEqual(groups.accepted, []);
});
