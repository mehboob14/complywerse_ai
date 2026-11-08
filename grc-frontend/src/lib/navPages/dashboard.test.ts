// node --test "src/lib/navPages/dashboard.test.ts"
// The Performance Overview in the navigation registry: the folder holds one page and the registry has exactly one entry for it (the sidebar's leaf), that entry
// says the page draws its own head, the component the route file composes really renders the kit's page head with the registry's name, and the top bar therefore names nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ownHeadingSection, registryNamesPage, routeFor, routes, titleFor } from '../navRegistry.ts';
import { LEAVES, PAGES } from './dashboard.ts';
import { flattenLeaves, navigation, navPermissions } from '../../components/layout/navAccess.ts';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));

/** `dashboard/x/[id]/page.tsx` -> `/dashboard/x/:id` for every page of the folder (the same walk as navRegistry.test.ts). */
function pagesOf(folder: string, base: string): string[] {
  return (readdirSync(`${APP}${folder}`, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
    .map((file) => `${base}${file.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`.replace(/\[([A-Za-z]+)\]/g, ':$1'));
}

test('the dashboard folder holds one page, and the registry has exactly one entry for it: the sidebar leaf, with the sidebar\'s name and rights', () => {
  assert.deepEqual(pagesOf('(dashboard)/dashboard', '/dashboard'), ['/dashboard']);
  assert.equal(routes.filter((e) => e.path === '/dashboard').length, 1);
  const leaf = flattenLeaves(navigation).find((l) => l.href === '/dashboard');
  assert.ok(leaf, 'the sidebar has the leaf');
  const entry = routeFor('/dashboard');
  assert.equal(entry?.label, 'Performance Overview');
  assert.equal(entry?.label, leaf.name);
  assert.deepEqual(entry?.permissions, navPermissions('/dashboard'));
  assert.deepEqual(entry?.permissions, ['dashboard:overview:*']);
  assert.equal(entry?.hidden, undefined, 'it is in the menu');
  assert.deepEqual(PAGES, [], 'the page has no sub-pages: nothing to declare');
});

test('the entry says the page draws its own head, so the top bar names only the section (and the section is the page\'s own name: nothing)', () => {
  assert.deepEqual(LEAVES, { '/dashboard': { ownHeading: true } });
  assert.equal(routeFor('/dashboard')?.ownHeading, true);
  assert.equal(registryNamesPage('/dashboard'), true);
  assert.equal(ownHeadingSection('/dashboard'), '', 'the bar shows nothing: the head says Performance Overview');
  assert.equal(ownHeadingSection('/dashboard/'), '');
  assert.equal(ownHeadingSection('/dashboard?tab=x#top'), '');
  assert.equal(titleFor('/dashboard'), 'Performance Overview');
});

test("every entry flagged ownHeading by this group has a page that renders the kit's page head, named by the registry (the route file composes PerfOverview, which draws it)", () => {
  const route = readFileSync(`${APP}(dashboard)/dashboard/page.tsx`, 'utf8');
  assert.match(route, /import PerfOverview from '\.\/_overview\/PerfOverview';/);
  assert.match(route, /<PerfOverview \/>/);
  const page = readFileSync(`${APP}(dashboard)/dashboard/_overview/PerfOverview.tsx`, 'utf8');
  assert.match(page, /<PageHeader\s+variant="page"/);
  assert.match(page, /title=\{titleFor\('\/dashboard'\) \?\? 'Performance Overview'\}/, "the heading is the registry's name for the page");
  assert.match(page, /import \{ titleFor \} from '@\/lib\/navRegistry';/);
  assert.equal(Object.keys(LEAVES).length, 1);
});
