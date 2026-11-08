// node --test "src/lib/statuses/frameworkRequirements.test.ts"
// The words of a requirement of a framework journey: every word the Requirements tab can show has a tone and a readable label, an unknown word reads neutral with its own label,
// and the review words are the ones the server writes on an evidence file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { statusPill, type Statuses } from '../status.ts';
import { evidenceState, fileRating, fileReview, requirementScope, subControlState } from './frameworkRequirements.ts';

const ALL: Statuses[] = [evidenceState, requirementScope, fileReview, fileRating, subControlState];

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

test('the evidence states are said the way a person works them: nothing, waiting, turned down, partly, fully', () => {
  assert.deepEqual(['none', 'review', 'rejected', 'partial', 'complete', 'not_asked'].map((w) => evidenceState.label(w)),
    ['No evidence', 'Waiting for review', 'Turned down', 'Partly approved', 'Fully approved', 'None asked for']);
  assert.equal(evidenceState.tone('complete'), 'success');
  assert.equal(evidenceState.tone('rejected'), 'danger');
  assert.equal(requirementScope.tone('out_of_scope'), 'warning');
});

test('the review words are the three the server writes on an evidence file', () => {
  assert.deepEqual(fileReview.words, ['pending', 'approved', 'rejected']);
  const url = new URL('../../../../backend/grc/routers/certification_router.py', import.meta.url);
  if (existsSync(url)) {
    const text = readFileSync(url, 'utf8');
    assert.match(text, /"approved" if action == "approve" else "rejected"/, 'approve and reject write approved / rejected');
  }
});
