// node --test "src/app/(dashboard)/governance/documents/directory/directoryFiles.test.ts"
// The files of the Directory: which documents are filed in a folder (a unit's own, never the units below it; the top holds those with no department), archived ones left out, folders
// first then files each by name unless a column is sorted, the 100-row cap, the keys of the selection, and where a file opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTree, fromList, type ListRow } from './directoryModel.ts';
import {
  FILE_PAGE, capFiles, docHref, docKey, fileFrom, fileTip, filesFrom, filesIn, itemKeys, itemOf, keyOf, libraryFileHref, reviewText, sortFiles, sortFolders, statusTone, unitKey, versionText, folderKey,
  type DirFile,
} from './directoryFiles.ts';

const row = (id: number, over: Record<string, unknown> = {}) => ({
  id, title: `Doc ${id}`, document_code: `D-${id}`, doc_type: 'policy', status: 'published', current_version: '1.0', owner_name: 'Olivia Owner', next_review_date: '2026-12-01', department_id: 3, ...over,
});
const file = (id: number, over: Record<string, unknown> = {}): DirFile => fileFrom(row(id, over))!;

test('a row of the library list is a file: the words are the library\'s, the version has its v, a missing owner or review stays missing', () => {
  const f = fileFrom(row(7, { doc_type: 'procedure', status: 'pending_review', current_version: '2.1' }))!;
  assert.deepEqual([f.id, f.title, f.code, f.type, f.typeLabel, f.status, f.statusLabel, f.version, f.owner, f.review, f.department], [7, 'Doc 7', 'D-7', 'procedure', 'Procedure', 'pending_review', 'In review', 'v2.1', 'Olivia Owner', '2026-12-01', 3]);
  const bare = fileFrom(row(8, { owner_name: null, next_review_date: null, department_id: null, current_version: null, document_code: '' }))!;
  assert.deepEqual([bare.owner, bare.review, bare.department, bare.version, bare.code], [null, null, null, '—', null]);
  assert.equal(versionText('v3'), 'v3');
  assert.equal(versionText('3'), 'v3');
});

test('a row that is not a document, or is archived (the folder counts leave it out too), is no file', () => {
  assert.equal(fileFrom(null), null);
  assert.equal(fileFrom({ title: 'No id' }), null);
  assert.equal(fileFrom({ id: 1, title: '   ' }), null);
  assert.equal(fileFrom({ id: 0, title: 'Zero' }), null);
  assert.equal(fileFrom(row(2, { status: 'archived' })), null);
  assert.notEqual(fileFrom(row(3, { status: 'expired' })), null, 'a lapsed document is still in its folder');
});

test('the list answer is read as { items, truncated } or a bare array; a truncated answer says the list is partial', () => {
  assert.deepEqual(filesFrom({ items: [row(1), row(2, { status: 'archived' }), 'junk'], total: 3 }).files.map((f) => f.id), [1]);
  assert.equal(filesFrom({ items: [row(1)], truncated: true }).partial, true);
  assert.equal(filesFrom({ items: [row(1)] }).partial, false);
  assert.deepEqual(filesFrom([row(4), row(5)]).files.map((f) => f.id), [4, 5]);
  assert.deepEqual(filesFrom(undefined), { files: [], partial: false });
  assert.deepEqual(filesFrom({ items: 'no' }), { files: [], partial: false });
});

test('a folder holds the documents filed directly in it: not the ones in the units below, and the top holds the ones with no department', () => {
  const all = [file(1, { department_id: 3 }), file(2, { department_id: 4 }), file(3, { department_id: null }), file(4, { department_id: 3 }), file(5, { department_id: 99 })];
  assert.deepEqual(filesIn(all, 3).map((f) => f.id), [1, 4]);
  assert.deepEqual(filesIn(all, 4).map((f) => f.id), [2]);
  assert.deepEqual(filesIn(all, null).map((f) => f.id), [3], 'the Organisation: documents with no department');
  assert.deepEqual(filesIn(all, 12), []);
});

test('files are by name (numbers in order, any case) unless a column is sorted; a tie falls back to the name', () => {
  const fs = [file(1, { title: 'beta' }), file(2, { title: 'Alpha 10' }), file(3, { title: 'alpha 2' }), file(4, { title: 'Gamma' })];
  assert.deepEqual(sortFiles(fs, null).map((f) => f.title), ['alpha 2', 'Alpha 10', 'beta', 'Gamma']);
  assert.deepEqual(sortFiles(fs, { key: 'name', dir: 'desc' }).map((f) => f.title), ['Gamma', 'beta', 'Alpha 10', 'alpha 2']);
  const byType = [file(1, { title: 'b', doc_type: 'standard' }), file(2, { title: 'a', doc_type: 'standard' }), file(3, { title: 'c', doc_type: 'guideline' })];
  assert.deepEqual(sortFiles(byType, { key: 'type', dir: 'asc' }).map((f) => f.title), ['c', 'a', 'b']);
});

test('sorting by status follows the lifecycle (draft first, published last, a lapsed one after); by version, 1.10 comes after 1.2', () => {
  const st = [file(1, { status: 'published' }), file(2, { status: 'draft' }), file(3, { status: 'expired' }), file(4, { status: 'pending_approval' }), file(5, { status: 'approved' })];
  assert.deepEqual(sortFiles(st, { key: 'status', dir: 'asc' }).map((f) => f.status), ['draft', 'pending_approval', 'approved', 'published', 'expired']);
  const vs = [file(1, { current_version: '1.10' }), file(2, { current_version: '1.2' }), file(3, { current_version: '2.0' }), file(4, { current_version: null })];
  assert.deepEqual(sortFiles(vs, { key: 'version', dir: 'asc' }).map((f) => f.version), ['v1.2', 'v1.10', 'v2.0', '—']);
  assert.deepEqual(sortFiles(vs, { key: 'version', dir: 'desc' }).map((f) => f.version), ['v2.0', 'v1.10', 'v1.2', '—'], 'no version is last either way');
});

test('a missing owner or review date is last in both directions', () => {
  const fs = [file(1, { owner_name: null, next_review_date: null }), file(2, { owner_name: 'Zed', next_review_date: '2027-01-01' }), file(3, { owner_name: 'Amy', next_review_date: '2026-01-01' })];
  assert.deepEqual(sortFiles(fs, { key: 'owner', dir: 'asc' }).map((f) => f.id), [3, 2, 1]);
  assert.deepEqual(sortFiles(fs, { key: 'owner', dir: 'desc' }).map((f) => f.id), [2, 3, 1]);
  assert.deepEqual(sortFiles(fs, { key: 'review', dir: 'asc' }).map((f) => f.id), [3, 2, 1]);
  assert.deepEqual(sortFiles(fs, { key: 'review', dir: 'desc' }).map((f) => f.id), [2, 3, 1]);
});

test('sorting does not touch what it was given', () => {
  const fs = [file(1, { title: 'b' }), file(2, { title: 'a' })];
  sortFiles(fs, null);
  assert.deepEqual(fs.map((f) => f.id), [1, 2]);
});

const LIST: ListRow[] = [
  { id: 1, name: 'Operations', parent_department_id: null, level: 1, is_active: true, member_count: 3, document_count: 5, child_count: 1 },
  { id: 2, name: 'Support', parent_department_id: 1, level: 2, is_active: true, member_count: 9, document_count: 4, child_count: 0 },
  { id: 3, name: 'Finance', parent_department_id: null, level: 1, is_active: true, member_count: 1, document_count: 8, child_count: 0, department_head_user_id: 5, department_head_name: 'Fay Head' },
  { id: 4, name: 'Audit', parent_department_id: null, level: 1, is_active: true, member_count: 0, document_count: 1, child_count: 0 },
];

test('folders are by name unless a column is sorted: documents mean the whole subtree, units the folders directly under it, an empty owner is last', () => {
  const tree = buildTree(fromList(LIST, true).nodes);
  const top = tree.childrenOf(null);
  assert.deepEqual(sortFolders(top, tree, null).map((n) => n.name), ['Audit', 'Finance', 'Operations']);
  assert.deepEqual(sortFolders(top, tree, { key: 'documents', dir: 'desc' }).map((n) => n.name), ['Operations', 'Finance', 'Audit'], 'Operations 5 + 4 = 9, Finance 8');
  assert.deepEqual(sortFolders(top, tree, { key: 'units', dir: 'desc' }).map((n) => n.name), ['Operations', 'Audit', 'Finance']);
  assert.deepEqual(sortFolders(top, tree, { key: 'people', dir: 'asc' }).map((n) => n.name), ['Audit', 'Finance', 'Operations']);
  assert.deepEqual(sortFolders(top, tree, { key: 'owner', dir: 'asc' }).map((n) => n.name), ['Finance', 'Audit', 'Operations'], 'a folder with no owner is last, by name');
  assert.deepEqual(sortFolders(top, tree, { key: 'owner', dir: 'desc' }).map((n) => n.name), ['Finance', 'Audit', 'Operations'], 'and last the other way too');
});

test('a long list shows its first 100 and says how many more there are', () => {
  const many = Array.from({ length: 250 }, (_, i) => i);
  assert.equal(FILE_PAGE, 100);
  assert.deepEqual([capFiles(many).shown.length, capFiles(many).more], [100, 150]);
  assert.deepEqual([capFiles(many, 200).shown.length, capFiles(many, 200).more], [200, 50]);
  assert.deepEqual([capFiles(many, 300).shown.length, capFiles(many, 300).more], [250, 0]);
  assert.deepEqual([capFiles([1, 2], 100).shown, capFiles([1, 2], 100).more], [[1, 2], 0]);
  assert.deepEqual(capFiles([], 100), { shown: [], more: 0 });
  assert.deepEqual(capFiles(many, 0), { shown: [], more: 250 });
});

test('the keys of the selection name a folder or a file, folders first in the order they are drawn', () => {
  assert.equal(unitKey(7), 'u:7');
  assert.equal(docKey(12), 'd:12');
  assert.deepEqual(itemOf('u:7'), { kind: 'unit', id: 7 });
  assert.deepEqual(itemOf('d:12'), { kind: 'doc', id: 12 });
  for (const bad of [null, undefined, '', 'x:1', 'u:', 'u:-1', 'u:1.5', 'd:12345678901']) assert.equal(itemOf(bad), null, String(bad));
  assert.equal(keyOf({ kind: 'doc', id: 3 }), 'd:3');
  assert.deepEqual(itemKeys([{ id: 4 }, { id: 2 }], [{ id: 9 }, { id: 1 }]), ['u:4', 'u:2', 'd:9', 'd:1']);
  assert.equal(folderKey(null), 'org');
  assert.equal(folderKey(7), '7');
});

test('a file opens on the document\'s own page, with the folder as its way back; the library is the other way in, filtered to the unit with its details open', () => {
  assert.equal(docHref(12), '/governance/documents/12');
  assert.equal(docHref(12, '/governance/documents/directory?unit=3'), '/governance/documents/12?from=%2Fgovernance%2Fdocuments%2Fdirectory%3Funit%3D3');
  assert.equal(libraryFileHref({ id: 12, department: 3 }), '/governance/documents?dept=3&open=12');
  assert.equal(libraryFileHref({ id: 12, department: null }), '/governance/documents?dept=none&open=12', 'a document with no department: the library\'s "no department"');
});

test('the words of a file: the tooltip names it and says what it is; the review day is the platform\'s date; the dot takes the platform\'s status tone', () => {
  assert.equal(fileTip(file(1, { title: 'Access Control', document_code: 'POL-3', doc_type: 'policy', status: 'published', current_version: '1.2' })), 'Access Control\nPOL-3 · Policy · Published · v1.2');
  assert.equal(fileTip(file(2, { document_code: null, current_version: null })), 'Doc 2\nPolicy · Published');
  assert.equal(reviewText({ review: '2026-12-01' }), '1 Dec 2026');
  assert.equal(reviewText({ review: null }), '—');
  assert.equal(statusTone('published'), 'success');
  assert.equal(statusTone('expired'), 'danger');
  assert.equal(statusTone('draft'), 'neutral');
  assert.equal(statusTone('pending_review'), 'pending');
});
