import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Folders view's screens are checked in a browser; these read the sources for the few rules a later edit could break without a
// type error (the repo's habit for the library: archive.test.ts, libraryTableLogic.test.ts).
const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const table = read('LibraryTable.tsx');
const rows = read('FolderRows.tsx');
const cells = read('cells.tsx');
const workspace = read('DocumentsWorkspace.tsx');
const popover = read('MovePopover.tsx');
const filters = read('LibraryFilters.tsx');

test('the Folders view is the same table: the same rows, columns without Department, no pager, and a folder header for each department', () => {
  assert.ok(table.includes('renderRow(r, node.depth + 1)'));                                       // a document row, one level under its folder
  assert.ok(table.includes("filter((c) => !(folders && c.id === 'department')"));                  // the folder is the department
  assert.ok(table.includes('hasDepartmentColumn || folders ? undefined : department'));            // and the owner cell does not repeat it
  assert.ok(table.includes('{!loading && !folders && top.length > 0 && ('));                      // the pager is the table's; folders have "Show N more"
  assert.ok(table.includes('<FolderHeadRow') && table.includes('<ShowMoreRow'));
  assert.ok(!table.includes('rows.map(renderRow)') && !/\.map\(renderRow\)/.test(table));          // map would pass the index as the row's depth offset
});

test('a folder header is a real button that says whether it is open and what it controls; its tick box is not a click on the row', () => {
  assert.ok(rows.includes('aria-expanded={open}') && rows.includes('aria-controls='));
  assert.ok(rows.includes('<button') && rows.includes('aria-label={folderAria(node)}'));
  assert.ok(rows.includes("closest('[data-no-peek], input, label')"));
  assert.ok(rows.includes('sticky left-[12px]'));                                                    // pinned: it stays in view when the table scrolls sideways
  assert.ok(!/overflow-hidden/.test(rows.slice(rows.indexOf('export function FolderHeadRow'), rows.indexOf('// ─── Show N more'))));   // overflow would unpin it
});

test('Move to… is in the row menu and the bulk bar of the working list only, for the documents the person may change, never an archived one', () => {
  assert.ok(cells.includes("key: 'move'") && cells.includes('hidden: !(canMove && onMove)'));
  assert.ok(table.includes("a.id === 'archive' && onMove && bulkMove"));                             // beside Archive: the Archived list (Restore only) has none
  assert.ok(table.includes('canMove={!!onMove && !!canMoveRow?.(doc)}'));
  assert.ok(workspace.includes('canMoveRow={mayChange}'));
  assert.ok(/const mayChange = \(d: GovDoc\) => \(canEdit \|\| mine\(d\)\) && d\.status !== 'archived'/.test(workspace));   // the server's can_edit and ensure_not_archived
  assert.ok(workspace.includes('moveAll(ids, to.id') && workspace.includes('toast(moveMessage('));   // one request each, ONE toast
});

test('what is moved leaves the selection; what could not be moved stays ticked, also when the refresh reorders the list under it', () => {
  assert.ok(table.includes('failed = await onMove(ids, target)'));
  assert.ok(table.includes('const stay = ticks.filter((id) => failed.includes(id))'));
  assert.ok(table.includes('ids.forEach((id) => next.delete(id));') && table.includes('stay.forEach((id) => next.add(id));'));
  assert.ok(table.includes('kept && kept.until > Date.now() ? new Set(kept.ids.filter((id) => matchIds.has(id))) : NONE'));
});

test('the layout is in the address, the switch is in the toolbar, and the choice is remembered', () => {
  assert.ok(workspace.includes('withLibraryParams(new URLSearchParams(window.location.search), state, openId, viewParam)'));
  assert.ok(workspace.includes('[state, openId, viewParam]'));
  assert.ok(workspace.includes('saveFolderPrefs(browserStore(), foldersKey(currentUserId), next)'));
  assert.ok(filters.includes('aria-label="Library layout"') && filters.includes("['table', Table2, 'Table'], ['folders', Folder, 'Folders']"));
  assert.ok(filters.includes('aria-pressed={on}'));
});

test('the Folders view says why it has nothing to show instead of an empty table: no departments yet (a way to make them), or none could be read', () => {
  assert.ok(rows.includes('No departments yet') && rows.includes('href="/governance/settings"'));
  assert.ok(rows.includes('Could not load departments') && rows.includes('Try again'));
  assert.ok(workspace.includes('departmentsQ.isError ? <DepartmentsFailed') && workspace.includes('<NoDepartments />'));
});

test('the Move to… popover is a dialog with a search box and a list, closes on Escape, and takes nothing while it is moving', () => {
  assert.ok(popover.includes('role="dialog"') && popover.includes('role="listbox"') && popover.includes('role="option"'));
  assert.ok(popover.includes("e.key === 'Escape'") && popover.includes("e.key === 'Enter'"));
  assert.ok(popover.includes('createPortal(') && popover.includes('document.body'));
  assert.ok(popover.includes('if (t && !busy && !isCurrent(t)) onPick(t)'));
});

test('no screen of the view names a model or a vendor', () => {
  for (const src of [rows, popover]) assert.ok(!/gpt|openai|claude|anthropic/i.test(src));
});
