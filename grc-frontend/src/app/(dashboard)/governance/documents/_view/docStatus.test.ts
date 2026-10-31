// Run from this folder (node --test reads [id] in a path as a glob): node --test docStatus.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DOC_STATUS_WORDS, docStatusPill, docStatusWord } from './docStatus.ts';
import { documentStatus } from '../../../../../lib/status.ts';

test('the seven statuses the page named keep the words it always showed', () => {
  assert.deepEqual({ ...DOC_STATUS_WORDS }, {
    draft: 'Draft', pending_review: 'In review', pending_approval: 'Awaiting approval', approved: 'Approved', published: 'Published', expired: 'Expired', archived: 'Archived',
  });
  for (const [status, word] of Object.entries(DOC_STATUS_WORDS)) assert.equal(docStatusWord(status), word, status);
});

test('a status nobody named reads as a sentence, never as the raw word', () => {
  assert.equal(docStatusWord('exception_applied'), 'Exception applied');
  assert.equal(docStatusWord('review_required'), 'Review required');
  assert.equal(docStatusWord('in-remediation'), 'In remediation');
  assert.equal(docStatusWord('PUBLISHED'), 'Published');                       // spelling of the case does not matter
  assert.equal(docStatusWord('  draft '), 'Draft');
});

test('no status is ever a blank pill: the dash stands for none', () => {
  for (const none of [null, undefined, '', '   ']) assert.equal(docStatusWord(none), '—', String(none));
  assert.equal(docStatusPill(null).tone, 'neutral');
});

test('a word that is a property of Object is just another unknown word', () => {
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.doesNotThrow(() => docStatusWord(key), key);
    assert.equal(typeof docStatusWord(key), 'string', key);
  }
  assert.equal(docStatusWord('constructor'), 'Constructor');
});

test('the tone is the registry\'s for every status the registry knows, and the word is never empty', () => {
  for (const status of documentStatus.words) {
    const pill = docStatusPill(status);
    assert.equal(pill.tone, documentStatus.tone(status), status);
    assert.ok(pill.label.trim().length > 0, status);
  }
  assert.equal(docStatusPill('pending_approval').label, 'Awaiting approval');          // the library says "In approval": the page keeps its own word
  assert.equal(documentStatus.label('pending_approval'), 'In approval');
  assert.equal(docStatusPill('published').tone, 'success');
  assert.equal(docStatusPill('expired').tone, 'danger');
});
