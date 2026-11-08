// node --test "src/lib/forwardTo.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { forwardTo } from './forwardTo.ts';

test('the plain address forwards to the plain path', () => {
  assert.equal(forwardTo('/controls'), '/controls');
  assert.equal(forwardTo('/controls', {}), '/controls');
  assert.equal(forwardTo('/controls', null), '/controls');
});

test('the query the visitor came with is carried over', () => {
  assert.equal(forwardTo('/controls', { framework: '12' }), '/controls?framework=12');
  assert.equal(forwardTo('/control-library', { fw: 'ISO 27001,SOC 2' }), '/control-library?fw=ISO+27001%2CSOC+2');
});

test('a repeated name stays repeated, an undefined one is dropped', () => {
  assert.equal(forwardTo('/controls', { a: ['1', '2'], b: undefined, c: '' }), '/controls?a=1&a=2&c=');
});
