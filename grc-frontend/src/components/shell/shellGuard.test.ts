// node --test src/components/shell/shellGuard.test.ts
// Source-text guard for the shell's new files (the rail, the crumbs, the panel, the palette): the kit's rules (no class the platform CSS rewrites, no value outside the tokens, 12px
// floor), nothing revealed by hover, no native dialog, and the roles and keys that make them usable by keyboard and screen reader. No React renderer here: what must not regress is
// pinned in the file that carries it, and behaviour (focus, Escape, widths) is checked in a browser. Header.tsx and Sidebar.tsx keep their older dropdown and drawer code and are
// guarded by topBar.test.ts and shell.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../ui/ds/kitRules.ts';

const DIR = 'src/components/shell';
const files = readdirSync(DIR).filter((name) => /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name));
const read = (name: string) => readFileSync(`${DIR}/${name}`, 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

// `main` keeps the classes the layout always gave it, byte for byte (a dozen pages cancel its padding with a negative margin): the one line the kit's rules do not apply to.
const KEPT_AS_IT_WAS = /^.*<main id="main-content".*$/m;

test('every file of the shell follows the kit\'s rules (the same ones the kit is held to)', () => {
  assert.ok(files.length >= 15, 'the guard sees the folder');
  const bad = files.flatMap((f) => findViolations(read(f).replace(KEPT_AS_IT_WAS, '')).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('nothing is revealed by hover, nothing asks through a native dialog, and no headline is left to the platform CSS', () => {
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /group-hover:(opacity-100|block|flex|visible)|opacity-0[^'"`]*group-hover/, `${f} reveals something on hover`);
    assert.doesNotMatch(src, /window\.(confirm|alert|prompt)\(|[^.\w](confirm|alert|prompt)\(/, `${f} uses a native dialog`);
    assert.doesNotMatch(src, /<h[1-6][ >]/, `${f} draws a bare heading (the platform CSS gives it 16px/12.5px): the panel's title is the kit's, the sections the kit's Disclosure`);
  }
});

test('the command palette is a modal combobox over a listbox: a labelled dialog, an input that names the highlighted option, options with ids, one Escape for one layer, Tab kept inside', () => {
  const src = read('CommandPalette.tsx');
  assert.match(src, /role="dialog"[\s\S]{0,60}aria-modal="true"[\s\S]{0,60}aria-label="Command palette"/);
  assert.match(src, /role="combobox"/);
  assert.match(src, /aria-controls="palette-list"/);
  assert.match(src, /aria-activedescendant=\{count > 0 \? `po-\$\{at\}` : undefined\}/);
  assert.match(src, /role="listbox" aria-label="Results"/);
  assert.match(src, /role="option"/);
  assert.match(src, /aria-selected=\{on\}/);
  assert.match(src, /useDialogFocus\(true, dialog\)/, 'focus in, Tab kept inside, focus back on what opened it');
  assert.match(src, /lockBodyScroll\(\)/);
  assert.match(src, /overlayTakesEscape\(/, 'a layer drawn over it, or one that took the key first, keeps it');
  assert.match(src, /moveOption\(count, at, e\.key\)/);
  assert.match(src, /e\.key === 'Enter'/);
  assert.match(src, /max-md:h-full[\s\S]{0,60}max-md:rounded-none/, 'full screen on a phone');
  assert.match(src, /return ui\.paletteOpen \? <PaletteDialog \/> : null/, 'mounted only while open: nothing is asked while it is shut');
});

test('Ctrl/Cmd K opens the palette and Ctrl/Cmd . takes focus into the panel; a page that handled the key first keeps it', () => {
  const src = read('ShellProvider.tsx');
  assert.match(src, /if \(e\.defaultPrevented \|\| !\(e\.ctrlKey \|\| e\.metaKey\) \|\| e\.altKey\) return/);
  assert.match(src, /e\.key === 'k' \|\| e\.key === 'K'/);
  assert.match(src, /e\.key === '\.'/);
  assert.match(src, /closest\?\.\('\[data-work-panel\]'\)/, 'pressed again from inside the panel it closes and focus goes back to its button');
});

test('the panel is the kit\'s SidePanel in three places, with sections that are disclosures, a named list for the module\'s pages and rows that are real links', () => {
  const src = read('WorkPanel.tsx');
  assert.match(src, /<SidePanel[\s\S]{0,400}title="Work and context"/);
  assert.match(src, /mode=\{docked \? 'docked' : ui\.placement === 'overlay' \? 'overlay' : 'sheet'\}/);
  assert.match(src, /initialFocus=\{docked \? undefined : '\[data-panel-first\]'\}/, 'a docked column takes no focus by itself');
  assert.match(src, /restoreFocus=\{ui\.panelButton\}/);
  assert.match(src, /requestAnimationFrame\(\(\) => \{\s*if \(!ui\.takeFocusRequest\(\)\) return;/, 'the Ctrl . request is taken inside the frame: a mounting effect that runs twice (development) must not lose it with its cancelled frame');
  assert.match(src, /<div ref=\{root\} data-work-panel="" className="relative">/, 'the list is the containing block of its visually hidden labels: a docked column in the page flow would otherwise let them stretch the document (a 15px scrollbar that shifts the shell)');
  assert.match(src, /<nav aria-label=\{section\.navLabel\}>/);
  assert.match(src, /aria-current=\{row\.current \? 'page' : undefined\}/);
  assert.equal((src.match(/<Disclosure /g) ?? []).length, 5, 'the queue, the committee, the module, Pinned, Recent');
  assert.match(src, /role="alert"/, 'a source of the queue that could not be loaded says so, with Retry');
  assert.match(src, /queue\.refetch\(n\.source\)/);
});

test('the trail: named navs for the wide and the phone bar, current page marked, the module\'s first crumb a switcher, a menu list that is a menu', () => {
  const crumbs = read('Breadcrumbs.tsx');
  assert.equal((crumbs.match(/aria-label="Breadcrumb"/g) ?? []).length, 2, 'one nav for the phone, one for the wide bar (an empty trail draws no landmark)');
  assert.match(crumbs, /aria-current="page"/);
  assert.match(crumbs, /md:hidden/);
  assert.match(crumbs, /hidden min-w-0 flex-1 md:block/);
  const menu = read('CrumbMenu.tsx');
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /onKeyDown=\{fly\.onPanelKeyDown\}/);
});

test('the rail is a fixed column with a short name under each icon, and the queue first with its count', () => {
  const src = read('ModuleIconRail.tsx');
  assert.match(src, /text-\[12px\]/);
  assert.match(src, /rail\.queue/);
  assert.match(src, /countLabel=\{queue\.label\}/);
  assert.match(src, /title=\{item\.name\}/);
});

test('what is kept per browser goes through the one store: every access in try/catch, nothing else touches storage', () => {
  const stores = files.filter((f) => /localStorage|sessionStorage/.test(code(read(f))));
  assert.deepEqual(stores.sort(), ['FirstRunHint.tsx', 'ShellProvider.tsx', 'pinnedRecent.ts'].sort());
  for (const f of stores) {
    const src = code(read(f));
    const accesses = (src.match(/(localStorage|sessionStorage)\.(getItem|setItem|removeItem)|\(store \?\? window\.localStorage\)|store \?\? browserStore|window\.localStorage\b/g) ?? []).length;
    const guarded = (src.match(/try \{/g) ?? []).length;
    assert.ok(accesses > 0 && guarded >= 1, `${f}: storage without try/catch`);
  }
});

test('the palette reads only lists the app already has, from the browser: no search endpoint of its own', () => {
  const src = read('useShellRecords.ts');
  const calls = (src.match(/apiClient\.get\('[^']+'|committeeApi\.\w+/g) ?? []).sort();
  assert.deepEqual(Array.from(new Set(calls)), ["apiClient.get('/governance/documents'", 'committeeApi.getCommittee', 'committeeApi.getCommittees', 'committeeApi.getMeeting', 'committeeApi.getMeetings']);
  assert.match(src, /brief: 1, search: term, limit: DOCUMENT_HITS/, 'the brief rows, the server\'s own search and visibility filter, a handful');
});
