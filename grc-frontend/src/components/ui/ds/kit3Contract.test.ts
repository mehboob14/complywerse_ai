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
