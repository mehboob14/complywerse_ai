// node --test "src/app/(dashboard)/governance/exceptions/_text.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanText, parseListish, toEditableText } from './_text.ts';

test('a list in disguise is found: an array, a JSON array, a Python repr, numbered lines, bullets', () => {
  assert.deepEqual(parseListish(['a', ' b ', '']), ['a', 'b']);
  assert.deepEqual(parseListish('["Enforce MFA","Log access"]'), ['Enforce MFA', 'Log access']);
  assert.deepEqual(parseListish("['Enforce MFA', 'Log access']"), ['Enforce MFA', 'Log access']);
  assert.deepEqual(parseListish('1. first\n2. second'), ['first', 'second']);
  assert.deepEqual(parseListish('1) first\n2) second'), ['first', 'second']);
  assert.deepEqual(parseListish('- first\n* second\n• third'), ['first', 'second', 'third']);
});

test('prose, one line and a mix of lines and sentences are not a list', () => {
  assert.equal(parseListish('Plain prose, nothing to parse.'), null);
  assert.equal(parseListish('1. only one numbered line'), null);
  assert.equal(parseListish('1. numbered\nbut this line is not'), null);
  assert.equal(parseListish(undefined), null);
  assert.equal(parseListish(42), null);
});

test('a Python repr with an apostrophe inside an item falls through to raw text instead of breaking', () => {
  assert.equal(parseListish("['Don't open the port', 'b']"), null);
});

test('the quotes a text was wrapped in come off, and an empty-looking value is nothing', () => {
  assert.equal(cleanText('"quoted"'), 'quoted');
  assert.equal(cleanText("'quoted'"), 'quoted');
  assert.equal(cleanText('  plain  '), 'plain');
  for (const none of [null, undefined, '', '""', "''", '[]', '{}', 'null', 'None', '   ']) assert.equal(cleanText(none), '');
});

test('an edit box starts with numbered lines for a list, the item for a one-item list, the clean text for prose', () => {
  assert.equal(toEditableText("['a', 'b', 'c']"), '1. a\n2. b\n3. c');
  assert.equal(toEditableText('["only"]'), 'only');
  assert.equal(toEditableText('"Prose in quotes"'), 'Prose in quotes');
  assert.equal(toEditableText(null), '');
});
