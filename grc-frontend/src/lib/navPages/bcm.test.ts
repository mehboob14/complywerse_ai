// node --test "src/lib/navPages/bcm.test.ts"
// The Business Continuity pages in the navigation registry: every page.tsx of the folder is exactly one entry and every /bcm entry is a page, every entry is flagged
// ownHeading and its page file draws the kit's page head, the top bar names the section for all five, the names are the sidebar's, and the two detail pages hang under
// their lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { breadcrumbFor, ownHeadingSection, registryNamesPage, routeFor, routes, subtitleFor, titleFor } from '../navRegistry.ts';

const FOLDER = fileURLToPath(new URL('../../app/(dashboard)/bcm/', import.meta.url));
const example = (path: string) => path.replace(/:[A-Za-z]+/g, '7');

/** `plans/[id]/page.tsx` -> `/bcm/plans/:id` for every page of the folder. */
function pagesOfBcm(): string[] {
  return (readdirSync(FOLDER, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
    .map((file) => `/bcm${file.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`.replace(/\[([A-Za-z]+)\]/g, ':$1'));
}

const pageFile = (path: string): string => {
  const rel = path.replace(/^\/bcm\/?/, '').replace(/:([A-Za-z]+)/g, '[$1]');
  return readFileSync(`${FOLDER}${rel ? `${rel}/` : ''}page.tsx`, 'utf8');
};
/** The three registers draw their head in a component of their own (the page is its address); the other pages draw it themselves. */
const HEAD_FILE: Record<string, string> = { '/bcm/plans': '_plans/PlansRegister.tsx', '/bcm/drills': '_drills/DrillsRegister.tsx', '/bcm/findings': '_findings/FindingsRegister.tsx' };
const headFile = (path: string): string => (HEAD_FILE[path] ? readFileSync(`${FOLDER}${HEAD_FILE[path]}`, 'utf8') : pageFile(path));

test('every page.tsx of the BCM folder is exactly one registry entry, and every /bcm entry is a page', () => {
  const pages = pagesOfBcm();
  assert.deepEqual(pages.slice().sort(), ['/bcm', '/bcm/drills', '/bcm/drills/:id', '/bcm/findings', '/bcm/plans', '/bcm/plans/:id']);
  for (const page of pages) assert.equal(routes.filter((e) => e.path === page).length, 1, page);
  for (const e of routes.filter((r) => r.path === '/bcm' || r.path.startsWith('/bcm/'))) assert.ok(pages.includes(e.path), `${e.path} has no page.tsx`);
});

test('every BCM entry is flagged ownHeading and its page file renders the kit\'s page head', () => {
  for (const e of routes.filter((r) => r.path === '/bcm' || r.path.startsWith('/bcm/'))) {
    assert.equal(e.ownHeading, true, `${e.path}: ownHeading`);
    assert.match(headFile(e.path), /<PageHeader\s+variant="page"/, `${e.path}: PageHeader variant="page"`);
    assert.equal(registryNamesPage(example(e.path)), true, e.path);
  }
});

test('the top bar names only the section on all six pages; the four list pages share the head "Business Continuity" (the Overview\'s registry name) with a strip of tabs, and the two records have their own', () => {
  for (const url of ['/bcm', '/bcm/plans', '/bcm/plans/12', '/bcm/drills', '/bcm/drills/12', '/bcm/findings']) assert.equal(ownHeadingSection(url), 'Compliance Management', url);
  assert.equal(titleFor('/bcm'), 'Business Continuity');
  assert.equal(titleFor('/bcm/plans'), 'Continuity Plans');
  assert.equal(titleFor('/bcm/drills'), 'Drills & Invocations');
  for (const path of ['/bcm', '/bcm/plans', '/bcm/drills', '/bcm/findings']) assert.match(headFile(path), /title=\{AREA\}/, `${path}: the head is the area's name`);
  assert.match(readFileSync(`${FOLDER}_tabs/tabsModel.ts`, 'utf8'), /export const AREA = 'Business Continuity';/);
  assert.equal(subtitleFor('/bcm'), undefined, 'no second line: the page says what it holds in its own head');
});

test('the labels are the sidebar\'s names; the detail pages hang under their lists and say where they open from', () => {
  assert.equal(routeFor('/bcm')?.label, 'Overview');
  assert.equal(routeFor('/bcm/plans')?.label, 'Continuity Plans');
  assert.equal(routeFor('/bcm/drills')?.label, 'Drills & Invocations');
  const plan = routeFor('/bcm/plans/12');
  const drill = routeFor('/bcm/drills/12');
  assert.equal(plan?.path, '/bcm/plans/:id');
  assert.equal(plan?.parent, '/bcm/plans');
  assert.equal(drill?.path, '/bcm/drills/:id');
  assert.equal(drill?.parent, '/bcm/drills');
  for (const e of [plan, drill]) assert.ok(e?.hidden && e.hidden.length > 10, `${e?.path}: a reason it has no menu entry`);
  assert.deepEqual(breadcrumbFor('/bcm/plans/12').map((c) => c.label), ['Compliance Management', 'Business Continuity', 'Continuity Plans', 'Continuity plan']);
  assert.deepEqual(breadcrumbFor('/bcm/drills/12').map((c) => c.label), ['Compliance Management', 'Business Continuity', 'Drills & Invocations', 'Drill']);
});

test('the rights of the three leaves are the sidebar\'s and a detail page is offered to whoever is offered its list (the registry enforces nothing)', () => {
  assert.deepEqual(routeFor('/bcm')?.permissions, ['bcm:dashboard:*']);
  assert.deepEqual(routeFor('/bcm/plans')?.permissions, ['bcm:plans:*']);
  assert.deepEqual(routeFor('/bcm/drills')?.permissions, ['bcm:drills:*']);
  assert.deepEqual(routeFor('/bcm/plans/12')?.permissions, ['bcm:plans:*']);
  assert.deepEqual(routeFor('/bcm/drills/12')?.permissions, ['bcm:drills:*']);
});
