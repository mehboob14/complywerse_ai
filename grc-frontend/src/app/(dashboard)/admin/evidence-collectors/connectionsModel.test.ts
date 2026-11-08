// node --test "src/app/(dashboard)/admin/evidence-collectors/connectionsModel.test.ts"
// The Connections page's decisions: what is active and failing, what a tab, a search and a category leave, how a row reads, and which "Back" link is followed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { CONNECTIONS_SCHEMA, categoriesOf, countsOf, defaultShow, isActive, isFailing, lastCollected, readingOf, returnLabel, safeReturn, visibleConnectors, type Connector } from './connectionsModel.ts';

const c = (id: string, over: Partial<Connector> = {}): Connector => ({
  id, name: id.toUpperCase(), category: 'identity', categories: ['identity'], provider: id, supported: true, connected: false, connection_id: null, last_run: null, ...over,
});
const list = [
  c('okta', { connected: true, connection_id: 1, last_run: { status: 'completed', started_at: '2026-11-07T10:00:00' } }),
  c('github', { connected: true, connection_id: 2, last_run: { status: 'error', started_at: '2026-11-06T10:00:00' }, category: 'scm', categories: ['scm'] }),
  c('slack', { connected: true, connection_id: 3, last_run: null, category: 'comms', categories: ['comms', 'productivity'] }),
  c('aws', { category: 'cloud', categories: ['cloud'] }),
  c('zoom', { supported: false, provider: null, category: 'comms', categories: ['comms'] }),
];

test('a connector reads as unavailable, not connected, or connected with the health of its last collection', () => {
  assert.deepEqual(readingOf(list[0]), { kind: 'connected', health: 'healthy' });
  assert.deepEqual(readingOf(list[1]), { kind: 'connected', health: 'failing' });
  assert.deepEqual(readingOf(list[2]), { kind: 'connected', health: 'never_run' });
  assert.deepEqual(readingOf(list[3]), { kind: 'not_connected' });
  assert.deepEqual(readingOf(list[4]), { kind: 'unavailable' });
  assert.equal(readingOf({ ...list[4], connected: true }).kind, 'unavailable', 'a connector that cannot collect is never "connected"');
});

test('active is wired and connected; failing is active whose last collection failed', () => {
  assert.deepEqual(list.map(isActive), [true, true, true, false, false]);
  assert.deepEqual(list.map(isFailing), [false, true, false, false, false]);
  assert.deepEqual(countsOf(list), { active: 3, failing: 1, all: 5, wired: 4 });
});

test('the tab shown by default is Active once anything is connected, else All', () => {
  assert.equal(defaultShow(list), 'active');
  assert.equal(defaultShow(list.filter((x) => !x.connected)), 'all');
  assert.equal(defaultShow([]), 'all');
});

test('a tab, a search and a category each leave what they name; the wired and connected come first', () => {
  const ids = (v: Parameters<typeof visibleConnectors>[1]) => visibleConnectors(list, v).map((x) => x.id);
  assert.deepEqual(ids({ show: 'all', query: '', category: '' }), ['github', 'okta', 'slack', 'aws', 'zoom']);
  assert.deepEqual(ids({ show: 'active', query: '', category: '' }), ['github', 'okta', 'slack']);
  assert.deepEqual(ids({ show: 'failing', query: '', category: '' }), ['github']);
  assert.deepEqual(ids({ show: 'all', query: ' OKT ', category: '' }), ['okta']);
  assert.deepEqual(ids({ show: 'all', query: '', category: 'comms' }), ['slack', 'zoom']);
  assert.deepEqual(ids({ show: 'all', query: '', category: 'productivity' }), ['slack'], 'a connector is in every category it names');
  assert.deepEqual(ids({ show: 'failing', query: 'okta', category: '' }), []);
  assert.deepEqual(categoriesOf(list), ['cloud', 'comms', 'identity', 'scm']);
});

test('what a row says about the last collection', () => {
  const f = (iso: string) => `on ${iso.slice(0, 10)}`;
  assert.equal(lastCollected(list[0], f), 'Last collected on 2026-11-07');
  assert.equal(lastCollected(list[2], f), 'Never collected');
  assert.equal(lastCollected(list[3], f), null);
  assert.equal(lastCollected(list[4], f), null);
});

test('only a path on this site is followed back, and it is named by its last part', () => {
  assert.equal(safeReturn('/automation/soc2-controls/IAC-06?tab=tests'), '/automation/soc2-controls/IAC-06?tab=tests');
  for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', `/${String.fromCharCode(92)}evil`, '', null, undefined]) assert.equal(safeReturn(bad as string), null, String(bad));
  assert.equal(returnLabel('/automation/soc2-controls/IAC-06?tab=tests'), 'IAC-06');
  assert.equal(returnLabel('/a/b%20c'), 'b c');
  assert.equal(returnLabel(null), null);
  assert.equal(returnLabel('/'), null);
});

test('the address: the old links keep working, the other parameters (the Administration tab) are left alone', () => {
  const state = readAddress(CONNECTIONS_SCHEMA, '?tab=evidence-collectors&connector=aws&return=/automation/soc2-controls/IAC-06&show=failing&q=okta&category=identity');
  assert.deepEqual({ ...state }, { show: 'failing', q: 'okta', category: 'identity', connector: 'aws', return: '/automation/soc2-controls/IAC-06' });
  assert.equal(readAddress(CONNECTIONS_SCHEMA, '?show=bogus').show, 'auto');
  assert.equal(writeAddress(CONNECTIONS_SCHEMA, '?tab=evidence-collectors', { ...state, connector: '', return: '', show: 'auto', q: '', category: '' }), 'tab=evidence-collectors');
});

test('the words of a connection are registered', () => {
  assert.ok(isActive(list[0]));
});
