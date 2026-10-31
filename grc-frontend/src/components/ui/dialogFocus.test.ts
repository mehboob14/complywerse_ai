// node --test src/components/ui/dialogFocus.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AUTOFOCUS, FIELD, TABBABLE, closeAction, focusIsElsewhere, initialFocusTarget, nextFocusIndex, visibleOnly } from './dialogFocus.ts';

test('Tab wraps from the last item to the first and Shift+Tab from the first to the last; in between the browser moves focus', () => {
  assert.equal(nextFocusIndex(4, 3, false), 0);
  assert.equal(nextFocusIndex(4, 0, true), 3);
  for (const i of [0, 1, 2]) assert.equal(nextFocusIndex(4, i, false), null, `Tab on ${i}`);
  for (const i of [1, 2, 3]) assert.equal(nextFocusIndex(4, i, true), null, `Shift+Tab on ${i}`);
});

test('focus on none of the items (the dialog itself, <body>) goes to an end', () => {
  assert.equal(nextFocusIndex(4, -1, false), 0);
  assert.equal(nextFocusIndex(4, -1, true), 3);
});

test('a dialog with one tabbable item keeps focus on it', () => {
  assert.equal(nextFocusIndex(1, 0, false), 0);
  assert.equal(nextFocusIndex(1, 0, true), 0);
});

test('only what is on screen is a tab stop', () => {
  const shown = { name: 'shown', getClientRects: () => [{}] };
  const hidden = { name: 'hidden', getClientRects: () => [] };
  assert.deepEqual(visibleOnly([shown, hidden, shown]).map((e) => e.name), ['shown', 'shown']);
  assert.deepEqual(visibleOnly(new Set([hidden])), []);
});

test('focus is elsewhere only when it is on something outside the dialog that is not <body>', () => {
  const inside = {};
  const outside = {};
  const body = {};
  const dialog = { contains: (n: unknown) => n === inside };
  assert.equal(focusIsElsewhere(dialog, inside, body), false);
  assert.equal(focusIsElsewhere(dialog, outside, body), true);        // a menu or a dialog drawn over this one
  assert.equal(focusIsElsewhere(dialog, body, body), false);
  assert.equal(focusIsElsewhere(dialog, null, body), false);
});

test('the first focus: a marked element, else a field, else a button, else the dialog', () => {
  const dialog = 'dialog';
  assert.equal(initialFocusTarget({ autofocus: ['mark'], fields: ['f1'], buttons: ['b1'] }, dialog), 'mark');
  assert.equal(initialFocusTarget({ autofocus: [], fields: ['f1', 'f2'], buttons: ['b1'] }, dialog), 'f1');
  assert.equal(initialFocusTarget({ autofocus: [], fields: [], buttons: ['close', 'b2'] }, dialog), 'close');
  assert.equal(initialFocusTarget({ autofocus: [], fields: [], buttons: [] }, dialog), 'dialog');
});

test('the selectors name what they should', () => {
  for (const part of ['a[href]', 'button:not(:disabled)', 'textarea:not(:disabled)', '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]']) {
    assert.ok(TABBABLE.includes(part), `TABBABLE has ${part}`);
  }
  assert.ok(FIELD.includes('input:not([type="hidden"])') && !FIELD.includes('button'), 'FIELD: inputs, selects, textareas, editors; no buttons');
  assert.equal(AUTOFOCUS, '[data-autofocus]:not(:disabled)');
});

const off = { dirty: false, asking: false, closeOnBackdrop: true };
const dirty = { dirty: true, asking: false, closeOnBackdrop: true };

test('without typed input Escape, X and the backdrop close, as these dialogs always did', () => {
  for (const source of ['escape', 'close-button', 'backdrop'] as const) assert.equal(closeAction(off, source), 'close', source);
});

test('with typed input nothing closes by itself: Escape, X and the backdrop ask first', () => {
  for (const source of ['escape', 'close-button', 'backdrop'] as const) assert.equal(closeAction(dirty, source), 'ask', source);
});

test('Escape on the "Discard changes?" bar means keep editing; X or the backdrop again leave the bar up', () => {
  const asking = { ...dirty, asking: true };
  assert.equal(closeAction(asking, 'escape'), 'keep');
  assert.equal(closeAction(asking, 'close-button'), 'ask');
  assert.equal(closeAction(asking, 'backdrop'), 'ask');
});

test('closeOnBackdrop false makes the backdrop inert, with or without typed input; Escape and X still work', () => {
  const inert = { ...off, closeOnBackdrop: false };
  assert.equal(closeAction(inert, 'backdrop'), 'ignore');
  assert.equal(closeAction({ ...inert, dirty: true }, 'backdrop'), 'ignore');
  assert.equal(closeAction(inert, 'escape'), 'close');
  assert.equal(closeAction(inert, 'close-button'), 'close');
  assert.equal(closeAction({ ...inert, dirty: true }, 'escape'), 'ask');
});

// Source-text guard (like kitGuard.test.ts): the focus work lives in the two shared overlays, once, and the vendor Dialog stays slim.
test('both overlays use the shared focus hook and the discard guard and name themselves; the vendor Dialog keeps no trap of its own', () => {
  for (const name of ['AnimatedModal', 'RightSlidePanel']) {
    const src = readFileSync(`src/components/ui/${name}.tsx`, 'utf8');
    assert.match(src, /useDialogFocus\(/, `${name} uses useDialogFocus`);
    assert.match(src, /useDiscardGuard\(/, `${name} uses useDiscardGuard`);
    assert.match(src, /aria-labelledby=/, `${name} names itself`);
  }
  const vendor = readFileSync('src/app/(dashboard)/vendor-risk/_ui/Dialog.tsx', 'utf8');
  assert.match(vendor, /labelledBy=/, 'the vendor Dialog names itself through AnimatedModal');
  assert.doesNotMatch(vendor, /addEventListener|TABBABLE|querySelector/, 'no trap or focus code of its own');
});
