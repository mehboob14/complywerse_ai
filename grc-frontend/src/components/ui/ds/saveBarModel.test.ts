// node --test "src/components/ui/ds/saveBarModel.test.ts"
// What the save bar says and offers, in every state a form can be in. The sentences are the ones the Governance settings page always showed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SAVE_BAR_WORDS, saveBarState, type SaveBarInput } from './saveBarModel.ts';

const quiet: SaveBarInput = { canEdit: true, dirty: false, invalid: false, saving: false, justSaved: false, error: null };
const bar = (over: Partial<SaveBarInput>) => saveBarState({ ...quiet, ...over });

test('nothing to say, nothing shown', () => {
  assert.equal(bar({}).show, false);
  assert.equal(bar({ error: '   ' }).show, false);              // a blank refusal is no refusal
  assert.deepEqual(bar({ invalid: true }).show, false);          // a wrong field alone says nothing until something changed
});

test('a person who cannot change the form never sees the bar, whatever its state', () => {
  for (const over of [{ dirty: true }, { justSaved: true }, { error: 'No.' }, { dirty: true, invalid: true, saving: true }]) {
    assert.equal(bar({ canEdit: false, ...over }).show, false, JSON.stringify(over));
  }
});

test('unsaved changes: the words, both buttons, Save pressable', () => {
  assert.deepEqual(bar({ dirty: true }), {
    show: true, tone: 'neutral', text: 'Unsaved changes', actions: true, discardDisabled: false, saveDisabled: false, saveBusy: false,
  });
});

test('a wrong field is said in red and Save is not offered; Discard still is', () => {
  const s = bar({ dirty: true, invalid: true });
  assert.equal(s.text, 'Fix the fields in red to save');
  assert.equal(s.tone, 'danger');
  assert.equal(s.saveDisabled, true);
  assert.equal(s.discardDisabled, false);
});

test('while saving Save is busy (not disabled, so focus stays on it) and Discard waits', () => {
  const s = bar({ dirty: true, saving: true });
  assert.equal(s.saveBusy, true);
  assert.equal(s.saveDisabled, false);
  assert.equal(s.discardDisabled, true);
  assert.equal(s.text, 'Unsaved changes');                       // the words do not change while the request is out
});

test('a refusal outranks everything and is shown as the server said it', () => {
  const s = bar({ dirty: true, invalid: true, error: '  Only an administrator can change this.  ' });
  assert.equal(s.text, 'Only an administrator can change this.');
  assert.equal(s.tone, 'danger');
  assert.equal(s.actions, true);                                 // the changes are still there: Discard and Save (when fixed) stay
});

test('the confirmation shows after a save, with no buttons, and gives way to a new edit', () => {
  assert.deepEqual(bar({ justSaved: true }), {
    show: true, tone: 'success', text: 'Saved', actions: false, discardDisabled: false, saveDisabled: false, saveBusy: false,
  });
  assert.equal(bar({ justSaved: true, dirty: true }).text, 'Unsaved changes');
});

test('the words are the platform\'s', () => {
  assert.deepEqual(SAVE_BAR_WORDS, { unsaved: 'Unsaved changes', invalid: 'Fix the fields in red to save', saved: 'Saved' });
});
