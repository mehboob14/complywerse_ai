// node --test src/components/shell/railModel.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flattenLeaves, navAccessFromMe, navigation, visibleNav } from '../layout/navAccess.ts';
import { activeNavHref } from '../layout/navActive.ts';
import { moduleOf, railOf } from './railModel.ts';

const me = (permissions: string[], extra: Record<string, unknown> = {}) => ({
  authenticated: true,
  user: { permissions, allowed_modules: Array.from(new Set(permissions.map((p) => p.split(':')[0]))), is_admin: false, ...extra },
  tenant: { features: ['audit_register'] },
});
const admin = me([], { permissions: ['*:*:*'], allowed_modules: [], is_admin: true });
const navOf = (who: unknown) => visibleNav(navigation, navAccessFromMe(who));
const lit = (who: unknown, path: string) => activeNavHref(path, navOf(who));

test('the rail of an administrator: the queue first and apart, then the eleven modules in menu order, each with a short name of at most ten letters', () => {
  const rail = railOf(navOf(admin), undefined);
  assert.equal(rail.queue?.name, 'Needs my action');
  assert.equal(rail.queue?.label, 'My action');
  // the cyber product's three groups (IT Asset, Cybersecurity, Help Desk) share the one 'Cyber' label (this rail is not mounted since the shell was reverted)
  assert.deepEqual(rail.modules.map((m) => m.label).filter((l, i, all) => l !== all[i - 1]), ['Overview', 'Tasks', 'Governance', 'Risk', 'Vendors', 'Compliance', 'Controls', 'Issues', 'Cyber', 'Reports', 'Audit']);
  assert.ok(rail.modules.every((m) => m.label.length <= 10 && m.name.length >= m.label.length - 4), 'a short name is shorter than the full one (or equal)');
  assert.ok(rail.modules.every((m) => typeof m.icon === 'object' || typeof m.icon === 'function'), 'every entry has an icon');
});

test('the accessible name always holds the visible short name: the full name, or both when the short one is a different word', () => {
  const rail = railOf(navOf(admin), undefined);
  const names = Object.fromEntries(rail.modules.map((m) => [m.label, m.ariaName]));
  assert.equal(names['Governance'], 'Governance');
  assert.equal(names['Risk'], 'Risk Management');
  assert.equal(names['Vendors'], 'Vendors (Third-Party Vendor Risk)');
  assert.equal(names['Tasks'], 'Tasks (Task Management)');
  assert.equal(names['Issues'], 'Issues (Issue & Incident Management)');
  assert.equal(names['Overview'], 'Performance Overview');
  assert.equal(rail.queue?.ariaName, 'Needs my action');
  for (const m of rail.modules) assert.ok(m.ariaName.toLowerCase().includes(m.label.toLowerCase()), `${m.label} is inside "${m.ariaName}"`);
});

test('a module opens on its first page the person may open; a page that stands alone opens itself', () => {
  const rail = railOf(navOf(admin), undefined);
  const byName = Object.fromEntries(rail.modules.map((m) => [m.name, m.href]));
  assert.equal(byName['Governance'], '/governance');
  assert.equal(byName['Third-Party Vendor Risk'], '/vendor-risk');
  assert.equal(byName['Performance Overview'], '/dashboard');
  assert.equal(byName['Reports'], '/reports/analytics');
  // someone whose first page is another: Reports for the one who may only export
  const exporter = railOf(navOf(me(['reports:reports:export'])), undefined);
  assert.equal(exporter.modules.find((m) => m.name === 'Reports')?.href, '/reports');
});

test('one entry is lit: the module that holds the page (true), or the entry itself when it stands alone (page)', () => {
  const nav = navOf(admin);
  const at = (path: string) => railOf(nav, activeNavHref(path, nav));
  const current = (path: string) => at(path).modules.concat(at(path).queue ? [at(path).queue!] : []).filter((m) => m.current).map((m) => `${m.name}:${m.current}`);
  assert.deepEqual(current('/governance/committees/3'), ['Governance:true']);
  assert.deepEqual(current('/governance/exceptions'), ['Governance:true'], 'a tab lights the module of the entry it hangs under');
  assert.deepEqual(current('/vendor-risk/intake'), ['Third-Party Vendor Risk:page']);
  assert.deepEqual(current('/needs-my-action'), ['Needs my action:page']);
  assert.deepEqual(current('/governance/approvals'), ['Needs my action:page'], 'the old address lights the queue');
  assert.deepEqual(current('/erm/risks/12'), ['Risk Management:true']);
  assert.deepEqual(current('/nowhere'), [], 'a page with no entry lights none');
  assert.deepEqual(current('/admin'), [], 'Administration is the rail\'s foot, not a module');
});

test('a reviewer\'s rail is the queue and the one page; a person with no right at all has the queue alone', () => {
  const rev = railOf(navOf(me(['dashboard:overview:view'])), undefined);
  assert.equal(rev.queue?.name, 'Needs my action');
  assert.deepEqual(rev.modules.map((m) => m.name), ['Performance Overview']);
  const none = railOf(navOf(me([])), undefined);
  assert.equal(none.queue?.name, 'Needs my action');
  assert.deepEqual(none.modules, []);
  const nobody = railOf(navOf(null), undefined);
  assert.equal(nobody.queue, undefined);
  assert.deepEqual(nobody.modules, []);
});

test('moduleOf: the entry that holds the lit page', () => {
  const nav = navOf(admin);
  assert.equal(moduleOf(nav, lit(admin, '/governance/documents/12'))?.name, 'Governance');
  assert.equal(moduleOf(nav, lit(admin, '/tasks'))?.name, 'Task Management');
  assert.equal(moduleOf(nav, lit(admin, '/vendor-risk/vendors/3'))?.name, 'Third-Party Vendor Risk');
  assert.equal(moduleOf(nav, undefined), undefined);
  assert.equal(moduleOf(nav, '/not/a/leaf'), undefined);
  assert.ok(flattenLeaves(nav).length > 40);
});
