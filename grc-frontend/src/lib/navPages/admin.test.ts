// node --test "src/lib/navPages/admin.test.ts"
// The Administration pages in the navigation registry are the sections of lib/adminSections.ts, so the menu, the section list and the top bar say one thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { ADMIN_SECTIONS } from '../adminSections.ts';
import { breadcrumbFor, ownHeadingSection, routeFor, routes, titleFor } from '../navRegistry.ts';

const entry = (path: string) => {
  const found = routes.find((e) => e.path === path);
  assert.ok(found, `no entry for ${path}`);
  return found;
};

test('every section is a page with an entry of the same name, under Administration, for administrators only', () => {
  for (const s of ADMIN_SECTIONS) {
    const e = entry(s.url);
    assert.equal(e.label, s.label, `${s.url}: the registry and the menu name it alike`);
    assert.equal(e.area, 'administration', s.url);
    assert.equal(routeFor(s.url)?.adminOnly, true, `${s.url}: administrators only, as the menu is`);
    assert.equal(titleFor(s.url), s.label, s.url);
  }
});

test('every section has its page in the app', () => {
  const missing = ADMIN_SECTIONS.filter((s) => !existsSync(`src/app/(dashboard)${s.url}/page.tsx`)).map((s) => s.url);
  assert.deepEqual(missing, []);
});

test('a section whose page draws the kit head is flagged, and the top bar then names only Administration; the others show their name there', () => {
  for (const s of ADMIN_SECTIONS.filter((x) => x.url.startsWith('/admin/'))) {
    assert.equal(entry(s.url).ownHeading, s.ownHeading ? true : undefined, s.url);
    assert.equal(ownHeadingSection(s.url), s.ownHeading ? 'Administration' : undefined, s.url);
  }
});

test('the trails: Administration, then the section, then the page', () => {
  const labels = (url: string) => breadcrumbFor(url).map((c) => c.label);
  assert.deepEqual(labels('/admin/users'), ['Administration', 'Users']);
  assert.deepEqual(labels('/admin/users/9/usage'), ['Administration', 'Users', 'User usage']);
  assert.deepEqual(labels('/admin/organization'), ['Administration', 'Organisation']);
  assert.deepEqual(labels('/admin/connectors'), ['Administration', 'Connected systems', 'Connectors']);
  assert.deepEqual(labels('/admin/cloud-connectors'), ['Administration', 'Connected systems', 'Cloud Connectors']);
  assert.deepEqual(labels('/admin/usage'), ['Administration', 'AI usage', 'Usage Monitoring']);
  assert.deepEqual(labels('/admin/teams'), ['Administration', 'Departments']);
});

test('the pages that are not sections are still entries: the tab host, the style guide, the scanner onboarding, Users at its own address', () => {
  for (const path of ['/admin', '/admin/ui-kit', '/admin/agents', '/admin/discover', '/admin/integrations/connect', '/admin/integrations/connect/ad-discover', '/admin/teams', '/users']) assert.ok(entry(path), path);
  assert.equal(entry('/admin/teams').aliasOf, '/admin/departments');
  assert.equal(entry('/admin').adminOnly, true);
});

test('search still finds Administration by every name its sections ever had', () => {
  const names = entry('/admin').keywords ?? [];
  for (const old of ['Company', 'Company Profile', 'Organisation Profile', 'User Management', 'Role Management', 'Teams', 'Password Policy', 'Integrations', 'Cloud Connectors', 'Connectors', 'Connections', 'Identity Providers', 'SSO', 'Workflow Engine', 'Audit Logs', 'Token usage', 'Usage Monitoring', 'Settings']) {
    assert.ok(names.includes(old), old);
  }
  assert.equal(new Set(names).size, names.length, 'a name once');
});
