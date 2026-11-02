// node --test src/lib/people.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { contrast } from './contrast.ts';
import { AVATAR_TINTS, initials, initialsOf, personOf, personStack, tintFor } from './people.ts';
import { TONE } from './status.ts';

test('a picker avatar: a person by name, a role or a department by its own name, never "R·"', () => {
  assert.equal(initialsOf('Olivia Owner'), 'OO');
  assert.equal(initialsOf('bilal'), 'BI');
  assert.equal(initialsOf('Role · Approvers'), 'AP');
  assert.equal(initialsOf('Department · Security Ops'), 'SO');
  assert.equal(initialsOf('Role: DigitalOcean admins'), 'DA');     // the name the server saved for a participant
  assert.equal(initialsOf('Zara (Audit) Khan'), 'ZA');
  assert.equal(initialsOf(''), 'U');
});

test('a /tenants/{id}/users row: the nested user names the person, user_id is the person (not the membership id)', () => {
  const row = { id: 41, user_id: 5, tenant_id: 1, is_primary: false, user: { id: 5, display_name: 'Sara Reviewer', username: 'sara', email: 'sara@x.test' } };
  assert.deepEqual(personOf(row), { id: 5, name: 'Sara Reviewer', email: 'sara@x.test' });
});

test('a flat /assets/tenant-users row', () => {
  assert.deepEqual(personOf({ id: 6, display_name: 'Khalid Approver', email: 'k@x.test' }), { id: 6, name: 'Khalid Approver', email: 'k@x.test' });
});

test('falls back to username, then email, then "User n"', () => {
  assert.equal(personOf({ user_id: 7, user: { id: 7, username: 'aamir' } }).name, 'aamir');
  assert.equal(personOf({ id: 8, email: 'b@x.test' }).name, 'b@x.test');
  assert.equal(personOf({ id: 9 }).name, 'User 9');
});

// ── how a person is drawn ─────────────────────────────────────────────────────
test('initials: the first and last word, or the first two letters of one word', () => {
  assert.equal(initials('Dana Okafor'), 'DO');
  assert.equal(initials('  ali   bin zayed '), 'AZ');
  assert.equal(initials('Madonna'), 'MA');
  assert.equal(initials('X'), 'X');
  assert.equal(initials('Álvaro Núñez'), 'ÁN');
  assert.equal(initials('Muhammad Waqas'), 'MW');
});

test('initials: names in Arabic and names that mix directions are read in the order they are written', () => {
  assert.equal(initials('محمد أحمد'), 'مأ');
  assert.equal(initials('سارة'), 'سا');                    // one word: its first two letters
  assert.equal(initials('Ali محمد'), 'Aم');
  assert.equal(initials('محمد Ali'), 'مA');
  assert.equal(initials('عبد الله بن زايد'), 'عز');         // the first and the last word
});

test('initials: a blank name is "?", and one letter is the first letter only', () => {
  for (const none of [null, undefined, '', '   ', '\n\t']) assert.equal(initials(none), '?', JSON.stringify(none));
  assert.equal(initials('Dana Okafor', 1), 'D');
  assert.equal(initials('محمد أحمد', 1), 'م');
  assert.equal(initials('', 1), '?');
});

test('initials: an emoji or a letter with its accent is never cut in half', () => {
  assert.equal(initials('🚀 Rocket'), '🚀R');
  assert.equal(initials('Team 🚀'), 'T🚀');
  assert.equal(initials('🚀'), '🚀');
  assert.equal(initials('🇵🇰 Pakistan'), '🇵🇰P');                         // a flag is two code points and one letter
  assert.equal(initials('👩🏽‍💻 Maya'), '👩🏽‍💻M');                           // skin tone and joiner stay with it
  const ACUTE = String.fromCodePoint(0x301);
  const DIAERESIS = String.fromCodePoint(0x308);
  assert.equal(initials(`e${ACUTE}lo${DIAERESIS}ise`), `E${ACUTE}L`);       // "é" written as e + an accent keeps its accent
  assert.equal(initials(`e${ACUTE}`, 1), `E${ACUTE}`);
  for (const name of ['🚀', '👨‍👩‍👧 Family', 'Ana 🧑‍🚀', '🇵🇰🇦🇪', 'xxx😀😀😀']) {
    assert.doesNotThrow(() => encodeURIComponent(initials(name)), name);       // throws on a lone surrogate
    assert.doesNotThrow(() => encodeURIComponent(initials(name, 1)), name);
  }
});

test('a name always gets the same tint, whatever its case and spaces', () => {
  assert.deepEqual(tintFor('Dana Okafor'), tintFor('  dana okafor '));
  assert.ok(new Set(['Dana', 'Rana', 'Uma', 'Mina', 'Olivia', 'Rafay', 'Ali', 'Sara'].map((n) => tintFor(n).tint)).size > 2);       // spread out
});

test('the tints are the vendor kit\'s slots, in its order, and the last is the brand', () => {
  assert.deepEqual(AVATAR_TINTS.slice(0, 5).map((c) => c.tint), [TONE.progress, TONE.pending, TONE.warning, TONE.danger, TONE.success].map((c) => c.tint));
  const css = readFileSync('styles/tokens.css', 'utf8');
  const token = (name: string) => new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1].toLowerCase();
  assert.equal(AVATAR_TINTS[5].tint.toLowerCase(), token('ds-primary-soft'));
  assert.equal(AVATAR_TINTS[5].text.toLowerCase(), token('ds-primary-text'));
});

test('the letters read on every tint (4.5:1), and a blank name is the quiet grey', () => {
  for (const c of AVATAR_TINTS) assert.ok(contrast(c.text, c.tint) >= 4.5, `${c.text} on ${c.tint}: ${contrast(c.text, c.tint).toFixed(2)}`);
  for (const none of [null, undefined, '', '  ']) assert.deepEqual(tintFor(none), { tint: TONE.neutral.tint, text: TONE.neutral.text });
});

test('a stack of people: the first few, the rest, and the +M button\'s name', () => {
  const five = ['Ann Lee', 'Bo Chen', 'Cy Park', 'Dee Roy', 'Eli Fox'];
  assert.deepEqual(personStack(five), { shown: five.slice(0, 3), rest: ['Dee Roy', 'Eli Fox'], more: 2, moreLabel: '+2 more: Dee Roy, Eli Fox' });
  assert.deepEqual(personStack(five, 5), { shown: five, rest: [], more: 0, moreLabel: '' });
  assert.deepEqual(personStack(five, 0).shown, []);
  assert.equal(personStack(five, 0).more, 5);
});

test('a stack leaves out people with no name, and nobody is an empty stack', () => {
  assert.deepEqual(personStack([' Ann Lee ', null, undefined, '', '   ', 'Bo Chen'], 1), { shown: ['Ann Lee'], rest: ['Bo Chen'], more: 1, moreLabel: '+1 more: Bo Chen' });
  for (const none of [null, undefined, [], [null, '  ']]) assert.deepEqual(personStack(none), { shown: [], rest: [], more: 0, moreLabel: '' });
});
