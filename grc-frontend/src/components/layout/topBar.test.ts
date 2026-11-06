// node --test src/components/layout/topBar.test.ts
// Source-text guard for the top bar (Header.tsx), like shell.test.ts is for the menu: no React renderer here, so what must not regress is
// pinned in the file that carries it. Behaviour (focus, Escape) is checked in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const header = readFileSync('src/components/layout/Header.tsx', 'utf8');

test('the bar is 48px high: pages that fill the window size themselves against it (100dvh - 3rem, 4.75rem, 5rem)', () => {
  assert.match(header, /<header className="top-nav flex h-12 /);
  for (const [file, pin] of [
    ['src/app/(dashboard)/governance/documents/studio/[sessionId]/page.tsx', 'h-[calc(100dvh-3rem)]'],
    ['src/app/(dashboard)/governance/documents/[id]/_DocumentStudio.tsx', 'h-[calc(100vh-3rem)]'],
    ['src/app/(dashboard)/complychat/page.tsx', 'h-[calc(100vh-4.75rem)]'],
  ] as const) assert.ok(readFileSync(file, 'utf8').includes(pin), `${file} no longer sizes itself against the 48px bar: the bar may change now`);
});

test('below lg the top bar has the button that opens the menu drawer, and from lg it is gone', () => {
  assert.match(header, /lg:hidden`}\s*\n?\s*>\s*\n?\s*<Menu/, 'the menu button shows below lg only');
  assert.match(header, /aria-label="Open menu"/);
  assert.match(header, /aria-controls=\{menuOpen \? MAIN_MENU_ID : undefined\}/, 'names the drawer while it is open: the drawer is not in the page when closed');
  assert.match(header, /aria-expanded=\{menuOpen\}/);
});

test('the left of the bar is the trail, or in the Documents area its tab strip; the command bar, the panel button, the bell and the account follow', () => {
  assert.match(header, /\{showTabs \? <DocumentsTabs ownerOnly=\{!canSeeGovernance\} \/> : <Breadcrumbs \/>\}/);
  assert.match(header, /const showTabs = inDocumentsArea\(pathname\) && \(canSeeGovernance \|\| access\.headsDepartment\)/, 'the strip is the library\'s: no library right and no department, no strip');
  assert.ok(header.indexOf('<CommandBar />') > header.indexOf('<Breadcrumbs />'));
  assert.ok(header.indexOf('ref={ui.panelButton}') > header.indexOf('<CommandBar />'));
  assert.ok(header.indexOf('aria-label="Notifications"') > header.indexOf('ref={ui.panelButton}'));
  assert.ok(header.indexOf('aria-label="User menu"') > header.indexOf('aria-label="Notifications"'));
});

test('Comply Agent is a question box from 1440 and an icon to the same chat below it; routes keep the name ComplyChat', () => {
  assert.match(header, /className="relative hidden min-\[1440px\]:block"/, 'the box from 1440');
  assert.match(header, /href="\/complychat" aria-label="Ask Comply Agent"/);
  assert.match(header, /max-md:hidden min-\[1440px\]:hidden/, 'the icon where the box is not, and not on a phone (the menu has it there)');
  assert.match(header, /router\.push\(q \? `\/complychat\?q=\$\{encodeURIComponent\(q\)\}` : '\/complychat'\)/);
});

test('the Guide is in the bar from 768 and a row of the menu below', () => {
  assert.match(header, /<span className="hidden md:inline-flex"><GuideToggle \/><\/span>/);
  assert.match(readFileSync('src/components/layout/Sidebar.tsx', 'utf8'), /Guide markers/);
});

test('the Work and context button says whether the panel is showing and what waits, with the inbox\'s number and the inbox\'s words', () => {
  assert.match(header, /aria-pressed=\{ui\.panelShown\}/);
  assert.match(header, /aria-label=\{`Work and context\. \$\{queue\.label\}`\}/);
  assert.match(header, /title="Work and context \(Ctrl \.\)"/);
  assert.match(header, /onClick=\{ui\.togglePanel\}/);
  assert.match(header, /queue\.urgent \? 'bg-ds-danger' : 'bg-ds-warning'/, 'overdue turns the count red');
});

test('the dropdowns close on Escape, give focus back to their button, and say they are popups', () => {
  assert.match(header, /e\.key !== 'Escape'/);
  assert.match(header, /button\.current\?\.focus\(\)/);
  assert.equal((header.match(/aria-haspopup="dialog"/g) ?? []).length, 3, 'menu, notifications and user buttons');
  assert.equal((header.match(/role="dialog"/g) ?? []).length, 2, 'the two dropdown panels');
  assert.equal((header.match(/aria-controls=\{(notifOpen|isUserMenuOpen) \? /g) ?? []).length, 2, 'each button names its panel while it is open');
});

test('the bar\'s buttons are 32px, 44px on a phone or a coarse pointer (the control height token)', () => {
  assert.match(header, /const BAR_BUTTON = '[^']*h-ds-control min-w-\[var\(--ds-control-h\)\]/);
  assert.equal((header.match(/className=\{BAR_BUTTON\}|\$\{BAR_BUTTON\}/g) ?? []).length >= 3, true, 'the menu button, the panel button and the bell use it');
});

test('signing out clears what the browser kept, as it always did; nothing of the shell is meant to outlive it', () => {
  assert.match(header, /localStorage\.clear\(\);\s*\n\s*sessionStorage\.clear\(\)/);
  assert.doesNotMatch(header, /readCollapsed|writeCollapsed/, 'the collapsed sidebar left with the sidebar');
});

test('the bell keeps its parts: 30 s poll and 20 items (the shared hook), Mark all read, a deep link for each notification, two lines of message with the whole text as its title', () => {
  const hook = readFileSync('src/components/shell/useNotifications.ts', 'utf8');
  assert.match(hook, /in-app\?limit=20/);
  assert.match(hook, /refetchInterval: 30000/);
  assert.match(hook, /in-app\/read-all/);
  assert.match(header, /Mark all read/);
  assert.match(header, /notificationHref\(n\)/);
  assert.match(header, /title=\{n\.message\} className="mt-0\.5 line-clamp-2/);
});

test('the account menu keeps Users (for those who hold the users right), Admin Users, Logout, and shows the tenant on two lines with its whole name as the title', () => {
  assert.match(header, /canSeeUsers/);
  assert.match(header, /router\.push\('\/admin\/users'\)/);
  assert.match(header, /Logout/);
  assert.match(header, /title=\{tenantName\} className="mt-1 line-clamp-2/);
});

test('the Header keeps no title map and no search of its own: the trail is the registry\'s and the palette is the shell\'s', () => {
  assert.doesNotMatch(header, /PAGE_TITLES|GlobalSearchBar|searchApi/);
  assert.match(header, /import Breadcrumbs from '@\/components\/shell\/Breadcrumbs'/);
  assert.match(header, /import CommandBar from '@\/components\/shell\/CommandBar'/);
});
