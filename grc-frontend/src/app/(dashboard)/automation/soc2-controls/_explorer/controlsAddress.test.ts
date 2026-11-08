// node --test "src/app/(dashboard)/automation/soc2-controls/_explorer/controlsAddress.test.ts"
// The Controls explorer's address: every state is one address and back, the links that already exist keep working, junk is the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../../lib/addressState.ts';
import { EXPLORER_SCHEMA, arrivedPatch, explorerHref, filtersPatch, pageOf, type ExplorerAddress } from './controlsAddress.ts';
import { NO_FILTERS } from './controlsFacets.ts';
import { DEFAULT_SORT } from './controlsModel.ts';

const read = (search: string) => readAddress(EXPLORER_SCHEMA, search) as ExplorerAddress;

test('the plain address is the default state', () => {
  const page = pageOf(read(''));
  assert.deepEqual(page.filters, NO_FILTERS);
  assert.deepEqual(page.sort, DEFAULT_SORT);
  assert.equal(page.view, 'list');
  assert.equal(page.scope, 'in_scope');
  assert.equal(page.arrive.configureScope, false);
});

test('a state is one address and back', () => {
  const state = read('?q=access&status=failed,expired&fw=soc2&domain=Identity&owner=7&type=Automated&origin=custom&quick=mine&sort=status:desc&view=board&scope=all');
  const page = pageOf(state);
  assert.deepEqual(page.filters, { search: 'access', status: ['failed', 'expired'], framework: ['soc2'], domain: ['Identity'], type: ['Automated'], owner: ['7'], origin: ['custom'], quick: 'mine' });
  assert.deepEqual(page.sort, { key: 'status', dir: 'desc' });
  assert.equal(page.view, 'board');
  assert.equal(page.scope, 'all');
  assert.deepEqual(read(writeAddress(EXPLORER_SCHEMA, '', state)), state);
});

test('junk in the address is the default, never a state the page cannot be in', () => {
  const page = pageOf(read('?quick=bogus&sort=nope:up&view=cloud&scope=everything'));
  assert.equal(page.filters.quick, null);
  assert.deepEqual(page.sort, DEFAULT_SORT);
  assert.equal(page.view, 'list');
  assert.equal(page.scope, 'in_scope');
});

test('?configure=scope opens the scope dialog once, and the link is taken out of the address afterwards', () => {
  const state = read('?configure=scope&q=x');
  assert.equal(pageOf(state).arrive.configureScope, true);
  const after = { ...state, ...arrivedPatch() };
  assert.equal(writeAddress(EXPLORER_SCHEMA, '', after), 'q=x');
});

test('the old ?source=custom link is the origin facet', () => {
  assert.deepEqual(pageOf(read('?source=custom')).filters.origin, ['custom']);
  assert.deepEqual(pageOf(read('?source=scf&origin=custom')).filters.origin, ['custom', 'scf']);
  assert.deepEqual(pageOf(read('?source=weird')).filters.origin, []);
  const patch = filtersPatch({ ...NO_FILTERS, origin: ['custom'] });
  assert.equal(patch.source, '', 'a change of filters drops the old link');
});

test('a link from another page (the Overview\'s counters, a domain) opens the explorer on what it counts', () => {
  assert.equal(explorerHref({}), '/automation/soc2-controls');
  assert.equal(explorerHref({ quick: 'failing' }), '/automation/soc2-controls?quick=failing');
  assert.equal(explorerHref({ quick: 'all' }), '/automation/soc2-controls');
  assert.equal(explorerHref({ status: ['expired', 'collection_failed'] }), '/automation/soc2-controls?status=expired%2Ccollection_failed');
  assert.equal(explorerHref({ domain: 'Identity & Access' }), '/automation/soc2-controls?domain=Identity+%26+Access');
  const page = pageOf(read(explorerHref({ status: ['expired', 'collection_failed'], domain: 'Identity & Access', scope: 'all' }).split('?')[1] ? `?${explorerHref({ status: ['expired', 'collection_failed'], domain: 'Identity & Access', scope: 'all' }).split('?')[1]}` : ''));
  assert.deepEqual(page.filters.status, ['expired', 'collection_failed']);
  assert.deepEqual(page.filters.domain, ['Identity & Access']);
  assert.equal(page.scope, 'all');
});
