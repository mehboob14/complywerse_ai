// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryKit.test.ts"
// The library stays on the design-system kit and keeps the promises of its rewrite, read from the sources (the repo's habit for pages: archive.test.ts, libraryFoldersView.test.ts):
// no control that appears only on hover, no native dialog, no legacy governance scope, every write reported and archiving asked, and the token rules of the kit (kitRules.ts:
// no named sizes, palette colours, hex, shadows or radii, no text under 12px) held over every file that was rewritten. A page that goes back to hover-only buttons or to
// window.confirm fails here, with the line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const DIR = new URL('./', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const files = readdirSync(DIR).filter((n) => /\.tsx$/.test(n));
// RowActionsMenu is the shared dropdown of other modules (statutory audit, regulatory changes, vendor risk): the library no longer uses it, and it is not the library's to restyle
const LIBRARY = files.filter((n) => n !== 'RowActionsMenu.tsx');
const lines = (src: string) => src.split(/\r?\n/);
const code = (line: string) => line.replace(/(^|\s)\/\/\s.*$/, '$1').replace(/^\s*(\*|\/\*)/, '');            // not a comment

test('no row action appears only on hover: nothing is opacity-0 until a group is hovered or focused', () => {
  const found: string[] = [];
  for (const name of [...LIBRARY, 'page.tsx']) {
    const src = name === 'page.tsx' ? readFileSync(new URL('../page.tsx', DIR), 'utf8') : read(name);
    lines(src).forEach((line, i) => {
      const c = code(line);
      if (/opacity-0\b[^'"`]*group-(hover|focus)|group-(hover|focus)[^'"`]*opacity-(100|[1-9]\d)|\bHoverButton\b/.test(c)) found.push(`${name}:${i + 1} ${c.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(found, []);
});

test('a row\'s menu is a kit Menu that is always drawn, and Open, Edit, Move to…, Download, Archive and Restore are in it', () => {
  const rows = read('libraryRows.tsx');
  assert.ok(rows.includes("from '@/components/ui/ds'") && rows.includes('<Menu label='));
  for (const key of ['open', 'edit', 'move', 'download', 'archive', 'restore']) assert.ok(rows.includes(`key: '${key}'`), key);
  assert.ok(rows.includes('iconOnly'));
  assert.ok(!/RowActionsMenu/.test(rows + read('cells.tsx') + read('DocumentDrawer.tsx')));          // the shared dropdown of other modules is not used here
  // the title is the link that opens the document, and it is a real link (a modified click opens a new tab); its address carries the library's (?from=)
  assert.ok(rows.includes('href={env.hrefOf(doc.id)}') && rows.includes('plainClick(e)'));
});

test('no native dialog: no window.confirm, alert or prompt, and the page asks through useConfirm', () => {
  const found: string[] = [];
  for (const name of [...LIBRARY, 'page.tsx']) {
    const src = name === 'page.tsx' ? readFileSync(new URL('../page.tsx', DIR), 'utf8') : read(name);
    lines(src).forEach((line, i) => { if (/\bwindow\.(confirm|alert|prompt)\s*\(|(^|[^.\w])(alert|prompt)\s*\(/.test(code(line))) found.push(`${name}:${i + 1}`); });
  }
  assert.deepEqual(found, []);
  const workspace = read('DocumentsWorkspace.tsx');
  assert.ok(workspace.includes('useConfirm()') && workspace.includes('{confirmDialog}'));
});

test('the page has left the legacy governance scope of the platform CSS', () => {
  for (const name of LIBRARY) assert.ok(!/governance-light/.test(read(name)), name);
  assert.ok(!/governance-light/.test(readFileSync(new URL('../page.tsx', DIR), 'utf8')));
});

test('every write of the page is reported when the server has answered, and archiving asks first, in the danger tone', () => {
  const workspace = read('DocumentsWorkspace.tsx');
  assert.equal(workspace.split('useReportedMutation({').length - 1, 5);               // publish, archive, restore, assign owner, set review date
  // each bulk endpoint is called only from a mutationFn
  for (const call of ['bulkPublish(', 'bulkArchive(', 'bulkAssignOwner(', 'bulkSetReviewDate(', 'restoreDocument(']) {
    const at = lines(workspace).map((l, i) => ({ l: code(l), i })).filter(({ l }) => l.includes(call));
    assert.ok(at.length > 0, call);
    for (const { l, i } of at) assert.ok(l.includes('mutationFn'), `${call} at line ${i + 1} is not inside a mutationFn: ${l.trim()}`);
  }
  assert.ok(workspace.includes('REFRESH_KEYS') && workspace.split('invalidate: REFRESH_KEYS').length - 1 === 5);       // the refresh the page always did, after each of them
  assert.ok(workspace.split('onError: refreshAll').length - 1 === 5);                                               // and after a failure too
  assert.ok(/askArchive = async/.test(workspace) && workspace.includes("tone: 'danger'") && workspace.includes('ARCHIVE_LINE'));
  assert.ok(workspace.includes('onBulkArchive = (ids: number[]) => { void askArchive(ids); }') && workspace.includes('onArchiveDoc = (doc: GovDoc) => { void askArchive([doc.id]); }'));     // bulk or one
  // a deleted saved view asks too
  assert.ok(workspace.includes('Delete the view'));
});

test('the numbers the page states come from libraryNumbers.ts: the head, the filter bar, the pager and the export say what they are over', () => {
  const workspace = read('DocumentsWorkspace.tsx');
  for (const word of ['headCount(', 'loadedNotice(', 'csvName(', 'noMatch(', 'missingOpen(', 'exportWords(', 'pagerNoun(cut)', '<Pager', "<ListNotice title={notice.title}>"]) assert.ok(workspace.includes(word), word);
  // a failed list is an error with Retry, never an empty library
  assert.ok(workspace.includes('if (noList) return <ErrorState title="Couldn\'t load the documents"'));
  // the library asks for its whole list ONCE, lean (no text, no query per row), and the page keeps no second request that only drives a banner
  assert.ok(read('api.ts').includes("fetchDocuments({ lean: 1, limit: LIBRARY_LIMIT, sort_by: 'updated_at', sort_order: 'desc' })") && workspace.includes('queryFn: fetchLibrary'));
  assert.ok(!/getDocuments\(/.test(readFileSync(new URL('../page.tsx', DIR), 'utf8')));
});

test('the register is on the kit table: sortable headers with aria-sort, rows that open from the keyboard, columns by the width of the list\'s own box, cards where the table has no room (only the one that fits is drawn); the details open over the list', () => {
  const table = readFileSync(new URL('../../../../../components/records/RecordTable.tsx', import.meta.url), 'utf8');
  for (const word of ['<TableFrame', '<Th', '<Tr', 'sortKey={c.sortKey}', 'onActivate={() => onActivate(record)}', 'useContainerWidth(box)', 'fitColumns(asked, room, chrome)']) assert.ok(table.includes(word), word);
  assert.ok(!/priority=/.test(table));                                                                            // the kit's priority classes are the window's width: the fit decides
  assert.ok(!/<table\b|<th\b|<thead\b/.test(table));                                                              // no bare table elements of its own: the kit's primitives
  assert.ok(table.includes('table-fixed'));
  // the details: the kit's SidePanel as an overlay at every width (never docked), a sheet on a phone, with ONE scrolling body
  const detail = read('DocumentDetail.tsx');
  assert.ok(detail.includes('<SidePanel') && detail.includes('dockFrom={Infinity}') && detail.includes('restoreFocus={rowOf(doc?.id ?? null)}'));
  assert.ok(!/useMinWidth/.test(read('DocumentsWorkspace.tsx')));
});

test('the files that were rewritten on the kit hold its token rules: no named text size, palette colour, hex, named shadow or radius, no text under 12px', () => {
  const rewritten = [
    'atoms.tsx', 'cells.tsx', 'DocumentDrawer.tsx', 'DocumentsWorkspace.tsx', 'FolderRows.tsx', 'FrameworkList.tsx', 'FrameworksCell.tsx', 'LibraryFilters.tsx', 'LibraryKpis.tsx',
    'LifecycleHover.tsx', 'MovePopover.tsx', 'Versions.tsx', 'libraryRows.tsx', 'libraryItems.tsx', 'DocumentDetail.tsx',
  ];
  const found: string[] = [];
  for (const name of rewritten) for (const v of findViolations(read(name))) found.push(`${name}:${v.line} ${v.rule} ${v.text}`);
  assert.deepEqual(found, []);
});

test('the library lays its list out by the room its explorer has, never by the window: no breakpoint variant and no viewport height in the files that draw the list, the board and the links', () => {
  const found: string[] = [];
  // Versions.tsx is the details panel's (its width is the kit panel's, which follows the window); BulkBar and the popovers are fixed to the window on purpose
  for (const name of ['DocumentsWorkspace.tsx', 'libraryRows.tsx', 'DocumentDetail.tsx', 'DocumentDrawer.tsx', 'FolderRows.tsx', 'cells.tsx', 'libraryItems.tsx']) {
    lines(read(name)).forEach((line, i) => {
      const c = code(line);
      if (/(^|[\s"'`])(max-)?(sm|md|lg|xl|2xl):/.test(c)) found.push(`${name}:${i + 1} breakpoint variant`);
      if (/\b\d*(d|s|l)?vh\b|calc\(100v/.test(c)) found.push(`${name}:${i + 1} viewport height`);
    });
  }
  assert.deepEqual(found, []);
});

test('every way out of the library to another page carries the library\'s address (?from=), so the shell keeps Documents lit and the way back is this view', () => {
  const workspace = read('DocumentsWorkspace.tsx');
  assert.ok(workspace.includes('withFrom(`/governance/documents/${id}`, here)') && workspace.includes('const openDoc = (id: number) => router.push(docHref(id));') && workspace.includes('hrefOf: docHref'));
  assert.ok(workspace.includes('<Button href={docHref(openId as number)}>Open its page</Button>'));
  assert.ok(read('Versions.tsx').includes('withFrom(`/governance/documents/${doc.id}?read=${v.id}`, here)'));
  assert.ok(read('DocumentDrawer.tsx').includes("withFrom('/governance/documents/attestation', here)"));
  assert.ok(read('FolderRows.tsx').includes("withFrom('/governance/settings', here)"));
  const page = readFileSync(new URL('../page.tsx', DIR), 'utf8');
  assert.equal((page.match(/router\.push\(/g) ?? []).length, (page.match(/router\.push\(withFrom\(/g) ?? []).length);             // none leaves without it
  // and no link of the library is a bare path to a document any more
  for (const name of ['libraryRows.tsx', 'Versions.tsx', 'DocumentDetail.tsx', 'DocumentDrawer.tsx']) assert.ok(!/href=\{?[`"']\/governance\/documents\/(\$\{|\d)/.test(read(name)), name);
});

test('no screen of the page names a model or a vendor', () => {
  for (const name of LIBRARY) assert.ok(!/\b(gpt|openai|anthropic)\b/i.test(read(name)), name);
});
