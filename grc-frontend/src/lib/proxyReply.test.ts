import { test } from 'node:test';
import assert from 'node:assert/strict';

import { proxyBody } from './proxyReply.ts';

const FAILURE = 'The statements could not be read now. Try again in a minute.';

test('the backend\'s JSON goes on as it is', () => {
  assert.deepEqual(proxyBody('{"detail":"Too many parse jobs in the last minute; try again shortly"}', FAILURE),
    { detail: 'Too many parse jobs in the last minute; try again shortly' });
  assert.deepEqual(proxyBody('{"status":"queued","task_id":"thread-1"}', FAILURE), { status: 'queued', task_id: 'thread-1' });
});

test('a plain-text or HTML error, or an empty body, becomes one plain sentence', () => {
  for (const text of ['Internal Server Error', '<html><body>502 Bad Gateway</body></html>', '']) {
    assert.deepEqual(proxyBody(text, FAILURE), { detail: FAILURE }, text);
  }
});
