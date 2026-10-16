// node --test trackedChanges.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaultBaseline, versionOrigin, versionPill, versionsBetween } from './trackedChanges.ts';

const v = (id: number, origin: string, changes: number, extra: { restored_from?: string; reverts?: { since_version: string; changes: number } } = {}) =>
  ({ id, origin, changes, restored_from: extra.restored_from ?? null, reverts: extra.reverts ?? null });

test('the default baseline passes over sign-off stamps and versions that changed nothing', () => {
  assert.equal(defaultBaseline([v(1, 'initial', 0), v(2, 'ai', 3), v(3, 'signoff', 1), v(4, 'nochange', 0)]), 1);
  assert.equal(defaultBaseline([v(1, 'initial', 0), v(2, 'manual', 1), v(3, 'revert', 2)]), 2);
  assert.equal(defaultBaseline([v(1, 'initial', 0), v(2, 'signoff', 1)]), 1);
  assert.equal(defaultBaseline([v(1, 'initial', 0)]), 1);
  assert.equal(defaultBaseline([]), null);
});

test('a version is named by what made it', () => {
  assert.equal(versionOrigin(v(1, 'initial', 0)), 'Original');
  assert.equal(versionOrigin(v(2, 'manual', 1)), 'By hand');
  assert.equal(versionOrigin(v(3, 'restore', 2, { restored_from: '1.0' })), 'Restored v1.0');
  assert.equal(versionPill(v(4, 'revert', 2, { reverts: { since_version: '1.1', changes: 2 } })), 'Taken back 2 changes since v1.1');
  assert.equal(versionPill(v(5, 'signoff', 1)), 'Sign-off stamp');
});

test('a comparison covers the versions after its baseline up to its end', () => {
  const all = [v(1, 'initial', 0), v(2, 'ai', 1), v(3, 'revert', 1), v(4, 'signoff', 1)];
  assert.deepEqual(versionsBetween(all, 2).map((x) => x.id), [3, 4]);
  assert.deepEqual(versionsBetween(all, 1, 3).map((x) => x.id), [2, 3]);
  assert.deepEqual(versionsBetween(all, 9), []);
});
