// node --test "src/lib/statuses/rcsa.test.ts"
// The words of the RCSA module: every word the server can store has a tone and a readable label, the returned and the rejected unit are not special cases any
// more, severity reads as the platform's priority scale, and a word nobody registered is neutral with its own readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { priority, statusPill, TONE, type Statuses } from '../status.ts';
import { approvalAction, assessmentStatus, campaignStatus, effectiveness, findingSeverity, findingStatus, findingType, optionsOf, questionType, registerLevel } from './rcsa.ts';

const ALL: Statuses[] = [assessmentStatus, campaignStatus, findingStatus, findingSeverity, findingType, questionType, approvalAction, registerLevel, effectiveness];

test('every word has a tone of the platform\'s six families and a readable label', () => {
  for (const registry of ALL) {
    for (const word of registry.words) {
      assert.ok(Object.keys(TONE).includes(registry.tone(word)), `${registry.record}.${word}`);
      assert.match(registry.label(word), /^[A-Z][A-Za-z ]+$/, `${registry.record}.${word}: ${registry.label(word)}`);
    }
  }
});

test('a returned unit and a rejected unit are words like the others (the old page threw on requires_changes)', () => {
  assert.deepEqual(statusPill(assessmentStatus, 'requires_changes'), { tone: 'warning', label: 'Returned' });
  assert.deepEqual(statusPill(assessmentStatus, 'rejected'), { tone: 'danger', label: 'Rejected' });
  assert.deepEqual(statusPill(assessmentStatus, 'under_review'), { tone: 'pending', label: 'Under review' });
  assert.deepEqual(assessmentStatus.words, ['not_started', 'in_progress', 'submitted', 'under_review', 'approved', 'rejected', 'requires_changes']);
});

test('the same word has the same colour on every page: submitted is purple, in progress is blue', () => {
  assert.equal(assessmentStatus.tone('submitted'), 'pending');
  assert.equal(assessmentStatus.tone('in_progress'), 'progress');
  assert.equal(findingStatus.tone('in_progress'), 'progress');
  assert.equal(campaignStatus.tone('active'), 'progress');
});

test('severity reads as the platform priority scale', () => {
  for (const word of findingSeverity.words) assert.equal(findingSeverity.tone(word), priority.tone(word), word);
});

test('an unknown word is neutral with its own readable label, a missing one is the dash', () => {
  assert.deepEqual(statusPill(assessmentStatus, 'escalated_to_committee'), { tone: 'neutral', label: 'Escalated to committee' });
  assert.deepEqual(statusPill(findingStatus, null), { tone: 'neutral', label: '—' });
  assert.equal(findingStatus.tone('constructor'), 'neutral');
});

test('the select options come in the registry\'s order, with the words the pills say', () => {
  assert.deepEqual(optionsOf(findingStatus), [
    { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'remediated', label: 'Remediated' },
    { value: 'accepted', label: 'Accepted' }, { value: 'closed', label: 'Closed' },
  ]);
});

// ── the server's own words: every status a route writes is registered ──
const ROUTER = new URL('../../../../backend/grc/modules/erm/routers/rcsa.py', import.meta.url);
const source = existsSync(ROUTER) ? readFileSync(ROUTER, 'utf8') : null;

test('every status the RCSA routes write is a registered word', { skip: source === null }, () => {
  const written = (name: string) => Array.from(new Set(Array.from((source as string).matchAll(new RegExp(`${name}\\.status = "(\\w+)"`, 'g'))).map((m) => m[1])));
  for (const word of written('assessment')) assert.ok(assessmentStatus.has(word), `assessment.status = ${word}`);
  for (const word of written('db_campaign')) assert.ok(campaignStatus.has(word), `campaign.status = ${word}`);
  assert.ok(written('assessment').length >= 4);
});
