// node --test "src/app/(dashboard)/vendor-risk/_ui/*.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { avatarIndex, initials } from './people.ts';

test('initials: first and last word, or the first two letters of one word', () => {
  assert.equal(initials('Dana Okafor'), 'DO');
  assert.equal(initials('  ali   bin zayed '), 'AZ');
  assert.equal(initials('Madonna'), 'MA');
  assert.equal(initials('X'), 'X');
  assert.equal(initials('Álvaro Núñez'), 'ÁN');
  for (const none of [null, undefined, '', '   ']) assert.equal(initials(none), '?');
});

test('a name always gets the same avatar slot, inside the palette', () => {
  assert.equal(avatarIndex('Dana Okafor', 6), avatarIndex('  dana okafor ', 6));
  for (const name of ['Dana Okafor', 'Rana', 'Uma', '', null, 'A very long name indeed']) {
    const slot = avatarIndex(name, 6);
    assert.ok(Number.isInteger(slot) && slot >= 0 && slot < 6, String(name));
  }
  assert.equal(avatarIndex('x', 0), 0);
  assert.ok(new Set(['Dana', 'Rana', 'Uma', 'Mina', 'Olivia', 'Rafay', 'Ali', 'Sara'].map((n) => avatarIndex(n, 6))).size > 2);   // spread out
});
