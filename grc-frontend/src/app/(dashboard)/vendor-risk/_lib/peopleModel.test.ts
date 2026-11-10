// node --test "src/app/(dashboard)/vendor-risk/_lib/peopleModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FORMER, personName, pickable } from './peopleModel.ts';

const people = [{ id: 1, name: 'Ana Analyst' }, { id: 2, name: 'Olu Owner' }];

test('a person on the list is named; one who is not is a former colleague, never a number', () => {
  assert.equal(personName(people, 2), 'Olu Owner');
  assert.equal(personName(people, 12), FORMER);
  assert.ok(!/\d/.test(personName(people, 12)));
  assert.equal(personName([], 12), 'A former colleague');
});

test('the name a record carries itself is used before giving up, and nobody is null', () => {
  assert.equal(personName(people, 12, 'Gus Gone'), 'Gus Gone');
  assert.equal(personName(people, 12, '  '), FORMER);
  assert.equal(personName(people, 1, 'Someone else'), 'Ana Analyst');       // the list is the truth for a person it holds
  assert.equal(personName(people, null), null);
  assert.equal(personName(people, undefined), null);
});

test('the choice an existing record holds stays in the list when that person has left', () => {
  assert.deepEqual(pickable(people, 1).map((p) => p.id), [1, 2]);
  assert.deepEqual(pickable(people, null).map((p) => p.id), [1, 2]);
  assert.deepEqual(pickable(people, 9, 'Gus Gone'), [{ id: 9, name: 'Gus Gone' }, { id: 1, name: 'Ana Analyst' }, { id: 2, name: 'Olu Owner' }]);
  assert.equal(pickable(people, 9)[0].name, FORMER);
});
