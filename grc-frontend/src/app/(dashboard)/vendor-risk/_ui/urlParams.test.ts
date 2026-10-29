// node --test "src/app/(dashboard)/vendor-risk/_ui/*.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyParamsPatch } from './urlParams.ts';

test('a patch sets a key and leaves the others where they were', () => {
  assert.equal(applyParamsPatch('?q=a&page=3', { tier: 'high' }), 'q=a&page=3&tier=high');
  assert.equal(applyParamsPatch('q=a&tier=x&page=3', { tier: 'y' }), 'q=a&tier=y&page=3');     // a replaced key keeps its place
  assert.equal(applyParamsPatch('', { q: 'a' }), 'q=a');
  assert.equal(applyParamsPatch('a=1', {}), 'a=1');
  assert.equal(applyParamsPatch('', {}), '');
});

test('null, undefined, an empty string and an empty list remove the key', () => {
  for (const none of [null, undefined, '', []]) assert.equal(applyParamsPatch('q=a&page=3', { page: none }), 'q=a', JSON.stringify(none));
  assert.equal(applyParamsPatch('q=a', { page: null }), 'q=a');                                // nothing to remove
  assert.equal(applyParamsPatch('tier=a&tier=b&q=1', { tier: null }), 'q=1');                  // all of its values
  assert.equal(applyParamsPatch('a=1&b=2', { a: null, b: undefined }), '');
});

test('a list is one key repeated, and replaces what was there', () => {
  assert.equal(applyParamsPatch('', { tier: ['critical', 'high'] }), 'tier=critical&tier=high');
  assert.equal(applyParamsPatch('tier=x&tier=y&q=1', { tier: ['z'] }), 'q=1&tier=z');
  assert.equal(applyParamsPatch('tier=x', { tier: ['', 'z', ''] }), 'tier=z');                  // blanks are not values
  assert.deepEqual(new URLSearchParams(applyParamsPatch('', { tier: ['a', 'b'] })).getAll('tier'), ['a', 'b']);
});

test('values are encoded', () => {
  assert.equal(applyParamsPatch('', { q: 'hello world & co' }), 'q=hello+world+%26+co');
  assert.equal(new URLSearchParams(applyParamsPatch('', { q: 'hello world & co' })).get('q'), 'hello world & co');
});
