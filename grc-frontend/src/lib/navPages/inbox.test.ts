// node --test "src/lib/navPages/inbox.test.ts"
// Needs my action in the navigation registry: the folder holds one page and the registry has exactly one entry for it (the sidebar's first leaf), that entry says the page draws its own head,
// the page file really renders the kit's page head with the registry's name, the top bar therefore names nothing, and the old address /governance/approvals is a forward to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { breadcrumbFor, ownHeadingSection, registryNamesPage, routeFor, routes, titleFor } from '../navRegistry.ts';
import { LEAVES, PAGES } from './inbox.ts';
import { flattenLeaves, navigation, navPermissions, visibleNav, navAccessFromMe } from '../../components/layout/navAccess.ts';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

/** `needs-my-action/x/[id]/page.tsx` -> `/needs-my-action/x/:id` for every page of the folder (the same walk as navRegistry.test.ts). */
function pagesOf(folder: string, base: string): string[] {
  return (readdirSync(`${APP}${folder}`, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file === 'page.tsx' || file.endsWith('/page.tsx'))
    .map((file) => `${base}${file.slice(0, -'page.tsx'.length).replace(/\/$/, '').replace(/^(?=.)/, '/')}`.replace(/\[([A-Za-z]+)\]/g, ':$1'));
}

test('the folder holds one page, and the registry has exactly one entry for it: the first sidebar leaf, named as the sidebar names it, needing no right', () => {
  assert.deepEqual(pagesOf('(dashboard)/needs-my-action', '/needs-my-action'), ['/needs-my-action']);
  assert.equal(routes.filter((e) => e.path === '/needs-my-action').length, 1);
  const leaf = flattenLeaves(navigation)[0];
  assert.deepEqual([leaf.href, leaf.name, leaf.signedIn], ['/needs-my-action', 'Needs my action', true]);
  const entry = routeFor('/needs-my-action');
  assert.equal(entry?.label, leaf.name);
  assert.equal(entry?.permissions, null, 'any signed-in person opens it: its sources answer only for them');
  assert.deepEqual(navPermissions('/needs-my-action'), []);
  assert.equal(entry?.hidden, undefined, 'it is in the menu');
  assert.deepEqual(entry?.groups, [], 'a global destination: it belongs to no group');
});

test('everyone who is signed in is shown the entry, whatever their rights; nobody else', () => {
  const sees = (me: unknown) => visibleNav(navigation, navAccessFromMe(me)).map((e) => e.name);
  assert.deepEqual(sees({ authenticated: true, user: { permissions: [], is_admin: false } }), ['Needs my action']);
  assert.deepEqual(sees({ authenticated: false, user: null }), []);
});

test('the entry says the page draws its own head, so the top bar names nothing (the section is the page\'s own name)', () => {
  assert.equal(LEAVES['/needs-my-action'].ownHeading, true);
  assert.equal(routeFor('/needs-my-action')?.ownHeading, true);
  assert.equal(registryNamesPage('/needs-my-action'), true);
  assert.equal(ownHeadingSection('/needs-my-action'), '');
  assert.equal(titleFor('/needs-my-action'), 'Needs my action');
  assert.deepEqual(breadcrumbFor('/needs-my-action'), [{ label: 'Needs my action', href: '/needs-my-action' }]);
});

test('the page file renders the kit\'s page head, with the registry\'s name', () => {
  const page = code(readFileSync(`${APP}(dashboard)/needs-my-action/page.tsx`, 'utf8'));
  assert.match(page, /<PageHeader[\s\S]{0,40}variant="page"/);
  assert.match(page, /routeFor\('\/needs-my-action'\)\?\.label/);
});

test('the search words find it by the names it replaced', () => {
  const words = (routeFor('/needs-my-action')?.keywords ?? []).map((k) => k.toLowerCase());
  for (const name of ['approvals', 'my approvals', 'pending approvals']) assert.ok(words.includes(name), name);
});

test('/governance/approvals is a forward to it, for ever: the entry is an alias, and the page is a server redirect that keeps the query', () => {
  assert.deepEqual(PAGES.map((p) => [p.path, p.aliasOf]), [['/governance/approvals', '/needs-my-action']]);
  const alias = routeFor('/governance/approvals');
  assert.equal(alias?.aliasOf, '/needs-my-action');
  assert.equal(titleFor('/governance/approvals'), 'Needs my action');
  const source = readFileSync(`${APP}(dashboard)/governance/approvals/page.tsx`, 'utf8');
  assert.doesNotMatch(source, /'use client'/, 'a server component: the redirect happens before anything is drawn');
  assert.match(code(source), /from 'next\/navigation'/);
  assert.match(code(source), /redirect\(`\/needs-my-action\$\{query\.toString\(\) \? `\?\$\{query\.toString\(\)\}` : ''\}`\)/);
});

test('the old page\'s code is kept, not routed: nothing imports it and it is not a page', () => {
  const folder = `${APP}(dashboard)/governance/approvals`;
  assert.deepEqual(readdirSync(folder).sort(), ['_LegacyApprovalsPage.tsx', 'page.tsx']);
  const legacy = readFileSync(`${folder}/_LegacyApprovalsPage.tsx`, 'utf8');
  assert.match(legacy, /export default function ApprovalsPage/);
  assert.match(legacy, /governanceApi\.getMyPendingApprovals/, 'the action-review log is still in it');
});
