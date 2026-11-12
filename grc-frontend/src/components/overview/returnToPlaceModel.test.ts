// node --test "src/components/overview/returnToPlaceModel.test.ts"
// useReturnToPlace's rules: the key a place is kept under (path and the whole query, so two views are two places), how a stored record is read (damaged,
// old or negative ones are nothing), the newest-24 cap, the write throttle, which arrivals are a return (Back/Forward, a link to the address that was left, a
// reload) and which are fresh (a menu entry, a stale Back press), and how far down a page that is still growing can be put.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DECIDE_LATE_MS, KEEP_COUNT, KEEP_MS, KEEP_TOP_MS, LOAD_WINDOW_MS, POP_WINDOW_MS, SAVE_EVERY_MS, isReturn, isTraverse, keyOfHref, mayWrite, parsePlaces, placeKey, placeOf, reached, restoreTarget, saveDelay, withPlace,
  type Arrival,
} from './returnToPlaceModel.ts';

const NOW = 1_800_000_000_000;
const none: Arrival = { poppedAt: null, intent: null, load: null };

test('the key is the path and the whole query: the view is part of the place; no hash, no empty "?", no trailing slash', () => {
  assert.equal(placeKey('/erm', ''), '/erm');
  assert.equal(placeKey('/erm', '?'), '/erm');
  assert.equal(placeKey('/erm', '?view=heat&by=unit'), '/erm?view=heat&by=unit');
  assert.equal(placeKey('/erm', 'view=heat'), '/erm?view=heat');
  assert.equal(placeKey('/erm/', ''), '/erm');
  assert.equal(placeKey('/', ''), '/');
  assert.equal(placeKey('/erm', '?view=heat#risks'), '/erm?view=heat');
  assert.notEqual(placeKey('/erm', '?view=a'), placeKey('/erm', '?view=b'));
});

test('the key of a link is its page on this origin; another origin or nonsense is none', () => {
  const base = 'http://admin.localhost:3030/erm/risks/4?from=%2Ferm';
  assert.equal(keyOfHref('/erm?view=heat', base), '/erm?view=heat');
  assert.equal(keyOfHref('http://admin.localhost:3030/erm/#top', base), '/erm');
  assert.equal(keyOfHref('https://example.com/erm', base), null);
  assert.equal(keyOfHref('http://[bad', base), null);
});

test('a stored record is read as a map of positions; damage, wrong shapes and negative positions are nothing, never an error', () => {
  assert.deepEqual(parsePlaces(null), {});
  assert.deepEqual(parsePlaces(''), {});
  assert.deepEqual(parsePlaces('{not json'), {});
  assert.deepEqual(parsePlaces('[1,2]'), {});
  assert.deepEqual(parsePlaces('"x"'), {});
  assert.deepEqual(parsePlaces(JSON.stringify({ '/erm': { y: 420, t: NOW }, '/bad': { y: -1, t: NOW }, '/worse': { y: 'x', t: NOW }, '/null': null })), { '/erm': { y: 420, t: NOW } });
});

test('a place is returned while it is fresh; an old one, a missing one and one from the future are null; 0 is a place', () => {
  const places = { '/erm': { y: 640, t: NOW - 1000 }, '/old': { y: 5, t: NOW - KEEP_MS - 1 }, '/top': { y: 0, t: NOW }, '/future': { y: 9, t: NOW + 60_000 } };
  assert.equal(placeOf(places, '/erm', NOW), 640);
  assert.equal(placeOf(places, '/old', NOW), null);
  assert.equal(placeOf(places, '/nowhere', NOW), null);
  assert.equal(placeOf(places, '/top', NOW), 0);
  assert.equal(placeOf(places, '/future', NOW), null, 'a clock that ran backwards is not trusted');
});

test('keeping a place rounds it, forgets the old ones and keeps only the newest KEEP_COUNT', () => {
  const next = withPlace({ '/old': { y: 1, t: NOW - KEEP_MS - 5 } }, '/erm', 312.7, NOW);
  assert.deepEqual(next, { '/erm': { y: 313, t: NOW } });
  assert.equal(withPlace({}, '/erm', -20, NOW)['/erm'].y, 0);
  let many = {};
  for (let i = 0; i < KEEP_COUNT + 6; i++) many = withPlace(many, `/p${i}`, i, NOW + i);
  const keys = Object.keys(many);
  assert.equal(keys.length, KEEP_COUNT);
  assert.ok(keys.includes(`/p${KEEP_COUNT + 5}`) && !keys.includes('/p0'), 'the newest stay, the oldest go');
});

test('the write is throttled: now when the interval has passed, else the rest of it', () => {
  assert.equal(saveDelay(NOW, NOW - SAVE_EVERY_MS), 0);
  assert.equal(saveDelay(NOW, NOW - 1000), 0);
  assert.equal(saveDelay(NOW, NOW - 50), SAVE_EVERY_MS - 50);
  assert.equal(saveDelay(NOW, NOW), SAVE_EVERY_MS);
  assert.equal(saveDelay(NOW, 0), 0, 'the first write is immediate');
});

test('Back or Forward is a return, while it is recent; a stale press is forgotten', () => {
  assert.equal(isReturn({ ...none, poppedAt: NOW - 400 }, '/erm', NOW), true);
  assert.equal(isReturn({ ...none, poppedAt: NOW - POP_WINDOW_MS - 1 }, '/erm', NOW), false);
  assert.equal(isReturn({ ...none, poppedAt: NOW + 5 }, '/erm', NOW), false, 'not from the future');
});

test('a link to the very address that was left (the module\'s own way back) is a return; a link to some other address is not', () => {
  assert.equal(isReturn({ ...none, intent: '/erm?view=heat' }, '/erm?view=heat', NOW), true);
  assert.equal(isReturn({ ...none, intent: '/erm' }, '/erm?view=heat', NOW), false);
  assert.equal(isReturn({ ...none, intent: '/erm/risks' }, '/erm', NOW), false);
});

test('a reload or a history load of this very document is a return only for the page it was loaded at, soon after loading', () => {
  assert.equal(isReturn({ ...none, load: { type: 'reload', ageMs: 900, key: '/erm' } }, '/erm', NOW), true);
  assert.equal(isReturn({ ...none, load: { type: 'back_forward', ageMs: 900, key: '/erm' } }, '/erm', NOW), true);
  assert.equal(isReturn({ ...none, load: { type: 'navigate', ageMs: 900, key: '/erm' } }, '/erm', NOW), false, 'typing the address or following a link from outside is a fresh open');
  assert.equal(isReturn({ ...none, load: { type: 'reload', ageMs: LOAD_WINDOW_MS + 1, key: '/erm' } }, '/erm', NOW), false, 'a page reached much later by a menu click is not the reloaded one');
  assert.equal(isReturn({ ...none, load: { type: 'reload', ageMs: 900, key: '/evidence' } }, '/erm', NOW), false, 'a document reloaded on another page that reaches this one by a menu click is a fresh open');
  assert.equal(isReturn({ ...none, load: { type: 'reload', ageMs: 900, key: '/erm?view=heat' } }, '/erm', NOW), false, 'the view is part of the place');
  assert.equal(isReturn({ ...none, load: { type: 'reload', ageMs: 40_000, key: '/erm' } }, '/erm', NOW), true, 'a slow dev server may take a while to hydrate');
});

test('a traversal is what the Navigation API calls Back, Forward and history.go; a push, a replace and a reload are not', () => {
  assert.equal(isTraverse('traverse'), true);
  for (const t of ['push', 'replace', 'reload', undefined, null, 42]) assert.equal(isTraverse(t), false, String(t));
});

test('the top is not written over a kept place by a page a few seconds old that nobody has touched (a return that was not recognised must not also destroy its place)', () => {
  const base = { y: 0, touched: false, sinceMountMs: 500, kept: 400 };
  assert.equal(mayWrite(base), false);
  assert.equal(mayWrite({ ...base, touched: true }), true, 'the person scrolled or pressed: it is their top');
  assert.equal(mayWrite({ ...base, sinceMountMs: KEEP_TOP_MS }), true, 'after a few seconds it is a real top');
  assert.equal(mayWrite({ ...base, kept: null }), true, 'nothing is kept: nothing to protect');
  assert.equal(mayWrite({ ...base, kept: 0 }), true);
  assert.equal(mayWrite({ ...base, y: 320 }), true, 'any other position is written');
});

test('a fresh open is nothing: no press, no link to this address, no history load', () => {
  assert.equal(isReturn(none, '/erm', NOW), false);
});

test('the page is put as far down as it reaches so far, and is "there" within a pixel', () => {
  assert.equal(restoreTarget(900, 2000), 900);
  assert.equal(restoreTarget(900, 400), 400, 'not tall enough yet: as low as it goes, asked again');
  assert.equal(restoreTarget(900, -30), 0);
  assert.equal(restoreTarget(-4, 500), 0);
  assert.equal(reached(899.6, 900), true);
  assert.equal(reached(880, 900), false);
});

test('without the Navigation API a page that looks fresh waits a moment for a late popstate, but not longer than a person would notice', () => {
  assert.ok(DECIDE_LATE_MS >= 150 && DECIDE_LATE_MS <= 500, String(DECIDE_LATE_MS));
  assert.ok(DECIDE_LATE_MS < KEEP_TOP_MS);
});
