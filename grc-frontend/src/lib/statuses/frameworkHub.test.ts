// node --test "src/lib/statuses/frameworkHub.test.ts"
// The words of the Frameworks hub: every word the hub can show has a tone and a readable label, an unknown word reads neutral with its own label, the journey words
// are the ones the journey page uses, and the target words are the states the journey model works out.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { statusPill, type Statuses } from '../status.ts';
import { targetState } from '../journeyModel.ts';
import { journeyStatus } from './frameworkJourney.ts';
import { frameworkState, targetWords } from './frameworkHub.ts';

const ALL: Statuses[] = [frameworkState, targetWords];

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

test('a framework with a journey is said the way its journey is said; the stages before a journey have words of their own', () => {
  for (const word of journeyStatus.words) {
    assert.equal(frameworkState.label(word), journeyStatus.label(word), word);
    assert.equal(frameworkState.tone(word), journeyStatus.tone(word), word);
  }
  assert.deepEqual(['idle', 'onboarding', 'ready', 'unknown'].map((w) => frameworkState.label(w)), ['No journey yet', 'Onboarding', 'Ready to start', 'Not known']);
});

test('the target words are the states the journey model works out, day by day', () => {
  const today = new Date(2026, 10, 8);
  const states = ['2026-11-01', '2026-11-20', '2027-03-01', null].map((day) => targetState(day, 'in_progress', today).state);
  assert.deepEqual(states, ['overdue', 'soon', 'later', 'none']);
  assert.equal(targetState('2026-11-01', 'completed', today).state, 'done');
  for (const state of [...states, 'done']) assert.ok(targetWords.has(state), state);
});
