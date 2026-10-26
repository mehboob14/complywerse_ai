// node --test src/lib/departments.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { apiErrorText } from './apiError.ts';
import {
  DEACTIVATE_NOTE, DEPARTMENT_QUERY_KEYS, activatedText, deactivatedText, departmentCreateBody, departmentPatch, departmentPlaceholder, departmentRows,
  departmentsSummary, documentsLabel, howChips, memberSummary, parentChoices, refreshDepartments, removeBlock,
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

// ── Governance → Settings → Departments ──────────────────────────────────────

const node = (id: number, name: string, parent: number | null = null, is_active = true) => ({ id, name, parent_department_id: parent, is_active });
const shape = (rows: { department: { name: string }; depth: number }[]) => rows.map((r) => `${'  '.repeat(r.depth)}${r.department.name}`);

test('the table lists the top departments A-Z, each followed by the ones under it A-Z, indented', () => {
  const all = [
    node(1, 'Operations'), node(2, 'compliance'), node(3, 'Support', 1), node(4, 'Audit', 2), node(5, 'Helpdesk', 3),
    node(6, 'Billing', 1), node(7, 'Legacy unit', null, false), node(8, 'Dormant child', 2, false),
  ];
  assert.deepEqual(shape(departmentRows(all)), [
    'compliance', '  Audit', '  Dormant child', 'Legacy unit', 'Operations', '  Billing', '  Support', '    Helpdesk',
  ]);
  assert.deepEqual(departmentRows(all).map((r) => r.department.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);   // all of them, once
  assert.deepEqual(departmentRows([]), []);
  assert.deepEqual(departmentRows([node(2, 'Same'), node(1, 'same')]).map((r) => r.department.id), [1, 2]);          // equal names: both, by id
});

test('a department whose parent is not in the list, or is itself, or sits in a loop, is still listed', () => {
  const all = [node(10, 'Orphan', 99), node(11, 'Selfie', 11), node(20, 'Loop A', 21), node(21, 'Loop B', 20), node(30, 'Fine'), node(31, 'Child', 30)];
  const rows = departmentRows(all);
  assert.equal(rows.length, 6);
  assert.deepEqual(shape(rows), ['Fine', '  Child', 'Orphan', 'Selfie', 'Loop A', '  Loop B']);                // a loop has no top: it follows the rest
});

test('the Documents cell shows the number and says it in words for a tooltip or a screen reader', () => {
  assert.deepEqual(documentsLabel(12), { text: '12', long: '12 documents' });
  assert.deepEqual(documentsLabel(1), { text: '1', long: '1 document' });
  for (const none of [0, undefined, null, -3, Number.NaN]) assert.deepEqual(documentsLabel(none), { text: '0', long: 'No documents' });
  assert.equal(documentsLabel(2.9).text, '2');
});

test('the section says how many departments there are and how many are switched off', () => {
  assert.equal(departmentsSummary([]), '0 departments');
  assert.equal(departmentsSummary([{ is_active: true }]), '1 department');
  assert.equal(departmentsSummary([{ is_active: true }, { is_active: false }, { is_active: true }]), '3 departments · 1 inactive');
  assert.equal(departmentsSummary([{}, { is_active: false }, { is_active: false }]), '3 departments · 2 inactive');
});

test('after any change every list read from the departments is marked out of date', () => {
  const asked: (readonly string[])[] = [];
  refreshDepartments({ invalidateQueries: (filters) => { asked.push(filters.queryKey); } });
  assert.deepEqual(asked, DEPARTMENT_QUERY_KEYS.map((k) => k));
  for (const key of ['admin-departments', 'org-departments', 'signoff-targets']) assert.ok(asked.some((k) => k[0] === key), key);
});

test('switching a department off is explained, and said, the same way from Administration and from Settings', () => {
  assert.match(DEACTIVATE_NOTE, /Documents that are already in it keep it/);
  assert.match(DEACTIVATE_NOTE, /activate it again/);
  assert.equal(deactivatedText('Finance'), 'Finance is deactivated. Documents already in it keep it.');
  assert.equal(activatedText('Finance'), 'Finance is active again.');
});

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ADMIN_PAGE = '../app/(dashboard)/admin/departments/page.tsx';
const SETTINGS_SECTION = '../app/(dashboard)/governance/settings/_DepartmentsSection.tsx';

test('the department form and the deactivate question exist once: Administration and Settings open the same components', () => {
  const shared = source('../components/admin/DepartmentForm.tsx');
  assert.match(shared, /export function DepartmentFormModal/);
  assert.match(shared, /export function DeactivateModal/);
  for (const path of [ADMIN_PAGE, SETTINGS_SECTION]) {
    const page = source(path);
    for (const name of ['DepartmentFormModal', 'DeactivateModal']) {
      assert.match(page, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '@/components/admin/DepartmentForm'`), `${path} does not use the shared ${name}`);
      assert.doesNotMatch(page, new RegExp(`function ${name}\\b`), `${path} has its own ${name}`);
    }
  }
});

test('Settings changes departments only for those the server lets, and links to the tab where members and roles are managed', () => {
  const section = source(SETTINGS_SECTION);
  assert.match(section, /const EDIT_RIGHT = 'admin:organization:edit'/);                       // the right departments_router asks for
  assert.match(section, /hasPermission\(EDIT_RIGHT\)/);
  const router = new URL('../../../backend/grc/routers/admin_departments_router.py', import.meta.url);        // (when the backend is beside the frontend)
  if (existsSync(router)) assert.match(readFileSync(router, 'utf8'), /require_tenant_permission\("admin:organization:edit"\)/);
  const link = /href="(\/admin\?tab=([a-z-]+))"/.exec(section);
  assert.equal(link?.[1], '/admin?tab=departments');
  const admin = source('../app/(dashboard)/admin/page.tsx');
  assert.match(admin, new RegExp(`VALID_ADMIN_TABS = new Set<AdminTab>\\(\\[[^\\]]*'${link?.[2]}'`));     // a tab Administration really has
  assert.match(admin, new RegExp(`activeTab === '${link?.[2]}' && <DepartmentsAdminPage />`));
});

test('the Departments card comes first on Governance → Settings, and is there even when the approval settings are not', () => {
  const page = source('../app/(dashboard)/governance/settings/page.tsx');
  assert.match(page, /<DepartmentsSection \/>\s*<Section id="due"/);                              // before the first lifecycle card
  assert.equal(page.match(/<WithDepartments>/g)?.length, 2);                                      // the load error and "not switched on"
});
