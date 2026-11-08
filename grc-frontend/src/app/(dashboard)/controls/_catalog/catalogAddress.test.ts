// node --test "src/app/(dashboard)/controls/_catalog/catalogAddress.test.ts"
// The Control Catalog's address: the links that already existed keep working (?mode=internal, ?promote=1, and ?framework=<id>, which the Frameworks pages link and only the retired Workbench read),
// every state is one address, and a value the page cannot be in is the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { CATALOG_SCHEMA, attentionPatch, filterPatch, modePatch, openDomainPatch, pageOf, viewPatch } from './catalogAddress.ts';

const read = (search: string) => readAddress(CATALOG_SCHEMA, search);
const page = (search: string) => pageOf(read(search));

test('the plain address is the hub of the framework controls', () => {
  const p = page('');
  assert.deepEqual([p.mode, p.view, p.openDomain, p.page, p.promote], ['framework', 'domain', '', 1, false]);
  assert.equal(writeAddress(CATALOG_SCHEMA, '', read('')), '');
});

test('/controls?mode=internal (the Risk Management redirect) opens the internal controls', () => {
  assert.equal(page('?mode=internal').mode, 'internal');
  assert.equal(page('?mode=junk').mode, 'framework');
});

test('/controls?promote=1 (the Library\'s Promote to Catalog) opens the Add-from-Library sheet', () => {
  assert.equal(page('?promote=1').promote, true);
  assert.equal(page('').promote, false);
});

test('/controls?framework=<id> (View requirements) opens All controls filtered to that framework', () => {
  const p = page('?framework=12');
  assert.equal(p.view, 'all');
  assert.equal(p.filters.framework, '12');
  assert.equal(page('?framework=abc').view, 'domain', 'junk is no framework');
  assert.equal(page('?framework=abc').filters.framework, '');
  assert.equal(page('?framework=007').filters.framework, '7');
  assert.equal(page('?view=mine&framework=12').view, 'mine', 'a view the address names itself wins');
  assert.equal(page('?view=mine&framework=12').filters.framework, '', 'and only All controls carries filters');
});

test('an open domain belongs to the hub; the same name is a filter in All controls', () => {
  assert.equal(page('?view=domain&domain=Risk').openDomain, 'Risk');
  assert.equal(page('?view=all&domain=Risk').openDomain, '');
  assert.equal(page('?view=all&domain=Risk').filters.domain, 'Risk');
});

test('every filter reads back from the address', () => {
  const p = page('?view=all&q=mfa&source=internal&progress=in_progress&effectiveness=ineffective&due=overdue&page=3');
  assert.deepEqual(p.filters, { source: 'internal', q: 'mfa', framework: '', domain: '', progress: 'in_progress', effectiveness: 'ineffective', due: 'overdue' });
  assert.equal(p.page, 3);
  assert.equal(page('?view=all&progress=bogus&page=0&due=soon').filters.progress, '');
  assert.equal(page('?view=all&page=0').page, 1);
});

test('picking a tab or a source starts clean', () => {
  const dirty = { ...read('?view=all&q=x&framework=3&due=overdue&page=4') };
  const next = { ...dirty, ...viewPatch('mine') };
  assert.deepEqual([next.view, next.q, next.framework, next.due, next.page], ['mine', '', '', '', 1]);
  const m = { ...dirty, ...modePatch('internal') };
  assert.deepEqual([m.mode, m.view, m.q], ['internal', 'domain', '']);
});

test('a click on a "needs attention" row opens All controls with the filter, and nothing else', () => {
  const base = read('?view=domain&domain=Risk&q=x');
  const a = { ...base, ...attentionPatch('overdue') };
  assert.deepEqual([a.view, a.due, a.effectiveness, a.domain, a.q], ['all', 'overdue', '', '', '']);
  const b = { ...base, ...attentionPatch('partial') };
  assert.deepEqual([b.view, b.effectiveness, b.due], ['all', 'partially_effective', '']);
  assert.equal(writeAddress(CATALOG_SCHEMA, '', { ...read(''), ...attentionPatch('ineffective') }), 'view=all&effectiveness=ineffective');
});

test('changing a filter goes back to page one; opening a domain is a domain address', () => {
  const p = read('?view=all&page=5');
  assert.equal({ ...p, ...filterPatch({ q: 'a' }) }.page, 1);
  assert.equal(writeAddress(CATALOG_SCHEMA, '', { ...read(''), ...openDomainPatch('Risk and exposure') }), 'domain=Risk+and+exposure');
});

test('the address of a state does not drop the params it does not own', () => {
  assert.equal(writeAddress(CATALOG_SCHEMA, '?utm=1', { ...read(''), ...viewPatch('mine') }), 'utm=1&view=mine');
});
