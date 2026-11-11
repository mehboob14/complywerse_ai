// node --test "src/app/(dashboard)/governance/documents/directory/directoryPage.test.ts"
// What the Directory promises, read from its sources (the repo's habit for pages, like overviewPage.test.ts): it stays on the design-system kit and holds its token rules, no
// screen names a model or a vendor or prints an id, a unit is never deleted (only deactivated, after a question), the Directory API is asked for once and a backend without it is
// not an error, the tree is a real keyboard tree, a unit opens as a popup with a double-click or Enter, the tabs come from ONE registry whose placeholders are not shown, every read has
// its states, a person who may not change a unit gets none of its buttons, and the page is a tab of the Documents area.
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
  assert.ok(page.includes('unitActions(tree, current, ctx)') && page.includes('unitActions(tree, id, ctx)') && page.includes('menuItems('));
  const toolbar = code(read('Toolbar.tsx'));
  assert.ok(toolbar.includes('actions.filter((a) => !a.hidden)') && toolbar.includes('title={a.reason}') && toolbar.includes('title={primary.reason}'));
  assert.ok(toolbar.includes('role="toolbar"') && toolbar.includes('<SegmentedControl label="View" name="directory-view"') && toolbar.includes('Refresh'));
  const menu = code(read('unitMenu.ts'));
  assert.ok(menu.includes('actions.filter((a) => !a.hidden)') && menu.includes('reason: a.reason') && menu.includes("a.key === 'toggle' && a.label === 'Deactivate'"));
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

test('a unit opens as a popup with a double-click or Enter, in the tree and in the contents; a single click only marks; on a phone a tap goes in', () => {
  const contents = code(read('Contents.tsx'));
  assert.ok(contents.includes('onDoubleClick') && contents.includes("e.key === 'Enter'") && contents.includes('e.preventDefault(); onOpen(node.id)'));
  assert.ok(contents.includes('useCompact') && contents.includes('(max-width: 767px)') && contents.includes('if (kids > 0) onGo(node.id); else onOpen(node.id);'), 'drill-down below 768px');
  assert.ok(contents.includes('Open ${node.name}: ${countText(kids') && contents.includes('onGo(node.id)'), 'the way in is a labelled button');
  assert.ok(contents.includes('<TableFrame') && contents.includes('<RowHeaderCell>') && contents.includes('Th priority={3}'), 'Details is the kit\'s table, its minor columns give way as the window narrows');
  assert.ok(contents.includes('view === \'icons\' || compact'), 'a phone gets the list of cards, not the table');
  const page = code(read('page.tsx'));
  assert.ok(page.includes('const openPopup = (id: number, tab: TabId = \'details\')') && page.includes('setAddress({ open: String(id), tab })'), 'the popup is in the address');
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
  assert.ok(contents.includes('aria-labelledby="directory-here"') && contents.includes('aria-label={`Actions for ${node.name}`}') === false && contents.includes('label={`Actions for ${node.name}`}'), 'every row has a named "⋯"');
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
