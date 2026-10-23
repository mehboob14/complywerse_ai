// node --test src/lib/signoffTargets.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assigneeOptions, assigneePlaceholder, chosenFrom, sentToast, withChosen, type SignoffTargets } from './signoffTargets.ts';

const targets: SignoffTargets = {
  users: [{ id: 3, name: 'zara Khan', email: 'z@x.test' }, { id: 1, name: 'Olivia Owner', email: null }, { id: 2, name: 'Bilal', email: 'b@x.test' }],
  roles: [{ id: 9, name: 'Reviewers', user_count: 1 }, { id: 8, name: 'Approvers', user_count: 2 }],
  teams: [{ id: 5, name: 'Security', member_count: 1 }],
};

test('people, then roles, then departments, each alphabetically whatever the case, with counts of people who can sign', () => {
  assert.deepEqual(assigneeOptions(targets), [
    { value: 'user:2', label: 'Bilal', subLabel: 'b@x.test' },
    { value: 'user:1', label: 'Olivia Owner', subLabel: undefined },
    { value: 'user:3', label: 'zara Khan', subLabel: 'z@x.test' },
    { value: 'role:8', label: 'Role · Approvers', subLabel: '2 users' },
    { value: 'role:9', label: 'Role · Reviewers', subLabel: '1 user' },
    { value: 'team:5', label: 'Department · Security', subLabel: '1 member' },
  ]);
  assert.deepEqual(assigneeOptions(null), []);
});

test('the placeholder names only what can be picked', () => {
  assert.equal(assigneePlaceholder(assigneeOptions(targets)), 'Add users, roles or departments…');
  assert.equal(assigneePlaceholder(assigneeOptions({ ...targets, roles: [] })), 'Add users or departments…');
  assert.equal(assigneePlaceholder(assigneeOptions({ ...targets, roles: [], teams: [] })), 'Add users…');
  assert.equal(assigneePlaceholder([]), 'Nobody to choose yet');
});

test('Send for review shows what the server says nobody can sign, and "Not sent" when the document stayed a draft', () => {
  assert.deepEqual(sentToast({ status: 'pending_review', notice: null }, 'Reviewers were asked'),
    { type: 'success', title: 'Sent for review', message: 'Reviewers were asked' });
  const notice = 'Nobody in DigitalOcean: team My Team can sign it; choose other approvers.';
  assert.deepEqual(sentToast({ status: 'pending_review', notice }, 'x'), { type: 'warning', title: 'Sent for review', message: notice });
  assert.equal(sentToast({ status: 'draft', notice }, 'x').title, 'Not sent');
  assert.equal(sentToast(undefined, 'Sent to them').message, 'Sent to them');           // an older server: no notice
});

test('a document with no reviewers (or none who can sign) is said to go for approval, as it does', () => {
  assert.equal(sentToast({ status: 'pending_approval', notice: null }, 'Approvers were asked').title, 'Sent for approval');
  assert.equal(sentToast({ status: 'pending_approval', notice: 'Nobody can review it; it went to its approvers.' }, 'x').title, 'Sent for approval');
  assert.equal(sentToast(undefined, 'x').title, 'Sent');
});

test('a saved participant missing from the options shows under its saved name, can be unticked, and keeps its name', () => {
  const options = assigneeOptions(targets);
  const saved = [{ target_type: 'user', target_id: 2, display: 'Bilal' }, { target_type: 'role', target_id: 40, display: 'Role: DigitalOcean admins' }];
  const shown = withChosen(options, saved);
  assert.deepEqual(shown[0], { value: 'role:40', label: 'Role: DigitalOcean admins', subLabel: 'Cannot sign: untick to remove it' });
  assert.equal(shown.length, options.length + 1);                                     // Bilal is an option already: not twice
  assert.equal(withChosen(options, saved.slice(0, 1)), options);
  assert.equal(withChosen([], saved)[1].subLabel, undefined);                         // options not loaded yet: nothing claimed
  assert.equal(withChosen(options, [{ target_type: 'user', target_id: 77 }])[0].label, 'user #77');
  assert.equal(withChosen(options, [{ target_type: 'team', target_id: 41 }])[0].label, 'department #41');       // a department with no saved name

  // ticking another one keeps the saved name; unticking the unknown one removes it
  assert.deepEqual(chosenFrom(['role:40', 'team:5'], saved), [saved[1], { target_type: 'team', target_id: 5 }]);
  assert.deepEqual(chosenFrom(['user:2'], saved), [saved[0]]);
});
