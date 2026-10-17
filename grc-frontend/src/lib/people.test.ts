// node --test src/lib/people.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { personOf } from './people.ts';

test('a /tenants/{id}/users row: the nested user names the person, user_id is the person (not the membership id)', () => {
  const row = { id: 41, user_id: 5, tenant_id: 1, is_primary: false, user: { id: 5, display_name: 'Sara Reviewer', username: 'sara', email: 'sara@x.test' } };
  assert.deepEqual(personOf(row), { id: 5, name: 'Sara Reviewer', email: 'sara@x.test' });
});

test('a flat /assets/tenant-users row', () => {
  assert.deepEqual(personOf({ id: 6, display_name: 'Khalid Approver', email: 'k@x.test' }), { id: 6, name: 'Khalid Approver', email: 'k@x.test' });
});

test('falls back to username, then email, then "User n"', () => {
  assert.equal(personOf({ user_id: 7, user: { id: 7, username: 'aamir' } }).name, 'aamir');
  assert.equal(personOf({ id: 8, email: 'b@x.test' }).name, 'b@x.test');
  assert.equal(personOf({ id: 9 }).name, 'User 9');
});
