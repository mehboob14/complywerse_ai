// node --test src/lib/departments.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { apiErrorText } from './apiError.ts';
import {
  DEACTIVATE_NOTE, DEFAULT_LEVEL_LABELS, DEPARTMENT_QUERY_KEYS, MAX_DEPTH, activatedText, deactivatedText, departmentCreateBody, departmentFormDirty, departmentPatch,
  departmentPickItems, departmentPlaceholder, departmentRows, departmentTree, departmentsSummary, descendantIds, documentsLabel, howChips, levelLabel, memberSummary,
  parentChoices, refreshDepartments, removeBlock, roleChips, roleItems, roleLabel, userItems, type DepartmentForm,
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
  assert.deepEqual(names(parentChoices(all, null, null)), ['Audit', 'Compliance', 'IT']);                          // a new one: any active department that is not the deepest level
  assert.deepEqual(names(parentChoices(all, 1, null)), []);                                                        // Compliance: not itself, not what is under it, and under IT its two levels would make four
  assert.deepEqual(names(parentChoices(all, 3, 2)), ['Audit', 'Compliance', 'IT']);
  assert.deepEqual(names(parentChoices(all, 3, 5)), ['Audit', 'Compliance', 'IT', 'Old unit']);                    // the one it sits under now stays, even switched off
});

const dept = {
  name: 'Compliance', code: 'COMP', description: 'Rules', parent_department_id: 4, department_head_user_id: 7, is_active: true,
  roles: [{ id: 8 }, { id: 9 }],
};
const form = (over: Partial<DepartmentForm> = {}): DepartmentForm => ({
  name: 'Compliance', description: 'Rules', parentId: 4, leadId: 7, roleIds: [9, 8], active: true, ...over,
});

test('an edit sends only what changed; a cleared lead or parent is null, a cleared description is empty', () => {
  assert.deepEqual(departmentPatch(dept, form()), {});                                                   // nothing changed (roles in another order are the same)
  assert.deepEqual(departmentPatch(dept, form({ name: '  Risk and Compliance ' })), { name: 'Risk and Compliance' });
  assert.deepEqual(departmentPatch(dept, form({ name: 'Risk' })), { name: 'Risk' });                      // the code the server made is never sent back
  assert.deepEqual(departmentPatch(dept, form({ description: '' })), { description: '' });
  assert.deepEqual(departmentPatch(dept, form({ leadId: null, parentId: null })), { parent_department_id: null, department_head_user_id: null });
  assert.deepEqual(departmentPatch(dept, form({ roleIds: [8] })), { role_ids: [8] });
  assert.deepEqual(departmentPatch(dept, form({ roleIds: [] })), { role_ids: [] });                      // every role taken off
  assert.deepEqual(departmentPatch(dept, form({ active: false })), { is_active: false });
  // a department made without a description, lead, parent or roles
  const bare = { name: 'IT', code: 'IT', description: null, parent_department_id: null, department_head_user_id: null, is_active: true, roles: [] };
  assert.deepEqual(departmentPatch(bare, form({ name: 'IT', description: '', parentId: null, leadId: null, roleIds: [] })), {});
});

test('a new department sends its name and only what was filled in, never a code (the server makes one from the name)', () => {
  assert.deepEqual(departmentCreateBody(form({ name: ' IT Security ', description: '', parentId: null, leadId: null, roleIds: [] })), { name: 'IT Security' });
  assert.deepEqual(departmentCreateBody(form({ roleIds: [3] })), {
    name: 'Compliance', description: 'Rules', parent_department_id: 4, department_head_user_id: 7, role_ids: [3],
  });
});

test('the form is dirty when closing it would lose something: typing in a new department, any change in an edit', () => {
  const empty = form({ name: '', description: '', parentId: null, leadId: null, roleIds: [] });
  assert.equal(departmentFormDirty('create', undefined, empty), false);                                         // opened and left alone
  assert.equal(departmentFormDirty('create', undefined, { ...empty, name: '   ' }), false);                     // spaces are no name
  for (const typed of [{ name: 'IT' }, { description: 'x' }, { parentId: 4 }, { leadId: 7 }, { roleIds: [3] }]) {
    assert.equal(departmentFormDirty('create', undefined, { ...empty, ...typed }), true, JSON.stringify(typed));
  }
  assert.equal(departmentFormDirty('edit', dept, form()), false);                                               // as it was (roles in another order are the same)
  assert.equal(departmentFormDirty('edit', dept, form({ name: ' Compliance ' })), false);                       // the save would trim it to the same name: nothing to lose
  for (const changed of [{ name: 'Risk' }, { description: '' }, { parentId: null }, { leadId: null }, { roleIds: [8] }, { active: false }]) {
    assert.equal(departmentFormDirty('edit', dept, form(changed)), true, JSON.stringify(changed));
  }
  assert.equal(departmentFormDirty('edit', undefined, empty), false);                                           // an edit with no department behaves as a new one
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

test('the department form exists once and the deactivate question says the same words: Administration and Settings open the same form and ask with DEACTIVATE_NOTE', () => {
  const shared = source('../components/admin/DepartmentForm.tsx');
  assert.match(shared, /export function DepartmentFormModal/);
  assert.match(shared, /export function DeactivateModal/);
  for (const path of [ADMIN_PAGE, SETTINGS_SECTION]) {
    const page = source(path);
    assert.match(page, /import \{[^}]*\bDepartmentFormModal\b[^}]*\} from '@\/components\/admin\/DepartmentForm'/, `${path} does not use the shared DepartmentFormModal`);
    assert.doesNotMatch(page, /function DepartmentFormModal\b/, `${path} has its own DepartmentFormModal`);
  }
  // Administration asks in the shared dialog; Settings asks through the kit's useConfirm (a dialog every page shares) with the very same note and the same call
  assert.match(source(ADMIN_PAGE), /import \{[^}]*\bDeactivateModal\b[^}]*\} from '@\/components\/admin\/DepartmentForm'/);
  const section = source(SETTINGS_SECTION);
  assert.doesNotMatch(section, /function DeactivateModal\b/);
  assert.match(section, /useConfirm\(\)/);
  assert.match(section, /message: DEACTIVATE_NOTE/);
  assert.match(section, /departmentsApi\.deactivate\(/);
  assert.match(section, /drawer mode="create"/);                                                 // and the form is the drawer that asks before it discards typing
  assert.match(section, /drawer mode="edit"/);
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
  assert.match(page, /<DepartmentsSection \/>\s*(?:<ExceptionApprovalsSection \/>\s*)?<SectionCard id="due"/);   // before the first lifecycle card (the exception approvals sit right after it)
  assert.equal(page.match(/<WithDepartments>/g)?.length, 2);                                      // the load error and "not switched on"
});


// ── the tree (D57) ───────────────────────────────────────────────────────────

const ops = [
  { id: 1, name: 'Operations', parent_department_id: null },
  { id: 2, name: 'Support', parent_department_id: 1 },
  { id: 3, name: 'Helpdesk', parent_department_id: 2 },
  { id: 4, name: 'Finance', parent_department_id: null },
  { id: 5, name: 'Treasury', parent_department_id: 4, is_active: false },
];

test("the tree knows each department's level, path, subtree and height", () => {
  const tree = departmentTree(ops);
  assert.equal(MAX_DEPTH, 3);
  assert.deepEqual([1, 2, 3, 4, 5].map((id) => tree.level(id)), [1, 2, 3, 1, 2]);
  assert.deepEqual(tree.path(3).map((d) => d.name), ['Operations', 'Support', 'Helpdesk']);
  assert.deepEqual([...tree.subtree(1)].sort(), [1, 2, 3]);
  assert.deepEqual([...tree.subtree(4)].sort(), [4, 5]);
  assert.deepEqual([1, 2, 3, 4].map((id) => tree.height(id)), [2, 1, 0, 1]);
  assert.deepEqual(tree.childrenOf(1).map((d) => d.name), ['Support']);
  assert.equal(tree.parentOf(1), null);
  assert.deepEqual([...descendantIds(ops, 2)].sort(), [2, 3]);
});

test('the tree reads a loop, a self-parent and a missing parent as top departments and loses none', () => {
  const old = [
    { id: 10, name: 'A', parent_department_id: 11 }, { id: 11, name: 'B', parent_department_id: 10 },    // a loop
    { id: 12, name: 'C', parent_department_id: 12 },                                                       // its own parent
    { id: 13, name: 'D', parent_department_id: 99 },                                                       // the parent is gone
    { id: 14, name: 'E', parent_department_id: 10 },                                                       // hangs off the loop
  ];
  const tree = departmentTree(old);
  assert.deepEqual(old.map((d) => tree.level(d.id)), [1, 1, 1, 1, 2]);
  assert.deepEqual(tree.path(14).map((d) => d.name), ['A', 'E']);
  assert.deepEqual([...tree.subtree(10)].sort(), [10, 14]);
  assert.deepEqual(departmentTree([]).path(1), []);
});

test('a chain deeper than three (older than the limit) offers nothing to sit under it and can still be moved up', () => {
  const deep = [
    { id: 1, name: 'L1', parent_department_id: null }, { id: 2, name: 'L2', parent_department_id: 1 },
    { id: 3, name: 'L3', parent_department_id: 2 }, { id: 4, name: 'L4', parent_department_id: 3 },
  ];
  assert.deepEqual(parentChoices(deep, null, null).map((d) => d.name), ['L1', 'L2']);       // a new one fits only under the first two levels
  assert.deepEqual(parentChoices(deep, 3, 2).map((d) => d.name), ['L1', 'L2']);             // L3 with L4 under it: only places that keep both within three
});

test('the level names default, and a level past the third is called as the third', () => {
  assert.deepEqual([...DEFAULT_LEVEL_LABELS], ['Department', 'Sub-department', 'Unit']);
  assert.deepEqual([1, 2, 3, 4].map((n) => levelLabel(n)), ['Department', 'Sub-department', 'Unit', 'Unit']);
  assert.deepEqual([1, 2, 3].map((n) => levelLabel(n, ['Division', 'Branch', 'Team'])), ['Division', 'Branch', 'Team']);
  assert.equal(levelLabel(2, []), 'Sub-department');                                         // no names sent: the defaults
});

test('a picker lists the departments by path in tree order with the level under the name', () => {
  assert.deepEqual(departmentPickItems(ops), [
    { value: '4', label: 'Finance', subLabel: 'Department' },                                // Treasury is switched off: left out
    { value: '1', label: 'Operations', subLabel: 'Department' },
    { value: '2', label: 'Operations › Support', subLabel: 'Sub-department' },
    { value: '3', label: 'Operations › Support › Helpdesk', subLabel: 'Unit' },
  ]);
  const kept = departmentPickItems(ops, { keep: [5, null], labels: ['Division', 'Branch', 'Team'] });
  assert.deepEqual(kept.find((i) => i.value === '5'), { value: '5', label: 'Finance › Treasury (inactive)', subLabel: 'Branch' });   // a document still sits in it
  assert.equal(departmentPickItems(ops, { withInactive: true }).length, 5);
  assert.deepEqual(departmentPickItems([]), []);
});
