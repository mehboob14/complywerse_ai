// node --test "src/app/(dashboard)/vendor-risk/_lib/rosterModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { candidates, pickerLabel } from './rosterModel.ts';

const PEOPLE = [{ id: 3, name: 'Cleo' }, { id: 1, name: 'Ada' }, { id: 2, name: 'Ben' }];

test('a role can be given to anyone not already on it, by name', () => {
  assert.deepEqual(candidates(PEOPLE, []).map((p) => p.name), ['Ada', 'Ben', 'Cleo']);
  assert.deepEqual(candidates(PEOPLE, [{ user_id: 2, name: 'Ben' }]).map((p) => p.name), ['Ada', 'Cleo']);
  assert.deepEqual(candidates(PEOPLE, PEOPLE.map((p) => ({ user_id: p.id, name: p.name }))), []);
  assert.deepEqual(candidates(undefined, []), []);
  assert.deepEqual(PEOPLE.map((p) => p.id), [3, 1, 2]);              // the list it was given is not reordered
});

test('the picker says Assign… for an empty role and Add another… once someone is on it', () => {
  assert.equal(pickerLabel([]), 'Assign…');
  assert.equal(pickerLabel([{ user_id: 1, name: 'Ada' }]), 'Add another…');
});
