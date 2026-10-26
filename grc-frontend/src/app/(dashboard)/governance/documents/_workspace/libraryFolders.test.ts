import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTree, treeEntries } from './docTree.ts';
import {
  FIRST_SHOWN, NO_DEPARTMENT_KEY, NO_DEPARTMENT_NAME, OPEN_UP_TO, SHOW_STEP,
  allFolders, buildFolders, chooseView, commonDepartment, defaultView, displayOrder, expandable, filterTargets, flipFolder, folderAria,
  folderEntries, folderIsOpen, folderKey, matchedIds, moveAll, moveMessage, moveTargets, planFolders, setAllFolders, showMoreStep, shownLimit,
  statusSummary,
  type FolderDepartment, type FolderDoc, type FolderNode, type FoldView,
} from './libraryFolders.ts';
import {
  DEFAULT_STATE, NO_FILTERS, health, matchesFilters, reviewState, viewFromParams, viewMatching, withLibraryParams, BUILT_IN_VIEWS,
  type Filters, type MatchContext,
} from './libraryModel.ts';
import { drawnRows } from './libraryTableLogic.ts';
import { foldersKey, loadFolderPrefs, saveFolderPrefs, type KeyValueStore } from './libraryPrefs.ts';

const NOW = new Date('2026-10-26T09:00:00Z');
let n = 0;
const doc = (over: Partial<FolderDoc> = {}): FolderDoc => ({
  id: ++n, title: `Doc ${n}`, document_code: null, description: null, doc_type: 'policy', status: 'published', classification: 'internal',
  owner_id: 1, owner_name: 'Olivia Owner', author_id: 2, author_name: 'Rana Author', department_id: null, framework_ids: [], applicable_framework_ids: [],
  tags: [], next_review_date: null, version_in_force: '1.0', current_version: '1.0', created_at: '2026-01-01T00:00:00', updated_at: '2026-10-25T10:00:00',
  file_name: null, parent_document_id: null, ...over,
});
const dept = (id: number, name: string, over: Partial<FolderDepartment> = {}): FolderDepartment => ({ id, name, parent_department_id: null, is_active: true, ...over });

const build = (scope: FolderDoc[], departments: FolderDepartment[] | null, over: { matches?: number[]; filtering?: boolean } = {}) =>
  buildFolders({
    scope, departments, now: NOW, filtering: over.filtering ?? false,
    matches: new Set(over.matches ?? scope.map((d) => d.id)),
  });
const names = (nodes: FolderNode[]) => nodes.map((x) => x.name);
const shape = (nodes: readonly FolderNode[]): unknown[] => nodes.map((x) => [x.name, x.depth, shape(x.folders)]);
const ids = (list: { id: number }[]) => list.map((d) => d.id);

// ── which folders there are ──────────────────────────────────────────────────────────────────────────────────────────────────

test('one folder for each department, A to Z (accents and case aside, numbers by value), "No department" last', () => {
  const departments = [dept(1, 'Risk'), dept(2, 'compliance'), dept(3, 'Ámbito'), dept(4, 'Finance 10'), dept(5, 'Finance 2')];
  const scope = [doc({ department_id: 1 }), doc({ department_id: null })];
  assert.deepEqual(names(build(scope, departments)), ['Ámbito', 'compliance', 'Finance 2', 'Finance 10', 'Risk', NO_DEPARTMENT_NAME]);
  assert.equal(build(scope, departments).at(-1)!.key, NO_DEPARTMENT_KEY);
  assert.equal(folderKey(12), 'd12');
  assert.equal(folderKey(null), 'none');
});

test('the same names in another order give the same folders (a tie is settled by id, not by arrival)', () => {
  const a = [dept(7, 'Ops'), dept(3, 'ops'), dept(5, 'OPS')];
  const b = [dept(5, 'OPS'), dept(7, 'Ops'), dept(3, 'ops')];
  const scope = [doc({ department_id: 5 })];
  assert.deepEqual(build(scope, a).map((x) => x.id), [3, 5, 7]);
  assert.deepEqual(build(scope, b).map((x) => x.id), [3, 5, 7]);
});

test('a department with a parent sits inside it, to any depth; the folders inside a folder come first, then its own documents', () => {
  const departments = [dept(1, 'Operations'), dept(2, 'Security', { parent_department_id: 1 }), dept(3, 'SOC', { parent_department_id: 2 }), dept(4, 'Finance'), dept(5, 'Audit', { parent_department_id: 1 })];
  const own = doc({ department_id: 1 });
  const sec = doc({ department_id: 2 });
  const soc = doc({ department_id: 3 });
  const fin = doc({ department_id: 4 });
  const folders = build([own, sec, soc, fin], departments);
  assert.deepEqual(shape(folders), [
    ['Finance', 0, []],
    ['Operations', 0, [['Audit', 1, []], ['Security', 1, [['SOC', 2, []]]]]],
  ]);
  const operations = folders[1];
  assert.deepEqual(ids(operations.top), [own.id]);                            // its own documents only
  assert.deepEqual(allFolders(folders).map((x) => x.name), ['Finance', 'Operations', 'Audit', 'Security', 'SOC']);
  // the order the CSV and the drawer's next / previous follow: folders in the order drawn, the ones inside a folder before its own documents
  assert.deepEqual(ids(displayOrder(folders)), [fin.id, soc.id, sec.id, own.id]);
});

test('counts are the folder\'s own documents and, rolled up, everything in the folders inside it', () => {
  const departments = [dept(1, 'Operations'), dept(2, 'Security', { parent_department_id: 1 }), dept(3, 'SOC', { parent_department_id: 2 })];
  const scope = [
    doc({ department_id: 1, status: 'published' }), doc({ department_id: 1, status: 'draft', version_in_force: null }),
    doc({ department_id: 2, status: 'published' }), doc({ department_id: 3, status: 'pending_review', version_in_force: null }),
    doc({ department_id: 3, status: 'pending_approval', version_in_force: null }), doc({ department_id: 3, status: 'approved' }),
  ];
  const [operations] = build(scope, departments);
  const [security] = operations.folders;
  const [soc] = security.folders;
  assert.deepEqual([operations.own.docs, operations.total.docs], [2, 6]);
  assert.deepEqual([security.own.docs, security.total.docs], [1, 4]);
  assert.deepEqual([soc.own.docs, soc.total.docs], [3, 3]);
  assert.deepEqual([operations.total.published, operations.total.draft, operations.total.inReview, operations.total.approved], [2, 1, 2, 1]);
  assert.equal(statusSummary(operations.total), '2 published · 1 approved · 2 in review · 1 draft');
  assert.equal(statusSummary(build([], departments)[0].total), '');                         // an empty folder says nothing
});

test('every document is in exactly one folder: the top folders add up to the documents that match', () => {
  const departments = [dept(1, 'A'), dept(2, 'B', { parent_department_id: 1 }), dept(3, 'C')];
  const scope = [1, 2, 3, null, 99, 2, 1, 3, 3].map((department_id) => doc({ department_id }));
  const folders = build(scope, departments);
  assert.equal(folders.reduce((sum, f) => sum + f.total.docs, 0), scope.length);
  assert.equal(displayOrder(folders).length, scope.length);
  assert.deepEqual(ids(displayOrder(folders)).sort((a, b) => a - b), ids(scope).sort((a, b) => a - b));
  assert.equal(folderEntries(folders).length, scope.length);
});

// ── bad data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a department in a loop, one that is its own parent, and one whose parent does not exist all end up somewhere, once', () => {
  const departments = [
    dept(1, 'Beta', { parent_department_id: 2 }), dept(2, 'Alpha', { parent_department_id: 1 }),   // a loop: Alpha is lifted
    dept(3, 'Self', { parent_department_id: 3 }),
    dept(4, 'Orphan', { parent_department_id: 99 }),
    dept(5, 'Tail', { parent_department_id: 1 }),                                                    // hangs off the loop
  ];
  const scope = [1, 2, 3, 4, 5].map((department_id) => doc({ department_id }));
  const folders = build(scope, departments);
  assert.deepEqual(shape(folders), [
    ['Alpha', 0, [['Beta', 1, [['Tail', 2, []]]]]],
    ['Orphan', 0, []],
    ['Self', 0, []],
  ]);
  assert.equal(allFolders(folders).length, 5);
  assert.equal(folders.reduce((sum, f) => sum + f.total.docs, 0), 5);
  // the same loop met from the other end gives the same answer
  const flipped = build(scope, [...departments].reverse());
  assert.deepEqual(shape(flipped), shape(folders));
  assert.equal(moveTargets(departments).filter((t) => t.id != null).length, 5);        // the paths of the pickers do not loop either
});

test('a document in a department the list does not know sits in "No department", not in a folder of its own', () => {
  const departments = [dept(1, 'Ops')];
  const folders = build([doc({ department_id: 99 }), doc({ department_id: 100 }), doc({ department_id: null }), doc({ department_id: 1 })], departments);
  assert.deepEqual(names(folders), ['Ops', NO_DEPARTMENT_NAME]);
  assert.equal(folders[1].total.docs, 3);
  assert.equal(folders[1].inactive, false);
});

test('"No department" is only there when a document is in it', () => {
  const departments = [dept(1, 'Ops')];
  assert.deepEqual(names(build([doc({ department_id: 1 })], departments)), ['Ops']);
  assert.deepEqual(names(build([], departments)), ['Ops']);                                // the empty active folder stays; this one does not
  assert.deepEqual(names(build([doc({ department_id: 1 })], departments, { filtering: true })), ['Ops']);
});

test('no departments at all: everything is in "No department"; no documents either: no folders', () => {
  const scope = [doc(), doc({ department_id: 5 })];
  for (const none of [[], null, undefined] as const) {
    const folders = build(scope, none as never);
    assert.deepEqual(names(folders), [NO_DEPARTMENT_NAME]);
    assert.equal(folders[0].total.docs, 2);
    assert.deepEqual(build([], none as never), []);
  }
  assert.equal(defaultView([]), 'table');
  assert.equal(defaultView(null), 'table');
});

// ── switched-off departments, empty ones, filters ────────────────────────────────────────────────────────────────────────────

test('a switched-off department is a folder only while a document is in it', () => {
  const departments = [dept(1, 'Old unit', { is_active: false }), dept(2, 'Closed unit', { is_active: false }), dept(3, 'Live')];
  const folders = build([doc({ department_id: 1 }), doc({ department_id: 3 })], departments);
  assert.deepEqual(names(folders), ['Live', 'Old unit']);                                   // Closed unit: nothing in it, never shown
  assert.deepEqual(folders.map((f) => f.inactive), [false, true]);
  assert.deepEqual(names(build([doc({ department_id: 3 })], departments)), ['Live']);
  // none of its documents matches the filter: gone as well
  assert.deepEqual(names(build([doc({ department_id: 1 })], departments, { matches: [], filtering: true })), []);
  assert.equal(folderAria(folders[1]), 'Old unit, 1 document, 1 published, inactive');
});

test('a switched-off department that holds only a folder with documents stays, as the way to it; an empty active one under a hidden parent moves up', () => {
  const departments = [dept(1, 'Old', { is_active: false }), dept(2, 'Team', { parent_department_id: 1 }), dept(3, 'Other', { is_active: false }), dept(4, 'Quiet', { parent_department_id: 3 })];
  const folders = build([doc({ department_id: 2 })], departments);
  assert.deepEqual(shape(folders), [['Old', 0, [['Team', 1, []]]], ['Quiet', 0, []]]);     // Old is the way to Team; Other has nothing, so Quiet takes its place
  assert.equal(folders[0].own.docs, 0);
  assert.equal(folders[0].total.docs, 1);
});

test('without a filter an empty active folder is shown (empty); with a search or filter on, only folders with a match are', () => {
  const departments = [dept(1, 'Ops'), dept(2, 'Legal'), dept(3, 'Security', { parent_department_id: 2 })];
  const a = doc({ department_id: 1 });
  const b = doc({ department_id: 3, status: 'draft', version_in_force: null });
  const none = build([a, b], departments);
  assert.deepEqual(shape(none), [['Legal', 0, [['Security', 1, []]]], ['Ops', 0, []]]);
  const empty = build([], departments);
  assert.deepEqual(empty.map((f) => f.total.docs), [0, 0]);
  assert.equal(expandable(empty[0]), true);                                                 // Legal has a folder inside it
  assert.equal(expandable(empty[1]), false);                                                // Ops: nothing to open
  assert.equal(folderAria(empty[1]), 'Ops, empty');
  const onlyB = build([a, b], departments, { matches: [b.id], filtering: true });
  assert.deepEqual(shape(onlyB), [['Legal', 0, [['Security', 1, []]]]]);                    // Ops has no match; Legal is the way to Security's
  assert.deepEqual(onlyB[0].total.docs, 1);
  assert.deepEqual(build([a, b], departments, { matches: [], filtering: true }), []);
});

test('counts and contents follow the filters, and a parent that does not match is kept for the documents under it, uncounted', () => {
  const departments = [dept(1, 'Ops')];
  const parent = doc({ department_id: 1, status: 'published' });
  const child = doc({ department_id: 1, status: 'draft', version_in_force: null, parent_document_id: parent.id });
  const other = doc({ department_id: 1, status: 'published' });
  const [ops] = build([parent, child, other], departments, { matches: [child.id], filtering: true });
  assert.deepEqual(ids(ops.top), [parent.id]);                                              // the way to the match is the only thing at the top
  assert.deepEqual(ops.entries.map((e) => [e.doc.id, e.depth, e.match]), [[parent.id, 0, false], [child.id, 1, true]]);
  assert.equal(ops.own.docs, 1);
  assert.equal(ops.total.draft, 1);
  assert.equal(ops.total.published, 0);
  assert.deepEqual(matchedIds(ops), [child.id]);
  // the folder's tree is the table's tree (docTree.buildTree) for the documents of that department
  const table = treeEntries(buildTree([parent, child, other], new Set([child.id])));
  assert.deepEqual(table.map((e) => [e.doc.id, e.depth, e.match]), ops.entries.map((e) => [e.doc.id, e.depth, e.match]));
});

test('documents nest inside a folder as in the table; a child filed under another department is at the top of its own folder', () => {
  const departments = [dept(1, 'Ops'), dept(2, 'Legal')];
  const policy = doc({ department_id: 1 });
  const standard = doc({ department_id: 1, parent_document_id: policy.id });
  const procedure = doc({ department_id: 2, parent_document_id: policy.id });
  const folders = build([policy, standard, procedure], departments);
  const [legal, ops] = folders;
  assert.deepEqual([ids(legal.top), ids(ops.top)], [[procedure.id], [policy.id]]);
  assert.deepEqual(ops.entries.map((e) => [e.doc.id, e.depth]), [[policy.id, 0], [standard.id, 1]]);
  assert.equal(ops.total.docs, 2);                                                         // the child counts as a document
});

test('inside a folder the documents keep the order they were given in', () => {
  const departments = [dept(1, 'Ops')];
  const [a, b, c] = [doc({ department_id: 1 }), doc({ department_id: 1 }), doc({ department_id: 1 })];
  assert.deepEqual(ids(build([c, a, b], departments)[0].top), [c.id, a.id, b.id]);
  assert.deepEqual(ids(build([b, c, a], departments)[0].top), [b.id, c.id, a.id]);
});

// ── the numbers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the overdue count is the library\'s own rule: a review owed on a document in force, and its date passed', () => {
  const departments = [dept(1, 'Ops'), dept(2, 'Legal')];
  const scope = [
    doc({ department_id: 1, next_review_date: '2026-10-01T00:00:00' }),                                          // overdue
    doc({ department_id: 1, status: 'approved', next_review_date: '2026-10-26T00:00:00' }),                      // overdue today
    doc({ department_id: 1, next_review_date: '2026-11-10T00:00:00' }),                                          // due soon: not overdue
    doc({ department_id: 1, next_review_date: null }),                                                           // no date
    doc({ department_id: 1, status: 'draft', version_in_force: null, next_review_date: '2026-10-01T00:00:00' }),  // a draft owes none
    doc({ department_id: 2, status: 'pending_review', next_review_date: '2026-09-01T00:00:00' }),                // a newer version over a published one: owed
    doc({ department_id: 2, status: 'expired', next_review_date: '2026-09-01T00:00:00' }),
    doc({ department_id: null, next_review_date: '2026-01-01T00:00:00' }),
  ];
  const folders = build(scope, departments);
  const byName = Object.fromEntries(folders.map((f) => [f.name, f.total.overdue]));
  assert.deepEqual(byName, { Legal: 1, Ops: 2, [NO_DEPARTMENT_NAME]: 1 });
  const total = folders.reduce((sum, f) => sum + f.total.overdue, 0);
  assert.equal(total, scope.filter((d) => reviewState(d, NOW).bucket === 'overdue').length);
  assert.equal(total, health(scope, NOW).overdue);                                                                // the Document health card's number
  // and with a filter: the folders count what matches
  const only = build(scope, departments, { matches: [scope[0].id, scope[2].id], filtering: true });
  assert.deepEqual(only.map((f) => [f.name, f.total.docs, f.total.overdue]), [['Ops', 2, 1]]);
});

test('archived documents are in the counts only where the table would show them', () => {
  const departments = [dept(1, 'Ops')];
  const live = doc({ department_id: 1 });
  const gone = doc({ department_id: 1, status: 'archived' });
  const ctx: MatchContext = { departments: {}, frameworks: {}, coverage: {}, me: null, now: NOW };
  const f = (statuses: string[]): Filters => ({ ...NO_FILTERS, statuses });
  const matching = (filters: Filters) => [live, gone].filter((d) => matchesFilters(d, filters, ctx)).map((d) => d.id);
  assert.deepEqual(matching(f([])), [live.id]);
  assert.deepEqual(matching(f(['archived'])), [gone.id]);
  const archived = build([live, gone], departments, { matches: matching(f(['archived'])), filtering: true })[0];
  assert.deepEqual([archived.total.docs, archived.total.archived, archived.total.published], [1, 1, 0]);
  assert.equal(statusSummary(archived.total), '1 archived');
});

test('the status words: the most settled first, nothing for a status the folder does not hold', () => {
  const c = { docs: 9, draft: 2, inReview: 1, approved: 0, published: 3, expired: 1, archived: 0, other: 2, overdue: 0 };
  assert.equal(statusSummary(c), '3 published · 1 in review · 2 draft · 1 expired · 2 other');
});

// ── speed ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('1,000 documents over 50 departments, some of them nested, take far less than 50 ms', () => {
  const departments = Array.from({ length: 50 }, (_, i) => dept(i + 1, `Department ${i + 1}`, { parent_department_id: i >= 40 ? i - 39 : null }));
  const scope = Array.from({ length: 1000 }, (_, i) => doc({ department_id: (i % 53) + 1, next_review_date: '2026-09-01T00:00:00' }));
  scope.forEach((d, i) => { if (i >= 53 && i % 7 === 0) d.parent_document_id = scope[i - 53].id; });          // some documents under another one of their department
  const matches = scope.filter((_, i) => i % 3 !== 0).map((d) => d.id);
  build(scope, departments);                                                               // warm up
  const t0 = performance.now();
  const folders = build(scope, departments, { matches, filtering: true });
  const took = performance.now() - t0;
  assert.ok(took < 50, `took ${took.toFixed(1)} ms`);
  assert.equal(folders.reduce((sum, f) => sum + f.total.docs, 0), matches.length);
});

// ── open and closed ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const view = (over: Partial<FoldView> = {}): FoldView => ({ saved: {}, shut: new Set<string>(), filtering: false, docCount: 10, ...over });

test('the first time, a library of up to 40 documents opens its folders and a longer one starts closed; a choice made before wins', () => {
  assert.equal(folderIsOpen(view({ docCount: OPEN_UP_TO }), 'd1'), true);
  assert.equal(folderIsOpen(view({ docCount: OPEN_UP_TO + 1 }), 'd1'), false);
  assert.equal(folderIsOpen(view({ docCount: 500, saved: { d1: true } }), 'd1'), true);
  assert.equal(folderIsOpen(view({ docCount: 5, saved: { d1: false } }), 'd1'), false);
  assert.equal(folderIsOpen(view({ docCount: 5, saved: { d2: false } }), 'd1'), true);          // only that folder
  assert.equal(folderIsOpen(view({ docCount: 500, saved: JSON.parse('{"__proto__": true}') }), 'constructor'), false);
});

test('a search or filter opens every folder with a match for as long as it applies, unless the person closed it since', () => {
  const on = view({ filtering: true, docCount: 500, saved: { d1: false } });
  assert.equal(folderIsOpen(on, 'd1'), true);                                                 // closed before, opened by the search
  assert.equal(folderIsOpen({ ...on, shut: new Set(['d1']) }, 'd1'), false);
  assert.equal(folderIsOpen(view({ saved: { d1: false } }), 'd1'), false);                    // the search is gone: as they left it
});

test('flipping a folder is remembered, except while a search or filter is on; Expand all and Collapse all follow the same rule', () => {
  const flipped = flipFolder(view({ docCount: 5 }), 'd1');
  assert.deepEqual(flipped.saved, { d1: false });                                             // it was open by default: now closed
  assert.deepEqual(flipFolder(view({ saved: flipped.saved }), 'd1').saved, { d1: true });
  const during = flipFolder(view({ filtering: true, saved: { d1: false } }), 'd1');
  assert.deepEqual(during.saved, { d1: false });                                              // nothing remembered
  assert.deepEqual(Array.from(during.shut), ['d1']);
  assert.deepEqual(Array.from(flipFolder(view({ filtering: true, shut: new Set(['d1']) }), 'd1').shut), []);
  assert.deepEqual(setAllFolders(view({ saved: { d9: true } }), ['d1', 'd2'], false).saved, { d9: true, d1: false, d2: false });
  assert.deepEqual(setAllFolders(view({ saved: {} }), ['d1', 'd2'], true).saved, { d1: true, d2: true });
  const filtered = setAllFolders(view({ filtering: true, saved: { d9: true } }), ['d1', 'd2'], false);
  assert.deepEqual([filtered.saved, Array.from(filtered.shut)], [{ d9: true }, ['d1', 'd2']]);
  assert.deepEqual(Array.from(setAllFolders(view({ filtering: true, shut: new Set(['d1']) }), ['d1', 'd2'], true).shut), []);
  const before = view({ saved: { d1: true } });
  flipFolder(before, 'd1');
  setAllFolders(before, ['d1'], false);
  assert.deepEqual(before.saved, { d1: true });                                               // new objects each time: React sees the change
});

test('a folder lists its first 15 documents and one click shows up to 50 more', () => {
  assert.equal(FIRST_SHOWN, 15);
  assert.equal(shownLimit(undefined), 15);
  assert.equal(shownLimit(0), 15);
  assert.equal(shownLimit(50), 65);
  assert.equal(showMoreStep(12), 12);
  assert.equal(showMoreStep(500), SHOW_STEP);
  assert.equal(showMoreStep(0), 0);
});

// ── what is drawn ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a closed folder draws its header only; an open one draws the folders inside it, then its own documents (the first ones, with how many are left)', () => {
  const departments = [dept(1, 'Ops'), dept(2, 'Security', { parent_department_id: 1 }), dept(3, 'Legal')];
  const scope = [...Array.from({ length: 20 }, () => doc({ department_id: 1 })), doc({ department_id: 2 }), doc({ department_id: 3 })];
  const folders = build(scope, departments);
  const at = new Map(folderEntries(folders).map((e) => [e.doc.id, e]));
  const draw = (open: string[], extra = 0) => planFolders(folders, {
    isOpen: (x) => open.includes(x.key),
    limit: () => shownLimit(extra),
    rowsOf: (x, limit) => drawnRows(x.top.slice(0, limit), at, () => null),
  }).map((item) => (item.kind === 'folder' ? `${item.node.name}${item.open ? ' (open)' : ''}` : `${item.node.name}: ${item.rows.length} rows, ${item.remaining} left`));
  assert.deepEqual(draw([]), ['Legal', 'Ops']);
  assert.deepEqual(draw(['d3']), ['Legal (open)', 'Legal: 1 rows, 0 left', 'Ops']);
  assert.deepEqual(draw(['d1']), ['Legal', 'Ops (open)', 'Security', 'Ops: 15 rows, 5 left']);                   // Security is closed: header only
  assert.deepEqual(draw(['d1', 'd2']), ['Legal', 'Ops (open)', 'Security (open)', 'Security: 1 rows, 0 left', 'Ops: 15 rows, 5 left']);
  assert.deepEqual(draw(['d1'], 5), ['Legal', 'Ops (open)', 'Security', 'Ops: 20 rows, 0 left']);
});

test('a folder\'s tick box ticks every document of it that matches, the folders inside included', () => {
  const departments = [dept(1, 'Ops'), dept(2, 'Security', { parent_department_id: 1 })];
  const [a, b, c] = [doc({ department_id: 1 }), doc({ department_id: 2 }), doc({ department_id: 2 })];
  const [ops] = build([a, b, c], departments, { matches: [a.id, c.id], filtering: true });
  assert.deepEqual(matchedIds(ops).sort((x, y) => x - y), [a.id, c.id]);
  assert.deepEqual(matchedIds(ops.folders[0]), [c.id]);
});

// ── the layout ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the default layout is Folders only where a department is in use; what the address says beats what the person chose, which beats the default', () => {
  const live = [dept(1, 'Ops')];
  const off = [dept(1, 'Ops', { is_active: false })];
  assert.equal(defaultView(live), 'folders');
  assert.equal(defaultView(off), 'table');
  assert.equal(chooseView({ address: null, remembered: null, departments: live }), 'folders');
  assert.equal(chooseView({ address: null, remembered: null, departments: off }), 'table');
  assert.equal(chooseView({ address: null, remembered: 'table', departments: live }), 'table');
  assert.equal(chooseView({ address: null, remembered: 'folders', departments: [] }), 'folders');         // chosen on purpose: shown, with its empty state
  assert.equal(chooseView({ address: 'table', remembered: 'folders', departments: live }), 'table');
  assert.equal(chooseView({ address: 'folders', remembered: 'table', departments: off }), 'folders');
});

test('the layout is in the address: ?view= round-trips, a link without it behaves as before, and it is not part of a saved view', () => {
  assert.equal(viewFromParams(new URLSearchParams('view=folders')), 'folders');
  assert.equal(viewFromParams(new URLSearchParams('view=table&q=x')), 'table');
  assert.equal(viewFromParams(new URLSearchParams('')), null);                                           // a legacy link
  assert.equal(viewFromParams(new URLSearchParams('view=grid')), null);
  assert.equal(viewFromParams(new URLSearchParams('view=')), null);
  const state = { ...DEFAULT_STATE, filters: { ...NO_FILTERS, types: ['policy'] } };
  for (const v of ['table', 'folders'] as const) {
    const out = withLibraryParams(new URLSearchParams('aiDraftTitle=Foo'), state, 12, v);
    assert.equal(out.get('view'), v);
    assert.equal(out.get('aiDraftTitle'), 'Foo');                                                         // others' links are kept
    assert.equal(out.get('open'), '12');
    assert.equal(viewFromParams(new URLSearchParams(out.toString())), v);
  }
  assert.equal(withLibraryParams(new URLSearchParams('view=folders&q=old'), state, null).get('view'), null);   // not chosen: not written
  assert.equal(withLibraryParams(new URLSearchParams('view=folders'), DEFAULT_STATE, null, null).toString(), '');
  assert.equal(withLibraryParams(new URLSearchParams('open=3'), DEFAULT_STATE, null).toString(), '');          // as before
  assert.equal(viewMatching(BUILT_IN_VIEWS, DEFAULT_STATE)?.id, 'all');                                        // the layout is not in the state a view is matched on
});

const memory = (): KeyValueStore & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
};

test('what the Folders view remembers is guarded: no storage, blocked storage and rubbish all give the defaults', () => {
  const key = foldersKey(7);
  const nothing = { view: null, open: {} };
  assert.deepEqual(loadFolderPrefs(null, key), nothing);
  assert.doesNotThrow(() => saveFolderPrefs(null, key, nothing));
  const broken: KeyValueStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(loadFolderPrefs(broken, key), nothing);
  assert.doesNotThrow(() => saveFolderPrefs(broken, key, nothing));
  const s = memory();
  for (const raw of ['{not json', '7', 'null', '"folders"', '[]', '{"view":"grid","open":5}', '{"open":[true]}']) {
    s.data[key] = raw;
    assert.deepEqual(loadFolderPrefs(s, key), nothing, raw);
  }
});

test('the layout and the folders left open or closed come back as saved; only real folder keys and yes/no answers are kept; it is per person', () => {
  const s = memory();
  saveFolderPrefs(s, foldersKey(7), { view: 'folders', open: { d1: true, d12: false, none: true } });
  assert.deepEqual(loadFolderPrefs(s, foldersKey(7)), { view: 'folders', open: { d1: true, d12: false, none: true } });
  s.data[foldersKey(7)] = JSON.stringify({ view: 'table', open: { d1: 'yes', d2: false, x: true, 'd3 ': true, ['__proto__']: true, none: true } });
  assert.deepEqual(loadFolderPrefs(s, foldersKey(7)), { view: 'table', open: { d2: false, none: true } });
  assert.deepEqual(loadFolderPrefs(s, foldersKey(8)), { view: null, open: {} });
  assert.notEqual(foldersKey(1), foldersKey(null));
  const many = Object.fromEntries(Array.from({ length: 800 }, (_, i) => [`d${i}`, true]));
  s.data[foldersKey(9)] = JSON.stringify({ open: many });
  assert.equal(Object.keys(loadFolderPrefs(s, foldersKey(9)).open).length, 500);
});

// ── Move to… ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Move to… offers the departments in use by their full name, A to Z, and "No department" last; a switched-off one is not offered', () => {
  const departments = [
    dept(1, 'Operations'), dept(2, 'Security', { parent_department_id: 1 }), dept(3, 'Legal'), dept(4, 'Old', { is_active: false }),
    dept(5, 'Archive team', { parent_department_id: 4 }), dept(6, 'ámbito'),
  ];
  assert.deepEqual(moveTargets(departments), [
    { id: 6, label: 'ámbito' },
    { id: 3, label: 'Legal' },
    { id: 5, label: 'Old › Archive team' },                   // it is in use; the path names where it sits (the department above it is switched off)
    { id: 1, label: 'Operations' },
    { id: 2, label: 'Operations › Security' },
    { id: null, label: NO_DEPARTMENT_NAME },
  ]);
  assert.deepEqual(moveTargets([]), [{ id: null, label: NO_DEPARTMENT_NAME }]);
  assert.deepEqual(moveTargets(null), [{ id: null, label: NO_DEPARTMENT_NAME }]);
});

test('the picker narrows by every word typed, accents and case aside, on the whole path', () => {
  const targets = moveTargets([dept(1, 'Operations'), dept(2, 'Security', { parent_department_id: 1 }), dept(3, 'Légal')]);
  assert.deepEqual(filterTargets(targets, '').length, 4);
  assert.deepEqual(filterTargets(targets, 'secu').map((t) => t.id), [2]);
  assert.deepEqual(filterTargets(targets, 'operations security').map((t) => t.id), [2]);
  assert.deepEqual(filterTargets(targets, 'LEGAL').map((t) => t.id), [3]);
  assert.deepEqual(filterTargets(targets, 'no dep').map((t) => t.id), [null]);
  assert.deepEqual(filterTargets(targets, 'zzz'), []);
});

test('the department a group of documents is in, if it is one', () => {
  assert.equal(commonDepartment([]), undefined);
  assert.equal(commonDepartment([{ department_id: 3 }, { department_id: 3 }]), 3);
  assert.equal(commonDepartment([{ department_id: 3 }, { department_id: 4 }]), undefined);
  assert.equal(commonDepartment([{ department_id: null }, {}]), null);
  assert.equal(commonDepartment([{ department_id: null }, { department_id: 4 }]), undefined);
});

test('a move is one request per document, in turn; one the server refuses does not stop the rest; one already there is not sent', async () => {
  const where: Record<number, number | null> = { 1: null, 2: 5, 3: 7, 4: null, 5: 9 };
  const sent: [number, number | null][] = [];
  let running = 0;
  let overlapped = false;
  const out = await moveAll([1, 2, 3, 4, 5], 5, {
    departmentOf: (id) => where[id],
    move: async (id, to) => {
      running += 1; overlapped ||= running > 1;
      await new Promise((r) => setTimeout(r, 1));
      running -= 1;
      if (id === 3) throw new Error('You may not change this document');
      sent.push([id, to]);
    },
    reason: (e) => (e as Error).message,
  });
  assert.deepEqual(out, { moved: [1, 4, 5], same: [2], failed: [{ id: 3, reason: 'You may not change this document' }] });
  assert.deepEqual(sent, [[1, 5], [4, 5], [5, 5]]);
  assert.equal(overlapped, false);
  // to "No department" is a move too, from an unknown department id as well
  const cleared = await moveAll([1, 2], null, { departmentOf: (id) => (id === 1 ? undefined : 99), move: async () => undefined, reason: String });
  assert.deepEqual(cleared, { moved: [2], same: [1], failed: [] });
});

test('one toast says what happened: how many moved, how many could not, and the first reason', () => {
  const ok = (moved: number[]) => ({ moved, same: [], failed: [] });
  assert.deepEqual(moveMessage(ok([1, 2, 3, 4, 5]), 'Operations'), { title: 'Moved 5 documents to Operations', type: 'success' });
  assert.deepEqual(moveMessage(ok([1]), 'Operations › Security'), { title: 'Moved 1 document to Operations › Security', type: 'success' });
  assert.deepEqual(moveMessage({ moved: [], same: [1, 2], failed: [] }, 'Legal'), { title: 'Already in Legal', type: 'info' });
  const failed = [{ id: 9, reason: 'The department chosen is not active.' }, { id: 8, reason: 'Second' }];
  assert.deepEqual(moveMessage({ moved: [1, 2, 3, 4], same: [], failed: failed.slice(0, 1) }, 'Legal'),
    { title: 'Moved 4 · 1 could not be moved', message: 'The department chosen is not active.', type: 'warning' });
  assert.deepEqual(moveMessage({ moved: [], same: [], failed }, 'Legal'), { title: '2 not moved', message: 'The department chosen is not active.', type: 'error' });
  assert.deepEqual(moveMessage({ moved: [], same: [], failed: failed.slice(0, 1) }, 'Legal'), { title: 'Not moved', message: 'The department chosen is not active.', type: 'error' });
  assert.equal(moveMessage({ moved: [1], same: [], failed: [{ id: 2, reason: '' }] }, 'Legal').message, undefined);
});
