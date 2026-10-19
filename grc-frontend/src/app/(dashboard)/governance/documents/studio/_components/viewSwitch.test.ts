import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choose, fileNote, opensOnFile, pressedKey, switchButtons, viewShows } from './viewSwitch.ts';

const word = { kind: 'docx', in_place: true };
const pdf = { kind: 'pdf', in_place: false };
const none = { kind: null, in_place: false };

test('the file view tells a reader it is the document as its file shows it, with no Edit to point to', () => {
  assert.equal(fileNote(word, false), 'The document as its Word file shows it, as Word lays it out.');
  assert.equal(fileNote(pdf, false), 'The document as its PDF shows it, as it was uploaded.');
  for (const s of [word, pdf]) assert.doesNotMatch(fileNote(s, false), /Edit|your changes|saving/);
  assert.match(fileNote(word, true), /Make changes in Edit/);
  assert.match(fileNote(pdf, true), /saving makes a Word copy/);
});

test('the switch is Edit and View, and only View for someone who may not save', () => {
  for (const s of [word, pdf, none, null]) {
    assert.deepEqual(switchButtons(s, true).map((b) => b.label), ['Edit', 'View']);
    assert.deepEqual(switchButtons(s, false).map((b) => b.label), ['View']);
  }
  assert.match(switchButtons(word, true)[1].title, /Word lays it out/);
  assert.match(switchButtons(pdf, false)[0].title, /PDF as it was uploaded/);
});

test('View is the file when there is one, else the text read-only', () => {
  assert.equal(viewShows(word), 'word');
  assert.equal(viewShows(pdf), 'pdf');
  assert.equal(viewShows(none), 'text');
  assert.equal(viewShows(undefined), 'text');
  assert.deepEqual(choose('view', word, 'edit'), { mode: 'edit', asFile: true });     // the editor keeps its mode under the file
  assert.deepEqual(choose('view', pdf, 'edit'), { mode: 'edit', asFile: true });
  assert.deepEqual(choose('view', none, 'edit'), { mode: 'view', asFile: false });
  assert.deepEqual(choose('edit', word, 'edit'), { mode: 'edit', asFile: false });
  assert.deepEqual(choose('edit', none, 'view'), { mode: 'edit', asFile: false });
});

test('a Word file opens on the file; a PDF does only for someone who may not save', () => {
  assert.equal(opensOnFile(word, true), true);
  assert.equal(opensOnFile(word, false), true);
  assert.equal(opensOnFile(pdf, true), false);
  assert.equal(opensOnFile(pdf, false), true);
  assert.equal(opensOnFile(none, false), false);
});

test('the lit button follows what is on screen', () => {
  assert.equal(pressedKey(word, 'edit', true), 'view');
  assert.equal(pressedKey(word, 'edit', false), 'edit');
  assert.equal(pressedKey(none, 'view', false), 'view');
  assert.equal(pressedKey(none, 'edit', false), 'edit');
  assert.equal(pressedKey(none, 'source', false), 'edit');
  assert.equal(pressedKey(pdf, 'view', false), null);          // the text brought into view over a file for a reader: neither
});
