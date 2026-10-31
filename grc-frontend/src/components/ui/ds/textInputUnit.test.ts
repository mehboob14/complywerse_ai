// node --test "src/components/ui/ds/textInputUnit.test.ts"
// TextInput's `unit` (a word after the value, inside the box): the room the box keeps for it (pure, fieldStyles.ts), how the unit is read out with the
// field (pure, fieldA11y.ts) and what the component must keep doing (source text, like controls.test.ts; the look was checked in a browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from './kitRules.ts';
import { controlA11y, describedBy } from './fieldA11y.ts';
import { UNIT_GAP, unitReserve } from './fieldStyles.ts';

const source = readFileSync('src/components/ui/ds/TextInput.tsx', 'utf8').replace(/\r\n/g, '\n');

// ── the room for the unit ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the box keeps the usual 12px, the unit\'s measured width and a 6px gap to the right of the text', () => {
  assert.equal(UNIT_GAP, 6);
  assert.equal(unitReserve('days', 32), 'calc(12px + 32px + 6px)');
  assert.equal(unitReserve('days before due', 106), 'calc(12px + 106px + 6px)');
});

test('a width with a fraction is rounded up, so the text can never touch the unit', () => {
  assert.equal(unitReserve('days', 31.6875), 'calc(12px + 32px + 6px)');
  assert.equal(unitReserve('days', 31.01), 'calc(12px + 32px + 6px)');
});

test('until the unit has been measured (first render, the server\'s HTML, a hidden tab) one "0" per character is reserved', () => {
  assert.equal(unitReserve('days', null), 'calc(12px + 4ch + 6px)');
  assert.equal(unitReserve('days late', 0), 'calc(12px + 9ch + 6px)');
  assert.equal(unitReserve('days before due', null), 'calc(12px + 15ch + 6px)');
});

test('next to a right adornment the unit sits left of it, so the room starts 32px from the edge', () => {
  assert.equal(unitReserve('MB', 24, 32), 'calc(32px + 24px + 6px)');
});

test('the room is a valid length the kit guard accepts', () => {
  for (const value of [unitReserve('days', null), unitReserve('days', 31.5), unitReserve('MB', 24, 32)]) {
    assert.match(value, /^calc\(\d+px \+ (\d+px|\d+ch) \+ 6px\)$/);
    assert.deepEqual(findViolations(`<x style={{ paddingRight: '${value}' }} />`), []);
  }
});

// ── read out with the field ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the unit is described first, then the field\'s hint and error, then the page\'s own ids', () => {
  const field = { id: 'f', describedBy: describedBy('f-hint', 'f-error'), invalid: true, required: false };
  const merged = controlA11y(field, { 'aria-describedby': 'own' })['aria-describedby'];
  assert.equal(merged, 'f-hint f-error own');
  assert.equal(describedBy('f-unit', merged), 'f-unit f-hint f-error own');
  assert.equal(describedBy('f-unit', controlA11y(null, {})['aria-describedby']), 'f-unit');          // a field with nothing else to say
});

// ── what the component keeps doing ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the unit is drawn over the right padding: it takes no clicks, is hidden from the reader (it is read as the description) and dims with a disabled field', () => {
  const unit = /<span ref=\{unitEl\}[\s\S]*?<\/span>/.exec(source)?.[0] ?? '';
  for (const part of ['aria-hidden="true"', 'id={unitId}', 'pointer-events-none', 'absolute inset-y-0', 'whitespace-nowrap', 'text-ds-body text-ds-fg-muted', 'peer-disabled:opacity-50']) {
    assert.ok(unit.includes(part), part);
  }
  assert.match(source, /unit && 'peer'/);                                          // peer-disabled needs the input to be the peer
});

test('the input is described by the unit first and reserves its room from the measured width, merged with a style the page gave', () => {
  assert.match(source, /aria-describedby=\{unit \? describedBy\(unitId, a11y\['aria-describedby'\]\) : a11y\['aria-describedby'\]\}/);
  assert.match(source, /style=\{unit \? \{ \.\.\.rest\.style, paddingRight: unitReserve\(unit, unitWidth, edge\) \} : rest\.style\}/);
  assert.ok(source.indexOf('{...rest}') < source.indexOf('{...a11y}'), 'the field\'s wiring still comes after the caller\'s props');
});

test('digits are right-aligned and tabular next to a unit, and the spin arrows (which would sit on the unit) are hidden; a number without a unit is left as it was', () => {
  assert.match(source, /const NUMBER_WITH_UNIT = 'text-right tabular-nums \[appearance:textfield\] \[&::-webkit-inner-spin-button\]:appearance-none \[&::-webkit-outer-spin-button\]:appearance-none'/);
  assert.match(source, /unit && rest\.type === 'number' && NUMBER_WITH_UNIT/);
});

test('the unit is measured before the first paint and again when it changes size, on the layout width a transform does not change', () => {
  assert.match(source, /typeof window === 'undefined' \? useEffect : useLayoutEffect/);                // no server-side warning
  assert.match(source, /setUnitWidth\(el\.offsetWidth\)/);
  assert.match(source, /new ResizeObserver\(/);
  assert.match(source, /contentBoxSize\?\.\[0\]\?\.inlineSize/);
  assert.match(source, /observer\.disconnect\(\)/);
  assert.doesNotMatch(source, /getBoundingClientRect/);                                              // that one is scaled by a transform
});

test('without a unit the field is exactly what it was: the same classes, the caller\'s style and describedby', () => {
  assert.match(source, /fieldClasses\(a11y\['aria-invalid'\] === true\), READ_ONLY, 'h-ds-control', leftAdornment \? 'pl-\[32px\]' : 'pl-\[12px\]', rightAdornment \? 'pr-\[32px\]' : 'pr-\[12px\]'/);
  assert.match(source, /: a11y\['aria-describedby'\]\}/);
  assert.match(source, /: rest\.style\}/);
});
