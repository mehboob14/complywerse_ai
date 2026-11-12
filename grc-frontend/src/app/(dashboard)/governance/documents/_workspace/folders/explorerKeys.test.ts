// node --test "src/app/(dashboard)/governance/documents/_workspace/folders/explorerKeys.test.ts"
// The keyboard of the Directory: the Explorer shortcuts (and only them: no Ctrl, Meta or Shift combination), how the arrows move the selection in a grid and in a list, and a letter
// jumping to the next name.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { explorerShortcut, typeAhead } from './explorerKeys.ts';

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
