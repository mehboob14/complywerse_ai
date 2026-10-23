// node --test src/lib/departments.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { apiErrorText } from './apiError.ts';
import {
  DEPARTMENT_QUERY_KEYS, departmentCreateBody, departmentPatch, departmentPlaceholder, howChips, memberSummary, parentChoices, removeBlock,
  roleChips, roleItems, roleLabel, userItems, type DepartmentForm,
} from './departments.ts';

test('how a person belongs: the lead, added by hand with the role they were given, and one chip for each role they hold', () => {
  assert.deepEqual(howChips({ how: ['head'] }).map((c) => c.label), ['Lead']);
  assert.deepEqual(howChips({ how: ['manual'], member_role: 'viewer' }).map((c) => c.label), ['Added by hand · Viewer']);
  assert.deepEqual(howChips({ how: ['manual'], member_role: null }).map((c) => c.label), ['Added by hand · Member']);          // no role sent: a member
  assert.deepEqual(howChips({ how: ['role'], via_roles: ['Compliance Officer', 'Auditor'] }).map((c) => c.label),
    ['Through role · Compliance Officer', 'Through role · Auditor']);
  assert.deepEqual(howChips({ how: ['role'], via_roles: [] }).map((c) => c.label), ['Through role']);                         // the server named none
  // in the order the server lists them, a person can be all three
  const all = howChips({ how: ['head', 'manual', 'role'], member_role: 'lead', via_roles: ['Auditor'] });
  assert.deepEqual(all.map((c) => [c.kind, c.label]), [['lead', 'Lead'], ['hand', 'Added by hand · Lead'], ['role', 'Through role · Auditor']]);
  assert.equal(new Set(all.map((c) => c.key)).size, all.length);                                                               // keys for React
  assert.deepEqual(howChips({ how: [] }), []);
  assert.equal(roleLabel('lead'), 'Lead');
  assert.equal(roleLabel(undefined), 'Member');
});

test('only a person added by hand can be removed here; the others are told how they belong', () => {
  assert.equal(removeBlock({ how: ['manual'], member_role: 'member' }), null);
  assert.equal(removeBlock({ how: ['manual', 'role'], via_roles: ['Auditor'] }), null);                  // by hand as well: Remove takes the hand-made part away
  assert.equal(removeBlock({ how: ['role'], via_roles: ['Compliance Officer'] }), 'Belongs through the role Compliance Officer');
  assert.equal(removeBlock({ how: ['role'], via_roles: ['A', 'B'] }), 'Belongs through the roles A, B');
  assert.equal(removeBlock({ how: ['role'] }), 'Belongs through a role');
  assert.match(removeBlock({ how: ['head'] }) ?? '', /lead of this department/);
});

test('the members header counts people and those who come through roles', () => {
  const m = (how: string[]) => ({ how });
  assert.equal(memberSummary([m(['role']), m(['manual']), m(['role', 'manual'])]), '3 people · 2 through roles');
  assert.equal(memberSummary([m(['role'])]), '1 person · 1 through a role');
  assert.equal(memberSummary([]), '0 people · 0 through roles');
});

test("a department's roles as chips, alphabetically, with the number left out", () => {
  const roles = [{ name: 'Zeta' }, { name: 'alpha' }, { name: 'Beta' }, { name: 'Gamma' }];
  assert.deepEqual(roleChips(roles, 3), { names: ['alpha', 'Beta', 'Gamma'], more: 1 });
  assert.deepEqual(roleChips(roles, 10), { names: ['alpha', 'Beta', 'Gamma', 'Zeta'], more: 0 });
  assert.deepEqual(roleChips([], 3), { names: [], more: 0 });
  assert.deepEqual(roleChips(null), { names: [], more: 0 });
});

test('role options say how many people hold each, and keep a chosen role the list no longer has', () => {
  const options = [{ id: 9, name: 'Reviewers', user_count: 1 }, { id: 8, name: 'Approvers', user_count: 2 }];
  assert.deepEqual(roleItems(options), [
    { value: '8', label: 'Approvers', subLabel: '2 people' },
    { value: '9', label: 'Reviewers', subLabel: '1 person' },
  ]);
  const kept = roleItems(options, [{ id: 8, name: 'Approvers' }, { id: 40, name: 'Old role' }]);
  assert.deepEqual(kept.map((i) => i.label), ['Approvers', 'Old role', 'Reviewers']);                       // 8 is an option already: not twice
  assert.deepEqual(roleItems(undefined), []);
});

test('people to choose from, by name, with their e-mail', () => {
  assert.deepEqual(userItems([{ id: 2, display_name: 'zara', email: 'z@x.test' }, { id: 1, display_name: 'Bilal', email: null }, { id: 3, display_name: '', email: 'c@x.test' }]), [
    { value: '1', label: 'Bilal', subLabel: undefined },
    { value: '3', label: 'c@x.test', subLabel: 'c@x.test' },
    { value: '2', label: 'zara', subLabel: 'z@x.test' },
  ]);
  assert.deepEqual(userItems(null), []);
});

test('a department can sit under any other except itself and what is under it, and not one switched off', () => {
  const all = [
    { id: 1, name: 'Compliance', parent_department_id: null },
    { id: 2, name: 'Audit', parent_department_id: 1 },
    { id: 3, name: 'Internal audit', parent_department_id: 2 },
    { id: 4, name: 'IT', parent_department_id: null },
    { id: 5, name: 'Old unit', parent_department_id: null, is_active: false },
  ];
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);
  assert.deepEqual(names(parentChoices(all, null, null)), ['Audit', 'Compliance', 'Internal audit', 'IT']);        // a new one: any active department
  assert.deepEqual(names(parentChoices(all, 1, null)), ['IT']);                                                    // Compliance: not itself, not Audit or what is under it
  assert.deepEqual(names(parentChoices(all, 3, 2)), ['Audit', 'Compliance', 'IT']);
  assert.deepEqual(names(parentChoices(all, 3, 5)), ['Audit', 'Compliance', 'IT', 'Old unit']);                    // the one it sits under now stays, even switched off
});

const dept = {
  name: 'Compliance', code: 'COMP', description: 'Rules', parent_department_id: 4, department_head_user_id: 7, is_active: true,
  roles: [{ id: 8 }, { id: 9 }],
};
const form = (over: Partial<DepartmentForm> = {}): DepartmentForm => ({
  name: 'Compliance', code: 'COMP', description: 'Rules', parentId: 4, leadId: 7, roleIds: [9, 8], active: true, ...over,
});

test('an edit sends only what changed; a cleared lead or parent is null, a cleared description is empty', () => {
  assert.deepEqual(departmentPatch(dept, form()), {});                                                   // nothing changed (roles in another order are the same)
  assert.deepEqual(departmentPatch(dept, form({ name: '  Risk and Compliance ' })), { name: 'Risk and Compliance' });
  assert.deepEqual(departmentPatch(dept, form({ code: '' })), {});                                       // an empty code keeps the one it has
  assert.deepEqual(departmentPatch(dept, form({ code: 'RC' })), { code: 'RC' });
  assert.deepEqual(departmentPatch(dept, form({ description: '' })), { description: '' });
  assert.deepEqual(departmentPatch(dept, form({ leadId: null, parentId: null })), { parent_department_id: null, department_head_user_id: null });
  assert.deepEqual(departmentPatch(dept, form({ roleIds: [8] })), { role_ids: [8] });
  assert.deepEqual(departmentPatch(dept, form({ roleIds: [] })), { role_ids: [] });                      // every role taken off
  assert.deepEqual(departmentPatch(dept, form({ active: false })), { is_active: false });
  // a department made without a description, lead, parent or roles
  const bare = { name: 'IT', code: 'IT', description: null, parent_department_id: null, department_head_user_id: null, is_active: true, roles: [] };
  assert.deepEqual(departmentPatch(bare, form({ name: 'IT', code: 'IT', description: '', parentId: null, leadId: null, roleIds: [] })), {});
});

test('a new department sends its name and only what was filled in', () => {
  assert.deepEqual(departmentCreateBody(form({ name: ' IT Security ', code: '', description: '', parentId: null, leadId: null, roleIds: [] })), { name: 'IT Security' });
  assert.deepEqual(departmentCreateBody(form({ code: 'C1', roleIds: [3] })), {
    name: 'Compliance', code: 'C1', description: 'Rules', parent_department_id: 4, department_head_user_id: 7, role_ids: [3],
  });
});

test('the Department field of a document says why it has nothing to offer', () => {
  assert.equal(departmentPlaceholder({ failed: true, count: 0 }), "Couldn't load departments");
  assert.equal(departmentPlaceholder({ loading: true, count: 0 }), 'Loading departments…');
  assert.equal(departmentPlaceholder({ count: 0 }), 'No departments yet — an administrator adds them in Administration → Departments');
  assert.equal(departmentPlaceholder({ count: 3 }), 'Choose a department');
  assert.equal(departmentPlaceholder({ failed: true, loading: true, count: 2 }), "Couldn't load departments");        // a failed read is never "No departments yet"
});

test('the 409 that says why a person cannot be removed reaches the page as the server wrote it', () => {
  const sentence = 'Olivia belongs to this department through the role Compliance Officer; take the role off the department or remove her from the role.';
  assert.equal(apiErrorText({ response: { status: 409, data: { detail: sentence } } }, 'Remove failed.'), sentence);
  assert.equal(apiErrorText({ response: { status: 500, data: '<html>Internal</html>' } }, 'Remove failed.'), 'Remove failed.');
});

test('every list the pickers cache under a name is refreshed when a department changes', () => {
  const src = new URL('../', import.meta.url);
  const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'));
  const text = files.map((f) => readFileSync(new URL(f.replace(/\\/g, '/'), src), 'utf8')).join('\n');
  DEPARTMENT_QUERY_KEYS.forEach((key) => assert.ok(text.includes(`queryKey: ['${key[0]}'`), `no query is keyed ['${key[0]}'] any more`));
});
