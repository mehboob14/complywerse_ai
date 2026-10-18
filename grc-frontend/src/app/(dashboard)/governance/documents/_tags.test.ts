import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TAGS, MAX_TAG_LENGTH, addTags, cleanTag, leftOut, splitTags, tagSuggestions } from './_tags.ts';

test('a tag is trimmed, its inner spaces collapsed and cut to the longest a tag may be', () => {
  assert.equal(cleanTag('  ISO   27001 \t'), 'ISO 27001');
  assert.equal(cleanTag('   '), '');
  assert.equal(cleanTag('x'.repeat(MAX_TAG_LENGTH + 10)).length, MAX_TAG_LENGTH);
  assert.equal(cleanTag(`${'a'.repeat(MAX_TAG_LENGTH - 1)} b`), 'a'.repeat(MAX_TAG_LENGTH - 1));   // no trailing space after the cut
});

test('adding keeps each tag once whatever its case, skips empty ones and keeps the first spelling', () => {
  assert.deepEqual(addTags(['Privacy'], [' privacy ', 'ISO  27001', '', 'iso 27001', 'Access']), ['Privacy', 'ISO 27001', 'Access']);
  const same = ['A'];
  assert.deepEqual(addTags(same, ['a']), ['A']);
  assert.deepEqual(same, ['A']);                                                                   // the list passed in is not changed
});

test('no more than the most tags a document may have are added', () => {
  const many = Array.from({ length: MAX_TAGS - 1 }, (_, i) => `t${i}`);
  assert.equal(addTags(many, ['x', 'y', 'z']).length, MAX_TAGS);
  assert.deepEqual(addTags(many, ['x', 'y']).slice(-1), ['x']);
});

test('suggestions are the tags of other documents not chosen yet, each once, matching what is typed, A to Z', () => {
  const used = ['Privacy', 'access', 'Access', 'ISO 27001', 7, null, '  ', 'Payments'];
  assert.deepEqual(tagSuggestions(used, ['privacy']), ['access', 'ISO 27001', 'Payments']);
  assert.deepEqual(tagSuggestions(used, [], 'ACC'), ['access']);
  assert.deepEqual(tagSuggestions(used, [], '', 2), ['access', 'ISO 27001']);
  assert.deepEqual(tagSuggestions([], ['x'], 'y'), []);
});

test('typed text becomes tags: split at commas, cleaned, empty parts left out', () => {
  assert.deepEqual(splitTags(' Privacy ,, ISO   27001,  '), ['Privacy', 'ISO 27001']);
  assert.deepEqual(splitTags('   '), []);
  assert.deepEqual(splitTags(''), []);
});

test('the parts the limit left out are named, each once; parts already there or added are not', () => {
  const many = Array.from({ length: MAX_TAGS - 1 }, (_, i) => `t${i}`);
  const parts = splitTags('x, T0, y, z, Y');
  const tags = addTags(many, parts);
  assert.equal(tags.length, MAX_TAGS);
  assert.deepEqual(leftOut(tags, parts), ['y', 'z']);
  assert.deepEqual(leftOut(addTags(['a'], ['b']), ['b', 'A']), []);                               // nothing left out under the limit
  const typed = splitTags(Array.from({ length: MAX_TAGS + 1 }, (_, i) => `p${i}`).join(','));
  assert.deepEqual(leftOut(addTags([], typed), typed), [`p${MAX_TAGS}`]);                           // the 21st of "p0,...,p20"
});
