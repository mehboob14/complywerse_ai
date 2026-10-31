// node --test "src/components/ui/infoTip.test.ts"
// InfoTip is shared (58 files use it, the kit's FormField, SectionCard and PageHeading among them), so what it promises is pinned here as source text:
// there is no DOM to render it in, and the behaviour itself was checked in a browser (hover, press, Tab, Escape, a tap on a touch screen, and a
// screenshot diff of three pages before and after: no pixel moved).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/ui/InfoTip.tsx', 'utf8').replace(/\r\n/g, '\n');
const GLYPH = 20;                                                                // h-5 w-5

const buttonClasses = /<button[\s\S]*?className="([^"]+)"/.exec(source)?.[1] ?? '';
const sides = (value: string): number[] => value.split('_').map((v) => parseInt(v, 10));          // top right bottom left

test('the glyph stays the 20px (i), and it is what the note is placed from', () => {
  assert.match(source, /<span\s+ref=\{glyph\}\s+className="grid h-5 w-5 place-items-center rounded-full/);
  assert.match(source, /const r = glyph\.current\?\.getBoundingClientRect\(\)/);
  assert.doesNotMatch(source, /button\.current\?\.getBoundingClientRect/);          // the larger press area must not move the note
});

test('the ring is drawn on the glyph, not on the larger press area; the button itself has no outline', () => {
  assert.match(source, /group-focus-visible\/tip:ring-2 group-focus-visible\/tip:ring-\[#0f766e\]/);
  assert.ok(buttonClasses.includes('focus-visible:outline-none'));
  assert.ok(buttonClasses.split(' ').includes('group/tip'), 'a named group: an unrelated group around the (i) must not light its ring or colour');
  assert.doesNotMatch(source, /\bgroup-(hover|focus-visible):/);
});

test('with a mouse the press area is at least 24px, padded out and pulled back by the same margin so nothing moves', () => {
  const margin = /(?:^|\s)-m-\[(\d+)px\]/.exec(buttonClasses)?.[1];
  const padding = /(?:^|\s)p-\[(\d+)px\]/.exec(buttonClasses)?.[1];
  assert.ok(margin && padding, 'both are there');
  assert.equal(margin, padding);
  assert.ok(GLYPH + 2 * Number(padding) >= 24);
});

test('on a touch screen the press area is at least 44px both ways, mirrored by its margin, and keeps to the right of the (i)', () => {
  const margin = /\[@media\(pointer:coarse\)\]:\[margin:(-?\d+px(?:_-?\d+px){3})\]/.exec(buttonClasses)?.[1];
  const padding = /\[@media\(pointer:coarse\)\]:\[padding:(-?\d+px(?:_-?\d+px){3})\]/.exec(buttonClasses)?.[1];
  assert.ok(margin && padding, 'a coarse-pointer margin and padding');
  const [mt, mr, mb, ml] = sides(margin);
  const [pt, pr, pb, pl] = sides(padding);
  assert.deepEqual([pt, pr, pb, pl], [-mt, -mr, -mb, -ml], 'the margin undoes the padding exactly');
  assert.ok(GLYPH + pl + pr >= 44 && GLYPH + pt + pb >= 44, `${GLYPH + pl + pr} x ${GLYPH + pt + pb}`);
  assert.ok(pl <= 4, 'the label before the (i) keeps every press on its text (FormField: label, then 4px, then the (i))');
});

test('the wrapper is not positioned, so a neighbouring control or a label is drawn over the extra press area; the hidden words have a box of their own', () => {
  const wrapper = /<span className=\{`([^`]*)\$\{className\}`\}>/.exec(source)?.[1] ?? '';
  assert.ok(wrapper.includes('inline-flex'));
  assert.ok(!/(^|\s)(relative|absolute|fixed|sticky)(\s|$)/.test(wrapper), `wrapper: ${wrapper}`);
  assert.match(source, /<span className="relative"><span id=\{id\} className="sr-only">\{text\}<\/span><\/span>/);   // else a long page gets a scrollbar of its own
});

test('the controls a FormField puts under its label are positioned boxes, so they are drawn over the (i)\'s extra press area', () => {
  for (const file of ['TextInput.tsx', 'Select.tsx', 'Textarea.tsx']) {
    const control = readFileSync(`src/components/ui/ds/${file}`, 'utf8');
    assert.match(control, /<div className=\{clsx\('relative', className\)\}>/, file);
  }
});

test('it is still a labelled button that describes itself, opens on hover, focus and press, and stops the press from reaching a clickable parent', () => {
  for (const part of ['type="button"', 'aria-label={label}', 'aria-describedby={id}', 'onMouseEnter={show}', 'onFocus={show}', 'e.stopPropagation()']) {
    assert.ok(source.includes(part), part);
  }
  assert.match(source, /role="tooltip"/);
  assert.match(source, /createPortal\(/);
});
