// node --test src/lib/departments.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { apiErrorText } from './apiError.ts';
import {
  DEACTIVATE_NOTE, DEFAULT_LEVEL_LABELS, DEPARTMENT_QUERY_KEYS, LEVEL_NAME_MAX, MAX_DEPTH, MEMBER_ROLES, OWNER_NOTE, PARENT_LIMITS_NOTE, activatedText, addUnderLabel,
  deactivatedText, departmentCreateBody, departmentFormDirty, departmentPatch, departmentPickItems, departmentPlaceholder, departmentRows, departmentTree,
  departmentsSummary, descendantIds, documentsLabel, howChips, levelInputs, levelLabel, levelNamesBody, levelNamesChanged, memberSummary, parentChoices,
  parentPickItems, refreshDepartments, removeBlock, roleChips, roleItems, roleLabel, userItems, willBeText, type DepartmentForm,
} from './departments.ts';

test('how a person belongs: the lead, added by hand with the role they were given, and one chip for each role they hold', () => {
  assert.deepEqual(howChips({ how: ['head'] }).map((c) => c.label), ['Owner']);                                              // the department's head is its owner
  assert.deepEqual(howChips({ how: ['manual'], member_role: 'viewer' }).map((c) => c.label), ['Added by hand · Viewer']);
  assert.deepEqual(howChips({ how: ['manual'], member_role: null }).map((c) => c.label), ['Added by hand · Member']);          // no role sent: a member
  assert.deepEqual(howChips({ how: ['role'], via_roles: ['Compliance Officer', 'Auditor'] }).map((c) => c.label),
    ['Through role · Compliance Officer', 'Through role · Auditor']);
  assert.deepEqual(howChips({ how: ['role'], via_roles: [] }).map((c) => c.label), ['Through role']);                         // the server named none
  // in the order the server lists them, a person can be all three
  const all = howChips({ how: ['head', 'manual', 'role'], member_role: 'lead', via_roles: ['Auditor'] });
  assert.deepEqual(all.map((c) => [c.kind, c.label]), [['lead', 'Owner'], ['hand', 'Added by hand · Lead'], ['role', 'Through role · Auditor']]);   // "Lead" stays the membership role added by hand
  assert.equal(new Set(all.map((c) => c.key)).size, all.length);                                                               // keys for React
  assert.deepEqual(howChips({ how: [] }), []);
  assert.equal(roleLabel('lead'), 'Lead');                                                                                    // a role in the department, not its owner
  assert.equal(roleLabel(undefined), 'Member');
});

test('only a person added by hand can be removed here; the others are told how they belong', () => {
  assert.equal(removeBlock({ how: ['manual'], member_role: 'member' }), null);
  assert.equal(removeBlock({ how: ['manual', 'role'], via_roles: ['Auditor'] }), null);                  // by hand as well: Remove takes the hand-made part away
  assert.equal(removeBlock({ how: ['role'], via_roles: ['Compliance Officer'] }), 'Belongs through the role Compliance Officer');
  assert.equal(removeBlock({ how: ['role'], via_roles: ['A', 'B'] }), 'Belongs through the roles A, B');
  assert.equal(removeBlock({ how: ['role'] }), 'Belongs through a role');
  assert.match(removeBlock({ how: ['head'] }) ?? '', /owner of this department: change the owner under Edit/);
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
const EDITOR = '../components/admin/DepartmentsEditor.tsx';                                // the one editor (Administration > Departments; Governance > Settings links to it)
const SETTINGS_CARD = '../app/(dashboard)/governance/settings/_DepartmentsSection.tsx';

test('the department form and the deactivate question exist once: the one editor opens the shared form and asks with DEACTIVATE_NOTE, and Administration is that editor', () => {
  const shared = source('../components/admin/DepartmentForm.tsx');
  assert.match(shared, /export function DepartmentFormModal/);
  const editor = source(EDITOR);
  assert.match(editor, /import \{[^}]*\bDepartmentFormModal\b[^}]*\} from '@\/components\/admin\/DepartmentForm'/, 'the editor does not use the shared DepartmentFormModal');
  assert.doesNotMatch(editor, /function DepartmentFormModal\b/);
  assert.doesNotMatch(editor, /function DeactivateModal\b/);
  assert.match(editor, /useConfirm\(\)/);                                                         // the question is the kit's dialog every page shares
  assert.match(editor, /message: DEACTIVATE_NOTE/);
  assert.match(editor, /departmentsApi\.deactivate\(/);
  assert.match(editor, /drawer mode="create"/);                                                 // and the form is the drawer that asks before it discards typing
  assert.match(editor, /drawer mode="edit"/);
  assert.match(source(ADMIN_PAGE), /import \{ DepartmentsEditor \} from '@\/components\/admin\/DepartmentsEditor'/);
  assert.match(source(ADMIN_PAGE), /<DepartmentsEditor /);
});

test('the editor changes departments only for those the server lets, and everyone who opens it reads the people of a department', () => {
  const section = source(EDITOR);
  assert.match(section, /const EDIT_RIGHT = 'admin:organization:edit'/);                       // the right departments_router asks for
  assert.match(section, /hasPermission\(EDIT_RIGHT\)/);
  const router = new URL('../../../backend/grc/routers/admin_departments_router.py', import.meta.url);        // (when the backend is beside the frontend)
  if (existsSync(router)) assert.match(readFileSync(router, 'utf8'), /require_tenant_permission\("admin:organization:edit"\)/);
  assert.match(section, /const members: MenuItem = \{ key: 'members'/);                          // Members is in the menu of a read-only person too
  assert.match(section, /<DepartmentMembers department=\{managing\} canEdit=\{canEdit\}/);
  const members = source('../components/admin/DepartmentMembers.tsx');
  assert.match(members, /\{canEdit && \(/);                                                       // the add box is for who may edit
  assert.doesNotMatch(members, /window\.(confirm|alert|prompt)|<(button|select)\b/);
});

test('Governance Settings keeps a Departments card that says how many there are and links to Administration, with no editor of its own', () => {
  const card = source(SETTINGS_CARD);
  assert.match(card, /href="\/admin\/departments"/);
  assert.match(card, /id="departments"/);
  assert.doesNotMatch(card, /RegisterTable|DepartmentFormModal|departmentsApi/);
});

test('the Departments card comes first on Governance → Settings, and is there even when the approval settings are not', () => {
  const page = source('../app/(dashboard)/governance/settings/page.tsx');
  assert.match(page, /<DepartmentsSection \/>\s*<ExceptionApprovalsSection \/>\s*<SectionCard id="due"/);   // then the exception rules, before the first lifecycle card
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
  assert.deepEqual(Array.from(tree.subtree(1)).sort(), [1, 2, 3]);
  assert.deepEqual(Array.from(tree.subtree(4)).sort(), [4, 5]);
  assert.deepEqual([1, 2, 3, 4].map((id) => tree.height(id)), [2, 1, 0, 1]);
  assert.deepEqual(tree.childrenOf(1).map((d) => d.name), ['Support']);
  assert.equal(tree.parentOf(1), null);
  assert.deepEqual(Array.from(descendantIds(ops, 2)).sort(), [2, 3]);
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
  assert.deepEqual(Array.from(tree.subtree(10)).sort(), [10, 14]);
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

test('numbers in a name are read by value: "Finance 2" comes before "Finance 10" in the tree and in every picker', () => {
  const numbered = [
    { id: 1, name: 'Finance 10', parent_department_id: null }, { id: 2, name: 'Finance 2', parent_department_id: null },
    { id: 3, name: 'Team 10', parent_department_id: 2 }, { id: 4, name: 'Team 9', parent_department_id: 2 },
  ];
  assert.deepEqual(departmentRows(numbered).map((r) => r.department.name), ['Finance 2', 'Team 9', 'Team 10', 'Finance 10']);
  assert.deepEqual(departmentPickItems(numbered).map((i) => i.label), ['Finance 2', 'Finance 2 › Team 9', 'Finance 2 › Team 10', 'Finance 10']);
  assert.deepEqual(departmentTree(numbered).childrenOf(2).map((d) => d.name), ['Team 9', 'Team 10']);
});

// ── the front end of the tree: Owner, the form, the tree editor in Governance → Settings ─────────────────────────────────

const NAMES = ['Division', 'Branch', 'Team'];

test('the head of a department is its owner wherever it is named; a membership role added by hand keeps its name', () => {
  assert.equal(OWNER_NOTE, 'Sees the Documents overview for this department and everything under it.');
  const shared = source('../components/admin/DepartmentForm.tsx');
  assert.match(shared, /<Field label="Owner" info=\{OWNER_NOTE\}>/);
  assert.match(shared, /<MultiSelectDropdown title="Owner"/);
  assert.match(shared, /label: 'No owner'/);
  assert.doesNotMatch(shared, /No lead|label="Lead"|title="Lead"/);
  assert.match(source(EDITOR), /key: 'owner', header: 'Owner'/);
  assert.doesNotMatch(source(EDITOR), /header: 'Lead'/);
  assert.deepEqual(MEMBER_ROLES.map((r) => r.label), ['Lead', 'Member', 'Viewer']);                        // a role in the department, not its owner
});

test('the Documents cell shows its own number, and the number with everything under it as a second figure only when that is more', () => {
  assert.deepEqual(documentsLabel(3, 12), { text: '3', long: '3 documents in it, 12 with the departments under it', total: '12' });
  assert.deepEqual(documentsLabel(0, 4), { text: '0', long: 'No documents in it, 4 with the departments under it', total: '4' });
  assert.deepEqual(documentsLabel(1, 2), { text: '1', long: '1 document in it, 2 with the departments under it', total: '2' });
  assert.deepEqual(documentsLabel(3, 3), { text: '3', long: '3 documents' });                                 // nothing under it counts: as before
  assert.deepEqual(documentsLabel(3, 0), { text: '3', long: '3 documents' });
  assert.deepEqual(documentsLabel(3, undefined), { text: '3', long: '3 documents' });                         // an older server sends no total
  assert.deepEqual(documentsLabel(5, 2), { text: '5', long: '5 documents' });                                 // never a total below its own
});

test('"Add <next level>" is named by the level below the row, and the deepest level offers none', () => {
  assert.equal(addUnderLabel(1), 'Add Sub-department');
  assert.equal(addUnderLabel(2), 'Add Unit');
  assert.equal(addUnderLabel(3), null);
  assert.equal(addUnderLabel(4), null);                                                                       // data older than the limit
  assert.equal(addUnderLabel(1, NAMES), 'Add Branch');
  assert.equal(addUnderLabel(2, NAMES), 'Add Team');
});

test('the Parent field lists the places that fit, by path and level in tree order, and a department with others under it has fewer', () => {
  // a new one: not under a unit (nothing may go below the third level) and not under a switched-off department
  assert.deepEqual(parentPickItems(ops, null, null), [
    { value: '4', label: 'Finance', subLabel: 'Department' },
    { value: '1', label: 'Operations', subLabel: 'Department' },
    { value: '2', label: 'Operations › Support', subLabel: 'Sub-department' },
  ]);
  // Support has Helpdesk under it: with it, it fits only under a top department
  assert.deepEqual(parentPickItems(ops, 2, 1).map((i) => i.label), ['Finance', 'Operations']);
  // Treasury sits under Finance (switched on); the level names are the organisation's
  assert.deepEqual(parentPickItems(ops, 5, 4, NAMES), [
    { value: '4', label: 'Finance', subLabel: 'Division' },
    { value: '1', label: 'Operations', subLabel: 'Division' },
    { value: '2', label: 'Operations › Support', subLabel: 'Branch' },
  ]);
  // the department it sits under now is kept even when that one is switched off (so the choice still shows)
  const off = [{ id: 1, name: 'Old', parent_department_id: null, is_active: false }, { id: 2, name: 'Team', parent_department_id: 1 }];
  assert.deepEqual(parentPickItems(off, 2, 1), [{ value: '1', label: 'Old (inactive)', subLabel: 'Department' }]);
  assert.deepEqual(parentPickItems([], null, null), []);
});

test('the Parent field says what the department will be, in the organisation\'s own word and without an article', () => {
  assert.equal(willBeText(ops, null), 'Will be: Department');
  assert.equal(willBeText(ops, 1), 'Will be: Sub-department');
  assert.equal(willBeText(ops, 2), 'Will be: Unit');
  assert.equal(willBeText(ops, 2, NAMES), 'Will be: Team');
  assert.equal(willBeText([], 99), 'Will be: Sub-department');                                              // a parent the list does not know reads as a top department
  assert.match(PARENT_LIMITS_NOTE, /itself, the departments under it, and any place that would take it past 3 levels/);
});

test('a new department opened under a row is not dirty until something is typed or the parent is changed', () => {
  const opened = form({ name: '', description: '', parentId: 4, leadId: null, roleIds: [] });
  assert.equal(departmentFormDirty('create', undefined, opened, 4), false);                                   // "Add Sub-department", left alone
  assert.equal(departmentFormDirty('create', undefined, { ...opened, parentId: null }, 4), true);              // moved to the top
  assert.equal(departmentFormDirty('create', undefined, { ...opened, name: 'IT' }, 4), true);
  assert.equal(departmentFormDirty('create', undefined, opened), true);                                       // a parent chosen where none was given: as before
});

test('the Level names boxes start from what is saved, send a name for each level, and are changed only by a real difference', () => {
  const saved = { labels: ['Division', 'Sub-department', 'Team'], defaults: [...DEFAULT_LEVEL_LABELS] };
  assert.deepEqual(levelInputs(saved), ['Division', '', 'Team']);                                             // a level at its default is an empty box: the default is its placeholder
  assert.deepEqual(levelInputs({ labels: [...DEFAULT_LEVEL_LABELS], defaults: [...DEFAULT_LEVEL_LABELS] }), ['', '', '']);
  assert.deepEqual(levelInputs(undefined), ['', '', '']);                                                     // not read yet, or could not be
  assert.deepEqual(levelNamesBody([' Division ', '', 'Team']), ['Division', '', 'Team']);
  assert.deepEqual(levelNamesBody(['A']), ['A', '', '']);                                                     // always one for each of the three levels
  assert.equal(levelNamesChanged(saved, ['Division', '', 'Team']), false);
  assert.equal(levelNamesChanged(saved, ['  Division', '', 'Team  ']), false);                                // spaces are not a difference
  assert.equal(levelNamesChanged(saved, ['Division', 'Sub-department', 'Team']), false);                      // the default typed out is the default
  assert.equal(levelNamesChanged(saved, ['Division', '', '']), true);                                         // a name taken back
  assert.equal(levelNamesChanged(saved, ['Division', 'Branch', 'Team']), true);
  assert.equal(levelNamesChanged(undefined, ['', '', '']), false);
  assert.equal(levelNamesChanged(undefined, ['Division', '', '']), true);
  assert.equal(LEVEL_NAME_MAX, 40);                                                                           // the server's own limit (org_departments.LEVEL_LABEL_MAX)
});

test('the form: the Parent field names where the department will be and why places are missing, and a new one can be opened under a row', () => {
  const shared = source('../components/admin/DepartmentForm.tsx');
  assert.match(shared, /parentPickItems\(departments,/);
  assert.match(shared, /willBeText\(departments, form\.parentId, levelNames\)/);
  assert.match(shared, /info=\{hasUnder \? PARENT_LIMITS_NOTE : undefined\}/);                                // one short (i), not a sentence on the page
  assert.match(shared, /parentId: startParent = null/);
  assert.match(shared, /departmentFormDirty\(mode, department, form, startParent\)/);
  assert.match(shared, /`New \$\{levelLabel\(startParent == null \? 1 : tree\.level\(startParent\) \+ 1, levelNames\)\}`/);   // "New Sub-department" under a department
  // the level names come from one cached read that a change to the departments refreshes
  assert.match(shared, /export function useDepartmentLevels\(\)/);
  assert.match(shared, /queryKey: \['department-levels'\]/);
  assert.match(shared, /departmentsApi\.levels\(\)/);
  assert.ok(DEPARTMENT_QUERY_KEYS.some((k) => k[0] === 'department-levels'));
});

test('Settings is a tree editor: Level names for those who may edit, "Add <next level>" on a row, the level beside the name, no Parent column', () => {
  const section = source(EDITOR);
  const header = section.slice(section.indexOf('actions={canEdit ?'), section.indexOf('</SectionCard>'));
  const [editors, readOnly] = header.split(') : permsLoading ? undefined : (');
  assert.match(editors, /<ListTree aria-hidden \/>[\s\S]*Level names/);                                       // Level names is one of the editors' actions
  assert.match(editors, /onClick=\{\(\) => setNaming\(true\)\}/);
  assert.doesNotMatch(readOnly, /Level names|setNaming/);                                                     // a read-only person has the tree and the names, no controls
  assert.match(section, /departmentsApi\.setLevels\(levelNamesBody\(typed\)\)/);
  assert.match(section, /onError: \(e\) => setProblem\(errorMessage\(e\)\)/);                                  // the server's refusal sentence, beside the boxes
  assert.match(section, /toast: 'success'/);                                                                  // …and said once
  assert.match(section, /maxLength=\{LEVEL_NAME_MAX\}/);
  assert.match(section, /placeholder=\{defaults\[i\]\}/);                                                      // the default is the placeholder
  assert.match(section, /d\.is_active === false \? null : addUnderLabel\(levelOf\(row\), names\)/);            // not on a level-3 row, nor on a switched-off department
  assert.match(section, /parentId=\{creating\.parent\?\.id \?\? null\}/);                                      // "Add Sub-department" opens the form under the row
  assert.match(section, /key: 'level', header: 'Level'/);
  assert.doesNotMatch(section, /key: 'parent'/);
  assert.match(section, /documentsLabel\(d\.document_count, d\.document_count_total\)/);
  assert.match(section, /const names = levels\.data\?\.labels;/);
});
