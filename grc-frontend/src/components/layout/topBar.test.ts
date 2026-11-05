// node --test src/components/layout/topBar.test.ts
// Source-text guard for the top bar (Header.tsx), like shell.test.ts is for the menu: no React renderer here, so what must not regress is
// pinned in the file that carries it. Behaviour (focus, Escape) is checked in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const header = readFileSync('src/components/layout/Header.tsx', 'utf8');

test('below lg the top bar has the button that opens the menu drawer, and from lg it is gone', () => {
  assert.match(header, /lg:hidden"\s*\n?\s*>\s*\n?\s*<Menu/, 'the menu button shows below lg only');
  assert.match(header, /aria-label="Open menu"/);
  assert.match(header, /aria-controls=\{menuOpen \? MAIN_MENU_ID : undefined\}/, 'names the drawer while it is open: the drawer is not in the page when closed');
  assert.match(header, /aria-expanded=\{menuOpen\}/);
});

test('Comply Agent is reachable where the input is hidden: an icon to the same chat', () => {
  assert.match(header, /href="\/complychat" aria-label="Ask Comply Agent"/);
  assert.match(header, /md:hidden/, 'below md, where the input is hidden');
  assert.match(header, /'lg:hidden'/, 'in the Documents area, which keeps the room for its tabs below lg');
});

test('the dropdowns close on Escape, give focus back to their button, and say they are popups', () => {
  assert.match(header, /e\.key !== 'Escape'/);
  assert.match(header, /button\.current\?\.focus\(\)/);
  assert.equal((header.match(/aria-haspopup="dialog"/g) ?? []).length, 4, 'menu, approvals, notifications and user buttons');
  assert.equal((header.match(/role="dialog"/g) ?? []).length, 3, 'the three dropdown panels');
  assert.equal((header.match(/aria-controls=\{(approvalsOpen|notifOpen|isUserMenuOpen) \? /g) ?? []).length, 3, 'each button names its panel while it is open');
});

test('signing out keeps the one thing the shell remembers about this browser', () => {
  assert.match(header, /readCollapsed\(\)[\s\S]{0,80}localStorage\.clear\(\)[\s\S]{0,80}writeCollapsed\(/);
});

test('a Governance page that draws its own heading shows only its section in the top bar, so its name is not on screen twice', () => {
  assert.doesNotMatch(header, /OWN_HEADING/, 'which pages own their heading is registry data (ownHeading in lib/navRegistry.ts), not a list in the top bar');
  assert.match(header, /section: ownHeadingSection\(pathname\)/);
  assert.match(header, /if \(info\.section\) \{/, 'the branch that prints the section and not the title');
});
