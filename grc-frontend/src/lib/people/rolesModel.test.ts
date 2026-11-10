// node --test "src/lib/people/rolesModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMINISTRATOR, DEFAULT_ROLE_SORT, NO_MATRIX_FILTER, actionLabel, blankRole, catalogueNames, changeLine, columnNames, createRoleBody, deleteBlock, diffHeld, filterMatrix, filterRoles,
  formOfRole, impactLine, isFullAccess, isRoleDirty, menuPreview, namesOfModule, otherActions, outsideNames, permName, permissionSummary, roleErrors, setNames, sortRoles, tally,
  updateRoleBody, type CatalogueModule, type RoleRecord,
} from './rolesModel.ts';

const MATRIX: CatalogueModule[] = [
  { module: 'governance', display_name: 'Governance', submodules: [
    { name: 'documents', display_name: 'Documents', actions: ['view', 'create', 'edit', 'delete', 'approve', 'publish'] },
    { name: 'committees', display_name: 'Committees', actions: ['view', 'create', 'edit'] },
  ] },
  { module: 'dashboard', display_name: 'Dashboard', submodules: [
    { name: 'overview', display_name: 'Overview', actions: ['view'] },
    { name: 'ai_insights', display_name: 'AI insights', actions: ['view'] },
  ] },
];

const role = (patch: Partial<RoleRecord> = {}): RoleRecord => ({ id: 5, name: 'Auditor', description: null, is_system_role: false, user_count: 0, permissions: [], ...patch });

test('names are module:submodule:action; the catalogue lists every one once', () => {
  assert.equal(permName('governance', 'documents', 'view'), 'governance:documents:view');
  assert.equal(catalogueNames(MATRIX).length, 6 + 3 + 1 + 1);
  assert.equal(namesOfModule(MATRIX[1]).join(), 'dashboard:overview:view,dashboard:ai_insights:view');
  assert.deepEqual(columnNames(MATRIX[0], 'create'), ['governance:documents:create', 'governance:committees:create']);
  assert.deepEqual(columnNames(MATRIX[0], 'delete'), ['governance:documents:delete'], 'a row without the action has no box in that column');
  assert.deepEqual(otherActions(MATRIX[0].submodules[0]), ['approve', 'publish']);
  assert.equal(actionLabel('send_back'), 'Send back');
  assert.equal(actionLabel('approve_ciso'), 'Approve (CISO)');
  assert.equal(actionLabel('view'), 'View');
});

test('names a role holds outside the catalogue are found, listed once, and never dropped by a change', () => {
  const held = ['governance:documents:view', 'legacy:thing:view', 'legacy:thing:view', 'x:y:z'];
  assert.deepEqual(outsideNames(MATRIX, held), ['legacy:thing:view', 'x:y:z']);
  const after = setNames(held, ['governance:documents:view'], false);
  assert.deepEqual(after, ['legacy:thing:view', 'legacy:thing:view', 'x:y:z'], 'unticking one box touches only that name');
  assert.deepEqual(setNames(['a:b:c'], ['a:b:c', 'd:e:f', 'd:e:f'], true), ['a:b:c', 'd:e:f'], 'ticking twice adds once');
  assert.deepEqual(setNames([], ['d:e:f'], false), []);
});

test('the tally says none, some or all and counts only what is held', () => {
  const held = new Set(['governance:documents:view', 'governance:documents:edit']);
  assert.deepEqual(tally(namesOfModule(MATRIX[0]), held), { granted: 2, total: 9, state: 'some' });
  assert.equal(tally(namesOfModule(MATRIX[1]), held).state, 'none');
  assert.equal(tally(['governance:documents:view'], held).state, 'all');
  assert.equal(tally([], held).state, 'none');
});

test('searching the grid: every word must match; Granted only keeps rows that hold something; empty modules disappear', () => {
  const held = new Set(['dashboard:ai_insights:view']);
  assert.equal(filterMatrix(MATRIX, NO_MATRIX_FILTER, held).length, 2);
  assert.deepEqual(filterMatrix(MATRIX, { q: 'commit', grantedOnly: false }, held).map((m) => m.submodules.map((s) => s.name)), [['committees']]);
  assert.deepEqual(filterMatrix(MATRIX, { q: 'governance publish', grantedOnly: false }, held).map((m) => m.submodules.map((s) => s.name)), [['documents']]);
  assert.deepEqual(filterMatrix(MATRIX, { q: 'AI INSIGHTS', grantedOnly: false }, held).map((m) => m.module), ['dashboard']);
  assert.deepEqual(filterMatrix(MATRIX, { q: '', grantedOnly: true }, held).map((m) => [m.module, m.submodules.map((s) => s.name)]), [['dashboard', ['ai_insights']]]);
  assert.deepEqual(filterMatrix(MATRIX, { q: 'nothing like this', grantedOnly: false }, held), []);
  assert.deepEqual(filterMatrix(MATRIX, { q: 'governance:documents:approve', grantedOnly: false }, held).map((m) => m.module), ['governance'], 'a full name finds its row');
});

test('the Administrator role is Full access; other roles say how many of the catalogue they hold, outside names not counted', () => {
  assert.equal(isFullAccess(role({ name: ADMINISTRATOR })), true);
  assert.equal(isFullAccess(role({ name: 'administrator' })), false, 'the server compares the exact name');
  assert.equal(permissionSummary(role({ name: ADMINISTRATOR, is_system_role: true }), MATRIX), 'Full access');
  assert.equal(permissionSummary(role({ permissions: ['dashboard:overview:view', 'legacy:x:view'] }), MATRIX), '1 of 11');
  assert.equal(permissionSummary(role({ permissions: ['a:b:c', 'd:e:f'] }), null), '2 permissions', 'without the catalogue only the count is known');
  assert.equal(permissionSummary(role({ permissions: ['a:b:c'] }), null), '1 permission');
});

test('saving sends only what changed; a changed permission list is the WHOLE list, outside names included', () => {
  const saved = formOfRole(role({ name: 'Auditor', description: 'Reads', permissions: ['dashboard:overview:view', 'legacy:x:view'] }));
  assert.equal(isRoleDirty(saved, { ...saved }), false);
  assert.equal(isRoleDirty(saved, { ...saved, held: ['legacy:x:view', 'dashboard:overview:view'] }), false, 'the same set in another order');
  assert.deepEqual(updateRoleBody(saved, { ...saved, name: ' Auditors ' }), { name: 'Auditors' });
  assert.deepEqual(updateRoleBody(saved, { ...saved, description: '' }), { description: '' });
  assert.deepEqual(updateRoleBody(saved, { ...saved, held: setNames(saved.held, ['dashboard:ai_insights:view'], true) }), {
    permission_names: ['dashboard:overview:view', 'legacy:x:view', 'dashboard:ai_insights:view'],
  });
  assert.deepEqual(updateRoleBody(saved, saved), {});
  assert.deepEqual(createRoleBody({ name: ' New ', description: ' d ', held: ['a:b:c'] }), { name: 'New', description: 'd', permission_names: ['a:b:c'] });
  assert.deepEqual(blankRole(), { name: '', description: '', held: [] });
});

test('a role needs a name of at most 100 characters', () => {
  assert.deepEqual(roleErrors({ ...blankRole(), name: '   ' }), { name: 'Give the role a name.' });
  assert.deepEqual(roleErrors({ ...blankRole(), name: 'x'.repeat(101) }), { name: 'Use 100 characters or fewer.' });
  assert.deepEqual(roleErrors({ ...blankRole(), name: 'x'.repeat(100) }), {});
});

test('the words about a change: what is added and removed, and who it reaches', () => {
  const d = diffHeld(['a:b:c', 'x:y:z'], ['a:b:c', 'd:e:f', 'g:h:i']);
  assert.deepEqual(d, { added: ['d:e:f', 'g:h:i'], removed: ['x:y:z'] });
  assert.equal(changeLine(d), 'Adds 2 permissions, removes 1 permission');
  assert.equal(changeLine({ added: [], removed: ['a:b:c'] }), 'Removes 1 permission');
  assert.equal(changeLine({ added: [], removed: [] }), '');
  assert.equal(impactLine(0, true), '');
  assert.equal(impactLine(6, false), '', 'a rename touches nobody');
  assert.match(impactLine(6, true), /^6 people hold this role/);
  assert.match(impactLine(1, true), /^1 person holds this role/);
});

test('a role cannot be deleted while people hold it or when the platform made it', () => {
  assert.equal(deleteBlock(role()), null);
  assert.equal(deleteBlock(role({ is_system_role: true })), "A system role can't be deleted.");
  assert.equal(deleteBlock(role({ user_count: 1 })), '1 person holds this role. Take it off them first.');
  assert.equal(deleteBlock(role({ user_count: 3 })), '3 people hold this role. Take it off them first.');
});

test('the register filters by name or description and sorts by name, people or permissions', () => {
  const roles = [role({ id: 1, name: 'Viewer', user_count: 9, permissions: ['a:b:c'] }), role({ id: 2, name: 'auditor', description: 'Reads the log', user_count: 2, permissions: ['a:b:c', 'd:e:f', 'g:h:i'] }), role({ id: 3, name: 'Owner', user_count: 0 })];
  assert.deepEqual(filterRoles(roles, 'LOG').map((r) => r.id), [2]);
  assert.equal(filterRoles(roles, '  ').length, 3);
  assert.deepEqual(sortRoles(roles, DEFAULT_ROLE_SORT).map((r) => r.id), [2, 3, 1]);
  assert.deepEqual(sortRoles(roles, { key: 'people', dir: 'desc' }).map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(sortRoles(roles, { key: 'permissions', dir: 'desc' }).map((r) => r.id), [2, 1, 3]);
});

test('the menu preview is the sidebar\'s own rule applied to the draft: a role sees only what its names open; the Administrator role sees everything', () => {
  const none = menuPreview([], role(), []);
  assert.deepEqual(none.map((g) => g.label), ['Needs my action'], 'the person\'s own queue is for everyone signed in');
  const dash = menuPreview(['dashboard:overview:view'], role(), []);
  assert.ok(dash.some((g) => g.label === 'Performance Overview'));
  assert.ok(dash.length > none.length);
  const all = menuPreview([], role({ name: ADMINISTRATOR }), []);
  assert.ok(all.length > dash.length);
  assert.ok(all.every((g) => g.names.length > 0));
});
