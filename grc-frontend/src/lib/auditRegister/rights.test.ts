// node --test "src/lib/auditRegister/rights.test.ts"
// The Issue Register's rights: the table the page draws its controls from (rights.ts) is the one the SERVER enforces. The test reads routers/audit_register.py, finds the dependency of
// every route an action calls and compares it with the table, so a route whose right changes (or an action the table gets wrong) fails here before a person meets a button that
// answers "Permission denied".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { ACTION_RIGHT, ACTION_ROUTE, RIGHT_KEYS, can, isOwnerRole, rightsOf, setupSections, type RegisterAction, type RegisterRights } from './rights.ts';

const ROUTER = new URL('../../../../backend/grc/modules/issue_management/routers/audit_register.py', import.meta.url);

/** "METHOD /path" -> the right its `dependencies=[Depends(_require_X)]` names. */
function serverRights(): Map<string, string> {
  const src = readFileSync(ROUTER, 'utf8');
  const out = new Map<string, string>();
  for (const m of Array.from(src.matchAll(/@router\.(get|post|put|patch|delete)\("([^"]*)",\s*dependencies=\[Depends\(_require_(view|edit|create|delete)\)\]/g))) out.set(`${m[1]} ${m[2]}`, m[3]);
  return out;
}

test('every action the page offers asks for the right the route asks for', { skip: !existsSync(ROUTER) }, () => {
  const server = serverRights();
  assert.ok(server.size >= 40, `read ${server.size} routes`);
  for (const action of Object.keys(ACTION_RIGHT) as RegisterAction[]) {
    const [method, path] = ACTION_ROUTE[action];
    assert.equal(server.get(`${method} ${path}`), ACTION_RIGHT[action], `${action}: ${method.toUpperCase()} ${path}`);
  }
});

test('the four rights are the register\'s own keys, read through hasPermission', () => {
  assert.deepEqual(RIGHT_KEYS, {
    view: 'issue_management:issues:view', edit: 'issue_management:issues:edit', create: 'issue_management:issues:create', delete: 'issue_management:issues:delete',
  });
  const granted = new Set(['issue_management:issues:view', 'issue_management:issues:edit']);
  assert.deepEqual(rightsOf((k) => granted.has(k)), { view: true, edit: true, create: false, delete: false });
});

const NONE: RegisterRights = { view: false, edit: false, create: false, delete: false };
const READER: RegisterRights = { ...NONE, view: true };
const OWNER: RegisterRights = { ...READER, edit: true };
const DESK: RegisterRights = { ...OWNER, create: true };
const ALL: RegisterRights = { ...DESK, delete: true };

test('a reader reads; an owner also submits and asks; Audit Services decides and edits; only delete deletes', () => {
  assert.equal(can(READER, 'read'), true);
  assert.equal(can(READER, 'submitValidation'), false);
  assert.equal(can(OWNER, 'submitValidation'), true);
  assert.equal(can(OWNER, 'requestExtension'), true);
  assert.equal(can(OWNER, 'decideValidation'), false);
  assert.equal(can(OWNER, 'addFinding'), false);
  assert.equal(can(DESK, 'decideValidation'), true);
  assert.equal(can(DESK, 'upload'), true);
  assert.equal(can(DESK, 'deleteFinding'), false);
  assert.equal(can(ALL, 'deleteFinding'), true);
  assert.equal(can(ALL, 'restoreFinding'), true);
  assert.equal(can(NONE, 'read'), false);
});

test('a person without the view right can do nothing: every action needs view as well, so the page shows one "no access" instead of failing views', () => {
  // the rights are independent keys on the server (create does not imply view), the page asks for view first and says so once
  assert.equal(can(NONE, 'read'), false);
  assert.equal(isOwnerRole(NONE), false);
});

test('the register opens on "Mine" for an owner (edit without create), not for Audit Services or a reader', () => {
  assert.equal(isOwnerRole(OWNER), true);
  assert.equal(isOwnerRole(DESK), false);
  assert.equal(isOwnerRole(READER), false);
});

test('the setup sections follow what the server lets a person read: the settings with view, the mappings and imports with create', () => {
  assert.deepEqual(setupSections(READER), ['reminders', 'reports', 'lists', 'numbering']);
  assert.deepEqual(setupSections(OWNER), ['reminders', 'reports', 'lists', 'numbering']);
  assert.deepEqual(setupSections(DESK), ['owners', 'imports', 'reminders', 'reports', 'lists', 'numbering']);
  assert.deepEqual(setupSections(NONE), []);
});
