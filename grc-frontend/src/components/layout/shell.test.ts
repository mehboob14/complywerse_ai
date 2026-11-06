// node --test src/components/layout/shell.test.ts
// Source-text guard (like kitGuard.test.ts and dialogFocus.test.ts): the menu's responsive layout and keyboard/touch behaviour have no
// React renderer to test them, so the rules that must not regress are pinned in the files that carry them. Behaviour is checked in a browser.
// The top bar's half is in topBar.test.ts; the rail, the panel, the palette and the crumbs are in components/shell/shellGuard.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { contrast } from '../../lib/contrast.ts';

const read = (path: string) => readFileSync(path, 'utf8');
const sidebar = read('src/components/layout/Sidebar.tsx');
const tree = read('src/components/layout/NavTree.tsx');
const rail = read('src/components/shell/ModuleIconRail.tsx');
const page = read('src/components/shell/PageShell.tsx');
const layout = read('src/app/(dashboard)/layout.tsx');
const tokens = read('styles/tokens.css');

test('nothing in the menu is revealed by hover', () => {
  for (const [name, src] of [['Sidebar', sidebar], ['NavTree', tree], ['ModuleIconRail', rail]] as const) {
    assert.doesNotMatch(src, /group-hover\/nav|hidden[^'"`]*group-hover:block|opacity-0[^'"`]*group-hover|group-hover:opacity-100/, `${name} reveals a menu on hover`);
  }
});

test('groups of the drawer are disclosure buttons, the Administration button is a menu button, and the menu is a labelled navigation', () => {
  assert.ok((tree.match(/aria-expanded=/g) ?? []).length >= 2, 'group and sub-group buttons say whether they are open');
  assert.match(tree, /aria-controls=\{panelId\}/, 'the open/close buttons name the rows they control');
  assert.match(tree, /menuTarget\(/, 'arrow keys move between the entries of a menu');
  assert.match(tree, /e\.key !== 'Escape'/, 'Escape closes a menu');
  assert.match(tree, /role="menuitem"/);
  assert.match(rail, /aria-haspopup="menu"/);
  assert.match(rail, /role="menu"/);
  assert.equal((sidebar.match(/<nav\s+aria-label="Primary"/g) ?? []).length, 1, 'the drawer has one labelled <nav>');
  assert.equal((rail.match(/<nav aria-label="Modules"/g) ?? []).length, 1, 'and so has the rail');
});

test('the lit entry is the one navActive.ts picked: no entry decides for itself from the path', () => {
  assert.match(read('src/components/shell/useShellRoute.ts'), /litFor\(nav, pathname, from\)/);
  assert.match(sidebar, /activeHref=\{litHref\}/);
  assert.match(rail, /litFor\(nav, pathname, from\)/);
  assert.match(tree, /aria-current=\{[^}]*\? 'page' : undefined\}/, 'the lit entry says so to a screen reader');
  assert.match(rail, /aria-current=\{item\.current === 'page' \? 'page' : item\.current\}/);
  for (const [name, src] of [['Sidebar', sidebar], ['NavTree', tree], ['ModuleIconRail', rail], ['railModel', read('src/components/shell/railModel.ts')]] as const) {
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

test('a phone\'s drawer carries what its top bar has no room for: Comply Agent, the Guide, the tenant on two lines, the queue\'s count', () => {
  assert.match(sidebar, /Ask Comply Agent/);
  assert.match(sidebar, /Guide markers/);
  assert.match(sidebar, /title=\{tenant\} className="mt-\[2px\] line-clamp-2/);
  assert.match(sidebar, /'\/needs-my-action': \{ text: queue\.text, label: queue\.label, urgent: queue\.urgent \}/);
});

test('the layout switches on the same widths as the mode: no rail in the page below lg, the fixed rail from lg, the drawer only in the drawer\'s window', () => {
  assert.match(rail, /className="hidden shrink-0 flex-col border-r border-ds-border bg-ds-surface lg:flex"/);
  assert.match(rail, /style=\{\{ width: RAIL_WIDTH \}\}/, 'a fixed column: nothing the data holds can move it');
  assert.match(sidebar, /\{mode === 'drawer' && \(/);
  assert.match(sidebar, /if \(mode !== 'drawer'\) closeMenu\(\)/, 'the window grew until the rail fits: no drawer left open');
});

test('the keyboard focus ring reads (3:1) on the white menu and on the tint of the lit row', () => {
  const ring = /focus-visible:ring-\[(#[0-9a-f]{6})\]/i.exec(tree)?.[1] ?? '';
  const mint = /--sidebar-active-bg:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1] ?? '';
  assert.ok(ring && mint, 'both colours are found');
  assert.ok(contrast(ring, '#ffffff') >= 3, `drawer ring ${ring} on white`);
  assert.ok(contrast(ring, mint) >= 3, `drawer ring ${ring} on ${mint}: ${contrast(ring, mint).toFixed(2)}`);
  const focus = /--ds-focus:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1] ?? '';
  const soft = /--ds-primary-soft:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1] ?? '';
  assert.ok(contrast(focus, '#ffffff') >= 3 && contrast(focus, soft) >= 3, `the rail's and the panel's ring ${focus} on white and on ${soft}`);
});

test('the lit rail entry reads: its words and icon on the tint (4.5:1); the drawer\'s lit icon is the text colour on its mint', () => {
  const text = /--ds-primary-text:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1] ?? '';
  const soft = /--ds-primary-soft:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1] ?? '';
  const muted = /--ds-fg-muted:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1] ?? '';
  assert.ok(text && soft && muted);
  assert.ok(contrast(text, soft) >= 4.5, `lit rail entry ${text} on ${soft}: ${contrast(text, soft).toFixed(2)}`);
  assert.ok(contrast(muted, '#ffffff') >= 4.5, `the rail's names ${muted} on white: ${contrast(muted, '#ffffff').toFixed(2)}`);
  const mint = /--sidebar-active-bg:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1] ?? '';
  const drawerText = /--color-text:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1] ?? '';
  assert.ok(contrast(drawerText, mint) >= 4.5, `the text colour on the drawer's mint: ${contrast(drawerText, mint).toFixed(2)}`);
  assert.doesNotMatch(tree, /(?:childActive|active) \? 'text-\[var\(--color-base\)\]'/, 'a lit leaf row with a mint icon on mint');
  assert.equal((tree.match(/(?:childActive|active) \? 'text-\[var\(--color-text\)\]'/g) ?? []).length, 3, 'a page of its own, a child row, a sub-group\'s child row');
});

test('text in the menu stays at or above the 12px floor (the drawer, the rail)', () => {
  for (const [name, src] of [['NavTree', tree], ['Sidebar', sidebar], ['ModuleIconRail', rail]] as const) {
    const small = (src.match(/text-\[\d+(?:\.\d+)?px\]/g) ?? []).filter((c) => parseFloat(c.slice(6)) < 12);
    assert.deepEqual(small, [], `${name}: text under 12px`);
  }
});

test('the page has two skip links as its first stops, aimed at the main area and at the queue, before the menu and the bar', () => {
  assert.match(page, /<a href="#main-content" className=\{`\$\{SKIP\} focus:left-3`\}>Skip to content<\/a>/);
  assert.match(page, /<main id="main-content" tabIndex=\{-1\}/);
  assert.ok(page.indexOf('href="#main-content"') < page.indexOf('<SkipToQueue />') && page.indexOf('<SkipToQueue />') < page.indexOf('<Sidebar />'), 'before the menu');
  assert.match(page, />Skip to Needs my action<\/button>/);
  for (const kept of ['<IdleLogout />', '<GuidePanel />', '<NavProgress />']) assert.ok(page.includes(kept), `${kept} stays`);
});

test('the frame: main keeps its padding (a dozen pages cancel it with a negative margin), the panel sits beside it under the bar, the layout only adds guards and providers', () => {
  assert.match(page, /<main id="main-content" tabIndex=\{-1\} className="min-w-0 flex-1 overflow-auto [^"]*p-4 lg:p-5 /);
  assert.ok(page.indexOf('<Header />') < page.indexOf('<main') && page.indexOf('<main') < page.indexOf('<WorkPanel />'));
  assert.match(layout, /<PageShell>\{children\}<\/PageShell>/);
  assert.match(layout, /AuthGuard/);
});
