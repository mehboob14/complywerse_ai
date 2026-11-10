// node --test "src/lib/navPages/issues.test.ts"
// The Issues pages in the navigation registry: every page.tsx under issues/ is exactly one entry, the two registers (Issues, Corrective actions) say they draw their own heading and really
// draw the kit's page head from their component, the heading of each is the registry's name, and the old tabs of /issues forward to them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { breadcrumbFor, ownHeadingSection, registryNamesPage, routeFor, routes } from '../navRegistry.ts';

const ISSUES = fileURLToPath(new URL('../../app/(dashboard)/issues/', import.meta.url));
const read = (rel: string) => readFileSync(`${ISSUES}${rel}`, 'utf8');
const pages = (readdirSync(ISSUES, { recursive: true }) as string[])
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'))
  .map((f) => `/issues${f.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`.replace(/\[([A-Za-z]+)\]/g, ':$1'));

test('every page.tsx under issues/ is exactly one registry entry', () => {
  assert.deepEqual(pages.slice().sort(), ['/issues', '/issues/:id', '/issues/actions', '/issues/register']);
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

test('the registers hang under Issue & Incident Management and say where they open from', () => {
  assert.deepEqual(breadcrumbFor('/issues/actions').map((c) => c.label)[0], 'Issue & Incident Management');
  for (const page of ['/issues/register', '/issues/actions']) {
    const e = routeFor(page)!;
    assert.equal(e.area, 'issue-incident-management');
    assert.equal(e.parent, '/issues');
    assert.ok(e.hidden && e.hidden.length > 20, `${page}: where it opens from`);
  }
});

test('the old tabs of /issues forward: log and contract to the issue register (contract as a filter of it), capa to the corrective actions, an issue-of-a-record address to ?linked', () => {
  const page = read('page.tsx');
  assert.match(page, /log: '\/issues\/register'/);
  assert.match(page, /contract: '\/issues\/register\?category=contract'/);
  assert.match(page, /capa: '\/issues\/actions'/);
  assert.match(page, /router\.replace\(`\/issues\/register\?linked=\$\{linked\.type\}:\$\{linked\.id\}`\)/);
  assert.match(page, /router\.push\(forward\)/, 'a click on a tab that became a page goes to it');
});
