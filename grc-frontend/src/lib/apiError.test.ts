// node --test src/lib/apiError.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readdirSync, readFileSync } from 'node:fs';

import { apiErrorText, detailText, safeDetail } from './apiError.ts';

test('the admin pages never put a raw `detail` on the page (a 422 list blanked Admin > Users)', () => {
  const root = new URL('../app/(dashboard)/admin/', import.meta.url);
  const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx'));
  const raw = files.flatMap((f) => readFileSync(new URL(f.replace(/\\/g, '/'), root), 'utf8').split('\n')
    .filter((l) => /set\w*(Error|Message|Err)\(\s*\w+\??\.response\?\.data\?\.detail\s*\|\|/.test(l)).map((l) => `${f}: ${l.trim()}`));
  assert.deepEqual(raw, []);
  assert.ok(files.length > 20);
  // and a toast given a `detail` as it came reads it out (every toast goes through the provider)
  assert.ok(readFileSync(new URL('../components/ui/ToastProvider.tsx', import.meta.url), 'utf8').includes(': detailText(options.message)'));
});

const err = (detail: unknown) => ({ response: { status: 422, data: { detail } } });

test('a 422 list reads as sentences naming the field, never as an object', () => {
  const detail = [
    { type: 'value_error', loc: ['body', 'email'], msg: 'value is not a valid email address: An email address must have an @-sign.' },
    { type: 'missing', loc: ['body', 'display_name'], msg: 'Field required' },
    { type: 'value_error', loc: ['body'], msg: 'Value error, password is too short' },
  ];
  assert.equal(apiErrorText(err(detail), 'x'),
    'Email: value is not a valid email address: An email address must have an @-sign. Display name: Field required. Password is too short.');
});

test('a sentence stays as it is; an object gives its message; nothing usable gives the fallback', () => {
  assert.equal(apiErrorText(err('Username already exists'), 'x'), 'Username already exists');
  assert.equal(apiErrorText(err({ code: 'conflict', message: 'The user changed meanwhile.' }), 'x'), 'The user changed meanwhile.');
  assert.equal(apiErrorText(err({ code: 'conflict' }), 'Failed to save user'), 'Failed to save user');
  assert.equal(apiErrorText(err([]), 'Failed to save user'), 'Failed to save user');
  assert.equal(apiErrorText(new Error('Network Error'), 'Failed to load users'), 'Failed to load users');
  assert.equal(apiErrorText(undefined, 'Failed'), 'Failed');
  assert.equal(detailText(42), '');
});

test('safeDetail keeps a plain sentence exactly as it is', () => {
  assert.equal(safeDetail('Username already exists'), 'Username already exists');
  assert.equal(safeDetail('Email: value is not a valid email address. Use a name@company address.'), 'Email: value is not a valid email address. Use a name@company address.');
  assert.equal(safeDetail('The score must be < 5 and > 0'), 'The score must be < 5 and > 0');          // a bare angle bracket is not markup
  assert.equal(safeDetail('  two   spaces\tand\n\nbreaks  '), 'two spaces and breaks');
  assert.equal(safeDetail('Rule المستخدم ‏ exists'), 'Rule المستخدم ‏ exists');   // Arabic and its direction mark are not "control characters"
  assert.equal(safeDetail(''), '');
  assert.equal(safeDetail(undefined), '');
  assert.equal(safeDetail(null), '');
  assert.equal(safeDetail(42 as unknown as string), '');
});

test('safeDetail never lets an AI vendor or a model name through: the UI says "AI"', () => {
  assert.equal(safeDetail('OpenAI API key not configured'), 'AI API key not configured');
  assert.equal(safeDetail('Model gpt-6-luna timed out'), 'Model AI timed out');
  assert.equal(safeDetail('Anthropic returned 529; claude-fable-5-1 is overloaded'), 'AI returned 529; AI is overloaded');
  assert.equal(safeDetail('Open AI and ChatGPT are unavailable'), 'AI and AI are unavailable');
  assert.equal(safeDetail('The paid plan is not an AIM issue'), 'The paid plan is not an AIM issue');          // not a name
  assert.equal(safeDetail('Open items remain'), 'Open items remain');
});

test('safeDetail strips markup, so a proxy error page reads as words', () => {
  assert.equal(safeDetail('<html><head><title>502</title></head><body><h1>Bad Gateway</h1><p>nginx</p></body></html>'), '502 Bad Gateway nginx');
  assert.equal(safeDetail('Saved <b>nothing</b>.<script>alert(1)</script> Try again'), 'Saved nothing . Try again');
  assert.equal(safeDetail('<style>body{color:red}</style>Down for maintenance'), 'Down for maintenance');
  assert.equal(safeDetail('<!DOCTYPE html><div class="x">Oops</div>'), 'Oops');
});

test('safeDetail drops stack traces and the SQL echo, keeping the message', () => {
  const py = 'Traceback (most recent call last):\n  File "/app/grc/routers/x.py", line 42, in create\n    db.commit()\nValueError: Dates overlap';
  assert.equal(safeDetail(py), 'ValueError: Dates overlap');
  const js = 'Cannot save the form\n    at save (webpack-internal:///./src/a.tsx:10:5)\n    at async run (/app/b.js:3:1)';
  assert.equal(safeDetail(js), 'Cannot save the form');
  assert.equal(safeDetail('Cannot save the form\n  File "/app/x.py", line 9, in f'), 'Cannot save the form');
  const sql = 'Import failed: duplicate key value\n[SQL: INSERT INTO t (a, b) VALUES (%(a)s, %(b)s)]\n[parameters: {\'a\': \'secret\'}]\n(Background on this error at: https://sqlalche.me/e/20/gkpj)';
  assert.equal(safeDetail(sql), 'Import failed: duplicate key value');
  assert.equal(safeDetail('at least one reviewer is needed'), 'at least one reviewer is needed');          // a sentence is not a frame
  assert.equal(safeDetail('Traceback (most recent call last):\n  File "/a.py", line 1, in x'), '');          // nothing readable left
});

test('safeDetail strips control characters', () => {
  assert.equal(safeDetail('bad\u0000 \u0007input\u001b[31m\u007f\u0085!'), 'bad input[31m!');
});

test('safeDetail caps the length with an ellipsis, 240 by default, and never splits an emoji', () => {
  const long = 'word '.repeat(100);
  const cut = safeDetail(long);
  assert.equal(cut.length, 240);
  assert.ok(cut.endsWith('…') && !cut.endsWith(' …'));
  assert.equal(safeDetail('x'.repeat(240)).length, 240);
  assert.equal(safeDetail('x'.repeat(241)), `${'x'.repeat(239)}…`);
  assert.equal(safeDetail('abcdefghij', 5), 'abcd…');
  const emoji = `12345678${'\u{1F600}'.repeat(5)}`;
  assert.equal(safeDetail(emoji, 10), '12345678…');               // the 9th unit is half an emoji: dropped, not left lone
  assert.equal(safeDetail('short', 5), 'short');
});

test('apiErrorText itself is unchanged: the admin pages show its output in full', () => {
  assert.equal(apiErrorText(err('x'.repeat(500)), 'f').length, 500);
});
