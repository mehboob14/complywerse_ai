// node --test "src/components/vendor-risk/supplier/portalProblem.test.ts"
// What a public supplier page says when a call fails: a link that no longer works, an address with no organisation in it, a busy server, and a
// failure that says nothing about the link. The server's tenant sentence never reaches the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BUSY, GONE, UNREACHABLE, WRONG_ADDRESS, actionText, canRetry, kindOf, problemText } from './portalProblem.ts';

const fail = (status?: number, detail?: unknown) => ({ response: status === undefined ? undefined : { status, data: { detail } } });
const TENANT = 'Tenant context required. Provide X-Tenant-Slug header or access via tenant subdomain.';

test('404 and 410 are a link that no longer works; 429 is busy', () => {
  assert.equal(kindOf(fail(404, GONE)), 'gone');
  assert.equal(kindOf(fail(410, GONE)), 'gone');
  assert.equal(kindOf(fail(429, BUSY)), 'busy');
});

test('a 400 about the tenant is an address with no organisation in it, whatever the server calls it', () => {
  assert.equal(kindOf(fail(400, TENANT)), 'address');
  assert.equal(kindOf(fail(400, 'Tenant context required')), 'address');
  assert.equal(problemText(fail(400, TENANT)), WRONG_ADDRESS);
  assert.equal(actionText(fail(400, TENANT), 'That did not save.'), WRONG_ADDRESS);
});

test('the server\'s technical words about a tenant never appear in what the person reads', () => {
  for (const text of [problemText(fail(400, TENANT)), actionText(fail(400, TENANT), 'x'), WRONG_ADDRESS]) {
    assert.doesNotMatch(text, /tenant|header|subdomain|X-/i);
  }
  assert.match(WRONG_ADDRESS, /organisation's link/);
});

test('any other 400 keeps its plain reason for an action and says "could not be reached" for a page that cannot open', () => {
  assert.equal(kindOf(fail(400, 'Empty file.')), 'other');
  assert.equal(actionText(fail(400, 'The period it covers ends before it starts'), 'x'), 'The period it covers ends before it starts');
  assert.equal(problemText(fail(400, 'Empty file.')), UNREACHABLE);
});

test('a network failure or a server error says nothing about the link', () => {
  assert.equal(kindOf(fail()), 'other');
  assert.equal(kindOf(null), 'other');
  assert.equal(kindOf(fail(500, 'boom')), 'other');
  assert.equal(problemText(fail(500, 'boom')), UNREACHABLE);
  assert.equal(problemText(fail(), 'The report could not be loaded.'), 'The report could not be loaded.');
});

test('a gone link keeps the server\'s sentence, or ours when it gave none', () => {
  assert.equal(problemText(fail(410, 'Custom words.')), 'Custom words.');
  assert.equal(problemText(fail(410)), GONE);
  assert.equal(problemText(fail(404, '   ')), GONE);
});

test('an action that was refused says why when the server did, else the caller\'s words', () => {
  assert.equal(actionText(fail(409, 'This request is not waiting on you now.'), 'x'), 'This request is not waiting on you now.');
  assert.equal(actionText(fail(500), 'That did not go through. Try again.'), 'That did not go through. Try again.');
  assert.equal(actionText(fail(500, 'psycopg2.errors.UndefinedTable: relation does not exist'), 'That did not save.'), 'That did not save.', "a failing server's own words are not shown");
  assert.equal(actionText(fail(429), 'x'), BUSY);
});

test('retrying can work for the network, a busy or a failing server, not for a refusal with a reason', () => {
  assert.equal(canRetry(fail()), true);
  assert.equal(canRetry(fail(429)), true);
  assert.equal(canRetry(fail(408)), true);
  assert.equal(canRetry(fail(503)), true);
  assert.equal(canRetry(fail(400, 'x')), false);
  assert.equal(canRetry(fail(404)), false);
});
