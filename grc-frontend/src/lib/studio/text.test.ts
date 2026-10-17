import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, plural, saveWarning, savedNote } from './text.ts';

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
});
