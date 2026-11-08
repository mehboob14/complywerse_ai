// node --test "src/lib/adminSections.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_GROUPS, ADMIN_HOME, ADMIN_SECTIONS, adminActiveHref, groupedSections, legacyTarget, sectionById, sectionOfPath, sectionOfTab, visibleSections,
} from './adminSections.ts';

// the 13 tab ids the old /admin page knew (admin/page.tsx at 8ba076b3) and the address each of the old standalone pages had
const OLD_TABS = ['company', 'profile', 'users', 'roles', 'departments', 'password-policy', 'integrations', 'cloud-connectors', 'connectors', 'evidence-collectors', 'identity', 'workflow', 'audit'];
const OLD_PAGES = ['/admin/organization', '/admin/users', '/admin/roles', '/admin/departments', '/admin/password-policy', '/admin/cloud-connectors', '/admin/connectors',
  '/admin/audit-logs', '/admin/ai-usage', '/admin/ai-governance', '/admin/usage', '/admin/scheduler', '/workflow-engine'];

test('13 sections in 7 groups, each with a name, an address of its own and the right group', () => {
  assert.equal(ADMIN_SECTIONS.length, 13);
  assert.deepEqual(ADMIN_GROUPS.map((g) => g.id), ['organisation', 'people', 'connections', 'ai', 'automation', 'audit', 'settings']);
  assert.equal(new Set(ADMIN_SECTIONS.map((s) => s.id)).size, 13, 'ids are unique');
  assert.equal(new Set(ADMIN_SECTIONS.map((s) => s.url)).size, 13, 'addresses are unique');
  assert.equal(new Set(ADMIN_SECTIONS.map((s) => s.label)).size, 13, 'names are unique (the menu, the heading and the registry all say it)');
  for (const s of ADMIN_SECTIONS) {
    assert.ok(s.label.trim() === s.label && s.label.length > 2, s.id);
    assert.ok(ADMIN_GROUPS.some((g) => g.id === s.group), `${s.id}: its group exists`);
    assert.match(s.url, /^\/(admin\/[a-z-]+|workflow-engine)$/, `${s.id}: /admin/<section>, or the builder's own address`);
    for (const p of s.paths) assert.match(p, /^\/admin\/[a-z-]+$/, `${s.id}: a listed path`);
    for (const right of s.rights) assert.match(right, /^[a-z_]+:[a-z_]+:[a-z_*]+$/, `${s.id}: ${right} is module:submodule:action`);
    for (const k of s.keywords) assert.ok(k.trim() === k && k.length > 1, `${s.id}: keyword ${k}`);
    assert.equal(new Set(s.keywords).size, s.keywords.length, `${s.id}: a keyword listed twice`);
  }
});

test('only the workflow builder is a full-width page of its own; the others sit beside the section list', () => {
  assert.deepEqual(ADMIN_SECTIONS.filter((s) => s.layout === 'full').map((s) => s.id), ['workflow']);
  assert.equal(sectionById('workflow')?.url, '/workflow-engine');
});

test('the menu order: the groups in order, the sections inside each in the order of the list', () => {
  const grouped = groupedSections();
  assert.deepEqual(grouped.map((g) => g.group.label), ['Organisation', 'People & access', 'Connections', 'AI', 'Automation', 'Audit', 'Settings']);
  assert.deepEqual(grouped.map((g) => g.sections.map((s) => s.id)), [
    ['organization', 'departments'], ['users', 'roles', 'password-policy', 'sso'], ['connections'], ['ai-governance', 'ai-usage'], ['workflow', 'scheduler'], ['audit-logs'], ['module-settings'],
  ]);
  assert.deepEqual(groupedSections([]), [], 'a group with nothing in it is not drawn');
  assert.deepEqual(groupedSections(ADMIN_SECTIONS.filter((s) => s.group === 'ai')).map((g) => g.group.id), ['ai']);
});

test('administrators are offered every section; nobody else is offered any (delegated administration is a decision for the user, no right changes here)', () => {
  assert.equal(visibleSections({ isAdmin: true }), ADMIN_SECTIONS);
  assert.deepEqual(visibleSections({ isAdmin: false }), []);
});

test('every address an Administration page had before is one section\'s (nothing is lost, nothing is two sections\')', () => {
  for (const path of OLD_PAGES) assert.ok(sectionOfPath(path), `${path} belongs to a section`);
  assert.equal(sectionOfPath('/admin/usage')?.id, 'ai-usage', 'Usage Monitoring joins AI usage');
  assert.equal(sectionOfPath('/admin/cloud-connectors')?.id, 'connections');
  assert.equal(sectionOfPath('/admin/connectors')?.id, 'connections');
  assert.equal(sectionOfPath('/admin/evidence-collectors'), undefined, "the Controls Automation menu's Connections page is not drawn inside Administration (its tab alias still opens /admin/connections?kind=evidence)");
  assert.equal(sectionOfPath('/admin/users/12/usage')?.id, 'users', 'a person\'s AI usage is a page of Users');
  assert.equal(sectionOfPath('/admin/users/')?.id, 'users', 'a trailing slash');
  assert.equal(sectionOfPath('/admin/users?x=1')?.id, 'users', 'a query');
  assert.equal(sectionOfPath('/admin/organization')?.id, 'organization');
});

test('addresses that are not a section\'s: the tab host, the scanner onboarding pages, the style guide, the forwards, near misses', () => {
  for (const path of ['/admin', '/admin/', '/admin/agents', '/admin/discover', '/admin/integrations/connect', '/admin/ui-kit', '/admin/teams', '/admin/access-reviews', '/administrator', '/admin/userspace', '/users', '/', '', null, undefined]) {
    assert.equal(sectionOfPath(path as string), undefined, String(path));
  }
});

test('the menu lights the section\'s own address, whatever page of the section is open', () => {
  assert.equal(adminActiveHref('/admin/users/7/usage'), '/admin/users');
  assert.equal(adminActiveHref('/admin/usage'), '/admin/ai-usage');
  assert.equal(adminActiveHref('/workflow-engine'), '/workflow-engine');
  assert.equal(adminActiveHref('/governance'), undefined);
});

test('every old tab id opens a section, and none opens two', () => {
  for (const tab of OLD_TABS) assert.ok(sectionOfTab(tab), `?tab=${tab}`);
  const all = ADMIN_SECTIONS.flatMap((s) => s.tabs.map((a) => a.tab));
  assert.equal(new Set(all).size, all.length, 'a tab id belongs to one section');
  assert.deepEqual(OLD_TABS.filter((tab) => !all.includes(tab)), []);
  assert.equal(sectionOfTab('teams')?.section.id, 'departments', 'the Teams tab became Departments');
  assert.equal(sectionOfTab('nonsense'), undefined);
  assert.equal(sectionOfTab(null), undefined);
});

test('/admin?tab= forwards to the section, keeping every other parameter', () => {
  assert.equal(legacyTarget(new URLSearchParams('tab=users')).href, '/admin/users');
  assert.equal(legacyTarget(new URLSearchParams('tab=roles')).href, '/admin/roles');
  assert.equal(legacyTarget(new URLSearchParams('tab=company')).href, '/admin/organization');
  assert.equal(legacyTarget(new URLSearchParams('tab=departments')).href, '/admin/departments');
  assert.equal(legacyTarget(new URLSearchParams('tab=teams')).href, '/admin/departments');
  assert.equal(legacyTarget(new URLSearchParams('tab=password-policy')).href, '/admin/password-policy');
  assert.equal(legacyTarget(new URLSearchParams('tab=identity')).href, '/admin/sso');
  assert.equal(legacyTarget(new URLSearchParams('tab=workflow')).href, '/workflow-engine');
  assert.equal(legacyTarget(new URLSearchParams('tab=audit')).href, '/admin/audit-logs');
  // the organisation profile's stage (links of the framework onboarding: /admin?tab=profile&stage=data_systems) stays, and "profile" alone opens the first stage still open
  assert.equal(legacyTarget(new URLSearchParams('tab=profile&stage=data_systems')).href, '/admin/organization?stage=data_systems');
  assert.equal(legacyTarget(new URLSearchParams('tab=profile')).href, '/admin/organization?stage=profile');
  // the four kinds of connection
  assert.equal(legacyTarget(new URLSearchParams('tab=integrations')).href, '/admin/connections?kind=scanners');
  assert.equal(legacyTarget(new URLSearchParams('tab=cloud-connectors&provider=aws')).href, '/admin/connections?kind=cloud&provider=aws');
  assert.equal(legacyTarget(new URLSearchParams('tab=connectors')).href, '/admin/connections?kind=tools');
  assert.equal(legacyTarget(new URLSearchParams('connector=github&tab=evidence-collectors')).href, '/admin/connections?kind=evidence&connector=github');
  // what the request says wins over what an alias adds
  assert.equal(legacyTarget(new URLSearchParams('tab=integrations&kind=cloud')).href, '/admin/connections?kind=cloud');
  // no tab, or one nobody knows: the first section, with the rest of the query
  assert.equal(legacyTarget(new URLSearchParams('')).href, ADMIN_HOME);
  assert.equal(legacyTarget(undefined).href, ADMIN_HOME);
  assert.equal(legacyTarget(new URLSearchParams('tab=nonsense&x=1')).href, `${ADMIN_HOME}?x=1`);
  assert.equal(ADMIN_HOME, '/admin/organization');
});

test('the forward takes the shapes Next hands a server page (a plain object, a repeated key, an undefined) as well as URLSearchParams', () => {
  assert.equal(legacyTarget({ tab: 'users' }).href, '/admin/users');
  assert.equal(legacyTarget({ tab: 'cloud-connectors', provider: 'azure' }).href, '/admin/connections?kind=cloud&provider=azure');
  assert.equal(legacyTarget({ tab: 'profile', stage: ['data_systems'] }).href, '/admin/organization?stage=data_systems');
  assert.equal(legacyTarget({ tab: undefined, x: 'a b' }).href, '/admin/organization?x=a+b');
  assert.equal(legacyTarget({ tab: ['roles', 'users'] }).href, '/admin/roles', 'the first of a repeated tab');
  const forward = legacyTarget({ tab: 'users', q: 'a&b' });
  assert.equal(forward.search, '?q=a%26b');
  assert.equal(forward.pathname, '/admin/users');
});
