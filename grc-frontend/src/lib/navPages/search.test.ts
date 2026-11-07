// node --test "src/lib/navPages/search.test.ts"
// What the command palette and the Work panel call: fold (case, accents and Arabic vowel signs do not matter), searchRoutes (a stable ranking: a name that starts with the query, then a word of
// a name, then inside a name, then the same for the names a page used to go by, then the path), pagesForArea (the openable pages of one module). Nothing here reads the rights of a person:
// `allow` is the caller's, and it is applied before the limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { areaName, fold, pagesForArea, routes, searchRoutes, type RouteEntry } from '../navRegistry.ts';

const paths = (list: RouteEntry[]) => list.map((e) => e.path);
const find = (query: string, limit = 50) => paths(searchRoutes(query, { limit }));

test('fold: lower case, no accents, no Arabic vowel signs or tatweel; Latin text folds like the kit\'s fold', () => {
  assert.equal(fold('Café Zürich'), 'cafe zurich');
  assert.equal(fold('KRIs'), 'kris');
  assert.equal(fold('İstanbul'), 'istanbul', 'a dotted capital I folds to i');
  assert.equal(fold('الْمَخَاطِر'), fold('المخاطر'), 'Arabic vowel signs (tashkeel) are dropped');
  assert.equal(fold('المخـــاطر'), fold('المخاطر'), 'and so is tatweel');
  assert.equal(fold('أمن'), fold('امن'), 'an alef with hamza folds to alef');
  assert.equal(fold('ﬁnance'), 'finance', 'a ligature is spelled out');
  assert.equal(fold(''), '');
  assert.doesNotThrow(() => fold('😀 \u0000 \ud800'), 'odd input never throws');
});

test('the ranking: a name that starts with the query beats a word inside a name, which beats the middle of a word, which beats an old name, which beats the path', () => {
  const kri = find('kri');
  assert.equal(kri[0], '/erm/kris', 'KRIs starts with it');
  assert.ok(kri.indexOf('/erm/analytics/kri-triggers') > kri.indexOf('/erm/kris'), '"Automated KRI Triggers" has it as a word: after');
  // "register": the name Register of the vendor tab first (a short label counts as a name), then the names with the word, the menu's leaf before the page under it
  const register = find('register');
  assert.equal(register[0], '/vendor-risk/vendors');
  assert.ok(register.indexOf('/erm/risks') >= 0 && register.indexOf('/erm/risks') < register.indexOf('/erm/risks/list'), 'equal matches keep registry order: the leaf before its page');
  assert.equal(find('Risk Register')[0], '/erm/risks', 'the whole name first');
  assert.equal(find('risk register')[0], '/erm/risks', 'case does not matter');
  assert.equal(find('  RISK   register ')[0], '/erm/risks', 'nor spaces');
  // an old name: "Board & Committee Management" finds Committees, and a word that starts a keyword beats the middle of another page's name ("Dashboard")
  assert.equal(find('board')[0], '/governance/committees');
  assert.ok(find('board').indexOf('/governance/committees') < find('board').indexOf('/evidence/coverage'));
  assert.ok(find('teams').includes('/admin'));
  // a part of a path
  assert.ok(find('kri-triggers').includes('/erm/analytics/kri-triggers'));
  assert.deepEqual(find('zzzz'), []);
  assert.deepEqual(find(''), []);
  assert.deepEqual(find('   '), []);
  assert.deepEqual(find('!!!'), [], 'only punctuation finds nothing');
});

test('the list is stable: the same query gives the same order, equals keep registry order (the menu first), and the limit cuts it', () => {
  assert.deepEqual(find('overview'), find('overview'));
  const overview = searchRoutes('overview', { limit: 100 });
  const order = overview.map((e) => routes.indexOf(e));
  const names = overview.map((e) => [e.label, e.title].map((n) => (n ?? '').toLowerCase()));
  assert.ok(overview.length >= 5, 'every module has an Overview');
  // among entries with the same rank the registry order holds: rank 0 (a name equal to the query) come first and are in registry order
  const exact = overview.filter((e) => e.label.toLowerCase() === 'overview');
  assert.deepEqual(exact.map((e) => routes.indexOf(e)), exact.map((e) => routes.indexOf(e)).sort((a, b) => a - b));
  assert.equal(order[0], routes.indexOf(exact[0]), 'an exact name is first');
  assert.ok(names.length === overview.length);
  assert.equal(searchRoutes('overview', { limit: 3 }).length, 3);
  assert.deepEqual(find('overview', 3), find('overview').slice(0, 3));
});

test('only pages a person can open: no record page (:param), no forward, no older copy; and `allow` is applied before the limit', () => {
  for (const query of ['assessment', 'risk', 'vendor', 'asset', 'vulnerab', 'admin', 'user', 'control', 'report']) {
    for (const e of searchRoutes(query, { limit: 500 })) {
      assert.ok(!e.path.includes(':'), `${e.path} is a record page`);
      assert.equal(e.aliasOf, undefined, `${e.path} is a forward`);
      assert.equal(e.duplicateOf, undefined, `${e.path} is an older copy`);
    }
  }
  // the older copy and the sidebar's page have the same name: only the sidebar's is offered
  assert.deepEqual(find('it asset inventory').filter((p) => /assets$/.test(p)), ['/cyber-assurance/assets']);
  assert.ok(!find('document library').includes('/documents'));
  assert.ok(!find('shadow').includes('/vendor-risk/shadow-saas'), 'a forward is not offered; its target is');
  // allow: people without the right see fewer pages, and the limit counts what they may see
  const open = searchRoutes('risk', { limit: 5, allow: (e) => !e.path.startsWith('/erm') });
  assert.equal(open.length, 5);
  assert.ok(open.every((e) => !e.path.startsWith('/erm')));
  assert.deepEqual(searchRoutes('kris', { allow: () => false }), []);
});

test('the palette finds the pages by the names people use: acronyms, old names, tab names, the other language of a module', () => {
  assert.equal(find('KRI')[0], '/erm/kris');
  assert.ok(find('DPIA').includes('/assessments/dpia'));
  assert.ok(find('PDPL').includes('/assessments/pdpl'));
  assert.ok(find('rcsa').includes('/erm/rcsa'));
  assert.ok(find('TPRM').includes('/vendor-risk'));
  assert.ok(find('sso').includes('/admin'), 'a section of the Administration page is a keyword of it');
  assert.ok(find('token usage').includes('/admin/ai-usage'));
  assert.ok(find('breach alerts').includes('/vendor-risk/alerts'));
  assert.ok(find('governance overview').includes('/governance'), 'every word somewhere in the name, groups and path');
  assert.ok(find('risk management appetite').includes('/erm/appetite'), 'a module name and a page name together');
  assert.ok(find('complychat').includes('/complychat'));
  assert.ok(find('evidence requirements').includes('/evidence-requirements'), 'a page no link opens is still found');
});

test('pagesForArea: the openable pages of one module, the menu\'s leaves first in menu order, every other page after', () => {
  const risk = pagesForArea('risk-management');
  assert.ok(risk.length >= 15);
  assert.deepEqual(paths(risk).slice(0, 3), ['/erm', '/erm/risks', '/erm/risk-assessments'], 'the sidebar order (the Risk Library left the menu with D64)');
  assert.ok(risk.every((e) => e.area === 'risk-management' && !e.path.includes(':') && !e.aliasOf && !e.duplicateOf));
  assert.ok(paths(risk).includes('/erm/appetite') && !paths(risk).includes('/erm/risks/:id') && !paths(risk).includes('/erm/risks/dashboard'));
  const vendor = pagesForArea('third-party-vendor-risk');
  assert.equal(paths(vendor)[0], '/vendor-risk');
  assert.ok(paths(vendor).includes('/vendor-risk/policy') && !paths(vendor).includes('/vendor-risk/shadow-saas'));
  assert.deepEqual(pagesForArea('nowhere'), []);
  // the cyber groups list their own pages and none of the older copies
  const itAsset = paths(pagesForArea('it-asset'));
  assert.deepEqual(itAsset.slice(0, 4), ['/cyber-assurance/asset-discovery', '/cyber-assurance/assets', '/cyber-assurance/licenses', '/cyber-assurance/risk-posture']);
  const cyber = paths(pagesForArea('cybersecurity'));
  assert.deepEqual(cyber.slice(0, 3), ['/cyber-assurance/vulnerabilities', '/cyber-assurance/advisories', '/cyber-assurance/pentest']);
  assert.ok(cyber.includes('/cyber-assurance/scan-flows'), 'scanning lives inside Vulnerabilities');
  assert.ok(!itAsset.includes('/assets') && !cyber.includes('/vulnerabilities') && !cyber.includes('/cyber-assurance/admin'));
  assert.deepEqual(paths(pagesForArea('help-desk')).slice(0, 2), ['/cyber-assurance/helpdesk/dashboard', '/cyber-assurance/helpdesk/tickets']);
  // every area an entry uses has a display name
  for (const area of Array.from(new Set(routes.map((e) => e.area)))) assert.ok(areaName(area), `${area} has no display name`);
  assert.equal(areaName('administration'), 'Administration');
  assert.equal(areaName('no-such-area'), '');
});
