// node --test src/lib/signoffTargets.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assigneeOptions, assigneePlaceholder, sentToast, type SignoffTargets } from './signoffTargets.ts';

const targets: SignoffTargets = {
  users: [{ id: 3, name: 'zara Khan', email: 'z@x.test' }, { id: 1, name: 'Olivia Owner', email: null }, { id: 2, name: 'Bilal', email: 'b@x.test' }],
  roles: [{ id: 9, name: 'Reviewers', user_count: 1 }, { id: 8, name: 'Approvers', user_count: 2 }],
  teams: [{ id: 5, name: 'Security', member_count: 1 }],
};

test('people, then roles, then teams, each alphabetically whatever the case, with counts of people who can sign', () => {
  assert.deepEqual(assigneeOptions(targets), [
    { value: 'user:2', label: 'Bilal', subLabel: 'b@x.test' },
    { value: 'user:1', label: 'Olivia Owner', subLabel: undefined },
    { value: 'user:3', label: 'zara Khan', subLabel: 'z@x.test' },
    { value: 'role:8', label: 'Role · Approvers', subLabel: '2 users' },
    { value: 'role:9', label: 'Role · Reviewers', subLabel: '1 user' },
    { value: 'team:5', label: 'Team · Security', subLabel: '1 member' },
  ]);
  assert.deepEqual(assigneeOptions(null), []);
});

test('the placeholder names only what can be picked', () => {
  assert.equal(assigneePlaceholder(assigneeOptions(targets)), 'Add users, roles or teams…');
  assert.equal(assigneePlaceholder(assigneeOptions({ ...targets, roles: [] })), 'Add users or teams…');
  assert.equal(assigneePlaceholder(assigneeOptions({ ...targets, roles: [], teams: [] })), 'Add users…');
  assert.equal(assigneePlaceholder([]), 'Nobody to choose yet');
});

test('Send for review shows what the server says nobody can sign, and "Not sent" when the document stayed a draft', () => {
  assert.deepEqual(sentToast({ status: 'pending_review', notice: null }, 'Reviewers were asked'),
    { type: 'success', title: 'Sent', message: 'Reviewers were asked' });
  const notice = 'Nobody in DigitalOcean: team My Team can sign it; choose other approvers.';
  assert.deepEqual(sentToast({ status: 'pending_review', notice }, 'x'), { type: 'warning', title: 'Sent', message: notice });
  assert.equal(sentToast({ status: 'draft', notice }, 'x').title, 'Not sent');
  assert.equal(sentToast(undefined, 'Sent to them').message, 'Sent to them');           // an older server: no notice
});
