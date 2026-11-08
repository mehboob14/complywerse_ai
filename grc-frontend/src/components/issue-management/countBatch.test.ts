// node --test "src/components/issue-management/countBatch.test.ts"
// The badges of a table leave as one call per type: asks in the same moment are batched, a different type is its own call, a full batch leaves at once, and a record the server leaves out
// of its answer is an error, never a zero.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCountBatcher, type LoadCounts } from './countBatch.ts';

const counts = (n: number) => ({ total_open: n, critical_open: 0, total_closed: 0 });

test('asks made together are one call, each asker gets its own record\'s counts', async () => {
  const calls: Array<[string, number[]]> = [];
  const load: LoadCounts = async (type, ids) => { calls.push([type, ids]); return Object.fromEntries(ids.map((i) => [String(i), counts(i)])); };
  const ask = makeCountBatcher(load, { wait: 5 });
  const got = await Promise.all([ask('risk', 3), ask('risk', 5), ask('risk', 3), ask('asset', 8)]);
  assert.deepEqual(got.map((c) => c.total_open), [3, 5, 3, 8]);
  assert.deepEqual(calls, [['risk', [3, 5]], ['asset', [8]]], 'one call per type, the repeated record asked once');
});

test('a later ask starts a new call', async () => {
  const calls: number[][] = [];
  const ask = makeCountBatcher(async (_t, ids) => { calls.push(ids); return Object.fromEntries(ids.map((i) => [String(i), counts(1)])); }, { wait: 1 });
  await ask('risk', 1);
  await ask('risk', 2);
  assert.deepEqual(calls, [[1], [2]]);
});

test('a full batch leaves at once, without waiting', async () => {
  const calls: number[][] = [];
  const ask = makeCountBatcher(async (_t, ids) => { calls.push(ids); return Object.fromEntries(ids.map((i) => [String(i), counts(1)])); }, { wait: 10_000, max: 3 });
  await Promise.all([ask('risk', 1), ask('risk', 2), ask('risk', 3)]);
  assert.deepEqual(calls, [[1, 2, 3]]);
});

test('a failed call fails every asker, and a record left out of the answer is an error, not a zero', async () => {
  const failing = makeCountBatcher(async () => { throw new Error('down'); }, { wait: 1 });
  const results = await Promise.allSettled([failing('risk', 1), failing('risk', 2)]);
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected']);
  const partial = makeCountBatcher(async () => ({ '1': counts(2) }), { wait: 1 });
  const [one, two] = await Promise.allSettled([partial('risk', 1), partial('risk', 2)]);
  assert.equal(one.status, 'fulfilled');
  assert.equal(two.status, 'rejected');
});
