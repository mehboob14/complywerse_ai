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
const QUEUE = 'Needs my action';       // everyone who is signed in has their own queue, whatever their rights

test("cfsb's Demo staff (Policies & Documents view + Task Management view) see their queue, Task Management and Governance only (My Approvals became the queue)", () => {
  assert.deepEqual(sees(me(['governance:policies:view', 'critical_tasks:tasks:view'])), [
    QUEUE,
    'Task Management',
    ['Governance', ['Overview', 'Documents']],
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
    QUEUE,
    ['Cybersecurity Assurance', ['Performance', 'Vulnerabilities', 'Vulnerability Scanning', 'AI Pentest']],
  ]);
  assert.deepEqual(sees(me(['assets:asset_inventory:view'])), [
    QUEUE,
    ['Cybersecurity Assurance', ['Performance', 'IT Asset Discovery', 'IT Asset Inventory']],
  ]);
  assert.deepEqual(sees(me(['reports:analytics:view'])), [QUEUE, ['Reports', ['Trends', 'Analytics']]]);
  assert.deepEqual(sees(me(['reports:reports:export'])), [QUEUE, ['Reports', ['Reports', 'Trends']]]);
});

test('nobody signed in sees nothing; a signed-in person with no permission sees only their own queue (a reviewer asked about a document has nothing else to open)', () => {
  assert.deepEqual(sees(null), []);
  assert.deepEqual(sees({ authenticated: false, user: null }), []);
  assert.deepEqual(sees(me([])), [QUEUE]);
  assert.deepEqual(sees(me(['dashboard:overview:view'])).slice(0, 1), [QUEUE]);
});

test('Needs my action is the first entry, open to everyone signed in by what it says (signedIn), not by a hole in the rule: no other entry is', () => {
  const first = navigation[0];
  assert.ok(!isGroup(first) && first.name === QUEUE && first.href === '/needs-my-action' && first.signedIn === true);
  assert.deepEqual(flattenLeaves(navigation).filter((l) => l.signedIn).map((l) => l.name), [QUEUE]);
  assert.deepEqual(flattenLeaves(navigation).filter((l) => !l.requiredPermissions?.length).map((l) => l.name), [QUEUE]);
  assert.equal(flattenLeaves(navigation).some((l) => l.href === '/governance/approvals'), false, 'the old address forwards: it has no entry of its own');
  assert.deepEqual(navPermissions('/needs-my-action'), [], 'no right is needed: the page guards nothing, its three sources answer only for the person');
});

test('every entry names the permissions that open it, and its page guards itself with the same ones', () => {
  for (const item of flattenLeaves(navigation)) {
    assert.ok(item.requiredPermissions?.length || item.signedIn, `${item.name} (${item.href}) would be shown to everyone`);
  }
  for (const href of ['/cyber-assurance/dashboard', '/cyber-assurance/pentest', '/reports', '/reports/analytics',
    '/reports/dashboards', '/reports/trends', '/reports/print', '/users', '/complychat']) {
    assert.ok(navPermissions(href).length, href);
  }
  assert.deepEqual(navPermissions('/reports/analytics'), ['reports:analytics:*']);
  assert.deepEqual(navPermissions('/nowhere'), []);
});

// ── the owner of a department (D59) ──

test('the owner of a department sees the Overview and the Documents area whatever their rights, and nothing else of Governance opens with it', () => {
  const owner = (permissions: string[] = []) => me(permissions, { heads_department: true });
  // (Needs my action is the one entry every signed-in person has, rights or none: it is listed first in every expectation here)
  assert.deepEqual(sees(owner()), ['Needs my action', ['Governance', ['Overview', 'Documents']]], 'no right at all: the queue and the two doors');
  assert.deepEqual(sees(me([])), ['Needs my action'], 'a person who heads nothing sees only the queue');
  assert.deepEqual(sees(me([], { heads_department: false })), ['Needs my action']);
  assert.deepEqual(sees(owner(['governance:policies:view'])), sees(me(['governance:policies:view'])), 'with the governance right the door adds nothing');
  assert.deepEqual(sees(owner(['critical_tasks:tasks:view'])), ['Needs my action', 'Task Management', ['Governance', ['Overview', 'Documents']]], 'a right in another module: the group opens for the doors only');
  assert.deepEqual(sees(owner(['governance:committees:view'])), ['Needs my action', ['Governance', ['Overview', 'Documents', 'Committees']]], 'and what their rights open stays');
  assert.deepEqual(sees(owner(['erm:kris:view'])).find((e) => Array.isArray(e) && e[0] === 'Governance'), ['Governance', ['Overview', 'Documents']], 'KRIs is a Governance entry they cannot reach by the door');
  const admin = { permissions: ['*:*:*'], allowed_modules: [], is_admin: true };
  assert.deepEqual(sees(me([], { ...admin, heads_department: true })), sees(me([], admin)), 'an administrator sees what an administrator sees');
  assert.equal(navAccessFromMe(me([], { heads_department: true })).headsDepartment, true);
  assert.equal(navAccessFromMe(me([])).headsDepartment, false);
  assert.equal(navAccessFromMe(null).headsDepartment, false);
});

test('only the Overview and the Documents entries are doors, and the top bar gives the owner the tabs made for them', async () => {
  const { readFileSync } = await import('node:fs');
  assert.deepEqual(flattenLeaves(navigation).filter((i) => i.ownerDoor).map((i) => i.name), ['Overview', 'Documents']);
  const header = readFileSync(new URL('./Header.tsx', import.meta.url), 'utf8');
  assert.ok(header.includes('perms.headsDepartment ? <DocumentsTabs ownerOnly /> : null'), 'the strip for someone with no governance right but a department');
  const tabs = readFileSync(new URL('../governance/DocumentsTabs.tsx', import.meta.url), 'utf8');
  assert.ok(tabs.includes('ownerOnly = false') && tabs.includes('ownerOnly })'), 'the strip asks the registry for the owner\'s tabs');
  const hook = readFileSync(new URL('../../hooks/usePermissions.ts', import.meta.url), 'utf8');
  assert.ok(hook.includes('data.user.heads_department') && hook.includes('headsDepartment,'), 'the hook reads the flag from /auth/me and shares it');
});
