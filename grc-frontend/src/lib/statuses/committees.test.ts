// node --test "src/lib/statuses/committees.test.ts"
// The words of the Committees screens (the outcome of an agenda item, the roll call, the agenda item's own status): every word the server writes has a tone and a label,
// and a word nobody registered reads neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { statusPill } from '../status.ts';
import { agendaStatus, decisionOutcome, rollStatus } from './committees.ts';

const ROUTER = new URL('../../../../backend/grc/modules/governance/routers/committees.py', import.meta.url);
const source = existsSync(ROUTER) ? readFileSync(ROUTER, 'utf8') : null;
const listOf = (name: string): string[] => {
  const hit = new RegExp(`${name}\\s*=\\s*\\(([^)]*)\\)`).exec(source as string);
  assert.ok(hit, `${name}: not found in committees.py (did the router change shape?)`);
  return Array.from((hit as RegExpExecArray)[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
};

test('the four outcomes the server accepts are the four registered, with the tones people expect', { skip: source === null && 'backend not beside the frontend' }, () => {
  const words = listOf('OUTCOME_WORDS');
  assert.deepEqual(words, ['Approved', 'Rejected', 'Deferred', 'Noted']);
  for (const word of words) assert.ok(decisionOutcome.has(word), word);
  assert.deepEqual([...decisionOutcome.words].sort(), words.map((w) => w.toLowerCase()).sort(), 'nothing is registered that the server does not write');
  assert.deepEqual(words.map((w) => decisionOutcome.tone(w)), ['success', 'danger', 'warning', 'neutral']);
  assert.deepEqual(words.map((w) => decisionOutcome.label(w)), words);
});

test('the roll call words are the ones the server accepts, and a member nobody marked reads "Not marked"', { skip: source === null && 'backend not beside the frontend' }, () => {
  const words = listOf('ATTENDANCE_WORDS');
  assert.deepEqual(words, ['present', 'late', 'absent']);
  for (const word of words) assert.ok(rollStatus.has(word), word);
  assert.deepEqual([...rollStatus.words].sort(), ['absent', 'late', 'not_marked', 'present']);
  assert.deepEqual(['present', 'late', 'absent', 'not_marked'].map((w) => statusPill(rollStatus, w)), [
    { tone: 'success', label: 'Present' },
    { tone: 'warning', label: 'Late' },
    { tone: 'neutral', label: 'Absent' },
    { tone: 'neutral', label: 'Not marked' },
  ]);
});

test('an agenda item is pending until it is decided, then discussed or deferred', () => {
  assert.deepEqual(['pending', 'discussed', 'deferred'].map((w) => statusPill(agendaStatus, w)), [
    { tone: 'neutral', label: 'Pending' },
    { tone: 'success', label: 'Discussed' },
    { tone: 'warning', label: 'Deferred' },
  ]);
});

test('a word nobody registered is neutral with its own readable label, never a guess', () => {
  assert.deepEqual(statusPill(decisionOutcome, 'Escalated'), { tone: 'neutral', label: 'Escalated' });
  assert.deepEqual(statusPill(decisionOutcome, undefined), { tone: 'neutral', label: '—' });
  assert.deepEqual(statusPill(rollStatus, 'on_leave'), { tone: 'neutral', label: 'On leave' });
});
