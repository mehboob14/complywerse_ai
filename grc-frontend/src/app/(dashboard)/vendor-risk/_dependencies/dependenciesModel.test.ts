// node --test "src/app/(dashboard)/vendor-risk/_dependencies/dependenciesModel.test.ts"
// Dependencies: Technology and Concentration in one page. The old addresses name views; a CVE typed in the search is recognised; shared flaws come first; a request for a supplier nobody
// recorded goes through Intake with its name (no vendor is created from a bare name).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DISMISS_SAYS, VIEWS, VIEW_LABEL, aliasSays, cveOf, dependantLabel, foundBy, platformLine, requestHref, sharedFirst, viewFrom, type SharedVuln } from './dependenciesModel.ts';

test('the views an address can name, and the old Concentration page\'s word', () => {
  assert.deepEqual(VIEWS, ['technology', 'platforms', 'vulnerabilities', 'unregistered']);
  assert.equal(viewFrom('platforms'), 'platforms');
  assert.equal(viewFrom(' Unregistered '), 'unregistered');
  assert.equal(viewFrom('concentration'), 'platforms');
  assert.equal(viewFrom('nonsense'), 'technology');
  assert.equal(viewFrom(null), 'technology');
  VIEWS.forEach((v) => assert.ok(VIEW_LABEL[v].length > 3));
});

test('a CVE id typed in the search box is found in any case, and nothing else is one', () => {
  assert.equal(cveOf('cve-2024-3400'), 'CVE-2024-3400');
  assert.equal(cveOf('  CVE-2021-44228 '), 'CVE-2021-44228');
  assert.equal(cveOf('WordPress'), null);
  assert.equal(cveOf('cve-24-1'), null);
});

test('flaws that hit more than one supplier come first, each group in the server\'s order', () => {
  const v = (cve: string, n: number): SharedVuln => ({ cve, title: null, severity: 'high', occurred_at: null, vendors: Array.from({ length: n }, (_, i) => ({ id: i, name: `S${i}`, tier: null, signal_id: i, acknowledged: false })) });
  assert.deepEqual(sharedFirst([v('a', 1), v('b', 3), v('c', 1), v('d', 2)]).map((x) => x.cve), ['b', 'd', 'a', 'c']);
  assert.deepEqual(sharedFirst([]), []);
});

test('words: a platform line, a dependant that is critical, what an alias says, where a supplier was found', () => {
  assert.equal(platformLine({ vendor_count: 3, critical_count: 1 }), '3 suppliers · 1 critical');
  assert.equal(platformLine({ vendor_count: 1, critical_count: 0 }), '1 supplier');
  assert.equal(dependantLabel({ name: 'Acme', critical_dependency: true }), 'Acme · critical dependency');
  assert.equal(dependantLabel({ name: 'Acme', critical_dependency: false }), 'Acme');
  assert.equal(aliasSays({ alias: 'AWS', platform: 'Amazon Web Services', excluded: false }), '“AWS” means Amazon Web Services');
  assert.equal(aliasSays({ alias: 'Acme', platform: null, excluded: true }), '“Acme” is not counted');
  assert.equal(foundBy({ asset_count: 1, sources: ['Asset discovery'] }), '1 asset · Asset discovery');
  assert.equal(foundBy({ asset_count: 4, sources: [] }), '4 assets');
  assert.match(DISMISS_SAYS, /shared platforms/);
});

test('a supplier nobody recorded is requested through Intake with its name, never created from a bare name', () => {
  assert.equal(requestHref('Acme & Sons, Ltd'), '/vendor-risk/intake?request=1&name=Acme%20%26%20Sons%2C%20Ltd');
  assert.ok(requestHref('x').startsWith('/vendor-risk/intake?request=1'));
});
