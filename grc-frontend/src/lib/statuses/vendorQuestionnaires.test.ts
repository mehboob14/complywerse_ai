// node --test "src/lib/statuses/vendorQuestionnaires.test.ts"
// The words of Questionnaires: every word the server can write has a tone and a plain label, the lists the page filters by are the server's own, and a word nobody registered reads neutral.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { statusPill, TONE, type Statuses } from '../status.ts';
import { IN_REVIEW, STATUS_ORDER, WAITING_ON_SUPPLIER, assessmentKind, questionnaireStatus, sharedRating, sharedStatus } from './vendorQuestionnaires.ts';

const ALL: Statuses[] = [questionnaireStatus, sharedStatus, sharedRating, assessmentKind];
const BACKEND = fileURLToPath(new URL('../../../../backend/grc/', import.meta.url));
const read = (rel: string) => readFileSync(`${BACKEND}${rel}`, 'utf8');
const wordsOf = (src: string, name: string): string[] => (new RegExp(`${name}\\s*=\\s*\\(([^)]*)\\)`).exec(src)?.[1].match(/"(\w+)"/g) ?? []).map((w) => w.replace(/"/g, ''));

test('every word has one of the six tones and a readable label that starts with a capital', () => {
  for (const registry of ALL) for (const word of registry.words) {
    assert.ok(Object.keys(TONE).includes(registry.tone(word)), `${registry.record}.${word}`);
    assert.match(registry.label(word), /^[A-Z]/, `${registry.record}.${word}: ${registry.label(word)}`);
  }
});

test('the statuses that wait on the supplier are the server\'s own list (tpra/portal.py), and the order lists every word once', () => {
  const portal = read('modules/vendor_risk/tpra/portal.py');
  assert.deepEqual(wordsOf(portal, 'WAITING_ON_VENDOR'), Array.from(WAITING_ON_SUPPLIER));
  for (const word of WAITING_ON_SUPPLIER.concat(IN_REVIEW as never)) assert.ok(STATUS_ORDER.includes(word as never), word);
  assert.equal(new Set(STATUS_ORDER).size, STATUS_ORDER.length);
  assert.deepEqual(Array.from(STATUS_ORDER).sort(), questionnaireStatus.words.slice().sort(), 'every registered word is in the order, and the other way round');
});

test('every status the server writes to a questionnaire is registered', () => {
  const reminders = read('modules/vendor_risk/tpra/reminders.py');
  assert.match(reminders, /a\.status = "expired"/, 'the reminder run still writes "expired"');
  for (const word of ['pending', 'in_progress', 'submitted', 'under_review', 'returned', 'accepted', 'expired']) assert.ok(questionnaireStatus.has(word), word);
  const routes = read('modules/vendor_risk/routers/questionnaires.py');
  for (const word of ['pending', 'accepted', 'returned']) assert.match(routes, new RegExp(`"${word}"`), `the router writes or reads ${word}`);
});

test('a word nobody registered reads neutral with a readable label, and no word at all reads as not recorded', () => {
  assert.deepEqual(statusPill(questionnaireStatus, 'waiting_for_legal'), { tone: 'neutral', label: 'Waiting for legal' });
  assert.equal(questionnaireStatus.label(null), '—');
  assert.equal(sharedStatus.label('revoked'), 'Revoked');
  assert.deepEqual(sharedStatus.words, ['active', 'revoked'], 'the server writes active and revoked only (tpra/api.py, tpra/exchange.py)');
  assert.equal(sharedRating.label('unscored'), 'Not scored');
});
