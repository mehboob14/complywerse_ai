// node --test src/components/shell/withFrom.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withFrom } from './withFrom.ts';

test('an in-app link gets the page it is on, encoded, as ?from= (as &from= after a query, and before a hash)', () => {
  assert.equal(withFrom('/governance/documents/7', '/needs-my-action'), '/governance/documents/7?from=%2Fneeds-my-action');
  assert.equal(withFrom('/governance/documents/7?act=ack', '/needs-my-action?section=ack'), '/governance/documents/7?act=ack&from=%2Fneeds-my-action%3Fsection%3Dack');
  assert.equal(withFrom('/governance/documents/7#versions', '/governance/documents'), '/governance/documents/7?from=%2Fgovernance%2Fdocuments#versions');
});

test('a link that is not a page of this app, one that already says where it came from, and a place that is not a page are left as they were', () => {
  assert.equal(withFrom('https://example.com/x', '/needs-my-action'), 'https://example.com/x');
  assert.equal(withFrom('//example.com/x', '/needs-my-action'), '//example.com/x');
  assert.equal(withFrom('/governance/documents/7?from=%2Fdashboard', '/needs-my-action'), '/governance/documents/7?from=%2Fdashboard');
  assert.equal(withFrom('/governance/documents/7', 'https://example.com'), '/governance/documents/7');
});
