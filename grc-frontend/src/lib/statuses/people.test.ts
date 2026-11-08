// node --test "src/lib/statuses/people.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memberStatus, roleKind, userStatus } from './people.ts';

test('every word the Users and Roles pages can show has a tone and a readable label; an unknown word reads neutral', () => {
  assert.deepEqual(userStatus.words, ['active', 'inactive']);
  assert.equal(userStatus.tone('active'), 'success');
  assert.equal(userStatus.label('active'), 'Active');
  assert.equal(userStatus.label('inactive'), 'Inactive');
  assert.equal(userStatus.tone('inactive'), 'neutral');
  assert.equal(roleKind.label('system'), 'System');
  assert.equal(roleKind.label('custom'), 'Custom');
  assert.equal(userStatus.tone('suspended'), 'neutral');
  assert.equal(userStatus.label('suspended'), 'Suspended');
  assert.equal(userStatus.label(undefined), '—');
  assert.equal(memberStatus.label('inactive'), 'Inactive');
});
