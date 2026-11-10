// node --test "src/lib/navPages/reports.test.ts"
// The Reports group's entries in the navigation registry: every page of the folder has exactly one entry, /reports/saved is a server forward to the library, the two pages that draw the kit's
// page head are flagged (and only they), the strip across the top offers each tab to the people its page lets in, and the builder takes the right of the library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ownHeadingSection, routeFor, routes } from '../navRegistry.ts';
import { navPermissions } from '../../components/layout/navAccess.ts';
import { LEAVES, PAGES } from './reports.ts';
import { STRIP_TABS, showsStrip, stripTabOf } from '../../app/(dashboard)/reports/_library/stripModel.ts';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const read = (file: string) => readFileSync(`${APP}(dashboard)/reports/${file}`, 'utf8');

/** `reports/x/page.tsx` -> `/reports/x` for every page of the folder (the walk of navRegistry.test.ts). */
const pages = (readdirSync(`${APP}(dashboard)/reports`, { recursive: true }) as string[])
  .map((file) => file.replace(/\\/g, '/'))
  .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
  .map((file) => `/reports${file.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`);

test('the folder holds seven pages and the registry has exactly one entry for each', () => {
  assert.deepEqual(pages.slice().sort(), ['/reports', '/reports/analytics', '/reports/builder', '/reports/dashboards', '/reports/print', '/reports/saved', '/reports/trends']);
  for (const page of pages) assert.equal(routes.filter((e) => e.path === page).length, 1, page);
  for (const spec of PAGES) assert.ok(pages.includes(spec.path), `${spec.path} has no page.tsx`);
  for (const href of Object.keys(LEAVES)) assert.ok(pages.includes(href), `${href}: a leaf is a page`);
});

test('the builder and the dashboards hang under the library, and say where they open from', () => {
  for (const path of ['/reports/builder', '/reports/dashboards', '/reports/trends', '/reports/print']) {
    const spec = PAGES.find((p) => p.path === path);
    assert.equal(spec?.parent, '/reports', path);
    assert.equal(spec?.area, 'reports', path);
    assert.ok((spec?.hidden ?? '').length > 20, `${path}: where it opens from`);
  }
  assert.equal(routeFor('/reports/builder')?.label, 'Report builder');
  assert.equal(routeFor('/reports/dashboards')?.label, 'Dashboards');
});

test('the builder needs what the library needs: it has no right of its own, so the registry gives it the library\'s, and its page guards itself with the library\'s', () => {
  assert.deepEqual(routeFor('/reports/builder')?.permissions, routeFor('/reports')?.permissions);
  assert.deepEqual(routeFor('/reports/builder')?.permissions, ['reports:reports:*']);
  assert.match(read('builder/page.tsx'), /navPermissions\('\/reports'\)/);
  assert.match(read('page.tsx'), /navPermissions\('\/reports'\)/);
  assert.match(read('dashboards/page.tsx'), /navPermissions\('\/reports\/dashboards'\)/);
});

test('/reports/saved is a forward for ever: a server redirect to the library, the query kept, nothing drawn, no heading flag', () => {
  const source = read('saved/page.tsx');
  assert.match(source, /redirect\(/);
  assert.match(source, /forwardTo\('\/reports', searchParams\)/);
  assert.doesNotMatch(source, /PageHeader|'use client'/, 'a server redirect: nothing is drawn, nothing flashes');
  assert.equal(routes.find((e) => e.path === '/reports/saved')?.ownHeading, undefined);
});

test('the pages that draw the kit head are flagged, the others are not, and the head says the entry\'s name', () => {
  const flagged = routes.filter((e) => e.area === 'reports' && e.ownHeading).map((e) => e.path).sort();
  assert.deepEqual(flagged, ['/reports', '/reports/analytics', '/reports/dashboards', '/reports/trends']);
  const library = readFileSync(`${APP}(dashboard)/reports/_library/ReportsLibrary.tsx`, 'utf8');
  const dashboards = readFileSync(`${APP}(dashboard)/reports/_library/dashboards/DashboardsPage.tsx`, 'utf8');
  for (const [file, title] of [[library, 'Reports'], [dashboards, 'Dashboards']] as const) {
    assert.match(file, /<PageHeader\s+variant="page"/);
    assert.match(file, new RegExp(`export const TITLE = '${title}';`));
    assert.match(file, /title=\{TITLE\}/);
  }
  assert.equal(routeFor('/reports/dashboards')?.label, 'Dashboards', 'the head and the registry say the same');
  assert.equal(ownHeadingSection('/reports/dashboards'), 'Reports', 'the top bar names the section only');
  for (const path of ['/reports/builder', '/reports/print']) assert.equal(ownHeadingSection(path), undefined, `${path} does not draw the kit head yet`);
});

test('the strip offers each tab to the people its page lets in: the strip\'s rights are the page\'s rights', () => {
  assert.deepEqual(STRIP_TABS.map((t) => t.href), ['/reports', '/reports/dashboards', '/reports/trends', '/reports/analytics']);
  for (const tab of STRIP_TABS) assert.deepEqual(tab.rights, navPermissions(tab.href), tab.href);
  assert.deepEqual(STRIP_TABS.map((t) => t.label), ['Reports', 'Dashboards', 'Trends', 'Analytics']);
});

test('the strip shows on the four pages of the area and nowhere else', () => {
  for (const tab of STRIP_TABS) { assert.equal(showsStrip(tab.href), true, tab.href); assert.equal(stripTabOf(`${tab.href}/`), tab.key); }
  assert.equal(stripTabOf('/reports/dashboards?id=dsh_1'), 'dashboards', 'the query is not part of the page');
  for (const path of ['/reports/builder', '/reports/print', '/reports/saved', '/reports/other', '/dashboard', null, undefined, '']) assert.equal(showsStrip(path), false, String(path));
  const layout = read('layout.tsx');
  assert.match(layout, /showsStrip\(pathname\)/);
  assert.match(layout, /<ReportsStrip pathname=\{pathname\} \/>/);
});
