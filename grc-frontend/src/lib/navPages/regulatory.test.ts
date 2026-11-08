// node --test "src/lib/navPages/regulatory.test.ts"
// The Regulatory Changes / Feed pages in the navigation registry: every page.tsx of the two folders is exactly one entry, the two pages that draw the kit's page head say so (and the top bar then
// names only the section, Compliance Management), the page's heading is its registry name, and the change's own page (declared in navRegistry.ts) keeps its title as the record's heading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ownHeadingSection, registryNamesPage, routeFor, routes, titleFor } from '../navRegistry.ts';
import { LEAVES, PAGES } from './regulatory.ts';

const GOV = fileURLToPath(new URL('../../app/(dashboard)/governance/', import.meta.url));

/** `regulatory-changes/[id]/page.tsx` -> `/governance/regulatory-changes/:id` for the two folders. */
function pagesOf(folder: string): string[] {
  return (readdirSync(`${GOV}${folder}`, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
    .map((file) => `/governance/${folder}${file.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`.replace(/\[([A-Za-z]+)\]/g, ':$1'));
}
const pages = [...pagesOf('regulatory-changes'), ...pagesOf('regulatory-feeds')].sort();
const file = (path: string) => readFileSync(`${GOV}${path.replace('/governance/', '').replace(/:([A-Za-z]+)/g, '[$1]')}/page.tsx`, 'utf8');

test('every page of the two folders is exactly one entry; the group declares the one sidebar leaf (Regulatory Changes) and the Feed page under it (the change page is declared in navRegistry.ts)', () => {
  assert.deepEqual(pages, ['/governance/regulatory-changes', '/governance/regulatory-changes/:id', '/governance/regulatory-feeds']);
  for (const p of pages) assert.equal(routes.filter((e) => e.path === p).length, 1, p);
  assert.deepEqual(Object.keys(LEAVES), ['/governance/regulatory-changes']);
  assert.deepEqual(PAGES.map((p) => [p.path, p.parent]), [['/governance/regulatory-feeds', '/governance/regulatory-changes']], 'the Feed is reached through the strip of Regulatory Changes');
});

test('both pages draw the kit head, are flagged ownHeading, and the top bar names the section Compliance Management', () => {
  for (const p of ['/governance/regulatory-changes', '/governance/regulatory-feeds']) {
    assert.equal(routes.find((e) => e.path === p)?.ownHeading, true, `${p}: ownHeading`);
    assert.match(file(p), /<PageHeader\s+variant="page"/, `${p}: PageHeader variant="page"`);
    assert.equal(ownHeadingSection(p), 'Compliance Management', p);
    assert.equal(registryNamesPage(p), true, p);
  }
  assert.match(file('/governance/regulatory-changes/:id'), /<PageHeader\s+variant="page"/, 'the change page draws the kit head too, with the change\'s own title');
  assert.equal(routes.find((e) => e.path === '/governance/regulatory-changes/:id')?.ownHeading, true, 'flagged: its entry is in navRegistry.ts');
});

test('the heading of each leaf is its registry name', () => {
  assert.match(file('/governance/regulatory-changes'), /routeFor\('\/governance\/regulatory-changes'\)\?\.label \?\? 'Regulatory Changes'/);
  assert.match(file('/governance/regulatory-feeds'), /routeFor\('\/governance\/regulatory-feeds'\)\?\.label \?\? 'Regulatory Feeds'/);
  assert.equal(routeFor('/governance/regulatory-changes')?.label, 'Regulatory Changes');
  assert.equal(routeFor('/governance/regulatory-feeds')?.label, 'Regulatory Feeds');
  assert.equal(titleFor('/governance/regulatory-changes/7') !== undefined, true);
});

test('the leaves keep the names they are searched by', () => {
  assert.ok(routeFor('/governance/regulatory-changes')?.keywords?.includes('Circulars'));
  assert.ok(routeFor('/governance/regulatory-feeds')?.keywords?.includes('Regulator feeds'));
});
