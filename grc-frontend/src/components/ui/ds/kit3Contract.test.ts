// node --test "src/components/ui/ds/kit3Contract.test.ts"
// Source-text contract (like kit2Contract.test.ts) for the Kit-3 pieces: WorkRow, CountRow, the facet-count and chip fixes, the wave-1 gaps. There is no
// React renderer in this repo, so what a component promises to draw, to wire for a screen reader and to leave out is pinned in its source; the decisions
// behind them are pure and have their own tests (workModel, clampModel ...). The behaviour itself is walked in a browser (the style guide, ux_kit_probe.mjs
// and the Kit-3 probe).
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
const FORBIDDEN = /window\.(confirm|alert|prompt)|opacity-0|group-hover/;

// ── WorkRow ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('WorkRow is built from the kit: Button, Checkbox, Menu, PersonChip and StatusPill, and the rules of workModel, not copies of them', () => {
  const row = code('WorkRow.tsx');
  for (const piece of ['Button', 'Checkbox', 'Menu', 'PersonChip', 'StatusPill']) assert.match(row, new RegExp(`import \\{[^}]*\\b${piece}\\b[^}]*\\} from '\\./${piece}';`), piece);
  assert.match(row, /import \{ actionName, dueBadge, menuName, rowTitle, titleControl, type DueTone \} from '\.\/workModel';/);
  assert.match(row, /dueBadge\(\{ due, calendar, overdue \}\)/);
  assert.doesNotMatch(row, FORBIDDEN);
});

test('WorkRow: the title is the row\'s ONE link or button, stretched over the row, and everything else that acts sits above it', () => {
  const row = code('WorkRow.tsx');
  assert.match(row, /after:absolute after:inset-0/);                                                // the stretch
  assert.match(row, /const ROW = 'relative grid /);                                                  // the row is the box the stretch fills
  assert.match(row, /control === 'link' && <Link href=\{href as string\} title=\{tip\} className=\{clsx\(TITLE, STRETCH\)\}>/);
  assert.match(row, /control === 'button' && <button type="button" title=\{tip\} onClick=\{onOpen\} className=\{clsx\(TITLE, STRETCH\)\}>/);
  assert.match(row, /control === 'text' && <span title=\{tip\} className=\{TITLE\}>/);               // plain text: no stretch, no stop
  const z = row.match(/relative z-\[1\]/g) ?? [];
  assert.ok(z.length >= 4, `the tick, both forms of the action and the menu must sit above the stretch (found ${z.length})`);
  assert.doesNotMatch(row.slice(at(row, 'const TITLE ='), at(row, 'const DUE')), /\bstatic\b|\brelative\b/);   // the title must not be positioned, or the stretch would fill IT
});

test('WorkRow: the ring is on the title element itself, the row tints while a control inside has focus, nothing is revealed by hover', () => {
  const row = code('WorkRow.tsx');
  assert.match(row, /const TITLE = '[^']*focus-visible:outline-none focus-visible:shadow-ds-ring'/);
  assert.match(row, /has-\[:focus-visible\]:bg-ds-surface-hover/);
  assert.match(row, /hover:bg-ds-surface-hover/);
  assert.doesNotMatch(row, /after:shadow|after:ring/);                                              // a ring on the pseudo-element cannot be seen by a probe or a magnifier
});

test('WorkRow: the title is cut at two lines on an inner span, and is the tooltip only when it really is cut', () => {
  const row = code('WorkRow.tsx');
  assert.match(row, /const \[text, cut\] = useLineClamped<HTMLSpanElement>\(\);/);
  assert.match(row, /<span ref=\{text\} className="line-clamp-2">\{words\}<\/span>/);
  assert.match(row, /const tip = cut \? words : undefined;/);
  assert.match(row, /const words = rowTitle\(title\);/);
});

test('WorkRow: the action is named "<word>: <title>", the menu "Actions for <title>", the tick by the page; the tick is a target of control height', () => {
  const row = code('WorkRow.tsx');
  assert.equal((row.match(/aria-label=\{actionName\(\{ label: action\.label, title: words, ariaLabel: action\.ariaLabel \}\)\}/g) ?? []).length, 2);      // the link and the button form
  assert.match(row, /<Menu iconOnly label=\{menuName\(\{ label: menu\.label, title: words \}\)\} items=\{menu\.items\} className="relative z-\[1\]" \/>/);
  assert.match(row, /<Checkbox checked=\{check\.checked\} disabled=\{check\.disabled\} aria-label=\{check\.label\} onChange=\{\(e\) => check\.onChange\(e\.target\.checked\)\} \/>/);
  assert.match(row, /h-ds-control w-\[var\(--ds-control-h\)\]/);                                    // 32px, 44px on a phone: the token
  assert.match(row, /<Button size="sm" variant=\{action\.variant \?\? 'secondary'\} href=\{action\.href\}/);
});

test('WorkRow: a due slot only when `due` is given (null says "No due date"), the overdue icon is decoration, the words are always drawn', () => {
  const row = code('WorkRow.tsx');
  assert.match(row, /const badge = due === undefined \? null : dueBadge\(/);
  assert.match(row, /\{badge\.overdue && <AlertTriangle aria-hidden /);
  assert.match(row, /\{badge\.text\}/);
});

test('WorkRow: stacked below 640px and at any width with `compact`; the template and every part\'s place are written out whole', () => {
  const row = code('WorkRow.tsx');
  assert.match(row, /const STACKED = 'grid-cols-\[minmax\(0,1fr\)_auto\]';/);
  assert.match(row, /sm:grid-cols-\[136px_minmax\(0,1fr\)_auto_auto\]/);
  assert.match(row, /sm:grid-cols-\[calc\(144px_\+_var\(--ds-control-h\)\)_minmax\(0,1fr\)_auto_auto\]/);
  assert.match(row, /compact \? undefined : check \? WIDE_TICK : WIDE/);
  assert.match(row, /const at = \(part: keyof typeof AREA, compact: boolean\): string => \(compact \? AREA\[part\]\[0\] : `\$\{AREA\[part\]\[0\]\} \$\{AREA\[part\]\[1\]\}`\);/);
  assert.match(row, /as: Tag = 'li'/);
  assert.match(row, /first:border-t-0/);
});

// ── the wave-1 gaps ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('ClampedText: the whole text is always in the page (CSS clamps it), the toggle is a real button that says whether it is open and what it opens, and only a measured cut draws it', () => {
  const c = code('ClampedText.tsx');
  assert.match(c, /<p ref=\{box\} id=\{id\} dir="auto" className=\{clsx\('whitespace-pre-line break-words text-ds-body text-ds-fg-body \[overflow-wrap:anywhere\]', !open && CLAMP_CLASS\[clampLines\(lines\)\]\)\}>\{words\}<\/p>/);
  assert.match(c, /showsToggle\(\{ cut, open \}\) && \(\s*<Button variant="link" size="sm" className="-ml-\[8px\] mt-\[2px\]" aria-expanded=\{open\} aria-controls=\{id\} onClick=\{\(\) => setOpen\(!open\)\}>\{toggleWords\(open\)\}<\/Button>/);
  // while it is open the clamp is lifted and nothing is cut: the hook must KEEP its last measurement, or "Show less" would unmount for a render and drop the focus on it
  assert.match(c, /const \[box, cut\] = useLineClamped<HTMLParagraphElement>\(!open\);/);
  assert.match(code('useLineClamped.ts'), /live\.current = clamped;/);
  assert.match(code('useLineClamped.ts'), /if \(el && live\.current\) setCut\(isCut\(/);
  assert.match(c, /const words = orEmpty\(text\);/);                                                // a missing text is the dash, never a blank
  assert.doesNotMatch(c, /truncate\(|\.slice\(|substring|max = \d+/);                              // no character count: the lines depend on the width
  assert.doesNotMatch(c, FORBIDDEN);
});

test('ChipList: the "+N" is a button that opens a NON-modal dialog with every item, reachable by keyboard: focus moves in, Tab stays, Escape gives it back', () => {
  const c = code('ChipList.tsx');
  assert.match(c, /import \{ useDialogFocus \} from '\.\.\/useDialogFocus';/);
  assert.match(c, /useDialogFocus\(open, panel\);/);
  assert.match(c, /aria-haspopup="dialog" aria-expanded=\{open\} aria-controls=\{open \? dialogId : undefined\} aria-label=\{moreName\(more, label\)\}/);
  assert.match(c, /role="dialog"\s+aria-label=\{dialogName\(label\)\}\s+tabIndex=\{-1\}/);
  assert.doesNotMatch(c, /aria-modal/);                                                             // a note over the page, not a modal
  assert.match(c, /if \(e\.key !== 'Escape'\) return;\s+e\.preventDefault\(\);[^]*?close\(\);\s+button\.current\?\.focus\(\);/);   // taken (a dialog around it must not close too) and given back
  assert.match(c, /createPortal\(/);                                                                // a table or a card never clips it
  assert.match(c, /document\.addEventListener\('mousedown', onDown\)/);
  assert.match(c, /window\.addEventListener\('scroll', onScroll, true\)/);
  assert.match(c, /window\.addEventListener\('resize', close\)/);
  assert.doesNotMatch(c, FORBIDDEN);
});

test('ChipList: the first two are chips, the full list is every item and has a search box only from eight, nothing is drawn for no items, a cut chip says its whole name', () => {
  const c = code('ChipList.tsx');
  assert.match(c, /const \{ visible, more \} = splitItems\(all, shown\);/);
  assert.match(c, /const canSearch = searchable\(all\.length, searchFrom\);/);
  assert.match(c, /const found = canSearch \? filterItems\(all, query\) : all;/);
  assert.match(c, /\{canSearch && \(/);
  assert.match(c, /<TextInput type="search" data-autofocus="" aria-label=\{`Find in \$\{label\}`\}/);
  assert.match(c, /if \(all\.length === 0\) return null;/);
  assert.match(c, /title=\{clipped \? item\.label : undefined\}/);
  assert.match(c, /<ul aria-label=\{label\}/);
  assert.match(c, /const \[spot, setSpot\] = useState<Spot \| null>\(null\);/);
});

test('Fact and FactList: a <dl> of <dt> over <dd> in divs, as many columns as fit with no breakpoint, a missing value says so, a long value wraps', () => {
  const f = code('Facts.tsx');
  assert.match(f, /<dl\s+style=\{\{ gridTemplateColumns: `repeat\(auto-fill, minmax\(min\(100%, \$\{column\}px\), 1fr\)\)` \}\}/);
  assert.match(f, /<dt className="text-ds-label font-normal text-ds-fg-muted">\{label\}<\/dt>/);
  assert.match(f, /<dd className="mt-\[2px\] min-w-0 break-words text-ds-body text-ds-fg \[overflow-wrap:anywhere\]">\{has\(children\) \? children : <span className="text-ds-fg-muted">\{empty\}<\/span>\}<\/dd>/);
  assert.match(f, /empty = EMPTY/);                                                                  // the dash, from lib/format.ts
  assert.match(f, /variant === 'boxed' && BOXED/);
});

test('TitleLink: the cut is on an inner span (a clamp on the link would show a third line through its padding), the tooltip only when it is cut; CardLink is one link and nothing else', () => {
  const l = code('Links.tsx');
  assert.match(l, /title=\{cut \? title : undefined\}/);
  assert.match(l, /<span ref=\{text\} className=\{CLAMP_CLASS\[clampLines\(lines \?\? 2\)\]\}>\{title\}<\/span>/);
  assert.match(l, /const SIZE: Record<LinkSize, string> = \{ body: 'text-ds-body', label: 'text-ds-label' \};/);       // a title sets its own size: a bare link inherits the shell's ~16px
  assert.match(l, /<div className=\{clsx\('flow-root min-w-0', className\)\}>\s*<Link \{\.\.\.rest\} title=\{cut \? title : undefined\} className=\{clsx\('block \[overflow-wrap:anywhere\]', SIZE\[size \?\? 'body'\], tone === 'muted' && 'font-normal', linkClasses\(\{ tone, size \}\)\)\}>/);   // in a div: a parent's space-y must not overwrite the link's cancelling margins
  assert.doesNotMatch(code('linkModel.ts'), /text-ds-body|text-ds-label/);                                          // linkClasses (a link in a sentence) keeps the sentence's size
  assert.match(l, /<Link \{\.\.\.rest\} className=\{clsx\(CARD_LINK, padded && CARD_LINK_PADDING, className\)\}>\{children\}<\/Link>/);
  assert.doesNotMatch(l, FORBIDDEN);
  assert.match(code('linkModel.ts'), /export const CARD_LINK = 'block min-w-0 rounded-ds-card border border-ds-border bg-ds-surface text-left hover:border-ds-border-strong focus-visible:outline-none focus-visible:shadow-ds-ring';/);
});

test('the barrels export every new piece once, from the kit and from @/components/ui', () => {
  for (const barrel of ['index.ts', '../index.ts']) {
    const text = read(`./${barrel}`);
    for (const name of ['WorkRow', 'CountRow', 'ClampedText', 'ChipList', 'Fact', 'FactList', 'TitleLink', 'CardLink', 'linkClasses']) {
      assert.equal((text.match(new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\} from`, 'g')) ?? []).length, 1, `${barrel}: ${name}`);
    }
  }
});

// ── the two findings of the Kit-2 probe ───────────────────────────────────────────────────────────────────────────────────────────────────

test('a chip is announced once: no tooltip of its whole text on the button, the cut label and the flag\'s mark carry their own', () => {
  const chips = code('FilterChips.tsx');
  assert.doesNotMatch(chips, /chipText|title=\{chip\.title \?\?/);
  assert.match(chips, /<span ref=\{word\} title=\{labelTip\(chip\.label, clipped\)\}/);
  assert.equal((chips.match(/aria-hidden title=\{flagTip\(flag\)\}/g) ?? []).length, 2);
  assert.match(code('filterChipsModel.ts'), /export function labelTip\(label: string, clipped: boolean\): string \| undefined/);
  assert.match(code('filterChipsModel.ts'), /export function flagTip\(flag: ChipFlag \| undefined\): string \| undefined/);
});

test('a facet group header says its count once: the number, then "selected" for a screen reader, and no aria-label to repeat them', () => {
  const d = code('Disclosure.tsx');
  assert.match(d, /\{chosen\}\s*<span className="sr-only">\{countLabel\}<\/span>/);
  assert.doesNotMatch(d, /aria-label=/);
});

test('an AccordionRow keeps a readable title column on a phone: the header wraps, the title asks for 10rem, the status drops under it instead of squeezing it', () => {
  const d = code('Disclosure.tsx');
  assert.match(d, /relative min-h-ds-control flex-wrap gap-x-\[10px\] gap-y-\[4px\] py-\[8px\] pl-\[4px\] pr-\[28px\]/);
  assert.match(d, /<span className="min-w-0 flex-1 basis-\[10rem\]">/);
  assert.match(d, /\{trailing && <span className="flex shrink-0 flex-wrap items-center gap-\[6px\]/);
});

// ── CountRow ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('CountRow is ONE target: a link, a button or plain text, never two controls; a count is read by workModel, never capped', () => {
  const c = code('CountRow.tsx');
  assert.match(c, /const target = href \? 'link' : onClick \? 'button' : 'text';/);
  assert.match(c, /target === 'link' && <Link href=\{href as string\} className=\{shape\}>/);
  assert.match(c, /target === 'button' && <button type="button" onClick=\{onClick\} className=\{shape\}>/);
  assert.match(c, /import \{ countText, deltaWords, isZero \} from '\.\/workModel';/);
  assert.doesNotMatch(c, /99\+|toLocale/);
  assert.doesNotMatch(c, FORBIDDEN);
});

test('CountRow: none is a dash read as "not recorded", a zero or none has a hollow dot, the dot and chevron are decoration, the change is words', () => {
  const c = code('CountRow.tsx');
  assert.match(c, /\{!recorded && <span className="sr-only"> not recorded<\/span>\}/);
  assert.match(c, /const quiet = !recorded \|\| isZero\(count\);/);
  assert.equal((c.match(/<span aria-hidden className="h-\[8px\] w-\[8px\] shrink-0 rounded-full shadow-\[inset_0_0_0_1\.5px_var\(--ds-border-control\)\]" \/>/g) ?? []).length, 2);   // the failed row's dot and the quiet one: hollow, decoration
  assert.match(c, /<ChevronRight aria-hidden /);
  assert.match(c, /const change = deltaWords\(delta, deltaLabel\);/);
  assert.match(c, /<span className="sr-only">: <\/span>/);                                          // "Overdue reviews: 12" for a screen reader
});

test('CountRow: loading is announced and busy, a failure says "unavailable" with a named Retry and is never a 0, a row keeps the label 10rem wide', () => {
  const c = code('CountRow.tsx');
  assert.match(c, /role="status" aria-busy="true"/);
  assert.match(c, /\{`Loading \$\{label\}`\}/);
  assert.match(c, /\{`\$\{label\}: unavailable`\}/);
  assert.match(c, /aria-label=\{`Retry: \$\{label\}`\}/);
  assert.match(c, /flex-1 basis-\[10rem\]/);                                                         // the label asks for 10rem; the count drops under it rather than squeezing it
  assert.match(c, /flex-wrap/);
});
