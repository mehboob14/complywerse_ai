// node --test "src/components/vendor-risk/supplier/*.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSaver, type Change, type SavePhase } from './answerSaver.ts';

/** A send the test settles by hand, and a record of what was sent and reported. */
function harness() {
  const sent: Array<{ id: string; change: Change; ok: () => void; fail: (e: unknown) => void }> = [];
  const phases: string[] = [];
  const saver = createSaver(
    (id, change) => new Promise<void>((ok, fail) => { sent.push({ id, change, ok, fail }); }),
    (id, phase: SavePhase, error) => { phases.push(`${id}:${phase}${error ? `:${String(error)}` : ''}`); },
  );
  return { saver, sent, phases };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('an answer is sent at once and reported saved when the server says so', async () => {
  const { saver, sent, phases } = harness();
  saver.save('q1', { value: 'yes', comment: '' });
  assert.deepEqual(sent.map((s) => [s.id, s.change.value]), [['q1', 'yes']]);
  assert.deepEqual(phases, ['q1:saving']);
  sent[0].ok();
  await tick();
  assert.deepEqual(phases, ['q1:saving', 'q1:saved']);
});

test('answers given while one is being saved wait, and only the last of them is sent', async () => {
  const { saver, sent, phases } = harness();
  saver.save('q1', { value: 'yes', comment: '' });
  saver.save('q1', { value: 'partial', comment: '' });
  saver.save('q1', { value: 'no', comment: 'We are moving off it' });
  assert.equal(sent.length, 1);                                              // not three requests racing each other
  sent[0].ok();
  await tick();
  assert.deepEqual(sent.map((s) => s.change.value), ['yes', 'no']);
  assert.equal(sent[1].change.comment, 'We are moving off it');
  assert.deepEqual(phases, ['q1:saving', 'q1:saving']);                      // the first result no longer matters: not "saved" yet
  sent[1].ok();
  await tick();
  assert.equal(phases[phases.length - 1], 'q1:saved');
});

test('different questions save side by side', async () => {
  const { saver, sent } = harness();
  saver.save('q1', { value: 'yes', comment: '' });
  saver.save('q2', { value: 'no', comment: '' });
  assert.deepEqual(sent.map((s) => s.id), ['q1', 'q2']);
});

test('a failed save is reported with its error, and giving the answer again tries again', async () => {
  const { saver, sent, phases } = harness();
  saver.save('q1', { value: 'yes', comment: '' });
  sent[0].fail('offline');
  await tick();
  assert.deepEqual(phases, ['q1:saving', 'q1:failed:offline']);
  saver.save('q1', { value: 'yes', comment: '' });                           // "Try again"
  assert.equal(sent.length, 2);
  sent[1].ok();
  await tick();
  assert.equal(phases[phases.length - 1], 'q1:saved');
});

test('a failure does not hide the newer answer given meanwhile', async () => {
  const { saver, sent, phases } = harness();
  saver.save('q1', { value: 'yes', comment: '' });
  saver.save('q1', { value: 'no', comment: '' });
  sent[0].fail('timeout');
  await tick();
  assert.equal(sent.length, 2);                                              // the newer one goes out
  assert.deepEqual(phases, ['q1:saving', 'q1:saving']);
  sent[1].ok();
  await tick();
  assert.equal(phases[phases.length - 1], 'q1:saved');
});
