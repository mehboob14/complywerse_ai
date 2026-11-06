import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_DEPARTMENT, creation, departmentFilterOptions, departmentNames, departmentPaths, departmentScopes, matchesDepartment, shownFrameworkIds, versionGroups,
  versionStates,
} from './library.ts';

test('the Frameworks column shows what the Details dialog edits, else the frameworks the document was made with', () => {
  assert.deepEqual(shownFrameworkIds({ applicable_framework_ids: [7, 9], framework_ids: [3] }), [7, 9]);
  assert.deepEqual(shownFrameworkIds({ applicable_framework_ids: [], framework_ids: [3] }), [3]);
  assert.deepEqual(shownFrameworkIds({ framework_ids: [3] }), [3]);                       // an older server sends no applicable ids
  assert.deepEqual(shownFrameworkIds({ applicable_framework_ids: null, framework_ids: null }), []);
});

test('creating documents is offered only where the Comply AI Studio is on', () => {
  assert.equal(creation(true, true), 'buttons');
  assert.equal(creation(true, undefined), 'buttons');                       // not known yet (or an older server): as before
  assert.equal(creation(true, false), 'studio-off');
  assert.equal(creation(false, false), null);
  assert.equal(creation(false, true), null);
});

const v = (...numbers: string[]) => numbers.map((number, i) => ({ id: 100 - i, number }));
const states = (rows: { state: string }[]) => rows.map((r) => r.state);

test("a version's state: the document's own number carries its state, the published one is in force, the rest superseded", () => {
  // published at 1.1, 1.2 on its way (in review): 1.2 says the document's state, 1.1 is the one everyone reads
  assert.deepEqual(states(versionStates(v('1.2', '1.1', '1.0'), { current_version: '1.2', version_in_force: '1.1' })),
    ['current', 'in-force', 'superseded']);
  // published at its newest: that one carries "Published", nothing is "in force" beside it
  assert.deepEqual(states(versionStates(v('2.0', '1.0'), { current_version: '2.0', version_in_force: '2.0' })), ['current', 'superseded']);
  // never published (a draft): no version is in force
  assert.deepEqual(states(versionStates(v('1.1', '1.0'), { current_version: '1.1', version_in_force: null })), ['current', 'superseded']);
  // someone who reads only the version in force gets the list up to it
  assert.deepEqual(states(versionStates(v('1.1', '1.0'), { current_version: '1.2', version_in_force: '1.1' })), ['in-force', 'superseded']);
  // no current number: the newest one is the current one
  assert.deepEqual(states(versionStates(v('3.0', '2.0'), {})), ['current', 'superseded']);
  assert.deepEqual(versionStates([], { current_version: '1.0' }), []);
});

test('the versions as a hierarchy: each major with its minor versions under it, newest major first, nothing dropped', () => {
  const numbers = (groups: { head: { number: string }; minors: { number: string }[] }[]) => groups.map((g) => [g.head.number, g.minors.map((x) => x.number)]);
  // the user's case: 1.0, 1.1, 1.2, then a major 2.0 and a minor 2.1 - 1.2 is still there, under 1.0
  assert.deepEqual(numbers(versionGroups(v('2.1', '2.0', '1.2', '1.1', '1.0'))), [['2.0', ['2.1']], ['1.0', ['1.2', '1.1']]]);
  assert.deepEqual(numbers(versionGroups(v('1.10', '1.9', '1.0'))), [['1.0', ['1.10', '1.9']]]);        // 1.10 is a minor of 1, not of 10
  // a document that started at a file's 4.3: its group starts there; a major alone is a group of its own
  assert.deepEqual(numbers(versionGroups(v('5.0', '4.4', '4.3'))), [['5.0', []], ['4.3', ['4.4']]]);
  const rows = v('1.2', '1.2', '1.1', '1.0');                                        // a number written twice: both rows kept
  const [one] = versionGroups(versionStates(rows, { current_version: '1.2' }));
  assert.deepEqual([one.head.id, ...one.minors.map((x) => x.id)], [97, 100, 99, 98]);
  assert.deepEqual([one.head.state, one.minors[0].state], ['superseded', 'current']); // the states come along
  assert.deepEqual(versionGroups([]), []);
});

test('a number written twice (a gap fix keeps a copy of the text before it): only the earliest row with it is in force', () => {
  const rows = versionStates(v('1.3', '1.2', '1.2', '1.1'), { current_version: '1.3', version_in_force: '1.2' });
  assert.deepEqual(states(rows), ['current', 'superseded', 'in-force', 'superseded']);
  assert.deepEqual(rows.map((r) => r.id), [100, 99, 98, 97]);              // the rows themselves are kept, in their order
});

test('the Department filter keeps the documents of one department, or those with none, and everything when off', () => {
  const docs = [{ id: 1, department_id: 4 }, { id: 2, department_id: null }, { id: 3, department_id: 12 }, { id: 4 }];
  const ids = (filter: string) => docs.filter((d) => matchesDepartment(d, filter)).map((d) => d.id);
  assert.deepEqual(ids(''), [1, 2, 3, 4]);                      // All
  assert.deepEqual(ids('4'), [1]);
  assert.deepEqual(ids('12'), [3]);                              // 12 is not 1: the id is compared whole
  assert.deepEqual(ids(NO_DEPARTMENT), [2, 4]);                 // no department (null, or not sent by an older server)
  assert.deepEqual(ids('99'), []);
});

test('the Department filter offers "No department" and the active departments with their level; a switched-off one only while a document is in it', () => {
  const departments = [
    { id: 2, name: 'risk', is_active: true }, { id: 1, name: 'Compliance', is_active: true },
    { id: 3, name: 'Old unit', is_active: false }, { id: 4, name: 'Closed unit', is_active: false },
  ];
  assert.deepEqual(departmentFilterOptions(departments, [{ department_id: 3 }, { department_id: null }]), [
    { value: NO_DEPARTMENT, label: 'No department' },
    { value: '1', label: 'Compliance', subLabel: 'Department' },
    { value: '3', label: 'Old unit (inactive)', subLabel: 'Department' },               // a document is in it: still findable
    { value: '2', label: 'risk', subLabel: 'Department' },
  ]);                                                             // 4 is out: nothing is in it
  assert.deepEqual(departmentFilterOptions([], []), [{ value: NO_DEPARTMENT, label: 'No department' }]);
  assert.deepEqual(departmentFilterOptions(undefined, [{ department_id: 3 }]), [{ value: NO_DEPARTMENT, label: 'No department' }]);
});

// ── the tree: choosing a department takes in the ones under it (D57) ──────────────────────────────────────────────────────────

const TREE = [
  { id: 1, name: 'Operations', parent_department_id: null, is_active: true },
  { id: 2, name: 'Support', parent_department_id: 1, is_active: true },
  { id: 3, name: 'Helpdesk', parent_department_id: 2, is_active: true },
  { id: 4, name: 'Billing', parent_department_id: 1, is_active: true },
  { id: 5, name: 'Finance', parent_department_id: null, is_active: true },
  { id: 6, name: 'Treasury', parent_department_id: 5, is_active: false },
];

test('each department knows itself and everything under it, however deep, and its whole path', () => {
  const scope = departmentScopes(TREE);
  const sorted = (key: string) => Array.from(scope[key]).sort((a, b) => a - b);
  assert.deepEqual(sorted('1'), [1, 2, 3, 4]);                 // Operations: Support, Helpdesk (two levels down) and Billing
  assert.deepEqual(sorted('2'), [2, 3]);
  assert.deepEqual(sorted('3'), [3]);                          // a unit has nothing under it: only itself
  assert.deepEqual(sorted('5'), [5, 6]);                       // a switched-off department under it is still in it
  assert.deepEqual(Object.keys(scope).sort(), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(departmentScopes(null), {});
  const paths = departmentPaths(TREE);
  assert.equal(paths['3'], 'Operations › Support › Helpdesk');
  assert.equal(paths['1'], 'Operations');                      // a top department: its path is its name
  assert.deepEqual(departmentPaths(undefined), {});
});

test('a department in the filter keeps the documents in it and in every department under it; "no department" stays exact', () => {
  const scope = departmentScopes(TREE);
  const docs = [1, 2, 3, 4, 5, 6, null].map((department_id, i) => ({ id: i + 1, department_id }));
  const ids = (filter: string, s: typeof scope | null = scope) => docs.filter((d) => matchesDepartment(d, filter, s)).map((d) => d.department_id);
  assert.deepEqual(ids('1'), [1, 2, 3, 4]);                    // Operations, Support, Helpdesk, Billing
  assert.deepEqual(ids('2'), [2, 3]);
  assert.deepEqual(ids('3'), [3]);
  assert.deepEqual(ids('5'), [5, 6]);
  assert.deepEqual(ids(NO_DEPARTMENT), [null]);                // a document in no department is in no department's tree
  assert.deepEqual(ids(''), [1, 2, 3, 4, 5, 6, null]);
  // without a scope (the departments are not known yet, an older caller): a department matches only itself, as it always did
  assert.deepEqual(ids('1', null), [1]);
  assert.deepEqual(ids('1', {}), [1]);
  assert.equal(matchesDepartment({ department_id: 2 }, '1'), false);                                          // no scope argument at all
  // an id the scope does not know matches itself; a value from the address that is a name every object has finds nothing and does not throw
  assert.deepEqual(ids('99'), []);
  assert.deepEqual(ids('constructor'), []);
  assert.deepEqual(ids('__proto__'), []);
  assert.equal(matchesDepartment({ department_id: 7 }, 'toString', scope), false);
});

test('the Department filter lists every department in tree order by its path with its level, in the organisation\'s own words', () => {
  const docs = [{ department_id: 6 }, { department_id: 3 }];
  assert.deepEqual(departmentFilterOptions(TREE, docs), [
    { value: NO_DEPARTMENT, label: 'No department' },
    { value: '5', label: 'Finance', subLabel: 'Department' },
    { value: '6', label: 'Finance › Treasury (inactive)', subLabel: 'Sub-department' },    // switched off, but a document is in it
    { value: '1', label: 'Operations', subLabel: 'Department' },
    { value: '4', label: 'Operations › Billing', subLabel: 'Sub-department' },
    { value: '2', label: 'Operations › Support', subLabel: 'Sub-department' },
    { value: '3', label: 'Operations › Support › Helpdesk', subLabel: 'Unit' },
  ]);
  assert.deepEqual(departmentFilterOptions(TREE, [], ['Division', 'Branch', 'Team']).map((o) => o.subLabel), [undefined, 'Division', 'Division', 'Branch', 'Branch', 'Team']);
  assert.equal(departmentFilterOptions(TREE, []).some((o) => o.value === '6'), false);       // Treasury is switched off and holds nothing: not offered
});

test('the register names a document\'s department; an id the list does not know has no name', () => {
  const names = departmentNames([{ id: 1, name: 'Compliance' }, { id: 12, name: 'IT Security' }]);
  assert.equal(names[String(12)], 'IT Security');
  assert.equal(names[String(99)], undefined);
  assert.deepEqual(Object.keys(names).sort(), ['1', '12']);
  assert.deepEqual(departmentNames(null), {});
});
