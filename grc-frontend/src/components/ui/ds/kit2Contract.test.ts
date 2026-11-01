// node --test "src/components/ui/ds/kit2Contract.test.ts"
// Source-text contract (like displayContract.test.ts) for the Kit-2 pieces: SidePanel, Sheet, FilterChips, Disclosure, WorkRow, CountRow, the Menu
// upgrades and the wave-1 gaps. There is no React renderer in this repo, so what a component promises to draw, to wire for a screen reader, to
// trap and to give back is pinned in its source; the decisions behind them are pure and have their own tests (sidePanelModel, filterChipsModel ...).
// The behaviour itself is walked in a browser (the style guide, ux_kit_probe.mjs and the Kit-2 probe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (url: string): string => readFileSync(new URL(url, import.meta.url), 'utf8');
/** the code without its comments */
const code = (name: string): string => read(`./${name}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const at = (source: string, needle: string): number => {
  const i = source.indexOf(needle);
  assert.ok(i >= 0, `${needle} is not in the source`);
  return i;
};

// ── SidePanel and Sheet ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('SidePanel builds on the existing overlay code: useDialogFocus, lockBodyScroll, useDiscardGuard and overlayTakesEscape, not copies of them', () => {
  const panel = code('SidePanel.tsx');
  assert.match(panel, /import \{ useDialogFocus \} from '\.\.\/useDialogFocus';/);
  assert.match(panel, /import \{ lockBodyScroll \} from '\.\.\/scrollLock';/);
  assert.match(panel, /import \{ focusIsElsewhere, overlayTakesEscape \} from '\.\.\/dialogFocus';/);
  assert.match(panel, /useDiscardGuard\(\{ open, dirty, closeOnBackdrop, onClose, dialogRef: panelRef \}\)/);
  assert.match(panel, /<DiscardBar keepLabel=\{keepLabel\} discardLabel=\{discardLabel\} onKeep=\{keep\} onDiscard=\{discard\} \/>/);
  assert.doesNotMatch(panel, /Escape.*\n.*TABBABLE|addEventListener\('keydown'[^]*'Tab'/);              // no Tab handling of its own
});

test('SidePanel: only an overlay or a sheet traps focus and locks the page; a docked column is part of the page', () => {
  const panel = code('SidePanel.tsx');
  assert.match(panel, /useDialogFocus\(open && !docked, panelRef\)/);
  assert.match(panel, /lockBodyScroll\(\) : undefined\), \[open, docked\]/);
  const docked = panel.slice(at(panel, 'if (docked) {'), at(panel, "if (typeof document === 'undefined') return null;"));
  assert.match(docked, /<aside\b/);
  assert.match(docked, /data-side-panel="docked"/);
  assert.match(docked, /aria-labelledby=\{titleId\}/);
  assert.doesNotMatch(docked, /role="dialog"|aria-modal|createPortal|tabIndex/);                      // not a dialog, not a portal
  const overlay = panel.slice(at(panel, "if (typeof document === 'undefined') return null;"));
  assert.match(overlay, /createPortal\(/);
  assert.match(overlay, /role="dialog"\s+aria-modal="true"\s+aria-labelledby=\{titleId\}/);
  assert.match(overlay, /tabIndex=\{-1\}/);
  assert.match(overlay, /<div aria-hidden className="absolute inset-0 bg-ds-scrim" onClick=\{\(\) => requestClose\('backdrop'\)\} \/>/);
  assert.match(overlay, /document\.body/);
});

test('SidePanel: Escape is taken only by the top layer, and by a docked column only when asked for and while focus is inside', () => {
  const panel = code('SidePanel.tsx');
  assert.match(panel, /overlayTakesEscape\(\{ key: e\.key, defaultPrevented: e\.defaultPrevented, focusElsewhere: elsewhere \}\)/);
  assert.match(panel, /panelTakesEscape\(\{ mode, escapeClosesDocked, focusInside: inside \}\)/);
  assert.match(panel, /e\.preventDefault\(\);/);                                                      // taken: a layer under this one must not take it too
  assert.match(panel, /requestClose\('escape'\)/);
});

test('SidePanel: focus is remembered before it moves in (declared before useDialogFocus), marked targets are honoured, and it is given back', () => {
  const panel = code('SidePanel.tsx');
  assert.ok(at(panel, 'useRestoreFocus(open, restoreFocus);') < at(panel, 'useDialogFocus(open && !docked, panelRef);'), 'the opener must be remembered first');
  assert.ok(at(panel, 'useInitialFocus(open, panelRef, initialFocus, docked);') < at(panel, 'useDialogFocus(open && !docked, panelRef);'), 'the target must be marked first');
  assert.match(panel, /setAttribute\('data-autofocus', ''\)/);                                         // what useDialogFocus's focusInto looks for
  assert.match(panel, /focusAfterClose\(\{ lost, named: resolveFocusTarget\(named\.current\), opener: from \}\)\?\.focus\(\{ preventScroll: true \}\)/);
});

test('SidePanel: the close button is a named IconButton, the heading carries the kit\'s `!` sizes, the footer stays in view, the sheet is capped at 640 px', () => {
  const panel = code('SidePanel.tsx');
  assert.match(panel, /<IconButton label=\{closeLabel\} onClick=\{\(\) => requestClose\('close-button'\)\}>/);
  assert.match(panel, /<h2 id=\{titleId\} className="break-words !text-ds-section !text-ds-fg">/);
  assert.match(panel, /shrink-0 border-t border-ds-border/);                                          // the footer does not scroll away
  assert.match(panel, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);                           // the body scrolls
  assert.match(panel, /max-w-\[640px\][^']*max-h-\[85vh\]/);
  assert.match(panel, /env\(safe-area-inset-bottom\)/);                                               // the phone's home bar
  assert.doesNotMatch(panel, /window\.(confirm|alert|prompt)|opacity-0|group-hover/);
});

test('Sheet is a SidePanel that never docks; "right" and "bottom" force the mode, "auto" leaves it to the window', () => {
  const sheet = code('Sheet.tsx');
  assert.match(sheet, /<SidePanel \{\.\.\.rest\} dockFrom=\{Infinity\} mode=\{side === 'right' \? 'overlay' : side === 'bottom' \? 'sheet' : undefined\} \/>/);
  assert.match(sheet, /side = 'auto'/);
});

test('usePanelMode answers from matchMedia without a render loop: a stable subscription, a primitive snapshot, and nothing drawn on the server', () => {
  const hook = code('usePanelMode.ts');
  assert.match(hook, /useSyncExternalStore\(subscribe, snapshot, \(\) => 'overlay'\)/);
  assert.match(hook, /useCallback\(\(onChange: \(\) => void\)/);
  assert.match(hook, /\[dock, overlay\]/);
});

// ── Menu ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Menu: every item role is a menuitem*, the arrow keys read navEntries (a reason keeps an item reachable), groups are named by their title', () => {
  const menu = code('Menu.tsx');
  assert.match(menu, /querySelectorAll<HTMLElement>\('\[role\^="menuitem"\]'\)/);
  assert.match(menu, /const reach = navEntries\(items\);/);
  assert.match(menu, /indexForKey\(reach, list\.indexOf\(document\.activeElement as HTMLElement\), e\.key\)/);
  assert.match(menu, /role=\{role\}/);
  assert.match(menu, /aria-checked=\{role === 'menuitem' \? undefined : !!it\.checked\}/);
  assert.match(menu, /aria-disabled=\{blocked && it\.reason \? true : undefined\}/);
  assert.match(menu, /aria-describedby=\{reasonId\}/);
  assert.match(menu, /disabled=\{blocked && !it\.reason\}/);                                          // without a reason a disabled item is a disabled button, as before
  assert.match(menu, /onClick=\{\(\) => \{ if \(!blocked\) onPick\(it\); \}\}/);                    // a blocked item never runs
  assert.match(menu, /<div key=\{`run-\$\{r\}`\} role="group" aria-labelledby=\{gid\}>/);
});

test('Menu: the defaults of every existing caller are unchanged (md trigger, 32 px control height, icon-only square, Escape and Tab as before)', () => {
  const menu = code('Menu.tsx');
  assert.match(menu, /size = 'md'/);
  assert.match(menu, /md: 'h-ds-control text-ds-body', sm: 'h-ds-control-sm text-ds-label'/);
  assert.match(menu, /e\.key === 'Escape'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); onClose\(true\); return; \}/);
  assert.match(menu, /e\.key === 'Tab'\) \{ onClose\(true\); return; \}/);
  assert.match(menu, /aria-haspopup="menu"/);
  assert.doesNotMatch(menu, /window\.(confirm|alert|prompt)|opacity-0|group-hover/);
});

// ── FilterChips and the Tabs count format ─────────────────────────────────────────────────────────────────────────────────────────────────

test('FilterChips: a toolbar of real buttons that say whether they are pressed, with one roving tab stop and the arrow keys', () => {
  const chips = code('FilterChips.tsx');
  assert.match(chips, /role="toolbar" aria-label=\{label\}/);
  assert.equal((chips.match(/role="toolbar"/g) ?? []).length, 2);                      // the wrapping row and the scrolling one
  assert.match(chips, /<button\s+ref=\{register\}\s+type="button"\s+aria-pressed=\{!!chip\.active\}\s+tabIndex=\{tabbable \? 0 : -1\}/);
  assert.match(chips, /const stop = chipStop\(row, focused\);/);
  assert.match(chips, /const to = nextChip\(row, key, e\.key\);/);
  assert.match(chips, /buttons\.current\.get\(to\)\?\.focus\(\);/);                  // an arrow moves focus ...
  assert.doesNotMatch(chips, /onToggle\(to\)|onToggle\(key\);\s*\n\s*buttons/);         // ... and never toggles
  assert.match(chips, /if \(e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey\) return;/);       // Alt+Left is the browser's Back
});

test('FilterChips: a flag always has words (screen-reader text and tooltip), a count is the true number, an empty row draws nothing', () => {
  const chips = code('FilterChips.tsx');
  assert.match(chips, /\{flag && <span className="sr-only">\{`, \$\{flag\.label\}`\}<\/span>\}/);
  assert.match(chips, /aria-hidden className=\{clsx\('h-\[8px\] w-\[8px\] shrink-0 rounded-full'/);   // the dot is decoration: its words are the sr-only text
  assert.match(chips, /const count = countText\(chip\.count\);/);
  assert.match(chips, /if \(row\.length === 0\) return null;/);
  assert.match(chips, /<Menu\s+label=\{trigger\.text\}\s+size="sm"/);                    // the "+N more" menu is the kit's Menu
  assert.match(chips, /title=\{chip\.title \?\? \(clipped \|\| flag \? chipText\(chip\) : undefined\)\}/);   // the whole text, only when it is cut (or a flag needs words)
  assert.match(chips, /h-ds-control-sm/);                                                // 28px, 44px on a phone: the token
  assert.doesNotMatch(chips, /99\+|window\.(confirm|alert|prompt)|opacity-0|group-hover/);
});

test('Tabs: the count reads "99+" unless the page asks for exact counts, so every existing caller is unchanged', () => {
  const tabs = code('Tabs.tsx');
  assert.match(tabs, /countFormat = 'capped'/);
  assert.match(tabs, /countLabel\(t\.count, countFormat === 'exact'\)/);
  assert.match(code('../../../lib/tabsModel.ts'), /export function countLabel\(count: number \| null \| undefined, exact: boolean = false\)/);
});
