// node --test "src/components/ui/toastLogic.test.ts"
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { createToastTimer, keepToasts } from './toastLogic.ts';

function clock() {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let done = 0;
  const timer = createToastTimer(3000, () => { done += 1; });
  return { timer, done: () => done, tick: (ms: number) => mock.timers.tick(ms) };
}

test('the clock dismisses the toast once its time is up', () => {
  const c = clock();
  c.timer.start();
  c.tick(2999);
  assert.equal(c.done(), 0);
  c.tick(1);
  assert.equal(c.done(), 1);
  mock.timers.reset();
});

test('a pause stops the clock and a resume goes on with what was left, not from the start', () => {
  const c = clock();
  c.timer.start();
  c.tick(2000);
  c.timer.pause();                       // the pointer arrives
  c.tick(60_000);                        // read for a minute
  assert.equal(c.done(), 0);
  c.timer.start();                       // the pointer leaves: 1000 ms were left
  c.tick(999);
  assert.equal(c.done(), 0);
  c.tick(1);
  assert.equal(c.done(), 1);
  mock.timers.reset();
});

test('pausing and resuming over and over adds up, and starting twice does not count twice', () => {
  const c = clock();
  c.timer.start();
  c.timer.start();                       // focus and hover both end at once: the second start is ignored
  c.tick(1000);
  c.timer.pause();
  c.timer.pause();                       // pause twice: the elapsed second is taken off once
  c.timer.start();
  c.tick(1000);
  c.timer.pause();
  c.timer.start();
  c.tick(999);
  assert.equal(c.done(), 0);
  c.tick(1);
  assert.equal(c.done(), 1);
  mock.timers.reset();
});

test('a clock that has fired never starts again (the toast is already leaving)', () => {
  const c = clock();
  c.timer.start();
  c.tick(3000);
  c.timer.pause();
  c.timer.start();
  c.tick(10_000);
  assert.equal(c.done(), 1);
  mock.timers.reset();
});

test('a duration of 0 (or less) never runs: the toast stays until it is dismissed', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let done = 0;
  for (const duration of [0, -1]) {
    const timer = createToastTimer(duration, () => { done += 1; });
    timer.start();
    mock.timers.tick(60 * 60 * 1000);
    timer.pause();
    timer.start();
    mock.timers.tick(60 * 60 * 1000);
  }
  assert.equal(done, 0);
  mock.timers.reset();
});

const t = (name: string, duration?: number) => ({ name, duration });
const names = (list: Array<{ name: string }>) => list.map((x) => x.name).join(',');

test('with room for all of them nothing is dropped, and with only self-dismissing toasts the oldest goes (as it always did)', () => {
  assert.equal(names(keepToasts([t('a', 5000), t('b', 5000)], 5)), 'a,b');
  assert.equal(names(keepToasts([t('a', 5000), t('b', 5000), t('c', 3000), t('d'), t('e', 5000), t('f', 5000)], 5)), 'b,c,d,e,f');
  const all = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => t(n, 5000));
  assert.deepEqual(keepToasts(all, 5), all.slice(-5));                // exactly the old `slice(-max)`
});

test('an error that stays outlives a toast that goes by itself', () => {
  const list = [t('error1', 0), t('ok1', 3000), t('error2', 0), t('ok2', 3000), t('error3', 0), t('new', 5000)];
  assert.equal(names(keepToasts(list, 5)), 'error1,error2,ok2,error3,new');         // ok1, the oldest self-dismissing one, goes
});

test('when every older toast stays, the oldest of them goes, and the newcomer is never the one dropped', () => {
  const full = [t('e1', 0), t('e2', 0), t('e3', 0), t('e4', 0), t('e5', 0)];
  assert.equal(names(keepToasts([...full, t('e6', 0)], 5)), 'e2,e3,e4,e5,e6');
  assert.equal(names(keepToasts([...full, t('ok', 3000)], 5)), 'e2,e3,e4,e5,ok');
});

test('keepToasts does not change the list it is given, and always keeps at least the newcomer', () => {
  const list = [t('a', 5000), t('b', 5000), t('c', 5000)];
  keepToasts(list, 1);
  assert.equal(list.length, 3);
  assert.equal(names(keepToasts(list, 1)), 'c');
  assert.equal(names(keepToasts(list, 0)), 'c');
});
