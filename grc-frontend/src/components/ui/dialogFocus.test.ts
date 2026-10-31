// node --test src/components/ui/dialogFocus.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AUTOFOCUS, FIELD, TABBABLE, closeAction, focusIsElsewhere, initialFocusTarget, nextFocusIndex, overlayTakesEscape, visibleOnly } from './dialogFocus.ts';

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

// One Escape closes one layer. Two overlays stacked (a preview over a drawer, a drawer over a dialog) both listen on the document, so the lower one must
// leave a press alone while focus is in the layer drawn over it; before this, only an overlay holding typed input (`dirty`) did, and one press closed both.
test('an overlay takes an Escape that nobody handled while focus is in it or nowhere', () => {
  assert.equal(overlayTakesEscape({ key: 'Escape', defaultPrevented: false, focusElsewhere: false }), true);
});

test('an overlay with a layer drawn over it (focus in a menu, a preview, another drawer) leaves the Escape to that layer, typed input or not', () => {
  assert.equal(overlayTakesEscape({ key: 'Escape', defaultPrevented: false, focusElsewhere: true }), false);
});

test('an Escape that a list or the top overlay already handled (defaultPrevented) is nobody else\'s, whichever order the listeners run in', () => {
  assert.equal(overlayTakesEscape({ key: 'Escape', defaultPrevented: true, focusElsewhere: false }), false);
  assert.equal(overlayTakesEscape({ key: 'Escape', defaultPrevented: true, focusElsewhere: true }), false);
});

test('only Escape is Escape', () => {
  for (const key of ['Enter', 'Tab', ' ', 'Esc', 'escape', 'ArrowDown', '']) assert.equal(overlayTakesEscape({ key, defaultPrevented: false, focusElsewhere: false }), false, JSON.stringify(key));
});

test('a stack of two: the press goes to the top layer only, in either order of the two listeners', () => {
  // the top layer (preview) holds focus; the lower (drawer) sees focus elsewhere. Whichever listener runs first, exactly one takes it.
  const listeners = {
    preview: (e: { defaultPrevented: boolean }) => overlayTakesEscape({ key: 'Escape', defaultPrevented: e.defaultPrevented, focusElsewhere: false }),
    drawer: (e: { defaultPrevented: boolean }) => overlayTakesEscape({ key: 'Escape', defaultPrevented: e.defaultPrevented, focusElsewhere: true }),
  };
  for (const order of [['preview', 'drawer'], ['drawer', 'preview']] as const) {
    const event = { defaultPrevented: false };
    const taken: string[] = [];
    for (const name of order) if (listeners[name](event)) { taken.push(name); event.defaultPrevented = true; }              // the one that takes it marks it handled
    assert.deepEqual(taken, ['preview'], order.join(' then '));
  }
  // and when focus has already moved back into the drawer before its listener runs (the preview closed first), the mark is what keeps the drawer shut
  const event = { defaultPrevented: false };
  assert.equal(listeners.preview(event), true);
  event.defaultPrevented = true;
  assert.equal(overlayTakesEscape({ key: 'Escape', defaultPrevented: event.defaultPrevented, focusElsewhere: false }), false);
});

test('the first focus: a marked element, else a field, else a button, else the dialog', () => {
  const dialog = 'dialog';
  assert.equal(initialFocusTarget({ autofocus: ['mark'], fields: ['f1'], buttons: ['b1'] }, dialog), 'mark');
  assert.equal(initialFocusTarget({ autofocus: [], fields: ['f1', 'f2'], buttons: ['b1'] }, dialog), 'f1');
  assert.equal(initialFocusTarget({ autofocus: [], fields: [], buttons: ['close', 'b2'] }, dialog), 'close');
  assert.equal(initialFocusTarget({ autofocus: [], fields: [], buttons: [] }, dialog), 'dialog');
});

test('on a touch screen no field or button takes focus (the keyboard would cover the dialog): a marked element, else the dialog', () => {
  const dialog = 'dialog';
  assert.equal(initialFocusTarget({ autofocus: ['mark'], fields: ['f1'], buttons: ['b1'] }, dialog, true), 'mark');
  assert.equal(initialFocusTarget({ autofocus: [], fields: ['f1'], buttons: ['b1'] }, dialog, true), 'dialog');
  assert.equal(initialFocusTarget({ autofocus: [], fields: ['f1'], buttons: ['b1'] }, dialog, false), 'f1');
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
    assert.match(src, /lockBodyScroll\(\)/, `${name} locks the page scroll through the shared lock`);
    assert.doesNotMatch(src, /body\.style\.overflow/, `${name} keeps no scroll lock of its own`);
  }
  const vendor = readFileSync('src/app/(dashboard)/vendor-risk/_ui/Dialog.tsx', 'utf8');
  assert.match(vendor, /labelledBy=/, 'the vendor Dialog names itself through AnimatedModal');
  assert.doesNotMatch(vendor, /addEventListener|TABBABLE|querySelector/, 'no trap or focus code of its own');
});

// Source-text pin: the Escape handler of BOTH overlays is the same decision, with no `dirty &&` in front of the focus guard (that was the gap), and it marks the
// press handled when it takes it, so an overlay under it that listens later in the same keydown leaves it alone.
test('both overlays apply the focus guard to every Escape, dirty or not, and mark the press taken', () => {
  for (const name of ['AnimatedModal', 'RightSlidePanel']) {
    const src = readFileSync(`src/components/ui/${name}.tsx`, 'utf8').replace(/\r\n/g, '\n');
    assert.match(src, /import \{ focusIsElsewhere, overlayTakesEscape \} from '\.\/dialogFocus';/, `${name} imports the decision`);
    assert.match(src, /overlayTakesEscape\(\{ key: e\.key, defaultPrevented: e\.defaultPrevented, focusElsewhere: elsewhere \}\)/, `${name} asks it`);
    assert.match(src, /focusIsElsewhere\((?:dialogRef|panelRef)\.current, document\.activeElement, document\.body\)/, `${name} measures where focus is`);
    assert.doesNotMatch(src, /dirty && (?:dialogRef|panelRef)\.current && focusIsElsewhere/, `${name}: the guard is no longer only for a dirty overlay`);
    assert.match(src, /if \(!overlayTakesEscape\([^\n]*\)\) return;\n\s*e\.preventDefault\(\);[^\n]*\n\s*requestClose\('escape'\);/, `${name} marks the press taken before it closes`);
  }
});
