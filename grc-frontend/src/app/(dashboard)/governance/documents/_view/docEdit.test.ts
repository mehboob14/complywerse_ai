// Run from this folder: node --test docEdit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { editState, type EditInput } from './docEdit.ts';

const ok: EditInput = { mayChange: true, openable: true, archived: false };

test('a document the person may open: Edit, pressable, no reason, and the tooltip says where it goes', () => {
  assert.deepEqual(editState(ok), { label: 'Edit', disabled: false, why: null, title: 'Edit in Comply AI Studio' });
});

test('an unsaved draft says "Continue editing" and its tooltip names the draft, when it was made and whether the document moved on', () => {
  const draft = { unsaved: true, updated_at: '2026-11-01T10:00:00', behind: true };
  const s = editState({ ...ok, draft, ago: () => '5 min ago' });
  assert.equal(s.label, 'Continue editing');
  assert.equal(s.title, 'Your draft, 5 min ago · the document has changed since');
  assert.equal(editState({ ...ok, draft: { unsaved: false } }).title, 'Your draft');
  assert.equal(editState({ ...ok, draft: { unsaved: false }, ago: () => 'x' }).title, 'Your draft');       // no time: nothing to say
});

test('when it cannot be pressed the reason is the server\'s sentence, else the archive sentence, else a plain one', () => {
  assert.deepEqual(editState({ ...ok, mayChange: false, archived: true }), {
    label: 'Edit', disabled: true, why: 'This document is archived. Restore it to change it.', title: 'This document is archived. Restore it to change it.',
  });
  assert.equal(editState({ ...ok, openable: false, reason: 'It is a scanned PDF with no text to edit.' }).why, 'It is a scanned PDF with no text to edit.');
  assert.equal(editState({ ...ok, openable: false, reason: '   ', archived: false }).why, 'This document cannot be opened for editing right now.');
  assert.equal(editState({ ...ok, openable: undefined }).disabled, true);              // not known yet: not pressable
  assert.equal(editState({ ...ok, mayChange: false, reason: 'Someone else is editing.', archived: true }).why, 'Someone else is editing.');     // the server's words win
});
