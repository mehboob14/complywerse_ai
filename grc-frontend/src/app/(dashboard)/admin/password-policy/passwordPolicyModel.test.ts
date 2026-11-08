// node --test "src/app/(dashboard)/admin/password-policy/passwordPolicyModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bodyOf, CLASSES, errorsOf, formOf, hasErrors, INFO, isDirty, numberOf, RANGES } from './passwordPolicyModel.ts';

const record = {
  min_length: 12, require_uppercase: true, require_lowercase: true, require_digit: true, require_special: false,
  lockout_threshold: 5, lockout_minutes: 30, session_idle_timeout_minutes: 30, updated_at: '2026-11-03T09:15:00',
};
const saved = formOf(record);

test('the form is the saved policy', () => {
  assert.deepEqual(saved, { minLength: 12, requireUppercase: true, requireLowercase: true, requireDigit: true, requireSpecial: false, lockoutThreshold: 5, lockoutMinutes: 30, idleMinutes: 30 });
});

test('what a box typed makes: a whole number, or NaN (an empty box is not 0, a decimal is not a number of minutes)', () => {
  assert.equal(numberOf('12'), 12);
  assert.equal(numberOf(' 40 '), 40);
  assert.ok(Number.isNaN(numberOf('')));
  assert.ok(Number.isNaN(numberOf('1.5')));
  assert.ok(Number.isNaN(numberOf('-3')));
  assert.ok(Number.isNaN(numberOf('abc')));
});

test('only what changed is sent, under the server\'s names; "reuse of the last N passwords" and "maximum age" are never sent (nothing enforces them)', () => {
  assert.deepEqual(bodyOf(saved, saved), {});
  assert.deepEqual(bodyOf(saved, { ...saved, minLength: 14, requireSpecial: true }), { min_length: 14, require_special: true });
  assert.deepEqual(bodyOf(saved, { ...saved, idleMinutes: 15, lockoutMinutes: 60, lockoutThreshold: 3 }), { session_idle_timeout_minutes: 15, lockout_minutes: 60, lockout_threshold: 3 });
  const everything = bodyOf(formOf({ ...record, min_length: 8, require_uppercase: false, require_lowercase: false, require_digit: false, require_special: true, lockout_threshold: 3, lockout_minutes: 1, session_idle_timeout_minutes: 5 }), saved);
  assert.equal(Object.keys(everything).length, 8);
  assert.ok(!('password_history_count' in everything) && !('max_password_age_days' in everything));
});

test('dirty means different from what is saved; an unfinished box is a change that cannot be sent', () => {
  assert.equal(isDirty(saved, saved), false);
  assert.equal(isDirty(saved, { ...saved, requireDigit: false }), true);
  const typing = { ...saved, minLength: Number.NaN };
  assert.equal(isDirty(saved, typing), true);
  assert.equal(isDirty(typing, typing), false, 'NaN equals NaN here: the same unfinished box is not a change');
});

test('the checks are the server\'s ranges, in words', () => {
  assert.deepEqual(errorsOf(saved), {});
  assert.equal(hasErrors(saved), false);
  assert.equal(errorsOf({ ...saved, minLength: 7 }).minLength, 'Use a whole number from 8 to 128.');
  assert.equal(errorsOf({ ...saved, minLength: 129 }).minLength, 'Use a whole number from 8 to 128.');
  assert.equal(errorsOf({ ...saved, lockoutThreshold: 2 }).lockoutThreshold, 'Use a whole number from 3 to 50.');
  assert.equal(errorsOf({ ...saved, lockoutMinutes: 0 }).lockoutMinutes, 'Use a whole number from 1 to 1440.');
  assert.equal(errorsOf({ ...saved, idleMinutes: 4 }).idleMinutes, 'Use a whole number from 5 to 1440.');
  assert.ok(errorsOf({ ...saved, idleMinutes: Number.NaN }).idleMinutes, 'an empty box');
  assert.ok(errorsOf({ ...saved, minLength: 12.5 }).minLength, 'a decimal');
  for (const [k, { min, max }] of Object.entries(RANGES)) {
    assert.deepEqual(errorsOf({ ...saved, [k]: min }), {}, `${k} at its lowest`);
    assert.deepEqual(errorsOf({ ...saved, [k]: max }), {}, `${k} at its highest`);
  }
});

test('the ranges are the ones the server enforces (admin_router.update_password_policy)', () => {
  assert.deepEqual(RANGES, { minLength: { min: 8, max: 128 }, lockoutThreshold: { min: 3, max: 50 }, lockoutMinutes: { min: 1, max: 1440 }, idleMinutes: { min: 5, max: 1440 } });
});

test('the words claim only what the platform does: no history, no maximum age, and locking says who switches it on', () => {
  assert.equal(CLASSES.length, 4);
  const words = JSON.stringify([INFO, CLASSES]);
  assert.doesNotMatch(words, /history|reuse|maximum age|expire|rotation/i);
  assert.match(INFO.lockoutThreshold, /switched on for the whole platform/);
  assert.match(INFO.minLength, /when an administrator creates an account/);
});
