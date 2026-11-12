// node --test src/components/shell/shellAccess.test.ts
// What the palette, the crumbs and the panel may offer: the doors of the six personas of the lab (truth_nav.mjs method: the menu is computed from the real navAccess.ts),
// and the rule that a page is offered only where its menu entry is on the person's menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flattenLeaves, navAccessFromMe, navigation, visibleNav } from '../layout/navAccess.ts';
import { routeFor, searchRoutes } from '../../lib/navRegistry.ts';
import { documentsStrip, mayAskComplyAgent, offeredEntry, visibleLeafHrefs } from './shellAccess.ts';

const me = (permissions: string[], extra: Record<string, unknown> = {}, features: string[] = ['audit_register']) => ({
  authenticated: true,
  user: { permissions, allowed_modules: Array.from(new Set(permissions.map((p) => p.split(':')[0]))), is_admin: false, ...extra },
  tenant: { features },
});
const PERSONAS = {
  admin: me([], { permissions: ['*:*:*'], allowed_modules: [], is_admin: true }),
  rev1: me(['dashboard:overview:view']),
  ro1: me(['critical_tasks:tasks:view', 'dashboard:overview:view', 'erm:kris:view', 'erm:risks:view', 'governance:attestations:view', 'governance:committees:view', 'governance:meetings:view',
    'governance:policies:view', 'governance:policy_exceptions:view', 'governance:regulatory_changes:view', 'governance:settings:view', 'governance:workflows:view', 'is_projects:projects:view']),
  set1: me(['governance:settings:edit']),
  reg1: me(['governance:regulatory_changes:view']),
  two: me(['governance:committees:view', 'compliance:frameworks:view']),
};

/** the destinations the palette would offer for a query, for one persona */
function offered(who: unknown, query: string): string[] {
  const access = navAccessFromMe(who);
  const leaves = visibleLeafHrefs(visibleNav(navigation, access));
  return searchRoutes(query, { limit: 100, allow: (entry) => offeredEntry(entry, access, leaves) }).map((entry) => entry.path);
}
const leafCount = (who: unknown) => flattenLeaves(visibleNav(navigation, navAccessFromMe(who))).length;

test('the doors: the leaves each persona has (the lab compared the same six with the real file: the queue is the one door every signed-in person has)', () => {
  assert.equal(leafCount(PERSONAS.admin), flattenLeaves(navigation).length - 0, 'an administrator of a tenant with the register: every leaf');
  assert.equal(leafCount(PERSONAS.rev1), 2, 'the queue and the one page their right opens');
  assert.equal(leafCount(PERSONAS.set1), 1, 'only the queue: a settings right opens no menu door');
  assert.equal(leafCount(PERSONAS.reg1), 1, 'only the queue: a regulatory right opens no menu door');
  assert.ok(leafCount(PERSONAS.ro1) > leafCount(PERSONAS.rev1));
  assert.ok(leafCount(PERSONAS.two) > leafCount(PERSONAS.set1));
});

test('a reviewer is offered the queue and their one page, and nothing of Governance (their menu has no Governance door)', () => {
  const found = offered(PERSONAS.rev1, 'a');
  assert.ok(found.includes('/needs-my-action') && found.includes('/dashboard'));
  assert.ok(found.every((path) => !path.startsWith('/governance') && !path.startsWith('/erm') && !path.startsWith('/admin')), found.join(' '));
});

test('a settings-only or a regulatory-only person is offered no page whose menu door is shut for them (the door question G3 change 11 is still open)', () => {
  assert.ok(!offered(PERSONAS.set1, 'settings').includes('/governance/settings'));
  assert.ok(!offered(PERSONAS.reg1, 'regulatory').includes('/governance/regulatory-changes'));
  assert.deepEqual(offered(PERSONAS.set1, 'governance'), []);
});

test('a read-only Governance person is offered the Documents area, its tabs they hold the right for and the committees; not Administration', () => {
  const docs = offered(PERSONAS.ro1, 'documents');
  assert.ok(docs.includes('/governance/documents'));
  assert.ok(offered(PERSONAS.ro1, 'committees').includes('/governance/committees'));
  assert.ok(offered(PERSONAS.ro1, 'settings').includes('/governance/settings'), 'governance:settings:view opens the tab');
  assert.ok(!offered(PERSONAS.ro1, 'administration').some((path) => path.startsWith('/admin')), 'Administration is for administrators');
});

test('only administrators are offered Administration; an administrator is offered every page of a module their tenant has', () => {
  assert.ok(offered(PERSONAS.admin, 'administration').some((path) => path.startsWith('/admin')));
  const adminOnly = routeFor('/admin');
  assert.ok(adminOnly?.adminOnly);
  const access = navAccessFromMe(PERSONAS.two);
  assert.equal(offeredEntry(adminOnly!, access, visibleLeafHrefs(visibleNav(navigation, access))), false);
  assert.ok(offered(PERSONAS.admin, 'issue register').includes('/auditor-portal/issue-register'));
  assert.ok(!offered(me([], { permissions: ['*:*:*'], allowed_modules: [], is_admin: true }, []), 'issue register').includes('/auditor-portal/issue-register'), 'a client feature the tenant lacks is not offered, even to an administrator');
});

test('a person with two rights is offered the pages of both modules and no third', () => {
  const found = offered(PERSONAS.two, 'o');
  assert.ok(found.includes('/governance/committees') && found.includes('/frameworks'));
  assert.ok(found.every((path) => !path.startsWith('/erm') && !path.startsWith('/vendor-risk') && !path.startsWith('/cyber-assurance')));
});

test('the owner of a department with no governance right is offered the Overview and the library, and not the Studio', () => {
  const owner = me([], { heads_department: true });
  const found = offered(owner, 'documents');
  assert.ok(found.includes('/governance/documents'));
  assert.ok(offered(owner, 'overview').includes('/governance'), 'the Overview is a door (navAccess ownerDoor): its Departments and Board views are theirs to read');
  assert.ok(!offered(owner, 'studio').includes('/governance/documents/studio'), 'their rights do not open it');
  assert.ok(!offered(owner, 'overview').includes('/governance/documents/overview'), 'the old At a glance address is a forward: never offered');
  assert.ok(!offered(me([]), 'overview').includes('/governance'), 'a person who heads nothing has no door to it');
  assert.ok(offered(me(['governance:policies:view']), 'overview').includes('/governance'), 'with the governance right it is offered as it always was');
});

test('nobody signed in is offered anything', () => {
  const access = navAccessFromMe(null);
  assert.equal(offeredEntry(routeFor('/needs-my-action')!, access, new Set(['/needs-my-action'])), false);
});

test('Comply Agent is offered to those who hold its right and to administrators, and to no one else', () => {
  const may = (who: unknown) => { const access = navAccessFromMe(who); return mayAskComplyAgent(access, visibleLeafHrefs(visibleNav(navigation, access))); };
  assert.equal(may(PERSONAS.admin), true);
  assert.equal(may(me(['dashboard:ai_insights:view'])), true);
  assert.equal(may(PERSONAS.rev1), false);
  assert.equal(may(PERSONAS.ro1), false);
  assert.equal(may(null), false);
});

test('the Documents strip: every tab with a governance right (the Studio where it is on, Settings with its right), two for a department owner or anyone given access to a unit, none for anyone else', () => {
  const strip = (who: unknown, studio = true) => documentsStrip(navAccessFromMe(who), studio).map((t) => t.tab.id);
  assert.deepEqual(strip(PERSONAS.admin), ['documents', 'studio', 'attestation', 'reviews', 'exceptions', 'directory', 'settings']);
  assert.deepEqual(strip(PERSONAS.admin, false), ['documents', 'attestation', 'reviews', 'exceptions', 'directory', 'settings'], 'no Studio tab where it is off');
  assert.deepEqual(strip(PERSONAS.ro1), ['documents', 'studio', 'attestation', 'reviews', 'exceptions', 'directory', 'settings'], 'governance:settings:view holds the Settings right');
  assert.deepEqual(strip(me(['governance:policies:view'])), ['documents', 'studio', 'attestation', 'reviews', 'exceptions', 'directory'], 'no Settings without its right');
  assert.deepEqual(strip(me([], { heads_department: true })), ['documents', 'directory']);
  assert.deepEqual(strip(me([], { unit_rights: { '12': 'edit' } })), ['documents', 'directory'], 'a person given access to a unit has the same door as a department owner');
  assert.deepEqual(strip(me([], { unit_rights: {} })), [], 'no level on any unit: no door');
  assert.deepEqual(strip(PERSONAS.rev1), []);
  assert.deepEqual(strip(null), []);
});
