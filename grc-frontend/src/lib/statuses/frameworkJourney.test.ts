// node --test "src/lib/statuses/frameworkJourney.test.ts"
// The status words of a framework journey: every word the page can show has a tone and a readable label, an unknown word reads neutral with its own
// label, the three words a scope decision goes through match what the server writes, and the readiness words match the model's bands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { statusPill, type Statuses } from '../status.ts';
import { readinessBand } from '../journeyModel.ts';
import { journeyStatus, readinessBandWords, requirementState, scopeDecision } from './frameworkJourney.ts';

const ALL: Statuses[] = [journeyStatus, requirementState, scopeDecision, readinessBandWords];

test('every registered word has a tone and a readable label; an unknown word is neutral with its own label', () => {
  for (const registry of ALL) {
    assert.ok(registry.words.length > 0, registry.record);
    for (const word of registry.words) {
      assert.match(registry.tone(word), /^(success|danger|warning|progress|pending|neutral)$/, `${registry.record}: ${word}`);
      assert.ok(registry.label(word).trim().length > 1 && registry.label(word) !== '—', `${registry.record}: ${word} has a label`);
      assert.doesNotMatch(registry.label(word), /gpt|openai|claude|anthropic|model/i, `${registry.record}: ${word}`);
    }
    assert.deepEqual(statusPill(registry, 'some_new_word'), { tone: 'neutral', label: 'Some new word' }, registry.record);
    assert.equal(registry.tone('constructor'), 'neutral', `${registry.record}: not an inherited property`);
  }
});

test('a requirement is said the way the page always said it; implemented and verified are both done', () => {
  assert.deepEqual(['not_started', 'in_progress', 'implemented', 'verified', 'not_applicable'].map((w) => requirementState.label(w)),
    ['Not implemented', 'In progress', 'Implemented', 'Verified', 'Not applicable']);
  assert.equal(requirementState.tone('implemented'), 'success');
  assert.equal(requirementState.tone('verified'), 'success');
});

test('the three words of a scope decision are the three the server writes, and a waiting one says who it waits for', () => {
  assert.deepEqual(scopeDecision.words, ['pending', 'approved', 'rejected']);
  assert.equal(scopeDecision.label('pending'), 'Waiting for a reviewer');
  assert.equal(scopeDecision.tone('pending'), 'pending');
  const url = new URL('../../../../backend/grc/modules/governance/routers/applicability.py', import.meta.url);
  if (existsSync(url)) {
    const text = readFileSync(url, 'utf8');
    assert.match(text, /status="pending"/, 'every decision is saved waiting');
    assert.match(text, /\("approved", "rejected"\)/, 'a reviewer sets approved or rejected');
  }
});

test('the readiness words are the model\'s four bands, in the tones of the platform', () => {
  for (const pct of [100, 60, 30, 0]) assert.ok(readinessBandWords.has(readinessBand(pct)), `${pct}`);
  assert.deepEqual(['strong', 'building', 'early', 'start'].map((w) => readinessBandWords.tone(w)), ['success', 'progress', 'warning', 'neutral']);
});
