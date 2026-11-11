// node --test "src/app/(dashboard)/vendor-risk/_overview/cardState.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardOutcome, type CardFeed } from './cardState.ts';

const feed = (over: Partial<CardFeed> = {}): CardFeed => ({ isPending: false, isError: false, error: null, data: {}, refetch: () => undefined, ...over });
const http = (status: number) => ({ isAxiosError: true, response: { status, data: { detail: 'The server said no.' } } });

test('a request that is running, or shows the other scope\'s answer, is loading; one that has not answered yet is loading too', () => {
  assert.equal(cardOutcome([feed({ isPending: true, data: undefined })], false, 'vendors').state, 'loading');
  assert.equal(cardOutcome([feed({ isPlaceholderData: true })], false, 'vendors').state, 'loading');
  assert.equal(cardOutcome([feed(), feed({ isPending: true, data: undefined })], false, 'vendors').state, 'loading');
  assert.equal(cardOutcome([feed({ data: undefined })], false, 'vendors').state, 'loading');
});

test('a failed request is an error with Retry where asking again can help, never an empty chart', () => {
  let asked = 0;
  const out = cardOutcome([feed({ isError: true, error: http(500), data: undefined, refetch: () => { asked += 1; } })], true, 'vendors');
  assert.equal(out.state, 'error');
  assert.equal(out.error?.message, 'The server said no.');
  out.error?.onRetry?.();
  assert.equal(asked, 1);
  const refused = cardOutcome([feed({ isError: true, error: http(400), data: undefined })], true, 'vendors');
  assert.equal(refused.state, 'error');
  assert.equal(refused.error?.onRetry, undefined);                                   // a refusal does not come out differently the second time
});

test('a refused request (403) says the role cannot see it, in the words of what it holds', () => {
  assert.deepEqual(cardOutcome([feed({ isError: true, error: http(403), data: undefined })], false, 'contracts'), { state: 'denied', deniedText: 'Your role cannot see contracts.' });
});

test('one failed request among several fails the card (it rests on all of them); nothing to draw is empty; else ready', () => {
  assert.equal(cardOutcome([feed(), feed({ isError: true, error: http(500), data: undefined })], false, 'the scores').state, 'error');
  assert.equal(cardOutcome([feed(), feed()], true, 'the scores').state, 'empty');
  assert.equal(cardOutcome([feed(), feed()], false, 'the scores').state, 'ready');
});
