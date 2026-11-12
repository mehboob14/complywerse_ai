// node --test "src/app/(dashboard)/governance/documents/directory/explorerKeys.test.ts"
// The keyboard of the Directory: the Explorer shortcuts (and only them: no Ctrl, Meta or Shift combination), how the arrows move the selection in a grid and in a list, and a letter
// jumping to the next name.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { explorerShortcut, moveSelection, typeAhead } from './explorerKeys.ts';

test('the shortcuts: Backspace and Alt+Left go back, Alt+Right forward, Alt+Up up, Enter opens, Alt+Enter is Properties, F2 edits the details, Delete deactivates', () => {
  assert.equal(explorerShortcut({ key: 'Backspace' }), 'back');
  assert.equal(explorerShortcut({ key: 'ArrowLeft', altKey: true }), 'back');
  assert.equal(explorerShortcut({ key: 'ArrowRight', altKey: true }), 'forward');
  assert.equal(explorerShortcut({ key: 'ArrowUp', altKey: true }), 'up');
  assert.equal(explorerShortcut({ key: 'Enter' }), 'open');
  assert.equal(explorerShortcut({ key: 'Enter', altKey: true }), 'properties');
  assert.equal(explorerShortcut({ key: 'F2' }), 'rename');
  assert.equal(explorerShortcut({ key: 'Delete' }), 'deactivate');
});

test('every other key, and every Ctrl, Meta or Shift combination, is not a shortcut', () => {
  for (const key of ['a', 'Escape', 'Tab', ' ', 'ArrowLeft', 'ArrowDown', 'Home', 'F1', 'F5']) assert.equal(explorerShortcut({ key }), null, key);
  for (const mod of ['ctrlKey', 'metaKey', 'shiftKey'] as const) {
    for (const key of ['Backspace', 'Enter', 'F2', 'Delete']) assert.equal(explorerShortcut({ key, [mod]: true }), null, `${mod}+${key}`);
    assert.equal(explorerShortcut({ key: 'ArrowLeft', altKey: true, [mod]: true }), null, `Alt+${mod}+Left`);
  }
  assert.equal(explorerShortcut({ key: 'ArrowDown', altKey: true }), null, 'Alt+Down is not Up');
  assert.equal(explorerShortcut({ key: 'Backspace', altKey: true }), null);
});

test('in a list (one column) Up and Down move one, Home and End go to the ends, Left and Right do nothing', () => {
  assert.equal(moveSelection(5, 2, 'ArrowDown', 1), 3);
  assert.equal(moveSelection(5, 2, 'ArrowUp', 1), 1);
  assert.equal(moveSelection(5, 4, 'ArrowDown', 1), null, 'the last one');
  assert.equal(moveSelection(5, 0, 'ArrowUp', 1), null, 'the first one');
  assert.equal(moveSelection(5, 2, 'Home', 1), 0);
  assert.equal(moveSelection(5, 2, 'End', 1), 4);
  assert.equal(moveSelection(5, 0, 'Home', 1), null);
  assert.equal(moveSelection(5, 4, 'End', 1), null);
  assert.equal(moveSelection(5, 2, 'ArrowLeft', 1), null);
  assert.equal(moveSelection(5, 2, 'ArrowRight', 1), null);
});

test('in a grid Left and Right move one, Up and Down a whole row; a short last row is reached by its last item', () => {
  // 3 columns, 8 items: rows [0 1 2] [3 4 5] [6 7]
  assert.equal(moveSelection(8, 1, 'ArrowRight', 3), 2);
  assert.equal(moveSelection(8, 3, 'ArrowLeft', 3), 2, 'Left from the start of a row goes to the end of the one above, as reading order');
  assert.equal(moveSelection(8, 0, 'ArrowLeft', 3), null);
  assert.equal(moveSelection(8, 7, 'ArrowRight', 3), null);
  assert.equal(moveSelection(8, 1, 'ArrowDown', 3), 4);
  assert.equal(moveSelection(8, 4, 'ArrowUp', 3), 1);
  assert.equal(moveSelection(8, 1, 'ArrowUp', 3), null, 'the first row');
  assert.equal(moveSelection(8, 5, 'ArrowDown', 3), 7, 'below it is a short row: its last item');
  assert.equal(moveSelection(8, 7, 'ArrowDown', 3), null);
  assert.equal(moveSelection(8, 6, 'ArrowDown', 3), null);
  assert.equal(moveSelection(8, 4, 'End', 3), 7);
});

test('with nothing selected the first key goes to the first item (End to the last); nothing to move among is no move', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home']) assert.equal(moveSelection(4, -1, key, 2), 0, key);
  assert.equal(moveSelection(4, -1, 'End', 2), 3);
  assert.equal(moveSelection(4, -1, 'x', 2), null);
  assert.equal(moveSelection(0, -1, 'ArrowDown', 2), null);
  assert.equal(moveSelection(1, 0, 'ArrowDown', 1), null);
  assert.equal(moveSelection(4, 1, 'ArrowDown', 0), 2, 'a column count under 1 is a list');
  assert.equal(moveSelection(4, 1, 'PageDown', 1), null, 'only the arrows, Home and End');
});

test('a letter goes to the next name that starts with it, after the selected one, round the list; one name that is the selected one is no move', () => {
  const names = ['Finance', 'Human Resources', 'Information Security', 'Legal', 'Operations', 'Finance Ops'];
  assert.equal(typeAhead(names, -1, 'f'), 0);
  assert.equal(typeAhead(names, 0, 'F'), 5, 'the next one that starts with it');
  assert.equal(typeAhead(names, 5, 'f'), 0, 'wraps round');
  assert.equal(typeAhead(names, 2, 'o'), 4);
  assert.equal(typeAhead(names, 3, 'l'), null, 'only the selected one starts with it');
  assert.equal(typeAhead(names, 0, 'z'), null);
  assert.equal(typeAhead(names, 0, ' '), null);
  assert.equal(typeAhead(names, 0, 'Enter'), null);
  assert.equal(typeAhead(names, 0, '/'), null);
  assert.equal(typeAhead([], -1, 'a'), null);
  assert.equal(typeAhead(['  Padded'], -1, 'p'), 0, 'leading space does not hide a name');
  assert.equal(typeAhead(['Étude', 'Zed'], -1, 'é'), 0);
});
