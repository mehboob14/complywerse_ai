// node --test "src/lib/inbox/sourceState.test.ts"
// How a source's query becomes the state of the inbox: a failed request never reads as an empty answer, a failed refresh keeps the last good answer, an older server's missing endpoint is "off".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stateOf, type QueryFacts } from './sourceState.ts';

const q = (over: Partial<QueryFacts> = {}): QueryFacts => ({ data: undefined, isError: false, error: null, dataUpdatedAt: 0, errorUpdatedAt: 0, fetchStatus: 'fetching', ...over });
const http = (status: number | null, detail?: string) => ({ isAxiosError: true, code: status ? undefined : 'ERR_NETWORK', response: status ? { status, data: { detail } } : undefined });

test('nothing yet is loading; an answer is ready, whatever it holds (an empty list is an answer)', () => {
  assert.deepEqual(stateOf(q()), { state: 'loading' });
  assert.deepEqual(stateOf(q({ data: { items: [] }, dataUpdatedAt: 5, fetchStatus: 'idle' })), { state: 'ready', at: 5 });
  assert.deepEqual(stateOf(q({ data: [], dataUpdatedAt: 6 })), { state: 'ready', at: 6 }, 'a refetch under way keeps the answer on screen');
});

test('a request that never answered is unavailable, in the server\'s words, never an empty answer', () => {
  assert.deepEqual(stateOf(q({ isError: true, error: http(500, 'boom'), errorUpdatedAt: 9, fetchStatus: 'idle' })), { state: 'unavailable', error: 'boom' });
  assert.deepEqual(stateOf(q({ isError: true, error: http(null), errorUpdatedAt: 9 })), { state: 'unavailable', error: "Couldn't reach the server. Check your connection and try again." });
  assert.deepEqual(stateOf(q({ isError: true, error: http(403, 'No.'), errorUpdatedAt: 9 })), { state: 'unavailable', error: 'No.' }, 'a refusal is a failure too: there is no 0');
});

test('a refresh that failed keeps the last good answer and says when it is from', () => {
  assert.deepEqual(stateOf(q({ data: { items: [1] }, dataUpdatedAt: 77, isError: true, error: http(null), errorUpdatedAt: 99, fetchStatus: 'idle' })),
    { state: 'stale', at: 77, error: "Couldn't reach the server. Check your connection and try again." });
});

test('a retry under way keeps the failure on screen with its words (the query is pending again and has forgotten its error)', () => {
  const retrying = q({ errorUpdatedAt: 9, fetchStatus: 'fetching' });
  assert.deepEqual(stateOf(retrying, { lastError: 'boom' }), { state: 'unavailable', error: 'boom' });
  assert.deepEqual(stateOf(retrying), { state: 'loading' }, 'with no words to keep it is loading');
  assert.deepEqual(stateOf(q({ fetchStatus: 'fetching' }), { lastError: 'boom' }), { state: 'loading' }, 'a first load that has not failed is loading');
  assert.deepEqual(stateOf(q({ data: { items: [] }, dataUpdatedAt: 3, errorUpdatedAt: 9 }), { lastError: 'boom' }), { state: 'ready', at: 3 }, 'once it answers it is ready');
});

test('an older server with no such endpoint (404) is off for a source that may be missing, and a failure for every other', () => {
  const missing = q({ isError: true, error: http(404, 'Not Found'), errorUpdatedAt: 9, fetchStatus: 'idle' });
  assert.deepEqual(stateOf(missing, { missingMeansOff: true }), { state: 'off' });
  assert.deepEqual(stateOf(missing), { state: 'unavailable', error: 'Not Found' });
  assert.equal(stateOf(q({ isError: true, error: http(500, 'x'), errorUpdatedAt: 9 }), { missingMeansOff: true }).state, 'unavailable', 'only a 404 means off');
});

test('the words of a failure never show a vendor name', () => {
  assert.deepEqual(stateOf(q({ isError: true, error: http(500, 'OpenAI is down'), errorUpdatedAt: 1 })), { state: 'unavailable', error: 'AI is down' });
});
