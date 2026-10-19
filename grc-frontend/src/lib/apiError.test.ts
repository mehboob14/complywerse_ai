// node --test src/lib/apiError.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readdirSync, readFileSync } from 'node:fs';

import { apiErrorText, detailText } from './apiError.ts';

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
