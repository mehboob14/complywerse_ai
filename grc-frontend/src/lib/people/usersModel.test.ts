// node --test "src/lib/people/usersModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_USER_FILTER, STALE_DAYS, USER_VIEWS, blankForm, countsOf, createBody, deactivateText, filterUsers, formErrors, formOfUser, inView, isDirty, isFiltering, nameOf,
  ownAccountReason, passwordChecks, passwordProblems, peopleLine, removeText, sortUsers, toggleId, updateBody, type UserRecord,
} from './usersModel.ts';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 19);        // naive UTC, as the server writes it

let next = 1;
const user = (patch: Partial<UserRecord> = {}): UserRecord => ({
  id: next++, username: `user${next}`, email: `user${next}@acme.test`, display_name: `Person ${next}`, is_active: true,
  created_at: daysAgo(200), last_login: daysAgo(2), roles: [{ id: 1, name: 'Auditor' }], ...patch,
});

const people = [
  user({ display_name: 'Ada Lovelace', username: 'ada', email: 'ada@acme.test' }),
  user({ display_name: 'Bob', username: 'bob', is_active: false, last_login: daysAgo(10) }),
  user({ display_name: null, username: 'carol', last_login: null, roles: [] }),                        // active, never signed in, no role
  user({ display_name: 'Dan', username: 'dan', last_login: daysAgo(STALE_DAYS + 1) }),               // stale
  user({ display_name: 'Eve', username: 'eve', last_login: daysAgo(STALE_DAYS - 1), roles: [{ id: 2, name: 'Viewer' }, { id: 1, name: 'Auditor' }] }),
  user({ display_name: 'Fay', username: 'fay', is_active: false, last_login: null, roles: [] }),      // inactive: never counts as a risk
];

test('a name is the display name, else the username', () => {
  assert.equal(nameOf(people[0]), 'Ada Lovelace');
  assert.equal(nameOf(people[2]), 'carol');
  assert.equal(nameOf({ display_name: '  ', username: 'x' }), 'x');
});

test('the chips count the complete list; the hygiene chips count ACTIVE accounts only', () => {
  const c = countsOf(people, NOW);
  assert.deepEqual(c, { all: 6, active: 4, inactive: 2, never: 1, stale: 1, norole: 1 });
  assert.equal(inView(people[5], 'never', NOW), false, 'an inactive account that never signed in is not a risk');
  assert.equal(inView(people[5], 'norole', NOW), false);
  assert.equal(inView(people[1], 'stale', NOW), false);
  assert.deepEqual(USER_VIEWS, ['all', 'active', 'inactive', 'never', 'stale', 'norole']);
});

test('90 days is the line: 89 days ago is recent, 91 is stale; a time with no zone is UTC', () => {
  assert.equal(inView(user({ last_login: daysAgo(STALE_DAYS - 1) }), 'stale', NOW), false);
  assert.equal(inView(user({ last_login: daysAgo(STALE_DAYS + 1) }), 'stale', NOW), true);
  assert.equal(inView(user({ last_login: null }), 'stale', NOW), false, 'never is its own chip');
});

test('the line under the title says how many people and how many are inactive', () => {
  assert.equal(peopleLine(people), '6 people · 2 inactive');
  assert.equal(peopleLine([people[0]]), '1 person');
  assert.equal(peopleLine([]), '0 people');
});

test('search looks at the name, the username and the e-mail; the view and the role narrow it', () => {
  const ids = (list: UserRecord[]) => list.map((u) => u.username);
  assert.deepEqual(ids(filterUsers(people, { ...NO_USER_FILTER, q: 'LOVE' }, NOW)), ['ada']);
  assert.deepEqual(ids(filterUsers(people, { ...NO_USER_FILTER, q: 'carol' }, NOW)), ['carol'], 'a person with no display name is found by the username');
  assert.deepEqual(ids(filterUsers(people, { ...NO_USER_FILTER, q: 'ada@acme' }, NOW)), ['ada']);
  assert.deepEqual(ids(filterUsers(people, { ...NO_USER_FILTER, view: 'inactive' }, NOW)), ['bob', 'fay']);
  assert.deepEqual(ids(filterUsers(people, { ...NO_USER_FILTER, roleId: 2 }, NOW)), ['eve']);
  assert.deepEqual(ids(filterUsers(people, { q: 'e', view: 'active', roleId: 1 }, NOW)), ['ada', 'dan', 'eve']);
  assert.equal(filterUsers(people, NO_USER_FILTER, NOW).length, 6);
  assert.equal(isFiltering(NO_USER_FILTER), false);
  assert.equal(isFiltering({ ...NO_USER_FILTER, q: ' ' }), false, 'blank search is no filter');
  assert.equal(isFiltering({ ...NO_USER_FILTER, roleId: 3 }), true);
});

test('sorting: by name (case-blind), by last sign-in with the never-signed-in last either way, by when added', () => {
  const names = (list: UserRecord[]) => list.map((u) => u.username);
  assert.deepEqual(names(sortUsers(people, { key: 'name', dir: 'asc' })), ['ada', 'bob', 'carol', 'dan', 'eve', 'fay']);
  assert.deepEqual(names(sortUsers(people, { key: 'name', dir: 'desc' })), ['fay', 'eve', 'dan', 'carol', 'bob', 'ada']);
  assert.deepEqual(names(sortUsers(people, { key: 'seen', dir: 'desc' })), ['ada', 'bob', 'eve', 'dan', 'carol', 'fay']);
  assert.deepEqual(names(sortUsers(people, { key: 'seen', dir: 'asc' })), ['dan', 'eve', 'bob', 'ada', 'carol', 'fay']);
  assert.deepEqual(names(sortUsers([people[0], people[1]], { key: 'added', dir: 'desc' })), ['ada', 'bob'], 'equal keys keep their order');
  assert.equal(people[0].username, 'ada', 'the input is not reordered');
});

test('the sheet refuses what cannot work and says which field', () => {
  assert.deepEqual(formErrors(blankForm(), 'create'), { username: 'Enter a username.', email: 'Enter an e-mail address.', password: 'Enter a password.' });
  assert.deepEqual(formErrors({ ...blankForm(), username: 'a', email: 'nope', password: 'x' }, 'create', ['a digit']), {
    email: 'Enter an e-mail address like name@company.com.', password: 'The password still needs: a digit.',
  });
  assert.deepEqual(formErrors({ ...blankForm(), email: 'a@b.co' }, 'edit'), {}, 'editing never asks for a username or a password');
  assert.deepEqual(formErrors({ ...blankForm(), username: 'a', email: 'a@b.co', password: 'x' }, 'create', []), {});
});

test('an edit sends only what changed, and role_ids only when the ticked set changed and the roles were loaded', () => {
  const ada = people[4];
  const saved = formOfUser(ada);
  assert.deepEqual(saved.roleIds, [2, 1]);
  assert.equal(isDirty(saved, { ...saved }), false);
  assert.equal(isDirty(saved, { ...saved, roleIds: [1, 2] }), false, 'the same roles in another order are no change');
  assert.equal(isDirty(saved, { ...saved, displayName: ' Eve ' }), false, 'spaces around the same name are no change');
  assert.deepEqual(updateBody(saved, { ...saved, displayName: 'Eva' }, true), { display_name: 'Eva' });
  assert.deepEqual(updateBody(saved, { ...saved, email: ' eva@acme.test ' }, true), { email: 'eva@acme.test' });
  assert.deepEqual(updateBody(saved, { ...saved, roleIds: [1] }, true), { role_ids: [1] });
  assert.deepEqual(updateBody(saved, { ...saved, roleIds: [] }, true), { role_ids: [] }, 'taking every role off is a change');
  assert.deepEqual(updateBody(saved, { ...saved, roleIds: [1] }, false), {}, 'with the role list unknown the roles are never touched');
  assert.deepEqual(updateBody(saved, { ...saved }, true), {});
  assert.equal(Object.keys(updateBody(saved, { ...saved, displayName: 'X', email: 'x@y.co', roleIds: [3] }, true)).sort().join(), 'display_name,email,role_ids');
});

test('a new user sends the four things the server stores and nothing else (no Department, Group, Division, Designation)', () => {
  const body = createBody({ username: ' ann ', email: ' ann@acme.test ', displayName: '  ', password: 'Secret#12345', roleIds: [3, 4] });
  assert.deepEqual(body, { username: 'ann', email: 'ann@acme.test', password: 'Secret#12345', role_ids: [3, 4] });
  assert.deepEqual(Object.keys(createBody({ ...blankForm(), username: 'a', email: 'a@b.co', displayName: 'Ann', password: 'x' })).sort(), ['display_name', 'email', 'password', 'role_ids', 'username']);
  assert.deepEqual(toggleId([1, 2], 2), [1]);
  assert.deepEqual(toggleId([1], 5), [1, 5]);
});

test('the password is checked line by line against the policy the server reads', () => {
  const rules = { min_length: 12, require_uppercase: true, require_lowercase: true, require_digit: true, require_special: true };
  assert.deepEqual(passwordChecks(rules, '').map((c) => c.key), ['length', 'upper', 'lower', 'digit', 'special']);
  assert.deepEqual(passwordProblems(rules, 'abc'), ['at least 12 characters', 'an uppercase letter', 'a digit', 'a special character (like ! or @)']);
  assert.deepEqual(passwordProblems(rules, 'Abcdefghij1!'), []);
  assert.deepEqual(passwordProblems(rules, 'Abcdefghij1 '), [], 'a space is a special character, as on the server');
  assert.deepEqual(passwordProblems({ ...rules, min_length: 8, require_special: false, require_digit: false }, 'Abcdefgh'), []);
  assert.deepEqual(passwordChecks(null, 'x'), [], 'no policy known: no lines, the server judges');
  assert.equal(passwordChecks({ ...rules, min_length: 3 }, '😀😀😀')[0].met, true, 'length counts characters, not code units');
});

test('your own account cannot be deactivated or removed from the page; the words say what happens and offer Deactivate instead of Remove', () => {
  assert.equal(ownAccountReason({ id: 7 }, 7), "You can't do this to your own account.");
  assert.equal(ownAccountReason({ id: 7 }, 8), null);
  assert.equal(ownAccountReason({ id: 7 }, null), null, 'unknown who you are: nothing is blocked by guess');
  assert.match(deactivateText('Ada').message, /reactivate/);
  assert.match(removeText('Ada').message, /cannot be undone/);
  assert.match(removeText('Ada').message, /deactivate the account instead/);
  assert.notEqual(deactivateText('Ada').confirmLabel, removeText('Ada').confirmLabel);
});
