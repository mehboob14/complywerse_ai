// node --test "src/app/(dashboard)/governance/documents/_workspace/foldersLayout.test.ts"
// What the library's Folders layout promises now that it is also the organisation's directory (the Governance Directory page went into it, 2026-11-12), read from its sources (the repo's habit
// for pages): it stays on the design-system kit, no screen names a model or prints an id or says "Directory", a unit is never deleted (only deactivated, after a question), the units are asked
// for once and only where the layout is on, a double-click or Enter on a folder goes INTO it (the Department filter, pushed to the address; Back, Forward and Up), the folder rows are a keyboard
// tree, the actions and the menus come from one model, the popup is Properties (`?props=`, the library's `open` is a document's), the tabs come from ONE registry, the folders are yellow, every
// read has its states, and the old Directory page is only a redirect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const WS = new URL('./', import.meta.url);
const DIR = new URL('./folders/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const readWs = (name: string) => readFileSync(new URL(name, WS), 'utf8');
const files = readdirSync(DIR).filter((n) => /\.tsx?$/.test(n) && !/\.test\.ts$/.test(n));
const tsx = files.filter((n) => n.endsWith('.tsx'));
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const idx = (src: string, piece: string) => { const i = src.indexOf(piece); assert.ok(i >= 0, `missing: ${piece}`); return i; };
const owned = [...files.map((n) => `folders/${n}`), 'FolderRows.tsx'];
const readOwned = (n: string) => (n.startsWith('folders/') ? read(n.slice(8)) : readWs(n));

test('the folders are on the kit: their files hold the token rules (no named text size, palette colour, hex, named shadow or radius, no text under 12px)', () => {
  const found: string[] = [];
  for (const name of owned) for (const v of findViolations(readOwned(name))) found.push(`${name}:${v.line} ${v.rule} ${v.text}`);
  assert.deepEqual(found, []);
});

test('no screen names a model or a vendor, none leaves the design system for the legacy scope, no two files differ only in case', () => {
  for (const name of owned) {
    assert.ok(!/governance-light/.test(readOwned(name)), name);
    assert.ok(!/\b(gpt|openai|anthropic|claude)\b/i.test(code(readOwned(name))), name);
  }
  const names = files.map((n) => n.replace(/\.tsx?$/, '').toLowerCase());
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

test('no bare <p>, <h2> or <h3> without a ds text size (the platform CSS gives a bare one 11.5px), and no bare table elements in the folder parts: the kit\'s primitives', () => {
  for (const name of tsx) {
    const src = code(read(name));
    for (const tag of src.match(/<(?:p|h2|h3)\b[^>]*>/g) ?? []) assert.ok(/text-ds-/.test(tag), `${name}: ${tag}`);
    assert.ok(!/<table\b|<thead\b|<tbody\b|<td\b/.test(src), `${name}: use the kit's Table`);
  }
});

test('U1: no id is printed on a screen (an id is a key, a data attribute or a link, never a word), and no screen says "Directory" (it is the Folders of the library now)', () => {
  for (const name of owned) {
    const src = code(readOwned(name));
    assert.ok(!/>\s*\{[\w.?!]*\bid\}\s*</.test(src), `${name}: an id printed as text`);
    assert.ok(!/>\s*#\{/.test(src), `${name}: "#id"`);
    const words = Array.from(src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)).map((m) => m[2]).concat(Array.from(src.matchAll(/>([^<>{}]+)</g)).map((m) => m[1]));
    assert.deepEqual(words.filter((w) => /\bdirectory\b/i.test(w) && !/^\/admin\/departments\/directory$|^directory-access$|^directory$/.test(w.trim())), [], `${name}: says Directory`);
  }
  const editor = readFileSync(new URL('../../../../../components/admin/DepartmentsEditor.tsx', import.meta.url), 'utf8');
  assert.ok(editor.includes('<Button href="/governance/documents?view=folders">Open in library</Button>') && !/Open directory/.test(editor), 'Settings > Departments opens the folders of the library');
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

test('the data: the units are asked for once, only where the Folders layout (or a Properties popup) is on; a backend without the Directory API (404, 405, 422) is not an error; nothing is logged', () => {
  const data = code(read('directoryData.ts'));
  assert.ok(data.includes("'/admin/departments/directory'") && data.includes('departmentsApi.list(true)'));
  assert.ok(data.includes("endpoint !== 'absent'") && data.includes("endpoint = 'absent'") && data.includes("endpoint = 'present'"), 'asked once, remembered');
  assert.ok(data.includes('[404, 405, 422]') && data.includes('if (!missing(e)) throw e'), 'only "no such route" falls back; a 401, 403, 500 or no network is the error');
  assert.ok(data.includes('retry: false') && data.includes('enabled }') && data.includes('export function useDirectory(enabled = true)'), 'not asked for in the library\'s other layouts');
  assert.ok(data.includes('fromDirectory(') && data.includes('fromList(') && data.includes("export const GLOBAL_RIGHT = 'admin:organization:edit'"), 'both answers become the same nodes');
  for (const name of files) assert.ok(!/\bconsole\.(log|warn|error|info|debug)\(/.test(code(read(name))), `${name}: a console call`);
  const refresh = data.slice(idx(data, 'export function useRefreshDirectory'));
  assert.ok(refresh.includes('refreshDepartments(qc)') && refresh.includes("['admin-department']") && refresh.includes('DIRECTORY_KEY'), 'a change reaches every list of departments (the library\'s too) and the open unit');
  const hook = code(read('useFolders.tsx'));
  assert.ok(hook.includes('useDirectory(i.on || popupWanted)'), 'the Folders layout, or a popup that the address asks for');
});

test('every unit is a folder: the layout reads the library\'s list of departments, the folders are built over ALL of them (the rules are libraryFolders.buildFolders), "Show inactive" is a check beside Expand all', () => {
  const ws = code(readWs('DocumentsWorkspace.tsx'));
  assert.ok(ws.includes('buildFolders({ scope: sortedScope, matches: matchIds, departments, filtering: foldFiltering, now, root: openFolder, showInactive })'));
  assert.ok(ws.includes('const [showInactive, setShowInactive] = useState(false)') && ws.includes('showInactive={showInactive}') && ws.includes('onShowInactive={setShowInactive}'), 'inactive units are hidden until asked for');
  assert.ok(ws.includes('const foldersToShow = inFolders && !foldFiltering && folders != null && folders.length > 0') && ws.includes('filteredDocs.length === 0 && !foldersToShow'), 'a library with no documents (or a folder with none) still shows its folders when no filter is on');
  const rows = code(readWs('FolderRows.tsx'));
  assert.ok(rows.includes('Show inactive (${fmt(inactive ?? 0)})') && rows.includes('(inactive ?? 0) > 0'), 'the check is there when some unit is switched off');
  assert.ok(rows.includes('node.inactive && (') && rows.includes('>Inactive</span>') && rows.includes("empty || node.inactive ? 'text-ds-fg-muted' : 'text-ds-fg'"), 'a switched-off unit is dimmed and says Inactive in words');
});

test('a double-click or Enter on a folder GOES INTO it: the Department filter is that unit, pushed to the address (the browser\'s Back comes back); the row, the path bar and the menu all go through one function', () => {
  const ws = code(readWs('DocumentsWorkspace.tsx'));
  assert.ok(ws.includes('const openFolder = inFolders ? openFolderOf(filters.departments, departments) : null'), 'the open folder is the Department filter holding one unit');
  assert.ok(ws.includes("setDepartments: (next, push) => setAddress({ dept: next }, { push })"), 'the library\'s own address, so the facet, the counts and the other layouts agree');
  const hook = code(read('useFolders.tsx'));
  assert.ok(hook.includes('const goInto = (id: number | null) => {') && hook.includes('nav.navigate(id)') && hook.includes('i.reveal([keyOfUnit(id)])'), 'one function opens a folder');
  assert.ok(hook.includes("onOpen: (n) => { if (n.id !== null) latest.current.goInto(n.id); else latest.current.flip(n.key); }"), 'a double-click');
  assert.ok(hook.includes("if (a === 'open') { if (node.id !== null) goInto(node.id); else i.flip(node.key); return true; }"), 'Enter');
  assert.ok(hook.includes("go: id !== i.openFolder ? { label: 'Open', onSelect: () => goInto(id) } : undefined"), 'the menu\'s Open');
  const rows = code(readWs('FolderRows.tsx'));
  assert.ok(rows.includes('onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest(\'[data-folder-arrow]\')) ui.onOpen(node); }}') && rows.includes('select-none'), 'a double-click (not on the arrow) opens; the text is not selected by it');
  const nav = code(read('useDirectoryNav.ts'));
  assert.ok(nav.includes('setUnit(to, mode === \'push\')') && nav.includes('window.history.back()') && nav.includes('window.history.forward()'), "Back and Forward are the browser's history, so the address, the selection and the scroll come back");
  assert.ok(nav.includes('canBack: !!t && canBack(t)') && nav.includes('follow(t, current, asked.current)'), "the page's own mirror says whether there is anywhere to go");
});

test("the folder bar: Back, Forward and Up, off where there is nowhere to go (the first Back from the first folder visited does not leave the library), the path as buttons, and the toolbar of the folder selected", () => {
  const bar = code(read('FolderBar.tsx'));
  for (const piece of ['aria-label="Back"', 'aria-label="Forward"', 'aria-label="Up one level"', 'disabled={!canBack}', 'disabled={!canForward}', 'disabled={!canUp}', 'Alt+Left', 'Alt+Right', 'Alt+Up', '<nav aria-label="Location"', '<ol', 'aria-current="page"', 'role="toolbar"']) assert.ok(bar.includes(piece), piece);
  assert.ok(bar.includes('splitActions(actions)') && bar.includes('<Menu label="More"') && bar.includes('<Menu label="Actions"') && bar.includes('Organisation defaults'), 'buttons from sm up, one Actions menu on a phone, Organisation defaults in the menu');
  const model = code(read('folderBarModel.ts'));
  assert.ok(model.includes("TOOLBAR_KEYS: readonly ActionKey[] = ['new', 'properties', 'access', 'approvals', 'move', 'toggle']"));
  const hook = code(read('useFolders.tsx'));
  assert.ok(hook.includes('canBack={nav.canBack}') && hook.includes('canForward={nav.canForward}') && hook.includes('canUp={i.openFolder !== null}') && hook.includes('onUp={up}'));
  assert.ok(hook.includes('setSelected(came);') && hook.includes('i.reveal(ancestors(i.openFolder))'), 'Up selects the folder you came from, as Explorer does, and makes sure it is drawn');
  assert.ok(hook.includes('const target = toolbarTarget(selected, i.openFolder'), 'the toolbar acts on the folder selected, else the one you are in');
  const ws = code(readWs('DocumentsWorkspace.tsx'));
  assert.ok(ws.includes('{inFolders && folders ? foldersApi.bar : null}'), 'the bar is the Folders layout\'s only');
});

test("the keyboard: the folder rows are one tab stop and a tree of keys (folderKeys); the Explorer shortcuts are explorerKeys' and act on the folder in focus; Back, Forward and Up work anywhere that is not a field, a menu or a dialog", () => {
  const hook = code(read('useFolders.tsx'));
  assert.ok(hook.includes('explorerShortcut(e.nativeEvent)') && hook.includes('folderKey(lines.current, node.key, e.key)'));
  assert.ok(hook.includes("const wanted: ActionKey = a === 'properties' ? 'properties' : a === 'rename' ? 'edit' : 'toggle'"), 'Alt+Enter is Properties, F2 Edit details, Delete Deactivate: each through unitActions, so a person who may not does nothing');
  assert.ok(hook.includes("found.label !== 'Deactivate'"), 'Delete only deactivates, it never activates (and it asks first)');
  assert.ok(hook.includes("document.addEventListener('keydown', onKey)") && hook.includes('[role="dialog"], [role="menu"]') && hook.includes('input, textarea, select, [contenteditable="true"], [role="combobox"]') && hook.includes("t.closest('#main-content')"), 'not under a popup or a menu, not in a field, not in the sidebar');
  assert.ok(hook.includes('if (e.defaultPrevented) return;'), 'a key a row has already taken is not taken twice');
  const items = code(readWs('libraryItems.tsx'));
  assert.ok(items.includes('const tabStop = i.ui.selected !== null') && items.includes('lines.push({ key: node.key'), 'the selected folder is the tab stop, else the first');
  const keys = code(read('folderKeys.ts'));
  for (const k of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter']) assert.ok(keys.includes(`case '${k}'`), k);
  assert.ok(keys.includes('typeAhead('), 'a letter jumps to the next folder that starts with it');
});

test('what a person may do comes from the model: the toolbar, the "…" and the right-click menu are built from unitActions, a hidden action is not drawn, a disabled one says why; New, Edit details, Move and Deactivate are the manager\'s', () => {
  const hook = code(read('useFolders.tsx'));
  assert.ok(hook.includes('unitActions(tree, target, ctx)') && hook.includes('unitActions(tree, id, ctx)') && hook.includes('menuItems('));
  const bar = code(read('FolderBar.tsx'));
  assert.ok(bar.includes('disabled={a.disabled || busy}') && bar.includes('title={a.reason ??'));
  const menu = code(read('unitMenu.ts'));
  assert.ok(menu.includes('.filter((a) => !a.hidden)') && menu.includes('reason: a.reason') && menu.includes("a.key === 'toggle' && a.label === 'Deactivate'") && menu.includes("label: 'Copy link'"));
  const ctxMenu = code(read('ContextMenu.tsx'));
  assert.ok(ctxMenu.includes('role="menu"') && ctxMenu.includes('role="menuitem"') && ctxMenu.includes("e.key === 'Escape'") && ctxMenu.includes('placeMenu('), 'a menu at the pointer, kept on screen, with its keys');
  const model = code(read('directoryModel.ts'));
  assert.ok(model.includes("key: 'properties', label: 'Properties', hidden: false") && model.includes("key: 'edit', label: 'Edit details', hidden: !manage") && model.includes("key: 'new', label: `New ${nextLevel}`, hidden: !manage") && model.includes("hidden: !ctx.tabs.includes('exceptions')"), 'everyone reads Properties; the changes are the manager\'s; the tabs offered are the ones that exist');
  const hookRows = code(read('useFolders.tsx'));
  assert.ok(hookRows.includes('onContext: (e: MouseEvent<HTMLElement>, n) => {') && hookRows.includes('e.preventDefault();') && hookRows.includes('hasMenu: (n) => n.id !== null && !!tree?.node(n.id)'), 'right-click on a folder; "No department" keeps the browser\'s own menu');
});

test('PROPERTIES: the popup opens from the toolbar, the menus, Alt+Enter and a link (?props=<unit>|org&tab=), never from a double-click; Edit details is the same popup with the cursor in the first field; the library\'s own ?open= is untouched', () => {
  const hook = code(read('useFolders.tsx'));
  assert.ok(hook.includes("if (key === 'properties') openPopup(id, 'details')") && hook.includes("else if (key === 'edit') { setRenaming(id); openPopup(id, 'details'); }"));
  assert.ok(hook.includes('focusName={renaming === popupNode.id}') && hook.includes("i.setProps({ props: '', tab: 'details' })") && hook.includes('i.setProps({ props: String(id), tab })'));
  const ws = code(readWs('DocumentsWorkspace.tsx'));
  assert.ok(ws.includes('useAddressState(PROPS_SCHEMA)') && ws.includes('props: popup.props') && ws.includes('{foldersApi.overlays}'));
  const popup = code(read('UnitPopup.tsx'));
  assert.ok(popup.includes('`Properties · ${node.level_label}') && popup.includes('<FolderIcon'), "the dialog says Properties under the folder's icon");
  assert.ok(code(read('DetailsTab.tsx')).includes('focusName && canManage'));
  const addr = code(readWs('libraryAddress.ts'));
  assert.ok(!/\bprops\b|\btab:/.test(addr), 'the library\'s own schema (PARAM_KEYS: its filters, layout and sort) does not hold the popup\'s names');
});

test('YELLOW FOLDERS: one file draws the folder icons and holds the only colour codes; the open one, the grey one and the badge are there; the rows, the bar and the popup use it, no lucide folder is left', () => {
  const icons = read('folderIcon.tsx');
  for (const piece of ['FOLDER_BACK', 'FOLDER_FRONT', 'FOLDER_GREY_BACK', 'FOLDER_GREY_FRONT', 'export function FolderIcon', 'open?: boolean', 'inactive?: boolean', 'badge?: boolean', 'aria-hidden']) assert.ok(icons.includes(piece), piece);
  assert.ok(/(?:FOLDER_BACK|FOLDER_FRONT) = '#[0-9A-Fa-f]{6}'/.test(icons), 'the yellows are named constants');
  for (const name of owned.filter((n) => n !== 'folders/folderIcon.tsx')) assert.ok(!/#[0-9a-fA-F]{6}\b/.test(code(readOwned(name))), `${name}: a colour code outside folderIcon.tsx`);
  for (const name of ['FolderBar.tsx', 'UnitPopup.tsx', 'EmptyFolder.tsx']) assert.ok(read(name).includes('<FolderIcon'), `${name} draws the yellow folder`);
  assert.ok(readWs('FolderRows.tsx').includes('<FolderIcon size={20}'));
  // (unitMenu.ts draws the small line icons of the menu's actions, Open and Move to…: glyphs of an action, not a picture of a folder)
  for (const name of owned.filter((n) => n !== 'folders/unitMenu.ts')) assert.ok(!/\b(Folder|FolderOpen|Building2)\b[^'"\n]*from 'lucide-react'/.test(readOwned(name)), `${name}: a lucide folder is left`);
});

test('the popup is the kit\'s centered dialog with the dirty guard; its tabs come from the registry and it names none; every registered tab is built', () => {
  const popup = code(read('UnitPopup.tsx'));
  assert.ok(popup.includes('<AnimatedModal') && popup.includes('dirty={Object.values(dirty).some(Boolean)}'));
  assert.ok(popup.includes('shownTabs(DIRECTORY_TABS, ENABLED_TABS)') && popup.includes('t.render(props(t.id))') && popup.includes('lazy'));
  assert.ok(!/['"](details|people|access|approvals|exceptions)['"]/.test(popup), 'the popup knows no tab by name');
  const tabs = code(read('directoryTabs.ts'));
  for (const id of ['details', 'people', 'access', 'approvals', 'exceptions']) assert.ok(tabs.includes(`id: '${id}'`), id);
  assert.ok(tabs.includes("ENABLED_TABS: readonly TabId[] = ['details', 'people', 'access', 'approvals', 'exceptions']"), 'only what is built is in the strip');
  assert.ok(tabs.includes("ORG_TABS: readonly TabId[] = ['approvals', 'exceptions']") && tabs.includes('ENABLED_ORG_TABS'), 'the Organisation popup\'s tabs are in the registry');
  for (const piece of ['node: DirectoryNode', 'tree: DirectoryTree', 'canManage: boolean', 'refresh: () => void', 'setDirty: (dirty: boolean) => void', 'openUnit:', 'close: () => void']) assert.ok(tabs.includes(piece), piece);
});

test('Details changes a unit in place with the Administration rules and shows the server\'s words; People adds, changes and removes with the existing endpoints; New and Move say the server\'s refusal in the dialog', () => {
  const form = code(read('UnitForm.tsx'));
  for (const piece of ['departmentCreateBody(form)', 'departmentPatch(department as DepartmentDetail, form)', 'departmentFormDirty(', 'willBeText(', 'userItems(', '<FormError', 'retryable: false', "toast: 'success'", 'onError: (e) => setProblem(e)']) assert.ok(form.includes(piece), piece);
  assert.ok(form.includes('Give the unit a name') && form.includes('readOnly && department'), 'a name is required, and a reader sees the facts as text');
  const people = code(read('PeopleTab.tsx'));
  for (const piece of ['departmentsApi.addMember(node.id', 'departmentsApi.updateMember(node.id', 'departmentsApi.removeMember(node.id', 'departmentsApi.setRoles(node.id', 'howChips(m)', 'removeBlock(m)', 'memberSummary(members)', 'canManage && (']) assert.ok(people.includes(piece), piece);
  const dialogs = code(read('UnitDialogs.tsx'));
  assert.ok(dialogs.includes('moveChoices(tree, node.id') && dialogs.includes('parent_department_id: target') && dialogs.includes('<AnimatedModal') && dialogs.includes('dirty={to !== now}'));
  const hook = code(read('useFolders.tsx'));
  assert.ok(hook.includes('<NewUnitDialog') && hook.includes('<MoveDialog') && hook.includes("setSelected(keyOfUnit(created.id))"), 'a unit just made is selected');
});

test('Access: who has access and why, the levels given here and inherited, and the writes (give, change, take back, block) are the manager\'s; a reader sees the lists only', () => {
  const tab = code(read('AccessTab.tsx'));
  for (const piece of ['directoryAccessApi.access(node.id)', 'directoryAccessApi.principals(node.id, q)', 'directoryAccessApi.setGrant(node.id', 'directoryAccessApi.removeGrant(node.id', 'departmentsApi.removeMember(node.id, p.user_id)', 'fromAccess(', 'removeSteps(p, access.grants)']) assert.ok(tab.includes(piece), piece);
  assert.ok(tab.includes('{canManage && adding && <AddBox node={node} />}') && tab.includes('{canManage && (') && tab.includes('p.can_remove ? (') && tab.includes("level: 'none'") && tab.includes('Block here'), 'adding, removing and blocking are for a manager');
  assert.ok(tab.includes('ACCESS_NOTE') && tab.includes('LEVEL_NOTE') && tab.includes('<InfoTip'), 'cascade, nearest wins and add-only are an (i), not a paragraph');
  assert.ok(tab.includes('<ErrorState title="Couldn\'t load who has access"') && tab.includes('<SkeletonRows') && tab.includes('<EmptyState'), 'loading, failed and empty states');
  assert.ok(tab.includes('useReportedMutation') && tab.includes('onError: refresh'), 'every write says what happened or why not; a half-done removal is re-read');
  const api = readFileSync(new URL('../../../../../lib/directoryAccessApi.ts', import.meta.url), 'utf8');
  for (const piece of ['/access`', '/principals`', '/grants`', '/grants/${grantId}`', "ACCESS_KEY = ['directory-access']"]) assert.ok(api.includes(piece), piece);
  assert.ok(code(read('directoryData.ts')).includes('queryKey: ACCESS_KEY'), 'a change to a unit refreshes the Access tab too');
});

test('Organisation defaults: a button (under "More", and in a phone\'s Actions) for a person who may write them opens the popup shell on the whole organisation with only the registry\'s organisation tabs', () => {
  const hook = code(read('useFolders.tsx'));
  assert.ok(hook.includes('canOrgDefaults && ENABLED_ORG_TABS.length > 0') && hook.includes('isOrgAddress(i.props)') && hook.includes('organisation tab={i.tab}') && hook.includes("i.setProps({ props: 'org', tab: ENABLED_ORG_TABS[0] })"), 'offered to a writer, once a tab exists, and in the address');
  const data = code(read('directoryData.ts'));
  assert.ok(data.includes("ORG_DEFAULTS_RIGHT = 'governance:settings:edit'") && data.includes('globalRight || perms.hasPermission(ORG_DEFAULTS_RIGHT)'));
  const popup = code(read('UnitPopup.tsx'));
  assert.ok(popup.includes('ORG_TABS.includes(t.id)') && popup.includes('organisation,') && popup.includes('Defaults for every unit'));
});

test('a document opens by double-click (the row that was clicked first, even when its details panel opened over the list); a click still opens the details', () => {
  const ws = code(readWs('DocumentsWorkspace.tsx'));
  assert.ok(ws.includes("document.addEventListener('click', onClick, true)") && ws.includes('e.detail < 2') && ws.includes('openDocRef.current(hit.id)') && ws.includes('e.stopPropagation()'), 'the second click, in the capture phase, before the backdrop closes the panel');
  assert.ok(ws.includes('onClickCapture={(e) => {') && ws.includes("closest('a, button, input, label, select, [data-no-peek]')"), 'never on a control in the row');
});

test('the Directory is gone: its route is a redirect to the Folders layout, nothing else of it is left on the route, and no page, tab or link of the app points at it', () => {
  const route = new URL('../directory/', import.meta.url);
  assert.deepEqual(readdirSync(route), ['page.tsx']);
  assert.ok(!existsSync(new URL('../directory/page.test.ts', import.meta.url)));
  const tabs = readFileSync(new URL('../../../../../components/governance/DocumentsTabs.tsx', import.meta.url), 'utf8');
  assert.ok(!/directory/i.test(code(tabs)) && !/FolderTree/.test(tabs), 'the strip has no Directory tab');
  const registry = readFileSync(new URL('../../../../../lib/navRegistry.ts', import.meta.url), 'utf8');
  assert.ok(registry.includes("gov(`${DOCS}/directory`, 'Documents', { aliasOf: DOCS })") && !/tab: \{ area: 'documents', id: 'directory'/.test(registry));
});
