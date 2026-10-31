// node --test src/components/ui/scrollLock.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createScrollLock } from './scrollLock.ts';

function page(initial = '') {
  const style = { overflow: initial };
  return { style, lock: createScrollLock(() => style.overflow, (v) => { style.overflow = v; }) };
}

test('one overlay hides the scroll and gives the page its own value back', () => {
  const { style, lock } = page('auto');
  const unlock = lock();
  assert.equal(style.overflow, 'hidden');
  unlock();
  assert.equal(style.overflow, 'auto');
});

test('two stacked overlays closing in either order leave the page as it was (the bug: the first-opened one closing last restored "hidden")', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const { style, lock } = page('');
    const unlocks = [lock(), lock()];
    assert.equal(style.overflow, 'hidden');
    unlocks[order[0]]();
    assert.equal(style.overflow, 'hidden', 'still locked while the other is open');
    unlocks[order[1]]();
    assert.equal(style.overflow, '', `closed in order ${order}`);
  }
});

test('releasing the same lock twice does not release somebody else\'s', () => {
  const { style, lock } = page('');
  const first = lock();
  lock();
  first();
  first();
  assert.equal(style.overflow, 'hidden');
});

test('after everything closed, the next overlay saves the page\'s value as it is then', () => {
  const { style, lock } = page('');
  lock()();
  style.overflow = 'scroll';           // something else changed it in between
  const unlock = lock();
  assert.equal(style.overflow, 'hidden');
  unlock();
  assert.equal(style.overflow, 'scroll');
});
