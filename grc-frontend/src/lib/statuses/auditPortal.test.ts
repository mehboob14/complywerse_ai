// node --test "src/lib/statuses/auditPortal.test.ts"
// The status words of the Auditor Portal: every word the pages can show has a tone and a readable label, an unknown word reads neutral with its own label,
// the words of a file and of a scope request are the ones the server writes, and the platform says "Turned down" for what the server calls "rejected".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { statusPill, type Statuses } from '../status.ts';
import { decisionWord, fileReview, queueKind, scopeRequest, scopeState } from './auditPortal.ts';

const ALL: Statuses[] = [fileReview, scopeRequest, scopeState, queueKind, decisionWord];

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

test('what the server calls rejected, a person reads as turned down, in the same red, everywhere an auditor decides', () => {
  for (const registry of [fileReview, scopeRequest, scopeState, decisionWord]) {
    assert.equal(registry.label('rejected'), 'Turned down', registry.record);
    assert.equal(registry.tone('rejected'), 'danger', registry.record);
  }
});

test('a file and a scope request have exactly the words the server writes', () => {
  assert.deepEqual(fileReview.words, ['pending', 'approved', 'rejected']);
  assert.deepEqual(scopeRequest.words, ['pending', 'approved', 'rejected']);
  const model = new URL('../../../../backend/grc/models/_16_certification_journey_models.py', import.meta.url);
  if (existsSync(model)) assert.match(readFileSync(model, 'utf8'), /review_status = Column\(String\(50\), default="pending"\)/, 'a file is sent for review pending');
  const rule = new URL('../../../../backend/grc/modules/governance/routers/applicability.py', import.meta.url);
  if (existsSync(rule)) assert.match(readFileSync(rule, 'utf8'), /\("approved", "rejected"\)/, 'a reviewer sets approved or rejected');
});

test('a requirement that has no request is not "waiting", and a turned-down request is not "pending" any more', () => {
  assert.equal(scopeState.label('untouched'), 'No request yet');
  assert.equal(scopeState.tone('untouched'), 'neutral');
  assert.notEqual(scopeState.label('rejected'), scopeState.label('pending'));
  assert.deepEqual(scopeState.words, ['untouched', 'pending', 'in_scope', 'out_of_scope', 'rejected']);
});
