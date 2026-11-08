// node --test "src/lib/navPages/frameworks.test.ts"
// The Frameworks group's entries in the navigation registry: every page of the frameworks folder (and the Organisation Profile) has exactly one entry, the pages that say they draw their own heading
// do, the heading is the registry's name, the top bar names only the section, and the two old addresses (/frameworks/manage, /frameworks/overview/:id) are real forwards that keep the query / the
// framework. The strip of the hub lists the three pages it names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ownHeadingSection, registryNamesPage, routeFor, routes, titleFor } from '../navRegistry.ts';
import { STRIP } from '../../app/(dashboard)/frameworks/_hub/hubAddress.ts';
import { LEAVES, PAGES } from './frameworks.ts';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const read = (file: string) => readFileSync(`${APP}${file}`, 'utf8').replace(/\r\n/g, '\n');

/** `frameworks/[id]/page.tsx` -> `/frameworks/:id` for every page of the folder. */
function pagesOf(folder: string, base: string): string[] {
  return (readdirSync(`${APP}${folder}`, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
    .map((file) => `${base}${file.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`.replace(/\[([A-Za-z]+)\]/g, ':$1'));
}
const pages = pagesOf('(dashboard)/frameworks', '/frameworks');
const FILE: Record<string, string> = {
  '/frameworks': '(dashboard)/frameworks/page.tsx',
  '/frameworks/:id': '(dashboard)/frameworks/[id]/page.tsx',
  '/frameworks/manage': '(dashboard)/frameworks/manage/page.tsx',
  '/frameworks/overview/:id': '(dashboard)/frameworks/overview/[id]/page.tsx',
  '/frameworks/onboarding': '(dashboard)/frameworks/onboarding/page.tsx',
  '/frameworks/onboarding/:id': '(dashboard)/frameworks/onboarding/[id]/page.tsx',
};
/** where each heading is drawn: the page, or the component the thin page places */
const HEAD_IN: Record<string, string> = {
  '/frameworks': '(dashboard)/frameworks/_hub/FrameworksHub.tsx',
  '/frameworks/:id': '(dashboard)/frameworks/[id]/_workspace/JourneyHeader.tsx',
  '/frameworks/onboarding': '(dashboard)/frameworks/onboarding/page.tsx',
  '/frameworks/onboarding/:id': '../components/compliance/onboarding/workspace/OnboardingWorkspace.tsx',
};

test('every page of the frameworks folder is exactly one entry of the registry, and every entry of this group is a page (or the sidebar leaf it forwards from)', () => {
  assert.deepEqual(pages.slice().sort(), Object.keys(FILE).sort(), 'the six pages of the folder');
  for (const page of pages) assert.equal(routes.filter((e) => e.path === page).length, 1, page);
  for (const spec of PAGES) assert.ok(pages.includes(spec.path), `${spec.path} has no page.tsx`);
  assert.deepEqual(Object.keys(LEAVES).sort(), ['/frameworks'], 'the sidebar leaf this group adds to');
});

test('the heading flags: the hub, a journey, the Onboarding page, a framework\'s onboarding and the Organisation Profile draw the kit head; the forward draws nothing and carries none', () => {
  const flagged = ['/frameworks', '/frameworks/:id', '/frameworks/onboarding', '/frameworks/onboarding/:id'];
  for (const path of flagged) {
    assert.equal(routes.find((e) => e.path === path)?.ownHeading, true, `${path} is flagged`);
    const source = read(HEAD_IN[path]);
    assert.match(source, /<PageHeader[\s\S]{0,80}variant="page"|<PageHeading/, `${path} draws the kit head (${HEAD_IN[path]})`);
  }
  for (const path of ['/frameworks/manage', '/frameworks/overview/:id']) assert.equal(routes.find((e) => e.path === path)?.ownHeading, undefined, `${path} only forwards`);
});

test('the heading of the hub and of the Onboarding page is the registry\'s name, and the Organisation Profile says the sidebar\'s', () => {
  assert.equal(titleFor('/frameworks'), 'Frameworks');
  assert.equal(titleFor('/frameworks/onboarding'), 'Onboarding');
  assert.match(read(HEAD_IN['/frameworks']), /titleFor\('\/frameworks'\)/, 'the hub reads its heading from the registry');
  assert.match(read(HEAD_IN['/frameworks/onboarding']), /titleFor\('\/frameworks\/onboarding'\)/);
});

test('the top bar names only the section on the pages that draw their own head', () => {
  for (const url of ['/frameworks', '/frameworks/7', '/frameworks/onboarding', '/frameworks/onboarding/3']) {
    assert.equal(ownHeadingSection(url), 'Compliance Management', url);
    assert.equal(registryNamesPage(url), true, url);
  }
  assert.equal(ownHeadingSection('/frameworks/overview/7'), undefined, 'a forward draws no head');
  assert.equal(ownHeadingSection('/frameworks/manage'), 'Compliance Management', 'the menu\'s old address is named as its target, the hub');
  assert.equal(routeFor('/frameworks/onboarding')?.path, '/frameworks/onboarding', 'the static segment wins over the journey page');
});

test('/frameworks/manage and /frameworks/overview/:id are forwards for ever: a server redirect, the query kept (Manage) or the framework opened in the Library (overview), nothing drawn', () => {
  const manage = read(FILE['/frameworks/manage']);
  assert.match(manage, /redirect\(/);
  assert.doesNotMatch(manage, /PageHeader|'use client'/, 'a server redirect: nothing is drawn, nothing flashes');
  assert.match(manage, /searchParams/, 'the query of the link is kept');
  assert.match(manage, /`\/frameworks\?\$\{query\.toString\(\)\}` : '\/frameworks'/, 'to the hub, with the plain address when there is no query');
  const overview = read(FILE['/frameworks/overview/:id']);
  assert.match(overview, /redirect\(/);
  assert.doesNotMatch(overview, /PageHeader|'use client'/);
  assert.match(overview, /\/frameworks\?tab=library&open=\$\{id\}/, 'the framework opens in the Library');
  assert.match(overview, /\^\\d\+\$/, 'a junk id goes to the Library, never to a broken drawer');
});

test('the strip names the three pages of the area, in order, and each goes where the registry has a page', () => {
  assert.deepEqual(STRIP.map((s) => s.label), ['Journeys', 'Library', 'Onboarding']);
  assert.deepEqual(STRIP.map((s) => s.href), ['/frameworks', '/frameworks?tab=library', '/frameworks/onboarding']);
  for (const item of STRIP) assert.ok(routeFor(item.href.split('?')[0]), item.href);
});

test('the sidebar leaf is the hub itself, its old address /frameworks/manage is an alias of it, and every page of the area has the leaf\'s right', () => {
  const leaf = routes.find((e) => e.path === '/frameworks');
  assert.equal(leaf?.label, 'Frameworks');
  assert.deepEqual(leaf?.permissions, ['compliance:frameworks:*']);
  assert.ok(leaf?.groups.length, 'the hub is a menu entry');
  const old = routes.find((e) => e.path === '/frameworks/manage');
  assert.equal(old?.aliasOf, '/frameworks');
  assert.equal(old?.label, 'Frameworks');
  assert.equal(old?.hidden, undefined);
  for (const spec of PAGES) assert.equal(routes.find((e) => e.path === spec.path)?.permissions?.join(), 'compliance:frameworks:*', `${spec.path}: the right of the page it hangs under`);
});
