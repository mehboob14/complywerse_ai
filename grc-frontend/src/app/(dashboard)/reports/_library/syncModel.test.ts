// node --test "src/app/(dashboard)/reports/_library/syncModel.test.ts"
// Where a saved report lives: what a failed request means, which local copies are sent again, the words for each case.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canSendAgain, classifySync, deviceLine, failureWords, readRefused, syncStateOf, toResend, withRefused, withoutRefused } from './syncModel.ts';

const http = (status?: number) => ({ response: status === undefined ? undefined : { status } });

test('no answer, a server fault, a busy server or a timeout is "unreachable" (try again); 401 and 403 are "denied"; any other 4xx is "refused"', () => {
  assert.deepEqual(classifySync(new Error('Network Error')), { kind: 'unreachable', status: null });
  assert.deepEqual(classifySync(http()), { kind: 'unreachable', status: null });
  for (const s of [500, 502, 503, 408, 425, 429]) assert.equal(classifySync(http(s)).kind, 'unreachable', String(s));
  assert.deepEqual(classifySync(http(403)), { kind: 'denied', status: 403 });
  assert.equal(classifySync(http(401)).kind, 'denied');
  for (const s of [400, 404, 409, 413, 422]) assert.equal(classifySync(http(s)).kind, 'refused', String(s));
  assert.equal(classifySync(null).kind, 'unreachable', 'nothing at all is no answer');
});

test('only an unreachable server is worth asking again', () => {
  assert.equal(canSendAgain(classifySync(http(503))), true);
  assert.equal(canSendAgain(classifySync(http(403))), false);
  assert.equal(canSendAgain(classifySync(http(422))), false);
});

test('the words say what was not done and whether to try again, with no code or address in them', () => {
  const what = 'save the report';
  assert.equal(failureWords({ kind: 'denied', status: 403 }, what), 'Your role does not allow you to save the report.');
  assert.equal(failureWords({ kind: 'refused', status: 422 }, what), 'The server did not accept the request to save the report.');
  assert.match(failureWords({ kind: 'unreachable', status: null }, what), /could not be reached.*Try again/);
  for (const kind of ['denied', 'refused', 'unreachable'] as const) assert.doesNotMatch(failureWords({ kind, status: 500 }, what), /\b(?:40\d|50\d|HTTP|http|api|\/)/);
});

test('a local copy is sent again only when the server does not have it and has not refused it', () => {
  const local = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: '' }];
  assert.deepEqual(toResend(local, new Set(['a']), { c: 422 }), ['b']);
  assert.deepEqual(toResend(local, new Set(), {}), ['a', 'b', 'c']);
  assert.deepEqual(toResend([], new Set(['a']), {}), []);
});

test('the state of an item: on the server is saved, refused is refused, anything else waits on this device', () => {
  assert.equal(syncStateOf('a', new Set(['a']), {}), 'synced');
  assert.equal(syncStateOf('b', new Set(['a']), {}), 'device');
  assert.equal(syncStateOf('c', new Set(['a']), { c: 403 }), 'refused');
  assert.equal(syncStateOf('a', new Set(['a']), { a: 403 }), 'synced', 'the server having it wins over an old refusal');
});

test('the refused map: set, clear, and read back from storage without trusting it', () => {
  const m = withRefused({}, 'x', 403);
  assert.deepEqual(m, { x: 403 });
  assert.deepEqual(withRefused(m, 'y', null), { x: 403, y: 0 });
  assert.deepEqual(withoutRefused(m, 'x'), {});
  assert.deepEqual(m, { x: 403 }, 'the map is not changed in place');
  assert.deepEqual(readRefused('{"a":403,"b":"no","c":null}'), { a: 403 });
  for (const bad of [null, '', 'not json', '[1,2]', '"x"', 'null']) assert.deepEqual(readRefused(bad), {}, String(bad));
});

test('the line above a list: nothing when all is saved; counts in words; the refused ones say the server did not accept them', () => {
  const noun = { one: 'report', other: 'reports' };
  assert.equal(deviceLine({ device: 0, refused: 0 }, noun), null);
  assert.equal(deviceLine({ device: 1, refused: 0 }, noun), '1 report is only on this device and will be saved when the server can be reached.');
  assert.equal(deviceLine({ device: 2, refused: 0 }, noun), '2 reports are only on this device and will be saved when the server can be reached.');
  assert.equal(deviceLine({ device: 0, refused: 1 }, noun), '1 report could not be saved because the server did not accept it.');
  assert.match(deviceLine({ device: 2, refused: 3 }, noun) ?? '', /^2 reports are only on this device.*3 reports could not be saved because the server did not accept them\.$/);
});
