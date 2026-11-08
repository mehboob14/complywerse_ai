// node --test src/components/layout/navActive.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { activeNavHref, cleanPath, groupHasActive, underPath } from './navActive.ts';
import { flattenLeaves, isGroup, navigation, type NavEntry, type NavGroup } from './navAccess.ts';

const icon = (() => null) as never;                                  // the icon is not read here
const leaf = (href: string, extra: Record<string, unknown> = {}) => ({ name: href, href, icon, ...extra }) as NavEntry;
const group = (name: string, items: NavEntry[]) => ({ name, items }) as NavEntry;

test('a path is under a prefix on whole path segments, not on characters', () => {
  assert.ok(underPath('/governance/documents', '/governance/documents'));
  assert.ok(underPath('/governance/documents/3', '/governance/documents'));
  assert.ok(!underPath('/governance/documentsX', '/governance/documents'));
  assert.ok(!underPath('/governance', '/governance/documents'));
});

test('a path loses its query, hash and trailing slash', () => {
  assert.equal(cleanPath('/governance/documents/3?tab=approvals#top'), '/governance/documents/3');
  assert.equal(cleanPath('/governance/documents/'), '/governance/documents');
  assert.equal(cleanPath('/'), '/');
  assert.equal(cleanPath(''), '/');
});

test('the deepest entry wins, across groups; a tie goes to the first in menu order', () => {
  const tree = [group('A', [leaf('/x'), leaf('/x/y')]), group('B', [leaf('/x/y/z'), leaf('/x/y/z', { name: 'twin' })])];
  assert.equal(activeNavHref('/x', tree), '/x');
  assert.equal(activeNavHref('/x/q', tree), '/x');
  assert.equal(activeNavHref('/x/y/1', tree), '/x/y');
  assert.equal(activeNavHref('/x/y/z/9', tree), '/x/y/z');
  assert.equal(flattenLeaves(tree).filter((l) => l.name === 'twin').length, 1);
});

test('an exact entry lights on its own page only', () => {
  const tree = [leaf('/g', { exact: true }), leaf('/g/docs')];
  assert.equal(activeNavHref('/g', tree), '/g');
  assert.equal(activeNavHref('/g/docs/3', tree), '/g/docs');
  assert.equal(activeNavHref('/g/other', tree), undefined);
});

test('activeMatch adds prefixes (one, or a list) to the entry\'s own href; they are prefixes even on an exact entry', () => {
  const tree = [leaf('/g', { exact: true, activeMatch: ['/g/a', '/g/b'] }), leaf('/h', { activeMatch: '/hh' })];
  assert.equal(activeNavHref('/g', tree), '/g');
  assert.equal(activeNavHref('/g/a', tree), '/g');
  assert.equal(activeNavHref('/g/b/7/edit', tree), '/g');
  assert.equal(activeNavHref('/g/c', tree), undefined);
  assert.equal(activeNavHref('/hh/2', tree), '/h');
  assert.equal(activeNavHref('/h/2', tree), '/h');
});

test('nothing lights for an unknown page, an empty path or a path that only shares characters', () => {
  assert.equal(activeNavHref('/nowhere', navigation), undefined);
  assert.equal(activeNavHref('', navigation), undefined);
  assert.equal(activeNavHref(null, navigation), undefined);
  assert.equal(activeNavHref('/governance/documentsX', navigation), undefined);
});

test('a group holds the lit entry at any depth', () => {
  const risk = navigation.find((e) => isGroup(e) && e.name === 'Risk Management') as NavGroup;
  assert.ok(groupHasActive(risk, '/erm/risks'), 'inside the Operational Risk sub-group');
  assert.ok(groupHasActive(risk, '/erm'));
  assert.ok(!groupHasActive(risk, '/governance'));
  assert.ok(!groupHasActive(risk, undefined));
});

// ---- the real menu ----

const leaves = flattenLeaves(navigation);

test('no two entries share a page, so a lit entry is never two', () => {
  const hrefs = leaves.map((l) => l.href);
  assert.deepEqual(hrefs.filter((h, i) => hrefs.indexOf(h) !== i), []);
});

test('every entry lights on its own page, and on the pages under it unless it is exact', () => {
  for (const l of leaves) {
    assert.equal(activeNavHref(l.href, navigation), l.href, `${l.name} on ${l.href}`);
    const under = activeNavHref(`${l.href}/12`, navigation);
    if (l.exact) assert.notEqual(under, l.href, `${l.name} is exact: it must not light on ${l.href}/12`);
    else assert.equal(under, l.href, `${l.name} on ${l.href}/12`);
  }
});

test('every Overview (and the dashboard) lights on its own page only, but Assessments: /assessments/<framework> is its own family', () => {
  const overviews = leaves.filter((l) => l.name === 'Overview' || l.name === 'Performance Overview');
  assert.ok(overviews.length >= 6, 'the Overview entries are there (Business Continuity is one leaf now, with no Overview of its own)');
  for (const l of overviews) assert.equal(!!l.exact, l.href !== '/assessments', `${l.name} (${l.href})`);
});

// The pages of an area that have no entry of their own lit its Overview before the Overview became exact (Phase 1 changes nothing outside
// Governance), so each is mapped to it by the narrowest prefix: path (dynamic ids as 1) -> the entry that lights
const OVERVIEW_PAGES: Array<[string, string]> = [
  ['/erm/ai-risk-assessment', '/erm'],
  ['/erm/dependencies', '/erm'],
  ['/erm/framework-controls/1', '/erm'],
  ['/erm/internal-controls', '/erm'],
  ['/erm/internal-controls/1', '/erm'],
  ['/erm/reports', '/erm'],
  ['/erm/reviews', '/erm'],
  ['/compliance/assessments', '/compliance'],
  ['/compliance/assessments/1', '/compliance'],
  ['/compliance/assessments/approvals', '/compliance'],
  ['/compliance/statements', '/compliance'],
  ['/assessments/1', '/assessments'],
];

test('the 12 pages with no entry of their own still light their area\'s Overview', () => {
  assert.equal(OVERVIEW_PAGES.length, 12);
  for (const [path, want] of OVERVIEW_PAGES) assert.equal(activeNavHref(path, navigation), want, path);
});

test('the mapping is the narrow one: a page that is not listed lights nothing, and an entry of its own still wins', () => {
  assert.equal(activeNavHref('/erm/not-a-page', navigation), undefined);
  assert.equal(activeNavHref('/compliance/not-a-page', navigation), undefined);
  assert.equal(activeNavHref('/erm/risks/12', navigation), '/erm/risks');
  assert.equal(activeNavHref('/erm/incidents', navigation), '/erm/incidents');
  assert.equal(activeNavHref('/compliance/access-reviews/4', navigation), '/compliance/access-reviews');
  assert.equal(activeNavHref('/assessments/dpia', navigation), '/assessments', 'the old type address forwards; the Assessments Overview is lit for the moment it is there');
  assert.equal(activeNavHref('/assessments/register', navigation), '/assessments/register');
  assert.equal(activeNavHref('/assessments/types', navigation), '/assessments/types');
  assert.equal(activeNavHref('/cyber-security/questionnaires/7', navigation), '/assessments/types', 'a type\'s questionnaire is opened from Types');
  assert.equal(activeNavHref('/cyber-security', navigation), '/assessments');
  assert.equal(activeNavHref('/nca', navigation), '/assessments');
});

test('every activeMatch prefix is a folder of the app: a typo would leave its pages unlit', () => {
  for (const l of leaves) {
    for (const prefix of ([] as string[]).concat(l.activeMatch ?? [])) assert.ok(existsSync(`src/app/(dashboard)${prefix}`), `${l.name}: ${prefix}`);
  }
});

// The Governance routes of G1_url_contracts.md (the page a link opens -> the one entry that lights)
const DOCUMENTS = '/governance/documents';
const CONTRACT: Array<[string, string | undefined]> = [
  ['/governance', '/governance'],
  [DOCUMENTS, DOCUMENTS],
  ['/governance/documents/44', DOCUMENTS],
  ['/governance/documents/studio', DOCUMENTS],
  ['/governance/documents/studio/12', DOCUMENTS],
  ['/governance/documents/attestation', DOCUMENTS],
  ['/governance/exceptions', DOCUMENTS],
  ['/governance/settings', DOCUMENTS],
  ['/governance/reviews', DOCUMENTS],
  ['/governance/reviews/calendar', DOCUMENTS],
  ['/governance/mappings', DOCUMENTS],
  ['/governance/workflows', DOCUMENTS],
  ['/governance/attestations', DOCUMENTS],
  ['/governance/attestations/campaigns', DOCUMENTS],
  ['/governance/attestations/campaigns/4', DOCUMENTS],
  ['/governance/attestations/complete/4', DOCUMENTS],
  ['/governance/attestations/my', DOCUMENTS],
  ['/governance/approvals', '/needs-my-action'],                      // the old address forwards to the queue and lights it
  ['/governance/committees', '/governance/committees'],
  ['/governance/committees/actions', '/governance/committees'],
  ['/governance/committees/3', '/governance/committees'],
  ['/governance/committees/meetings/9', '/governance/committees'],
  ['/governance/kpi-report', '/governance/kpi-report'],
  ['/governance/regulatory-changes', '/governance/regulatory-changes'],
  ['/governance/regulatory-changes/5', '/governance/regulatory-changes'],
  ['/governance/regulatory-feeds', '/governance/regulatory-changes'],           // the Feed is a tab of Regulatory Changes: one leaf lights for both
  ['/erm/kris', '/erm/kris'],
  ['/is-projects', '/is-projects'],
  ['/is-projects/dashboard', '/is-projects'],
  ['/is-projects/my-projects', '/is-projects'],
  ['/is-projects/7', '/is-projects'],
  ['/dashboard', '/dashboard'],
  ['/attest/abc123', undefined],                                      // the public page is outside the shell
];

test('the Governance URLs of the contract each light the one entry that is theirs', () => {
  for (const [path, want] of CONTRACT) assert.equal(activeNavHref(path, navigation), want, path);
});

test('the pages of an Overview\'s area light the entries beside it, never the Overview', () => {
  assert.notEqual(activeNavHref('/governance/exceptions', navigation), '/governance');
  assert.notEqual(activeNavHref('/erm/kris', navigation), '/erm');
  assert.notEqual(activeNavHref('/erm/risks/12', navigation), '/erm');
  assert.notEqual(activeNavHref('/compliance/access-reviews/4', navigation), '/compliance');
  assert.equal(activeNavHref('/compliance/access-reviews/4', navigation), '/compliance/access-reviews');
  assert.equal(activeNavHref('/erm/analytics/scenario', navigation), '/erm/analytics/scenario', 'the deeper entry beats Advanced Analytics');
  assert.equal(activeNavHref('/erm/analytics/heatmap', navigation), '/erm/analytics');
});

test('Regulatory Changes and Feeds belong to Compliance Management alone: Governance does not light with them', () => {
  const find = (name: string) => navigation.find((e) => isGroup(e) && e.name === name) as NavGroup;
  for (const path of ['/governance/regulatory-changes', '/governance/regulatory-changes/5', '/governance/regulatory-feeds']) {
    const lit = activeNavHref(path, navigation);
    assert.ok(groupHasActive(find('Compliance Management'), lit), `${path}: Compliance Management`);
    assert.ok(!groupHasActive(find('Governance'), lit), `${path}: not Governance`);
  }
});

test('the Documents area keeps the Governance group open; Task Management and the dashboard are single entries', () => {
  const governance = navigation.find((e) => isGroup(e) && e.name === 'Governance') as NavGroup;
  for (const [path, want] of CONTRACT) if (want === DOCUMENTS) assert.ok(groupHasActive(governance, activeNavHref(path, navigation)), path);
  assert.equal(activeNavHref('/tasks/my-tasks', navigation), '/tasks');
  assert.equal(activeNavHref('/dashboard/anything', navigation), undefined);
});

test('exactly one entry is lit for every page of the menu and every page under it', () => {
  const paths = [...leaves.map((l) => l.href), ...leaves.map((l) => `${l.href}/1`), ...CONTRACT.map(([p]) => p)];
  for (const path of paths) {
    const lit = activeNavHref(path, navigation);
    assert.ok(leaves.filter((l) => l.href === lit).length <= 1, path);
  }
});
