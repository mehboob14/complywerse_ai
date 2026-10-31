// Run from this folder: node --test docLoad.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadFailure } from './docLoad.ts';

const http = (status: number) => ({ response: { status } });

test('no error is no failure', () => {
  assert.equal(loadFailure(null), null);
  assert.equal(loadFailure(undefined), null);
});

test('a refusal and a missing document are the server\'s answers, said as such', () => {
  assert.equal(loadFailure(http(403)), 'refused');
  assert.equal(loadFailure(http(404)), 'missing');
});

test('anything else is a failed read: a server error, a gateway, no answer at all', () => {
  for (const status of [400, 401, 408, 409, 429, 500, 502, 503, 504]) assert.equal(loadFailure(http(status)), 'failed', String(status));
  assert.equal(loadFailure(new Error('Network Error')), 'failed');
  assert.equal(loadFailure({ code: 'ECONNABORTED' }), 'failed');
  assert.equal(loadFailure({ response: {} }), 'failed');
  assert.equal(loadFailure('boom'), 'failed');
});
