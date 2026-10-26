import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildTree, treeEntries, type TreeDoc } from './docTree.ts';
import { SORT_KEYS } from './libraryModel.ts';
import { OPTIONAL_COLUMNS } from './libraryPrefs.ts';
import {
  BULK_ACTIONS, COLUMNS, TITLE_MIN_WIDTH, actionableIds, bulkActionsFor, drawnRows, pageOf, rowRights, selectedLabel, tableMinWidth,
  tickState, toggleAll, toggleOne, visibleColumns, type Open,
} from './libraryTableLogic.ts';

const d = (id: number, parent: number | null = null): TreeDoc => ({ id, parent_document_id: parent });

// ── columns ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the columns are the ones the library names, in order; every optional one can be switched off, the title and the actions cannot', () => {
  assert.deepEqual(COLUMNS.map((c) => c.id), ['title', 'type', 'lifecycle', 'owner', 'department', 'frameworks', 'attestation', 'review', 'version', 'updated', 'actions']);
  assert.deepEqual(COLUMNS.map((c) => c.id).filter((id) => id !== 'title' && id !== 'actions'), [...OPTIONAL_COLUMNS]);
  assert.deepEqual(visibleColumns(['department']).map((c) => c.id), ['title', 'type', 'lifecycle', 'owner', 'frameworks', 'attestation', 'review', 'version', 'updated', 'actions']);
  assert.deepEqual(visibleColumns([...OPTIONAL_COLUMNS, 'title', 'actions']).map((c) => c.id), ['title', 'actions']);
  assert.equal(visibleColumns([]).length, COLUMNS.length);
});

test('every way of sorting is on one column, and only the actions column has none', () => {
  const keys = COLUMNS.map((c) => c.sort).filter(Boolean);
  assert.deepEqual([...keys].sort(), [...SORT_KEYS].sort());
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(COLUMNS.filter((c) => !c.sort).map((c) => c.id), ['actions']);
});

test('the table is as wide as its columns and the title together, so a narrow card scrolls sideways instead of squeezing a cell', () => {
  const all = visibleColumns([]);
  const fewer = visibleColumns(['department', 'attestation']);
  assert.equal(tableMinWidth(all), TITLE_MIN_WIDTH + all.reduce((sum, c) => sum + (c.width ?? 0), 0));
  assert.ok(tableMinWidth(fewer) < tableMinWidth(all));
  assert.ok(COLUMNS.every((c) => (c.id === 'title') === (c.width === undefined)));      // the title takes what is left, the rest have a width
});

// ── rows of a page ───────────────────────────────────────────────────────────────────────────────────────────────────────

// 1 ─ 2 ─ 4, 1 ─ 3, 5 alone
const LIB = [d(1), d(2, 1), d(3, 1), d(4, 2), d(5)];
const entries = treeEntries(buildTree(LIB, null));
const at = new Map(entries.map((e) => [e.doc.id, e]));
const top = buildTree(LIB, null).map((n) => n.doc);
const opening = (ids: Record<number, Open>) => (id: number): Open => ids[id] ?? null;

test('a page draws the top-level rows, and under each open one the documents under it, one level deeper', () => {
  const closed = drawnRows(top, at, opening({}));
  assert.deepEqual(closed.map((r) => [r.doc.id, r.depth, r.open]), [[1, 0, null], [5, 0, null]]);
  assert.deepEqual(closed.map((r) => r.childCount), [2, 0]);
  const opened = drawnRows(top, at, opening({ 1: 'docs', 2: 'docs' }));
  assert.deepEqual(opened.map((r) => [r.doc.id, r.depth]), [[1, 0], [2, 1], [4, 2], [3, 1], [5, 0]]);
  assert.deepEqual(opened.map((r) => r.parent?.id ?? null), [null, 1, 2, 1, null]);       // what the screen reader hears "under"
  // opened all the way (the versions too) draws the same rows: the versions are a panel under the row, not rows
  assert.deepEqual(drawnRows(top, at, opening({ 1: 'all' })).map((r) => r.doc.id), [1, 2, 3, 5]);
});

test('a document shown only as the parent of a match is flagged, and its closed children are not drawn', () => {
  const only4 = treeEntries(buildTree(LIB, new Set([4])));
  const map = new Map(only4.map((e) => [e.doc.id, e]));
  const roots = buildTree(LIB, new Set([4])).map((n) => n.doc);
  const rows = drawnRows(roots, map, opening({ 1: 'docs', 2: 'docs' }));        // a filter opens the way to the match
  assert.deepEqual(rows.map((r) => [r.doc.id, r.match]), [[1, false], [2, false], [4, true]]);
  assert.deepEqual(drawnRows(roots, map, opening({})).map((r) => r.doc.id), [1]);
});

test('a page is a slice of the top-level rows', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(pageOf(rows, 1, 3), [1, 2, 3]);
  assert.deepEqual(pageOf(rows, 3, 3), [7]);
  assert.deepEqual(pageOf(rows, 4, 3), []);
  assert.deepEqual(pageOf([], 1, 25), []);
});

// ── tick boxes ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the header box is empty, part ticked or all ticked, and one click ticks the page or unticks it', () => {
  const page = [1, 2, 3];
  assert.equal(tickState(new Set(), page), 'none');
  assert.equal(tickState(new Set([2]), page), 'some');
  assert.equal(tickState(new Set([1, 2, 3, 9]), page), 'all');
  assert.equal(tickState(new Set([9]), page), 'none');                              // ticked on another page only
  assert.equal(tickState(new Set([1]), []), 'none');                                 // nothing tickable: never "all"
  assert.deepEqual(Array.from(toggleAll(new Set([2, 9]), page)).sort(), [1, 2, 3, 9]);
  assert.deepEqual(Array.from(toggleAll(new Set([1, 2, 3, 9]), page)), [9]);         // rows ticked on other pages stay
  const before = new Set([1]);
  toggleAll(before, page);
  toggleOne(before, 2);
  assert.deepEqual(Array.from(before), [1]);                                         // a new set each time: React sees the change
  assert.deepEqual(Array.from(toggleOne(new Set([1]), 2)).sort(), [1, 2]);
  assert.deepEqual(Array.from(toggleOne(new Set([1, 2]), 2)), [1]);
});

test('a bulk action is for the ticked matches in the table order, never a parent shown for the sake of a match', () => {
  const rows = [{ doc: { id: 1 }, match: false }, { doc: { id: 2 }, match: true }, { doc: { id: 4 }, match: true }, { doc: { id: 3 }, match: true }];
  assert.deepEqual(actionableIds(new Set([3, 1, 2]), rows), [2, 3]);                // 1 is only a parent; 3 comes after 2 in the table
  assert.deepEqual(actionableIds(new Set([8]), rows), []);                           // gone from the list since it was ticked
  assert.deepEqual(actionableIds(new Set(), rows), []);
});

test('the bar says how many are selected', () => {
  assert.equal(selectedLabel(1), '1 selected');
  assert.equal(selectedLabel(2), '2 selected');
});

// ── bulk bar and row menu ────────────────────────────────────────────────────────────────────────────────────────────────

test('the bulk bar: nothing without the edit right, Restore alone on the Archived list, the rest on the working list, never Approve', () => {
  const ids = (canEdit: boolean, archived: boolean, canRestore: boolean) => bulkActionsFor(canEdit, archived, canRestore).map((a) => a.id);
  assert.deepEqual(ids(false, false, true), []);                                    // no tick boxes either: the page draws them only when this is not empty
  assert.deepEqual(ids(false, true, true), []);
  assert.deepEqual(ids(true, false, true), ['publish', 'assign-owner', 'set-review', 'archive']);
  assert.deepEqual(ids(true, false, false), ['publish', 'assign-owner', 'set-review', 'archive']);
  assert.deepEqual(ids(true, true, true), ['restore']);
  assert.deepEqual(ids(true, true, false), []);                                      // the page cannot restore: nothing to offer
  assert.ok(BULK_ACTIONS.every((a) => (a.id as string) !== 'approve'));
  assert.deepEqual(BULK_ACTIONS.map((a) => a.label), ['Publish', 'Assign owner', 'Set review date', 'Archive', 'Restore']);
  assert.deepEqual(BULK_ACTIONS.filter((a) => a.danger).map((a) => a.id), ['archive']);
});

test('a row\'s menu: the per-row rule where the page gave one, the page-wide edit right where not; Restore needs both a way and a yes', () => {
  const doc = { id: 1 };
  const base = { canRestore: false };
  assert.deepEqual(rowRights(base, doc), { edit: false, archive: false, restore: false });
  assert.deepEqual(rowRights({ ...base, canEdit: true }, doc), { edit: true, archive: true, restore: false });
  assert.deepEqual(rowRights({ ...base, canEdit: true, canEditRow: () => false }, doc), { edit: false, archive: true, restore: false });
  assert.deepEqual(rowRights({ ...base, canEdit: false, canEditRow: () => true, canArchiveRow: () => false }, doc), { edit: true, archive: false, restore: false });
  assert.equal(rowRights({ canRestore: true, canEdit: true }, doc).restore, false);          // no per-row yes: the edit right does not restore
  assert.equal(rowRights({ canRestore: true, canRestoreRow: () => true }, doc).restore, true);
  assert.equal(rowRights({ canRestore: false, canRestoreRow: () => true }, doc).restore, false);   // a yes without a way to restore
});

test('what the rest of the page leans on: the row marker the drawer returns focus to, and one fixed-height line of frameworks whatever their number', () => {
  const table = readFileSync(new URL('./LibraryTable.tsx', import.meta.url), 'utf8');
  assert.ok(table.includes('data-doc-row={doc.id}'));
  assert.ok(table.includes('compareDocs(') && table.indexOf('compareDocs(') < table.indexOf('buildTree(ordered'));      // the order is chosen before the tree is built
  const cell = readFileSync(new URL('./FrameworksCell.tsx', import.meta.url), 'utf8');
  assert.ok(cell.includes('const MAX_CHIPS = 2;') && cell.includes('max: MAX_CHIPS'));       // two chips, the rest behind "+N"
  assert.ok(cell.includes('flex-nowrap') && cell.includes('overflow-hidden'));                  // on one line, clipped: the row never grows
});
