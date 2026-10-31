// node --test src/components/layout/shell.test.ts
// Source-text guard (like kitGuard.test.ts and dialogFocus.test.ts): the menu's responsive layout and keyboard/touch behaviour have no
// React renderer to test them, so the rules that must not regress are pinned in the files that carry them. Behaviour is checked in a browser.
// The top bar's half is in topBar.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { contrast } from '../../lib/contrast.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const sidebar = read('src/components/layout/Sidebar.tsx');
const tree = read('src/components/layout/NavTree.tsx');
const layout = read('src/app/(dashboard)/layout.tsx');

test('nothing in the menu is revealed by hover', () => {
  for (const [name, src] of [['Sidebar', sidebar], ['NavTree', tree]] as const) {
    assert.doesNotMatch(src, /group-hover\/nav|hidden[^'"`]*group-hover:block/, `${name} reveals a menu on hover`);
  }
});

test('groups are disclosure buttons, flyouts are menu buttons, and the menu is a labelled navigation', () => {
  assert.ok((tree.match(/aria-expanded=/g) ?? []).length >= 4, 'group, sub-group, rail group and Administration buttons say whether they are open');
  assert.match(tree, /aria-controls=\{panelId\}/, 'the open/close buttons name the rows they control');
  assert.match(tree, /aria-haspopup="menu"/, 'a rail button announces a menu');
  assert.match(tree, /role="menu"/);
  assert.match(tree, /role="menuitem"/);
  assert.match(tree, /menuTarget\(/, 'arrow keys move between flyout entries');
  assert.match(tree, /e\.key !== 'Escape'/, 'Escape closes a flyout');
  assert.equal((sidebar.match(/<nav\s+aria-label="Primary"/g) ?? []).length, 2, 'the sidebar and the drawer each have a labelled <nav>');
});

test('the lit entry is the one navActive.ts picked: no entry decides for itself from the path', () => {
  assert.match(sidebar, /activeNavHref\(pathname, filteredNavigation\)/);
  assert.match(tree, /aria-current=\{[^}]*\? 'page' : undefined\}/, 'the lit entry says so to a screen reader');
  for (const [name, src] of [['Sidebar', sidebar], ['NavTree', tree]] as const) {
    assert.doesNotMatch(src, /startsWith\(/, `${name} matches paths itself`);
  }
});

test('the drawer is a modal dialog that takes focus, keeps it, closes on Escape and following a link, and locks the page behind it', () => {
  assert.match(sidebar, /role="dialog"[\s\S]{0,80}aria-modal="true"[\s\S]{0,80}aria-label="Main menu"/);
  assert.match(sidebar, /useDialogFocus\(/);
  assert.match(sidebar, /lockBodyScroll\(/);
  assert.match(sidebar, /e\.key !== 'Escape'/);
  assert.match(sidebar, /max-w-\[85vw\]/, 'at most 85% of the window');
  assert.match(sidebar, /onNavigate=\{onClose\}/, 'following a link closes it');
  assert.match(sidebar, /useEffect\(\(\) => \{ closeMenu\(\); \}, \[pathname, closeMenu\]\)/, 'and so does any other navigation');
  assert.doesNotMatch(sidebar, /document\.body\.style/, 'the page scroll lock is the shared one (ui/scrollLock)');
});

test('the layout switches on the same widths as the mode: no sidebar in the page below lg, a 64px rail to xl, the full 240px from xl', () => {
  assert.match(sidebar, /'hidden lg:flex flex-col/);
  assert.match(sidebar, /'w-\[64px\] xl:w-60'/);
  assert.match(sidebar, /aria-controls=\{MAIN_MENU_ID\}/, 'the rail button names the drawer it opens');
});

test('the keyboard focus ring reads (3:1) on the white menu and on the mint row that is lit', () => {
  const ring = /focus-visible:ring-\[(#[0-9a-f]{6})\]/i.exec(tree)?.[1] ?? '';
  const mint = /--sidebar-active-bg:\s*(#[0-9a-f]{6})/i.exec(read('styles/tokens.css'))?.[1] ?? '';
  assert.ok(ring && mint, 'both colours are found');
  assert.ok(contrast(ring, '#ffffff') >= 3, `ring ${ring} on white`);
  assert.ok(contrast(ring, mint) >= 3, `ring ${ring} on ${mint}: ${contrast(ring, mint).toFixed(2)}`);
});

test('the page has a skip link as its first stop, aimed at the main area', () => {
  assert.match(layout, /<a\s+href="#main-content"/);
  assert.match(layout, /<main id="main-content" tabIndex=\{-1\}/);
  assert.ok(layout.indexOf('href="#main-content"') < layout.indexOf('<Sidebar />'), 'before the menu');
  for (const kept of ['<IdleLogout />', '<GuidePanel />', '<NavProgress />']) assert.ok(layout.includes(kept), `${kept} stays`);
});
