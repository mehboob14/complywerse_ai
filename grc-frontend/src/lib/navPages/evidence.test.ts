// node --test "src/lib/navPages/evidence.test.ts"
// The navigation-registry entries of the Evidence Management group's own pages (`/evidence` and `/evidence-requirements`; the item page, the audit packages and the
// coverage page belong to the next builders and stay commented out of navPages/evidence.ts): every page of the two folders that is declared has exactly one entry, every
// entry that says it draws its own heading has a page that does, the page's heading is the registry's name, and the top bar names the section.
// `/evidence-requirements` is written in navPages/evidence.ts but not enabled: the registry's rules need the Evidence Management leaf in navAccess.ts to carry
// `activeMatch: '/evidence-requirements'` first (see the comment there); this test holds that state, and keeps holding once the line is enabled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { activeNavHref } from '../../components/layout/navActive.ts';
import { navigation } from '../../components/layout/navAccess.ts';
import { ownHeadingSection, registryNamesPage, routeFor, routes, titleFor } from '../navRegistry.ts';
import { LEAVES, PAGES } from './evidence.ts';

const DASHBOARD = fileURLToPath(new URL('../../app/(dashboard)/', import.meta.url));
const NOT_MINE = ['[id]', 'audit-packages', 'coverage'];            // the other Evidence builders' pages (and their folders)

/** `evidence-requirements/page.tsx` -> `/evidence-requirements`, `evidence/page.tsx` -> `/evidence`, for the folders this group owns. */
function ownPages(): string[] {
  const out: string[] = [];
  const walk = (folder: string, base: string) => {
    if (existsSync(`${DASHBOARD}${folder}/page.tsx`)) out.push(base);
    for (const entry of readdirSync(`${DASHBOARD}${folder}`, { withFileTypes: true })) {
      if (entry.isDirectory() && !NOT_MINE.includes(entry.name) && !entry.name.startsWith('_')) walk(`${folder}/${entry.name}`, `${base}/${entry.name}`);
    }
  };
  walk('evidence', '/evidence');
  walk('evidence-requirements', '/evidence-requirements');
  return out;
}

const pageFile = (path: string) => readFileSync(`${DASHBOARD}${path.slice(1)}/page.tsx`, 'utf8');
const entry = (path: string) => routes.filter((e) => e.path === path);
const REQUIREMENTS = '/evidence-requirements';

test('the two folders hold the two pages; /evidence is a sidebar leaf; the other Evidence builders\' pages are not declared here', () => {
  assert.deepEqual(ownPages().sort(), ['/evidence', REQUIREMENTS]);
  assert.equal(entry('/evidence').length, 1, 'the sidebar leaf is the entry');
  assert.ok(entry(REQUIREMENTS).length <= 1, 'declared at most once');
  assert.deepEqual(PAGES.map((p) => p.path).filter((p) => p !== REQUIREMENTS), [], 'only this group\'s own page is declared in PAGES; the others stay commented out for their builders');
  for (const skeleton of ['/evidence/:id', '/evidence/audit-packages', '/evidence/coverage']) assert.equal(entry(skeleton).length, 0, `${skeleton} is the next builder's`);
});

test('the requirements catalogue entry, once enabled, is what the code says: no link opens it, it hangs under Evidence Management, it draws its own heading', () => {
  const declared = entry(REQUIREMENTS)[0];
  const sidebarReady = activeNavHref(REQUIREMENTS, navigation) === '/evidence';
  if (!declared) {
    assert.equal(sidebarReady, false, 'the entry is waiting for navAccess.ts: when the leaf lights this page, enable the entry in navPages/evidence.ts');
    assert.equal(ownHeadingSection(REQUIREMENTS), undefined);
    return;
  }
  assert.equal(declared.label, 'Evidence requirements');
  assert.equal(declared.area, 'compliance-management');
  assert.equal(declared.parent, '/evidence');
  assert.match(declared.hidden ?? '', /no link opens it/);
  assert.equal(declared.ownHeading, true);
  assert.equal(sidebarReady, true, 'the page lights the menu entry it hangs under');
  assert.equal(ownHeadingSection(REQUIREMENTS), 'Compliance Management');
  assert.equal(registryNamesPage(REQUIREMENTS), true);
  assert.equal(titleFor(REQUIREMENTS), 'Evidence requirements');
  assert.equal(routeFor(`${REQUIREMENTS}/`)?.path, REQUIREMENTS, 'a trailing slash is the same page');
});

test('an entry that says it draws its own heading has a page that does, with the registry\'s name as its heading', () => {
  for (const path of ownPages()) {
    const e = entry(path)[0];
    if (!e || !e.ownHeading) continue;
    const source = pageFile(path);
    assert.match(source, /<PageHeader\s+variant="page"/, `${path} draws the kit's page head`);
    assert.ok(source.includes(`title="${e.label}"`), `${path}: the heading is "${e.label}"`);
  }
  // the catalogue's page head is written to the registry's name whether or not its entry is enabled yet
  assert.match(pageFile(REQUIREMENTS), /<PageHeader\s+variant="page"\s+title="Evidence requirements"/);
});

test('the group file declares leaves only for pages that moved to the kit (each with ownHeading)', () => {
  for (const [path, extra] of Object.entries(LEAVES)) assert.equal(extra.ownHeading, true, `${path}: a leaf of this group is declared when its page draws the kit head`);
});
