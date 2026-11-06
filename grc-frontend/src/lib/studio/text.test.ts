import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptedLine, maySaveToLibrary, nextVersion, num, plural, saveWarning, savedNote } from './text.ts';

test('nothing is saved to the library from an archived document, nor by someone who may only read it', () => {
  assert.equal(maySaveToLibrary({ may_save: true, document_status: 'draft' }), true);
  assert.equal(maySaveToLibrary({}), true);
  assert.equal(maySaveToLibrary({ may_save: false, document_status: 'draft' }), false);
  assert.equal(maySaveToLibrary({ may_save: true, document_status: 'archived' }), false);
});

test('an accept stays in the studio: a library document has it only once it is saved to the library', () => {
  assert.equal(acceptedLine(2, true), '2 changes accepted here in the studio; the library is not changed until you save to it.');
  assert.equal(acceptedLine(1, false), '1 change accepted and written into the document.');    // not in the library yet
});

test('the minor and the major version a save makes, numbered as the server numbers them', () => {
  assert.deepEqual([nextVersion('1.1', 'minor'), nextVersion('1.2', 'major')], ['1.2', '2.0']);     // the user's 1.2, then 2.0
  assert.deepEqual([nextVersion('1.9', 'minor'), nextVersion('1.9', 'major')], ['1.10', '2.0']);    // 1.10 follows 1.9
  assert.deepEqual([nextVersion('4.0', 'minor'), nextVersion('4.0', 'major')], ['4.1', '5.0']);     // a file that starts at 4.0
  assert.deepEqual([nextVersion('2.0.1', 'minor'), nextVersion('2.0.1', 'major')], ['2.1', '3.0']); // a patch number goes
  assert.deepEqual([nextVersion(null, 'minor'), nextVersion(undefined, 'major'), nextVersion('', 'minor')], ['1.1', '2.0', '1.1']);
  assert.deepEqual([nextVersion('7', 'minor'), nextVersion('7', 'major')], ['1.1', '2.0']);          // as the server: one part counts as 1.0
});

test('counts are written with a thousands separator', () => {
  assert.equal(plural(16278, 'word'), '16,278 words');
  assert.equal(plural(1, 'reference'), '1 reference');
  assert.equal(num(1096), '1,096');
  assert.equal(num(44), '44');
});

test('Save to the library warns by the document status, and says nothing for a draft', () => {
  assert.match(saveWarning('pending_review')!, /signs again from the start/);
  assert.equal(saveWarning('pending_approval'), saveWarning('pending_review'));
  assert.match(saveWarning('published')!, /back to review with the same reviewers and approvers/);
  assert.equal(saveWarning('approved'), saveWarning('published'));
  assert.equal(saveWarning('draft'), null);
  assert.equal(saveWarning(null), null);
  assert.match(saveWarning(undefined)!, /approved or published/);        // an older server: the general line
});

test('Save to the library says everyone else keeps reading the published version while this one is on its way', () => {
  const keeps = 'Everyone else keeps reading the published version v1.0 until this one is approved and published.';
  assert.equal(saveWarning('published', '1.0'), `${saveWarning('published')} ${keeps}`);
  assert.equal(saveWarning('pending_review', '1.0'), `${saveWarning('pending_review')} ${keeps}`);
  assert.equal(saveWarning('draft', '1.0'), keeps);                       // a draft after a rejection: v1.0 is still in force
  assert.equal(saveWarning('draft', null), null);                          // never published
  assert.equal(saveWarning('published', undefined), saveWarning('published'));
});

test('the toast after saving says the version, major or minor, and where the document went', () => {
  assert.deepEqual(savedNote({ version: '2.0', change: 'major', status: 'draft' }, 'draft'), { title: 'Saved as version 2.0 (major change)', message: undefined });
  assert.equal(savedNote({ version: '1.1', status: 'pending_review' }, 'published').title, 'Saved as version 1.1');
  assert.match(savedNote({ version: '1.1', change: 'minor', status: 'pending_review' }, 'pending_review').message!, /in review again/);
  assert.match(savedNote({ version: '1.1', status: 'pending_approval' }, 'pending_approval').message!, /waiting for approval/);
  assert.match(savedNote({ version: '1.1', status: 'draft' }, 'pending_review').message!, /a draft again/);
  assert.equal(savedNote({ version: '1.1', status: 'published' }, 'published').message, undefined);
  // every save is a version of its own, a draft too: never "saved in" a version that stays until it is published
  assert.deepEqual(savedNote({ version: '1.2', change: 'minor', status: 'draft' }, 'draft'), { title: 'Saved as version 1.2 (minor change)', message: undefined });
});
