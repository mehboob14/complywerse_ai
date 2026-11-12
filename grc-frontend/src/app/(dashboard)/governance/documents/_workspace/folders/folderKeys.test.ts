// node --test "src/app/(dashboard)/governance/documents/_workspace/folders/folderKeys.test.ts"
// The keys of the folder rows in the library's Folders layout, and the toolbar's rules (folderBarModel.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { folderKey, parentLine, type FolderLine } from './folderKeys.ts';
import { TOOLBAR_KEYS, departmentFilter, idOfKey, keyOfUnit, splitActions, toolbarTarget } from './folderBarModel.ts';
import { buildTree, fromList, unitActions, type ListRow } from './directoryModel.ts';

// Finance (closed), Operations (open: Support (open: Helpdesk), Security), Legal, No department
const LINES: FolderLine[] = [
  { key: 'd3', name: 'Finance', depth: 0, expandable: true, open: false },
  { key: 'd1', name: 'Operations', depth: 0, expandable: true, open: true },
  { key: 'd2', name: 'Support', depth: 1, expandable: true, open: true },
  { key: 'd8', name: 'Helpdesk', depth: 2, expandable: false, open: false },
  { key: 'd9', name: 'Security', depth: 1, expandable: false, open: false },
  { key: 'd6', name: 'Legal', depth: 0, expandable: false, open: false },
  { key: 'none', name: 'No department', depth: 0, expandable: true, open: false },
];

test('Up, Down, Home and End move between the folder rows; nothing at the ends', () => {
  assert.deepEqual(folderKey(LINES, 'd1', 'ArrowDown'), { focus: 'd2' });
  assert.deepEqual(folderKey(LINES, 'd2', 'ArrowUp'), { focus: 'd1' });
  assert.equal(folderKey(LINES, 'd3', 'ArrowUp'), null);
  assert.equal(folderKey(LINES, 'none', 'ArrowDown'), null);
  assert.deepEqual(folderKey(LINES, 'd8', 'Home'), { focus: 'd3' });
  assert.deepEqual(folderKey(LINES, 'd3', 'End'), { focus: 'none' });
  assert.equal(folderKey(LINES, 'd3', 'Home'), null);
  assert.equal(folderKey(LINES, 'none', 'End'), null);
});

test('Right opens a closed folder, then goes to the first folder inside it; Left closes an open one, then goes to the folder it is in', () => {
  assert.deepEqual(folderKey(LINES, 'd3', 'ArrowRight'), { expand: 'd3' });
  assert.deepEqual(folderKey(LINES, 'd1', 'ArrowRight'), { focus: 'd2' });
  assert.equal(folderKey(LINES, 'd6', 'ArrowRight'), null, 'a folder with nothing in it has nothing to open');
  assert.deepEqual(folderKey(LINES, 'd1', 'ArrowLeft'), { collapse: 'd1' });
  assert.deepEqual(folderKey(LINES, 'd2', 'ArrowLeft'), { collapse: 'd2' });
  assert.deepEqual(folderKey(LINES, 'd8', 'ArrowLeft'), { focus: 'd2' }, 'a folder that is not open goes to the one it is in');
  assert.deepEqual(folderKey(LINES, 'd9', 'ArrowLeft'), { focus: 'd1' });
  assert.equal(folderKey(LINES, 'd3', 'ArrowLeft'), null, 'a closed top folder has nowhere to go');
  // an open folder whose next row is not inside it (it holds documents only) stays
  assert.equal(folderKey([{ key: 'a', name: 'A', depth: 0, expandable: true, open: true }, { key: 'b', name: 'B', depth: 0, expandable: false, open: false }], 'a', 'ArrowRight'), null);
});

test('Enter opens the folder (goes into it)', () => {
  assert.deepEqual(folderKey(LINES, 'd2', 'Enter'), { open: 'd2' });
  assert.deepEqual(folderKey(LINES, 'none', 'Enter'), { open: 'none' });
});

test('a letter goes to the next folder whose name starts with it, round the rows; none: no move; a key that is not a letter does nothing', () => {
  assert.deepEqual(folderKey(LINES, 'd3', 's'), { focus: 'd2' });
  assert.deepEqual(folderKey(LINES, 'd2', 's'), { focus: 'd9' });
  assert.deepEqual(folderKey(LINES, 'd9', 's'), { focus: 'd2' }, 'round the list');
  assert.deepEqual(folderKey(LINES, 'd3', 'N'), { focus: 'none' });
  assert.equal(folderKey(LINES, 'd3', 'z'), null);
  for (const k of ['Tab', 'Escape', ' ', 'F2', 'Backspace', 'Shift']) assert.equal(folderKey(LINES, 'd3', k), null, k);
  assert.equal(folderKey(LINES, 'gone', 'ArrowDown'), null, 'a folder that is not drawn');
});

test('the folder a row is inside is the nearest row above it one level up', () => {
  assert.equal(parentLine(LINES, 3)?.key, 'd2');
  assert.equal(parentLine(LINES, 4)?.key, 'd1');
  assert.equal(parentLine(LINES, 2)?.key, 'd1');
  assert.equal(parentLine(LINES, 5), undefined);
  assert.equal(parentLine(LINES, 0), undefined);
});

// ── the folder bar ──

const LIST: ListRow[] = [
  { id: 1, name: 'Operations', parent_department_id: null, level: 1, level_label: 'Department', is_active: true },
  { id: 2, name: 'Support', parent_department_id: 1, level: 2, level_label: 'Sub-department', is_active: true },
  { id: 3, name: 'Helpdesk', parent_department_id: 2, level: 3, level_label: 'Unit', is_active: false },
];
const LEVELS = ['Department', 'Sub-department', 'Unit'];
const ALL_TABS = ['details', 'people', 'access', 'approvals', 'exceptions'];
const tree = buildTree(fromList(LIST, true).nodes);
const ctx = { canTop: true, levels: LEVELS, tabs: ALL_TABS };

test('the toolbar: New, Properties, Access, Approvals, Move and Deactivate are buttons; Edit details and Exceptions are under More; nothing hidden is drawn', () => {
  assert.deepEqual(TOOLBAR_KEYS, ['new', 'properties', 'access', 'approvals', 'move', 'toggle']);
  const { buttons, more } = splitActions(unitActions(tree, 1, ctx));
  assert.deepEqual(buttons.map((a) => a.key), ['new', 'properties', 'access', 'approvals', 'move', 'toggle']);
  assert.deepEqual(more.map((a) => a.key), ['edit', 'exceptions']);
  assert.equal(buttons[0].label, 'New Sub-department', 'named by the next level, in the organisation\'s own word');
  assert.equal(splitActions(unitActions(tree, null, ctx)).buttons[0].label, 'New Department', 'at the root');
  assert.deepEqual(splitActions(unitActions(tree, null, ctx)).more, []);
});

test('the toolbar by level and by right: a reader gets Properties alone; a unit that is switched off is activated, not deactivated; the deepest level cannot hold a new unit (with its reason)', () => {
  const reader = buildTree(fromList(LIST, false).nodes);
  assert.deepEqual(splitActions(unitActions(reader, 1, { ...ctx, canTop: false })).buttons.map((a) => a.key), ['properties', 'access', 'approvals'], 'what is read, not what is changed');
  const off = splitActions(unitActions(tree, 3, ctx));
  assert.equal(off.buttons.find((a) => a.key === 'toggle')?.label, 'Activate');
  const deepest = off.buttons.find((a) => a.key === 'new')!;
  assert.equal(deepest.disabled, true);
  assert.equal(deepest.reason, 'Switched off: activate it first');
  const three = buildTree(fromList(LIST.map((r) => ({ ...r, is_active: true })), true).nodes);
  assert.equal(splitActions(unitActions(three, 3, ctx)).buttons.find((a) => a.key === 'new')?.reason, 'Units go 3 levels deep');
  // one grant-only manager: she manages Support (and so can add under it) and nothing else
  const grant = buildTree(fromList(LIST, false).nodes.map((n) => (n.id === 2 ? { ...n, can_manage: true } : n)));
  assert.ok(splitActions(unitActions(grant, 2, { ...ctx, canTop: false })).buttons.some((a) => a.key === 'new'));
  assert.ok(!splitActions(unitActions(grant, 1, { ...ctx, canTop: false })).buttons.some((a) => a.key === 'new'));
  assert.deepEqual(splitActions(unitActions(grant, null, { ...ctx, canTop: false })).buttons, [], 'not at the root without the right to add departments');
});

test('the toolbar acts on the folder selected when it is a unit that is drawn, else on the one you are in (null: the organisation)', () => {
  const knows = (id: number) => id === 1 || id === 2;
  assert.equal(toolbarTarget('d2', null, knows), 2);
  assert.equal(toolbarTarget('d2', 1, knows), 2);
  assert.equal(toolbarTarget(null, 1, knows), 1);
  assert.equal(toolbarTarget(null, null, knows), null);
  assert.equal(toolbarTarget('none', 1, knows), 1, 'No department is no unit');
  assert.equal(toolbarTarget('d99', 1, knows), 1, 'a folder that is gone');
  assert.equal(idOfKey('d12'), 12);
  for (const odd of ['none', 'd', 'd1x', 'x12', '', null]) assert.equal(idOfKey(odd), null, String(odd));
  assert.equal(keyOfUnit(7), 'd7');
  assert.deepEqual(departmentFilter(4), ['4']);
  assert.deepEqual(departmentFilter(null), []);
});
