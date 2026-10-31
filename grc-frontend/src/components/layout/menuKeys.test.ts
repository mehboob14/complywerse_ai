// node --test src/components/layout/menuKeys.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { menuTarget } from './menuKeys.ts';

test('Down and Up step through the items and wrap around the ends', () => {
  assert.equal(menuTarget('ArrowDown', 0, 3), 1);
  assert.equal(menuTarget('ArrowDown', 2, 3), 0);
  assert.equal(menuTarget('ArrowUp', 2, 3), 1);
  assert.equal(menuTarget('ArrowUp', 0, 3), 2);
});

test('with focus on none of the items Down goes to the first and Up to the last', () => {
  assert.equal(menuTarget('ArrowDown', -1, 4), 0);
  assert.equal(menuTarget('ArrowUp', -1, 4), 3);
});

test('Home and End jump to the ends', () => {
  assert.equal(menuTarget('Home', 2, 5), 0);
  assert.equal(menuTarget('End', 2, 5), 4);
});

test('any other key, and a menu with no item, move nothing', () => {
  for (const key of ['Enter', 'Escape', 'Tab', 'a', 'ArrowLeft', 'ArrowRight']) assert.equal(menuTarget(key, 1, 3), null, key);
  assert.equal(menuTarget('ArrowDown', -1, 0), null);
  assert.equal(menuTarget('End', 0, 0), null);
});

test('a menu of one item keeps focus on it', () => {
  assert.equal(menuTarget('ArrowDown', 0, 1), 0);
  assert.equal(menuTarget('ArrowUp', 0, 1), 0);
});
