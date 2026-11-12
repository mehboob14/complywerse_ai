// node --test "src/app/(dashboard)/governance/documents/directory/directoryPage.test.ts"
// What the Directory promises, read from its sources (the repo's habit for pages, like overviewPage.test.ts): it stays on the design-system kit and holds its token rules, no
// screen names a model or a vendor or prints an id, a unit is never deleted (only deactivated, after a question), the Directory API is asked for once and a backend without it is
// not an error, the tree is a real keyboard tree, a double-click or Enter on a folder goes INTO it (like Explorer; Back, Forward and Up work, the documents filed in the folder are files after
// its folders, the folders are yellow), the popup is Properties (toolbar, menus, Alt+Enter, a link), the tabs come from ONE registry whose placeholders are not shown, every read has its
// states, a person who may not change a unit gets none of its buttons, and the page is a tab of the Documents area.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const DIR = new URL('./', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const files = readdirSync(DIR).filter((n) => /\.tsx?$/.test(n) && !/\.test\.ts$/.test(n));
const tsx = files.filter((n) => n.endsWith('.tsx'));
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const idx = (src: string, piece: string) => { const i = src.indexOf(piece); assert.ok(i >= 0, `missing: ${piece}`); return i; };

test('the page is on the kit: its files hold the token rules (no named text size, palette colour, hex, named shadow or radius, no text under 12px)', () => {
  const found: string[] = [];
  for (const name of files) for (const v of findViolations(read(name))) found.push(`${name}:${v.line} ${v.rule} ${v.text}`);
  assert.deepEqual(found, []);
});

test('no screen names a model or a vendor, none leaves the design system for the legacy scope, no two files differ only in case', () => {
  for (const name of files) {
    assert.ok(!/governance-light/.test(read(name)), name);
    assert.ok(!/\b(gpt|openai|anthropic|claude)\b/i.test(code(read(name))), name);
  }
  const names = files.map((n) => n.replace(/\.tsx?$/, '').toLowerCase());
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

test('no bare <p>, <td>, <th>, <h2> or <h3> without a ds text size (the platform CSS gives a bare one 11.5px), and no bare table elements: the kit\'s primitives', () => {
  for (const name of tsx) {
    const src = code(read(name));
    for (const tag of src.match(/<(?:p|h2|h3)\b[^>]*>/g) ?? []) assert.ok(/text-ds-/.test(tag), `${name}: ${tag}`);
    assert.ok(!/<table\b|<thead\b|<tbody\b|<td\b/.test(src), `${name}: use the kit's Table`);
  }
});

test('U1: no id is printed on a screen (an id is a key, a data attribute or a link, never a word)', () => {
  for (const name of tsx) {
    const src = code(read(name));
    assert.ok(!/>\s*\{[\w.?!]*\bid\}\s*</.test(src), `${name}: an id printed as text`);
    assert.ok(!/>\s*#\{/.test(src), `${name}: "#id"`);
  }
});

test('a unit is never deleted: nothing calls a delete on a department; switching off is deactivate, after the kit\'s confirm, and activating is a patch', () => {
  const all = files.map((n) => code(read(n))).join('\n');
  assert.ok(!/(?:apiClient|departmentsApi|api)\.delete\(/.test(all), 'a delete call on the API (departmentsApi.deactivate is the DELETE route that only switches a unit off)');
  assert.ok(!/window\.(confirm|alert)\(/.test(all), 'window.confirm');
  const toggle = code(read('useToggleActive.tsx'));
  assert.ok(toggle.includes('departmentsApi.deactivate(u.id)') && toggle.includes('{ is_active: true }'));
  assert.ok(toggle.includes("await confirm({ title: `Deactivate ${unit.name}?`") && toggle.includes('DEACTIVATE_NOTE') && toggle.includes("tone: 'danger'"));
  assert.ok(toggle.includes('deactivatedText') && toggle.includes('activatedText'), 'says what happened, in the words Administration uses');
});

test('the data: the Directory API is tried once and a backend without it (404, 405, 422) is not an error; the flat list is the fallback; nothing is logged', () => {
  const data = code(read('directoryData.ts'));
  assert.ok(data.includes("'/admin/departments/directory'") && data.includes('departmentsApi.list(true)'));
  assert.ok(data.includes("endpoint !== 'absent'") && data.includes("endpoint = 'absent'") && data.includes("endpoint = 'present'"), 'asked once, remembered');
  assert.ok(data.includes('[404, 405, 422]') && data.includes('if (!missing(e)) throw e'), 'only "no such route" falls back; a 401, 403, 500 or no network is the page\'s error');
  assert.ok(data.includes('retry: false'));
  assert.ok(data.includes('fromDirectory(') && data.includes('fromList(') && data.includes('GLOBAL_RIGHT'), 'both answers become the same nodes');
  assert.ok(data.includes("export const GLOBAL_RIGHT = 'admin:organization:edit'"));
  for (const name of files) assert.ok(!/\bconsole\.(log|warn|error|info|debug)\(/.test(code(read(name))), `${name}: a console call`);
  const refresh = data.slice(idx(data, 'export function useRefreshDirectory'));
  assert.ok(refresh.includes('refreshDepartments(qc)') && refresh.includes("['admin-department']") && refresh.includes('DIRECTORY_KEY'), 'a change reaches every list of departments and the open unit');
});

test('the page is a tab of the Documents area with the registry\'s name, its state is in the address, and every read has its states', () => {
  const page = code(read('page.tsx'));
  assert.ok(page.includes("export const dynamic = 'force-dynamic'") && page.includes("routeFor('/governance/documents/directory')"));
  for (const piece of ['unit: text()', "view: oneOf<ViewId>(VIEW_IDS, 'icons')", 'open: text()', "tab: oneOf<TabId>(TAB_IDS, 'details')", 'useAddressState(ADDRESS)']) assert.ok(page.includes(piece), piece);
  assert.ok(page.includes('<PageHeader') && page.includes('variant="page"') && page.includes('info={INFO}'), 'the kit\'s page head, the explanation in an (i)');
  assert.ok(page.includes('data.loading') && page.includes('<SkeletonLines') && page.includes('<ErrorState title="Couldn\'t load the directory"') && page.includes('onRetry={canRetry(data.error) ? data.refetch : undefined}'));
  assert.ok(page.includes('<NoAccessState title="No access"') && page.includes('statusOf(data.error) === 403'), 'a refusal is not an error');
  assert.ok(page.includes('title="No departments yet"') && page.includes('What is shown may be out of date.'), 'an empty organisation, and a refresh that failed after one that worked');
  assert.ok(page.includes('<ReadOnlyNote>') && page.includes('viewOnly(nodes, canTop)'), 'a person who may change nothing is told so');
  assert.ok(!/\?\?\s*0\b|\|\|\s*0\b/.test(page), 'a missing answer is never turned into 0');
  assert.ok(page.includes('.platform') === false);
});

test('what a person may do comes from the model: the toolbar and every menu are built from unitActions, a hidden action is not drawn, a disabled one says why', () => {
  const page = code(read('page.tsx'));
  assert.ok(page.includes('unitActions(tree, target, ctx)') && page.includes('unitActions(tree, current, ctx)') && page.includes('unitActions(tree, id, ctx)') && page.includes('menuItems('));
  const toolbar = code(read('Toolbar.tsx'));
  assert.ok(toolbar.includes('actions.filter((a) => !a.hidden)') && toolbar.includes('title={a.reason}') && toolbar.includes('title={primary.reason}'));
  assert.ok(toolbar.includes('role="toolbar"') && toolbar.includes('<SegmentedControl label="View" name="directory-view"') && toolbar.includes('Refresh'));
  const menu = code(read('unitMenu.ts'));
  assert.ok(menu.includes('.filter((a) => !a.hidden)') && menu.includes('reason: a.reason') && menu.includes("a.key === 'toggle' && a.label === 'Deactivate'"));
  const ctxMenu = code(read('ContextMenu.tsx'));
  assert.ok(ctxMenu.includes('role="menu"') && ctxMenu.includes('role="menuitem"') && ctxMenu.includes("e.key === 'Escape'") && ctxMenu.includes('placeMenu('), 'a menu at the pointer, kept on screen, with its keys');
  assert.ok(page.includes('onContextMenu') === false && code(read('UnitTree.tsx')).includes('onContextMenu') && code(read('Contents.tsx')).includes('onContextMenu'), 'right-click on a tree line, a tile and a row');
});

test('the tree is a keyboard tree: role=tree, lines with level, place in set, open and selected, one tab stop, the keys decided by the tested treeKey', () => {
  const tree = code(read('UnitTree.tsx'));
  for (const piece of ['role="tree"', 'role="treeitem"', 'aria-level={row.depth + 1}', 'aria-posinset={row.posInSet}', 'aria-setsize={row.setSize}', 'aria-selected={on}', 'aria-expanded=', 'tabIndex={on ? 0 : -1}', 'treeKey(rows, names']) assert.ok(tree.includes(piece), piece);
  assert.ok(tree.includes('onDoubleClick={() => { if (row.id !== null) onOpen(row.id); }}') && tree.includes("'open' in act") === false, 'a double-click opens the unit; Enter is the model\'s {open}');
  assert.ok(tree.includes('Inactive') && tree.includes('aria-label="Find a unit"') && tree.includes('findUnits('), 'a unit switched off says so in words; a unit can be found by name');
  assert.ok(tree.includes('relative max-h-'), 'the tree scrolls in a positioned box (hidden text must not widen the page)');
  const model = code(read('directoryModel.ts'));
  for (const k of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter']) assert.ok(model.includes(`case '${k}'`), k);
});

test('a double-click or Enter on a folder GOES INTO it (tree and contents), pushing the address; a single click only selects; a double-click on a file opens the document; on a phone a tap opens', () => {
  const contents = code(read('Contents.tsx'));
  assert.ok(contents.includes('onDoubleClick={() => { if (!tap) onOpen(item); }}') && contents.includes("if (e.key === 'Enter')") && contents.includes('if (item) onOpen(item);'), 'Enter and a double-click open');
  assert.ok(contents.includes('onClick={() => (tap ? onOpen(item) : onSelect(itemKey))}'), 'a single click selects; with a finger it opens');
  assert.ok(contents.includes('const tap = compact || coarse') && contents.includes('(max-width: 767px)') && contents.includes('(pointer: coarse)'), 'drill-down below 768px, and for a finger');
  assert.ok(contents.includes('<TableFrame') && contents.includes('<RowHeaderCell>') && contents.includes('Th priority={3}'), "Details is the kit's table, its minor columns give way as the window narrows");
  assert.ok(contents.includes("view === 'icons' || compact"), 'a phone gets the Icons list, not the table');
  const page = code(read('page.tsx'));
  assert.ok(page.includes('const openFolder = (id: number) => { wantPane(); goInto(id); }') && page.includes('nav.navigate(id)'), "opening a folder is a push (the browser's Back comes back)");
  assert.ok(page.includes('onOpen={openItem}') && page.includes('onOpen={(id) => goInto(id)}'), 'the contents and the tree both go into a folder');
  assert.ok(!/onOpen=\{\([^)]*\) => openPopup/.test(page) && !contents.includes('openPopup'), 'a double-click no longer opens the popup');
  assert.ok(page.includes('router.push(docHref(f.id, here))') && page.includes('openFile(f)'), "a file opens the document's own page, with this folder as its way back");
  assert.ok(page.includes("setAddress({ unit: to === null ? '' : String(to) }, { push })"), 'the folder is in the address (?unit=)');
});

test("Back, Forward and Up are in the address bar, off where there is nowhere to go; the first Back from the first folder visited does not leave the Directory; the browser's history is used", () => {
  const bar = code(read('AddressBar.tsx'));
  for (const piece of ['aria-label="Back"', 'aria-label="Forward"', 'aria-label="Up one level"', 'disabled={!canBack}', 'disabled={!canForward}', 'disabled={current === null}', 'Alt+Left', 'Alt+Right', 'Alt+Up']) assert.ok(bar.includes(piece), piece);
  const nav = code(read('useDirectoryNav.ts'));
  assert.ok(nav.includes('window.history.back()') && nav.includes('window.history.forward()'), "Back and Forward are the browser's history, so the address, the tree, the selection and the scroll come back");
  assert.ok(nav.includes('canBack: !!t && canBack(t)') && nav.includes('follow(t, current, asked.current)'), "the page's own mirror says whether there is anywhere to go");
  const page = code(read('page.tsx'));
  assert.ok(page.includes('canBack={nav.canBack}') && page.includes('canForward={nav.canForward}') && page.includes('onUp={up}'));
  assert.ok(page.includes('[folderKey(parent)]: unitKey(current)'), 'Up selects the folder you came from, as Explorer does');
});

test("the keyboard: the shortcuts are explorerKeys' and are the page's only outside fields, dialogs and menus; Enter on a button or a row is that control's own", () => {
  const page = code(read('page.tsx'));
  assert.ok(page.includes("document.addEventListener('keydown', onKey)") && page.includes('explorerShortcut(e)'));
  assert.ok(page.includes('[role="dialog"], [role="menu"]') && page.includes('input, textarea, select, [contenteditable="true"], [role="combobox"]'), 'not under a popup or a menu, not in a field');
  assert.ok(page.includes("action === 'open' && t !== document.body && t !== pane.current"), "Enter on a button is the button's");
  assert.ok(page.includes("const wanted: ActionKey = a === 'properties' ? 'properties' : a === 'rename' ? 'edit' : 'toggle'"), 'Alt+Enter is Properties, F2 Edit details, Delete Deactivate: each through unitActions, so a person who may not does nothing');
  assert.ok(page.includes("act.label !== 'Deactivate'"), 'Delete only deactivates, it never activates');
  const contents = code(read('Contents.tsx'));
  assert.ok(contents.includes('onKeyDownCapture={onKeyDownCapture}') && contents.includes("el.matches('[data-item]')") && contents.includes('moveSelection(keys.length, at, e.key,') && contents.includes('typeAhead(names, at, e.key)'), 'arrows, Home, End and a letter move the selection, only on an item');
  assert.ok(contents.includes('columnsOf(box.current)'), 'a grid in Icons: Up and Down go a row');
});

test("FILES: the documents filed in the folder come after its folders (one list for the keyboard), from the library's own list; empty, failed, refused and long lists have their words", () => {
  const contents = code(read('Contents.tsx'));
  assert.ok(contents.includes('itemKeys(kids, shown)') && contents.includes('sortFolders(') && contents.includes('sortFiles(') && contents.includes('capFiles(sorted, limit)'), 'folders first, then files, sorted, capped');
  assert.ok(contents.includes('title="This folder is empty"') && contents.includes('Show more') && contents.includes('FILE_PAGE'), 'an empty folder says so; a long list has Show more');
  assert.ok(contents.includes('title="Couldn\'t load the files"') && contents.includes('onRetry={canRetry(files.error) ? files.onRetry : undefined}'), 'a list that did not load is not an empty folder, and can be asked again');
  assert.ok(contents.includes('files.refused') && contents.includes('Documents are not shown to you'), 'a refusal is said, not an error');
  assert.ok(contents.includes('<Th priority={2} sortKey="status"') && contents.includes('<Th priority={3} sortKey="review"') && contents.includes('Next review') && contents.includes('<Th priority={3} sortKey="version"'), 'the Details columns of a file: Name, Status, Type, Version, Owner, Next review');
  assert.ok(contents.includes("A folder's document count includes the folders under it."), "the count's meaning is in an (i)");
  const api = readFileSync(new URL('../../../../../lib/directoryFilesApi.ts', import.meta.url), 'utf8');
  assert.ok(api.includes("LIBRARY_LIST_KEY = ['gov-docs-workspace']") && api.includes('lean: 1') && api.includes("'/governance/documents'"), "the library's own lean list and its cache key: one request, the server's own read filter");
  const data = code(read('directoryFilesData.ts'));
  assert.ok(data.includes('queryKey: LIBRARY_LIST_KEY') && data.includes('statusOf(q.error) === 403') && data.includes('failed: q.isError && !parsed && !refused'));
  const page = code(read('page.tsx'));
  assert.ok(page.includes('filesIn(allFiles, current)') && page.includes('libraryFileHref(f)') && page.includes('fileMenuItems('), "the folder's own files; right-click: Open, Open in the library, Copy link");
  const menu = code(read('unitMenu.ts'));
  for (const label of ["'Open'", "'Open in the library'", "'Copy link'"]) assert.ok(menu.includes(label), label);
});

test('PROPERTIES: the popup opens from the toolbar, the menus, Alt+Enter and a link, not from a double-click; Edit details is the same popup with the cursor in the first field', () => {
  const page = code(read('page.tsx'));
  assert.ok(page.includes("if (key === 'properties') openPopup(id, 'details')") && page.includes("else if (key === 'edit') { setRenaming(id); openPopup(id, 'details'); }"));
  assert.ok(page.includes('focusName={renaming === popupNode.id}') && page.includes("setAddress({ open: '', tab: 'details' })"));
  const popup = code(read('UnitPopup.tsx'));
  assert.ok(popup.includes('`Properties · ${node.level_label}') && popup.includes('<FolderIcon'), "the dialog says Properties under the folder's icon");
  const model = code(read('directoryModel.ts'));
  assert.ok(model.includes("key: 'properties', label: 'Properties', hidden: false") && model.includes("key: 'edit', label: 'Edit details', hidden: !manage"), "everyone reads Properties; Edit details is the manager's");
  assert.ok(code(read('DetailsTab.tsx')).includes('focusName && canManage'));
});

test('YELLOW FOLDERS: one file draws every folder and file icon and holds the only colour codes of the Directory; the open one, the grey one and the file page are there; the rest uses tokens', () => {
  const icons = read('folderIcon.tsx');
  for (const piece of ['FOLDER_BACK', 'FOLDER_FRONT', 'FOLDER_GREY_BACK', 'FOLDER_GREY_FRONT', 'export function FolderIcon', 'export function FileIcon', 'open?: boolean', 'inactive?: boolean', 'badge?: boolean', 'aria-hidden']) assert.ok(icons.includes(piece), piece);
  assert.ok(/(?:FOLDER_BACK|FOLDER_FRONT) = '#[0-9A-Fa-f]{6}'/.test(icons), 'the yellows are named constants');
  for (const name of files.filter((n) => n !== 'folderIcon.tsx')) assert.ok(!/#[0-9a-fA-F]{6}\b/.test(code(read(name))), `${name}: a colour code outside folderIcon.tsx`);
  for (const name of ['UnitTree.tsx', 'Contents.tsx', 'AddressBar.tsx', 'UnitPopup.tsx', 'EmptyFolder.tsx']) assert.ok(read(name).includes('<FolderIcon'), `${name} draws the yellow folder`);
  for (const name of ['UnitTree.tsx', 'Contents.tsx', 'AddressBar.tsx', 'UnitPopup.tsx']) assert.ok(!/\b(Folder|FolderOpen|Building2)\b[^'"\n]*from 'lucide-react'/.test(read(name)), `${name}: a lucide folder is left`);
  assert.ok(code(read('UnitTree.tsx')).includes('<FolderIcon size={20} open={on} inactive='), 'the open folder is the one you are in');
});

test('the popup is the kit\'s centered dialog with the dirty guard; its tabs come from the registry and it names none; placeholders are not shown until enabled', () => {
  const popup = code(read('UnitPopup.tsx'));
  assert.ok(popup.includes('<AnimatedModal') && popup.includes('dirty={Object.values(dirty).some(Boolean)}'));
  assert.ok(popup.includes('shownTabs(DIRECTORY_TABS, ENABLED_TABS)') && popup.includes('t.render(props(t.id))') && popup.includes('lazy'));
  assert.ok(!/['"](details|people|access|approvals|exceptions)['"]/.test(popup), 'the popup knows no tab by name');
  const tabs = code(read('directoryTabs.ts'));
  for (const id of ['details', 'people', 'access', 'approvals', 'exceptions']) assert.ok(tabs.includes(`id: '${id}'`), id);
  assert.ok(tabs.includes("ENABLED_TABS: readonly TabId[] = ['details', 'people', 'access', 'approvals', 'exceptions']"), 'only what is built is in the strip');
  assert.ok(!tabs.includes('waitsFor') && !tabs.includes('ComingTab'), 'every registered tab is built: no placeholder is left');
  assert.ok(tabs.includes("createElement(AccessTab, props)") && tabs.includes("ORG_TABS: readonly TabId[] = ['approvals', 'exceptions']") && tabs.includes('ENABLED_ORG_TABS'), 'Access is built; the Organisation popup\'s tabs are in the registry');
  for (const piece of ['node: DirectoryNode', 'tree: DirectoryTree', 'canManage: boolean', 'refresh: () => void', 'setDirty: (dirty: boolean) => void', 'openUnit:', 'close: () => void']) assert.ok(tabs.includes(piece), piece);
  const toolbarKeys = code(read('directoryModel.ts'));
  assert.ok(toolbarKeys.includes("hidden: !ctx.tabs.includes('access')") && toolbarKeys.includes("hidden: !ctx.tabs.includes('approvals')"), 'the toolbar offers Access and Approvals only when their tab exists');
});

test('Details changes a unit in place with the Administration rules and shows the server\'s words; People adds, changes and removes with the existing endpoints', () => {
  const form = code(read('UnitForm.tsx'));
  for (const piece of ['departmentCreateBody(form)', 'departmentPatch(department as DepartmentDetail, form)', 'departmentFormDirty(', 'willBeText(', 'userItems(', '<FormError', 'retryable: false', "toast: 'success'", 'onError: (e) => setProblem(e)']) assert.ok(form.includes(piece), piece);
  assert.ok(form.includes('Give the unit a name') && form.includes('readOnly && department'), 'a name is required, and a reader sees the facts as text');
  assert.ok(form.includes('info={parentNote}') && form.includes('levels go') === false && form.includes('Units go ${MAX_DEPTH} levels deep'), 'the depth cap is explained in an (i)');
  const people = code(read('PeopleTab.tsx'));
  for (const piece of ['departmentsApi.addMember(node.id', 'departmentsApi.updateMember(node.id', 'departmentsApi.removeMember(node.id', 'departmentsApi.setRoles(node.id', 'howChips(m)', 'removeBlock(m)', 'memberSummary(members)', 'canManage && (']) assert.ok(people.includes(piece), piece);
  assert.ok(people.includes('they grant no access') || people.includes('grant no access to documents'), 'roles give membership, not access');
  const dialogs = code(read('UnitDialogs.tsx'));
  assert.ok(dialogs.includes('moveChoices(tree, node.id') && dialogs.includes('parent_department_id: target') && dialogs.includes('<AnimatedModal') && dialogs.includes('dirty={to !== now}'));
});

test('the address bar and the tree are labelled, the up button and every crumb are real buttons, and nothing needs the mouse', () => {
  const bar = code(read('AddressBar.tsx'));
  assert.ok(bar.includes('<nav aria-label="Location"') && bar.includes('aria-label="Up one level"') && bar.includes('aria-current="page"') && bar.includes('<ol'));
  const contents = code(read('Contents.tsx'));
  assert.ok(contents.includes('aria-labelledby="directory-here"') && contents.includes('aria-label={`Actions for ${node.name}`}') === false && contents.includes('label={`Actions for ${node.name}`}') && contents.includes('menuLabel={`Actions for ${file.title}`}'), 'the selected folder and file have a named "⋯" (every one on a phone)');
});

test('Access: who has access and why, the levels given here and inherited, and the writes (give, change, take back, block) are the manager\'s; a reader sees the lists only', () => {
  const tab = code(read('AccessTab.tsx'));
  for (const piece of ['directoryAccessApi.access(node.id)', 'directoryAccessApi.principals(node.id, q)', 'directoryAccessApi.setGrant(node.id', 'directoryAccessApi.removeGrant(node.id', 'departmentsApi.removeMember(node.id, p.user_id)', 'fromAccess(', 'removeSteps(p, access.grants)']) assert.ok(tab.includes(piece), piece);
  assert.ok(tab.includes('{canManage && adding && <AddBox node={node} />}') && tab.includes('{canManage && (') && tab.includes('p.can_remove ? (') && tab.includes("level: 'none'") && tab.includes('Block here'), 'adding, removing and blocking are for a manager');
  assert.ok(tab.includes('ACCESS_NOTE') && tab.includes('LEVEL_NOTE') && tab.includes('<InfoTip'), 'cascade, nearest wins and add-only are an (i), not a paragraph');
  assert.ok(tab.includes('<ErrorState title="Couldn\'t load who has access"') && tab.includes('<SkeletonRows') && tab.includes('<EmptyState'), 'loading, failed and empty states');
  assert.ok(tab.includes('useReportedMutation') && tab.includes('onError: refresh'), 'every write says what happened or why not; a half-done removal is re-read');
  assert.ok(!/(?:apiClient|departmentsApi|api)\.delete\(/.test(tab), 'the tab deletes through the API files');
  const api = readFileSync(new URL('../../../../../lib/directoryAccessApi.ts', import.meta.url), 'utf8');
  for (const piece of ['/access`', '/principals`', '/grants`', '/grants/${grantId}`', "ACCESS_KEY = ['directory-access']"]) assert.ok(api.includes(piece), piece);
  assert.ok(code(read('directoryData.ts')).includes('queryKey: ACCESS_KEY'), 'a change to a unit refreshes the Access tab too');
});

test('Organisation defaults: a toolbar button for a person who may write them opens the popup shell on the whole organisation with only the registry\'s organisation tabs', () => {
  const toolbar = code(read('Toolbar.tsx'));
  assert.ok(toolbar.includes('onOrganisation') && toolbar.includes('Organisation defaults'), 'the button, and its place in the phone\'s Actions menu');
  const page = code(read('page.tsx'));
  assert.ok(page.includes('canOrgDefaults && ENABLED_ORG_TABS.length > 0') && page.includes('isOrgAddress(address.open)') && page.includes('organisation tab={address.tab}'), 'offered to a writer, once a tab exists, and in the address');
  const data = code(read('directoryData.ts'));
  assert.ok(data.includes("ORG_DEFAULTS_RIGHT = 'governance:settings:edit'") && data.includes('globalRight || perms.hasPermission(ORG_DEFAULTS_RIGHT)'));
  const popup = code(read('UnitPopup.tsx'));
  assert.ok(popup.includes('ORG_TABS.includes(t.id)') && popup.includes('organisation,') && popup.includes('Defaults for every unit'));
});
