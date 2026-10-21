import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flattenLeaves, isGroup, navAccessFromMe, navigation, navPermissions, visibleNav, type NavEntry } from './navAccess.ts';

// The sidebar as names: a group is [name, its entries], an entry its name.
type Shape = string | [string, Shape[]];
const shape = (entries: NavEntry[]): Shape[] => entries.map((e) => (isGroup(e) ? [e.name, shape(e.items)] : e.name));

const me = (permissions: string[], extra: Record<string, unknown> = {}, features: string[] = []) => ({
  authenticated: true,
  user: { permissions, allowed_modules: Array.from(new Set(permissions.map((p) => p.split(':')[0]))), is_admin: false, ...extra },
  tenant: { features },
});
const sees = (data: unknown) => shape(visibleNav(navigation, navAccessFromMe(data)));

test("cfsb's Demo staff (Policies & Documents view + Task Management view) see Task Management and Governance only", () => {
  assert.deepEqual(sees(me(['governance:policies:view', 'critical_tasks:tasks:view'])), [
    'Task Management',
    ['Governance', ['Overview', 'Documents', 'My Approvals']],
  ]);
});

test('an administrator sees every entry; a client feature still needs the tenant to have it', () => {
  const admin = { permissions: ['*:*:*'], allowed_modules: [], is_admin: true };
  assert.deepEqual(sees(me([], admin, ['audit_register'])), shape(navigation));
  const withoutRegister = shape(navigation.map((e) => (isGroup(e) && e.name === 'Auditor Portal'
    ? { ...e, items: e.items.filter((i) => i.name !== 'Issue Register') } : e)));
  assert.deepEqual(sees(me([], admin)), withoutRegister);
});

test('Cybersecurity Assurance and Reports show their entries to the rights that open them', () => {
  assert.deepEqual(sees(me(['vulnerabilities:vulnerability_register:view'])), [
    ['Cybersecurity Assurance', ['Performance', 'Vulnerabilities', 'Vulnerability Scanning', 'AI Pentest']],
  ]);
  assert.deepEqual(sees(me(['assets:asset_inventory:view'])), [
    ['Cybersecurity Assurance', ['Performance', 'IT Asset Discovery', 'IT Asset Inventory']],
  ]);
  assert.deepEqual(sees(me(['reports:analytics:view'])), [['Reports', ['Analytics']]]);
  assert.deepEqual(sees(me(['reports:reports:export'])), [['Reports', ['Quick export', 'Saved exports']]]);
});

test('nobody signed in, or a role with no permission, sees nothing', () => {
  assert.deepEqual(sees(null), []);
  assert.deepEqual(sees({ authenticated: false, user: null }), []);
  assert.deepEqual(sees(me([])), []);
});

test('every entry names the permissions that open it, and its page guards itself with the same ones', () => {
  for (const item of flattenLeaves(navigation)) {
    assert.ok(item.requiredPermissions?.length, `${item.name} (${item.href}) would be shown to everyone`);
  }
  for (const href of ['/cyber-assurance/dashboard', '/cyber-assurance/pentest', '/reports', '/reports/saved', '/reports/analytics',
    '/reports/dashboards', '/reports/trends', '/reports/print', '/users', '/complychat']) {
    assert.ok(navPermissions(href).length, href);
  }
  assert.deepEqual(navPermissions('/reports/analytics'), ['reports:analytics:*']);
  assert.deepEqual(navPermissions('/nowhere'), []);
});
