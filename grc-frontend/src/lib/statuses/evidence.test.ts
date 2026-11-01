// node --test "src/lib/statuses/evidence.test.ts"
// The status words of Evidence Management: every word the workspace and the catalogue can show has a tone and a label, an unknown word reads neutral with a
// readable label, the lists the backend writes are all registered, and the AI-review words say what is happening (a stuck run is never "rating").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { statusPill, type Statuses } from '../status.ts';
import { evidenceStatus, expiryState, maturityLevel, ocrStatus, requirementStatus, reviewState } from './evidence.ts';

const ALL: Statuses[] = [evidenceStatus, reviewState, maturityLevel, expiryState, ocrStatus, requirementStatus];

test('every registered word has a tone, a readable label, and an unknown word is neutral with its own label', () => {
  for (const registry of ALL) {
    assert.ok(registry.words.length > 0, registry.record);
    for (const word of registry.words) {
      assert.ok(registry.has(word), `${registry.record}: ${word}`);
      assert.match(registry.tone(word), /^(success|danger|warning|progress|pending|neutral)$/, `${registry.record}: ${word}`);
      assert.ok(registry.label(word).trim().length > 1 && registry.label(word) !== '—', `${registry.record}: ${word} has a label`);
    }
    assert.deepEqual(statusPill(registry, 'some_new_word'), { tone: 'neutral', label: 'Some new word' }, registry.record);
    assert.equal(statusPill(registry, null).label, '—', `${registry.record}: a missing word is the dash`);
    assert.equal(registry.tone('constructor'), 'neutral', `${registry.record}: not an inherited property`);
  }
});

test('evidence status: the words the server writes, the labels the page always showed, the tones of the platform', () => {
  assert.deepEqual(
    ['draft', 'pending_review', 'approved', 'rejected', 'expired', 'archived', 'stale'].map((w) => evidenceStatus.label(w)),
    ['Draft', 'Pending review', 'Approved', 'Rejected', 'Expired', 'Archived', 'Stale'],
  );
  assert.deepEqual(
    ['draft', 'pending_review', 'approved', 'rejected', 'expired', 'archived', 'stale'].map((w) => evidenceStatus.tone(w)),
    ['neutral', 'pending', 'success', 'danger', 'danger', 'neutral', 'warning'],
  );
  // the module's own list of statuses (backend router.py) is registered word for word
  const url = new URL('../../../../backend/grc/modules/evidence/router.py', import.meta.url);
  if (existsSync(url)) {
    const text = readFileSync(url, 'utf8');
    const block = /"statuses":\s*\[([^\]]*)\]/.exec(text);
    assert.ok(block, 'the backend lists its statuses');
    const words = Array.from((block as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)).map((m) => m[1]);
    assert.ok(words.length >= 6);
    for (const word of words) assert.ok(evidenceStatus.has(word), `the backend writes "${word}" and the page does not know it`);
  }
});

test('the AI-review words: a run in progress is told by its step, a failed or lost run is said as such, a file with no run is "not rated yet"', () => {
  assert.deepEqual(
    ['queued', 'reading', 'rating', 'matching'].map((w) => [reviewState.tone(w), reviewState.label(w)]),
    [['progress', 'Waiting to start'], ['progress', 'Reading the file'], ['progress', 'AI rating'], ['progress', 'Matching to clauses']],
  );
  assert.deepEqual(statusPill(reviewState, 'failed'), { tone: 'danger', label: 'Not rated' });
  assert.deepEqual(statusPill(reviewState, 'stopped'), { tone: 'danger', label: 'Review stopped' });
  assert.deepEqual(statusPill(reviewState, 'ocr_stalled'), { tone: 'warning', label: 'Reading stalled' });
  assert.deepEqual(statusPill(reviewState, 'unavailable'), { tone: 'neutral', label: "Can't be rated by AI" });
  assert.deepEqual(statusPill(reviewState, 'none'), { tone: 'neutral', label: 'Not rated yet' });
  assert.deepEqual(statusPill(reviewState, 'rated'), { tone: 'success', label: 'Rated' });
  // the UI says "AI", never a model or a vendor
  for (const registry of ALL) for (const word of registry.words) assert.doesNotMatch(registry.label(word), /gpt|openai|claude|anthropic|model/i, `${registry.record}: ${word}`);
});

test('maturity bands keep the thresholds the workspace always drew (80, 60, 40) and expiry keeps its 30 days; OCR words are plain', () => {
  assert.deepEqual(['strong', 'fair', 'weak', 'poor', 'unrated'].map((w) => maturityLevel.tone(w)), ['success', 'progress', 'warning', 'danger', 'neutral']);
  assert.deepEqual(['expired', 'expiring', 'valid', 'none'].map((w) => expiryState.tone(w)), ['danger', 'warning', 'success', 'neutral']);
  assert.deepEqual(['pending', 'processing', 'completed', 'failed', 'not_applicable'].map((w) => ocrStatus.label(w)), ['Waiting', 'Reading', 'Done', 'Failed', 'Not needed']);
});

test('requirement words: the five states of the catalogue workflow, in the order a requirement moves through them', () => {
  assert.deepEqual(requirementStatus.words, ['draft', 'submitted', 'pending_review', 'approved', 'rejected']);
  assert.deepEqual(requirementStatus.words.map((w) => requirementStatus.label(w)), ['Draft', 'Submitted', 'Pending review', 'Approved', 'Rejected']);
  assert.deepEqual(requirementStatus.words.map((w) => requirementStatus.tone(w)), ['neutral', 'progress', 'pending', 'success', 'danger']);
  // the model's own comment on the column names the same five words (backend models/_17)
  const url = new URL('../../../../backend/grc/models/_17_framework_upload_parsing_models.py', import.meta.url);
  if (existsSync(url)) assert.match(readFileSync(url, 'utf8'), /draft -> submitted -> pending_review -> approved\/rejected/);
});
