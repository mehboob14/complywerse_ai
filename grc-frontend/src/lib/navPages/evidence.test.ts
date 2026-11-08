// node --test "src/lib/navPages/evidence.test.ts"
// The navigation-registry entries of the Evidence Management pages: every page.tsx under the two folders has exactly one entry, every entry that says it draws its own heading has a page that
// does (with the registry's name as its heading), the top bar names the section for those, the sidebar's Evidence Management leaf lights the Requirements page, and the three pages that are
// not the leaf say where they open from (the strip of tabs under the head is page-local, so none of them is a registry tab). The record page /evidence/[id] draws the kit's head with the
// file's name, so it is declared with `ownHeading` and the top bar names only its section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { activeNavHref } from '../../components/layout/navActive.ts';
import { navigation } from '../../components/layout/navAccess.ts';
import { ownHeadingSection, registryNamesPage, routeFor, routes, titleFor } from '../navRegistry.ts';
import { LEAVES, PAGES } from './evidence.ts';

const DASHBOARD = fileURLToPath(new URL('../../app/(dashboard)/', import.meta.url));
const RECORD = '[id]';                                              // the record page's folder (its own group)

/** `evidence-requirements/page.tsx` -> `/evidence-requirements`, `evidence/audit-packages/page.tsx` -> `/evidence/audit-packages`, for the folders of this group. */
function pagesOfFolders(): string[] {
  const out: string[] = [];
  const walk = (folder: string, base: string) => {
    if (existsSync(`${DASHBOARD}${folder}/page.tsx`)) out.push(base);
    for (const entry of readdirSync(`${DASHBOARD}${folder}`, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== RECORD && !entry.name.startsWith('_')) walk(`${folder}/${entry.name}`, `${base}/${entry.name}`);
    }
  };
  walk('evidence', '/evidence');
  walk('evidence-requirements', '/evidence-requirements');
  return out;
}

const pageFile = (path: string) => readFileSync(`${DASHBOARD}${path.slice(1)}/page.tsx`, 'utf8');
const entry = (path: string) => routes.filter((e) => e.path === path);

test('every page of the two folders has exactly one entry: the sidebar leaf, the four pages declared here, and the record page (declared for its next group)', () => {
  assert.deepEqual(pagesOfFolders().sort(), ['/evidence', '/evidence-requirements', '/evidence/audit-packages', '/evidence/coverage']);
  for (const path of ['/evidence', '/evidence-requirements', '/evidence/audit-packages', '/evidence/coverage', '/evidence/:id']) assert.equal(entry(path).length, 1, path);
  assert.deepEqual(PAGES.map((p) => p.path), ['/evidence/:id', '/evidence/audit-packages', '/evidence/coverage', '/evidence-requirements']);
  assert.equal(entry('/evidence/:id')[0].ownHeading, true, 'the record page draws the kit head, so the top bar names only the section');
});

test('the pages of the tab strip say where they open from, hang under Evidence Management, and the forward is a page with no head of its own', () => {
  for (const path of ['/evidence/audit-packages', '/evidence/coverage', '/evidence-requirements']) {
    const e = entry(path)[0];
    assert.equal(e.area, 'compliance-management', path);
    assert.equal(e.parent, '/evidence', path);
    assert.ok(e.hidden && e.hidden.length > 10, `${path}: says where it opens from`);
    assert.equal(e.tab, undefined, `${path}: the strip is page-local, not a registry tab`);
  }
  assert.match(entry('/evidence/coverage')[0].hidden ?? '', /forwards to the Insights tab/);
  assert.equal(entry('/evidence/coverage')[0].ownHeading, undefined, 'the forward draws nothing');
  assert.doesNotMatch(pageFile('/evidence/coverage'), /PageHeader/);
});

test('the sidebar leaf lights the Requirements page (its activeMatch), and the top bar names the section for the pages that draw their own heading', () => {
  assert.equal(activeNavHref('/evidence-requirements', navigation), '/evidence');
  assert.equal(activeNavHref('/evidence', navigation), '/evidence');
  for (const path of ['/evidence', '/evidence-requirements', '/evidence/audit-packages']) {
    assert.equal(ownHeadingSection(path), 'Compliance Management', path);
    assert.equal(registryNamesPage(path), true, path);
  }
  assert.equal(titleFor('/evidence-requirements'), 'Evidence requirements');
  assert.equal(titleFor('/evidence/audit-packages'), 'Audit packages');
  assert.equal(routeFor('/evidence-requirements/')?.path, '/evidence-requirements', 'a trailing slash is the same page');
});

test('an entry that says it draws its own heading has a page that does, with the registry\'s name as its heading', () => {
  for (const path of pagesOfFolders()) {
    const e = entry(path)[0];
    if (!e || !e.ownHeading) continue;
    const source = pageFile(path);
    assert.match(source, /<PageHeader\s+variant="page"/, `${path} draws the kit's page head`);
    assert.ok(source.includes(`title="${e.label}"`), `${path}: the heading is "${e.label}"`);
  }
  assert.deepEqual(pagesOfFolders().filter((p) => entry(p)[0]?.ownHeading).sort(), ['/evidence', '/evidence-requirements', '/evidence/audit-packages']);
});

test('the record page draws the kit head with the name of the file itself (the registry name is for the menu and the palette), and the top bar names only its section', () => {
  const source = readFileSync(`${DASHBOARD}evidence/[id]/page.tsx`, 'utf8');
  assert.match(source, /<PageHeader\s+variant="page"\s+title=\{evidence\.name\}/);
  assert.equal(ownHeadingSection('/evidence/12'), 'Compliance Management');
  assert.equal(routeFor('/evidence/12')?.path, '/evidence/:id');
  assert.equal(routeFor('/evidence/12')?.parent, '/evidence');
});

test('the group file declares leaves only for pages on the kit (each with ownHeading)', () => {
  for (const [path, extra] of Object.entries(LEAVES)) assert.equal(extra.ownHeading, true, `${path}: a leaf of this group is declared when its page draws the kit head`);
});
