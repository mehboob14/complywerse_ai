// node --test "src/lib/navPages/issues.test.ts"
// The Issues pages in the navigation registry: every page.tsx under issues/ is exactly one entry, the Overview, the two registers (Issues, Corrective actions) and the settings say they draw their
// own heading and really draw the kit's page head, the heading of each is the registry's name, and the old tabs of /issues forward to the pages that took their place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { breadcrumbFor, ownHeadingSection, registryNamesPage, routeFor, routes, sidebarLeafOf } from '../navRegistry.ts';

const ISSUES = fileURLToPath(new URL('../../app/(dashboard)/issues/', import.meta.url));
const read = (rel: string) => readFileSync(`${ISSUES}${rel}`, 'utf8');
const pages = (readdirSync(ISSUES, { recursive: true }) as string[])
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'))
  .map((f) => `/issues${f.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`.replace(/\[([A-Za-z]+)\]/g, ':$1'));

test('every page.tsx under issues/ is exactly one registry entry', () => {
  assert.deepEqual(pages.slice().sort(), ['/issues', '/issues/:id', '/issues/actions', '/issues/register', '/issues/settings']);
  pages.forEach((page) => assert.equal(routes.filter((e) => e.path === page).length, 1, page));
});

test('the two registers draw the kit\'s page head from their component, and say so', () => {
  assert.match(read('register/_register/IssueRegister.tsx'), /<PageHeader\s+variant="page"/);
  assert.match(read('actions/_register/ActionRegister.tsx'), /<PageHeader\s+variant="page"/);
  for (const page of ['/issues/register', '/issues/actions']) {
    assert.equal(routeFor(page)?.ownHeading, true, `${page}: ownHeading`);
    assert.equal(registryNamesPage(page), true, page);
    assert.ok(ownHeadingSection(page), `${page}: the top bar names a section`);
  }
});

test('the heading of each register is its registry name (the page reads it from the registry)', () => {
  assert.equal(routeFor('/issues/register')?.label, 'Issues');
  assert.equal(routeFor('/issues/actions')?.label, 'Corrective actions');
  assert.match(read('register/page.tsx'), /routeFor\('\/issues\/register'\)\?\.label/);
  assert.match(read('actions/page.tsx'), /routeFor\('\/issues\/actions'\)\?\.label/);
});

test('the registers are sidebar leaves of Issue & Incident Management, and a record lights Issues', () => {
  assert.deepEqual(breadcrumbFor('/issues/actions').map((c) => c.label)[0], 'Issue & Incident Management');
  for (const page of ['/issues/register', '/issues/actions']) {
    const e = routeFor(page)!;
    assert.equal(e.area, 'issue-incident-management');
    assert.equal(e.ownHeading, true, `${page}: draws its own head`);
    assert.ok(sidebarLeafOf(e), `${page}: a leaf of the menu`);
  }
  assert.equal(routeFor('/issues/:id')?.parent, '/issues/register');
  assert.equal(sidebarLeafOf(routeFor('/issues/:id')!)?.path, '/issues/register');
});

test('the Overview and the settings page draw the kit page head themselves, and say so', () => {
  assert.match(read('page.tsx'), /<PageHeader\s+variant="page"/);
  assert.match(read('settings/page.tsx'), /<PageHeader\s+variant="page"/);
  for (const page of ['/issues', '/issues/settings']) {
    assert.equal(routeFor(page)?.ownHeading, true, `${page}: ownHeading`);
    assert.equal(registryNamesPage(page), true, page);
  }
  assert.equal(routeFor('/issues')?.title, 'Issue & Incident Overview');
  assert.match(read('page.tsx'), /titleFor\('\/issues'\)/, 'the Overview reads its heading from the registry');
  assert.match(read('settings/page.tsx'), /routeFor\('\/issues\/settings'\)\?\.label/, 'the settings page reads its heading from the registry');
  assert.equal(routeFor('/issues/settings')?.parent, '/issues');
});

test('the page of the old tabs forwards: it reads the address through forwardFor and replaces it, and shows no Overview meanwhile', () => {
  const page = read('page.tsx');
  assert.match(page, /forwardFor\(params\.toString\(\)\)/);
  assert.match(page, /router\.replace\(forward\)/);
  assert.match(page, /return forward \? .* : <IssuesOverview \/>/);
});

test('the issue record draws the kit\'s page head itself and says so: the top bar names only the section, the title is the issue\'s', () => {
  assert.match(read('[id]/page.tsx'), /<PageHeader\s+variant="page"/);
  assert.equal(routeFor('/issues/12')?.ownHeading, true);
  assert.equal(registryNamesPage('/issues/12'), true);
  assert.ok(ownHeadingSection('/issues/12'), 'the top bar names a section');
  assert.deepEqual(breadcrumbFor('/issues/12').map((c) => c.label), ['Issue & Incident Management', 'Issues', 'Issue'], 'the trail the record has always had');
});
