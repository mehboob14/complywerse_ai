// node --test "src/lib/statuses/reports.test.ts"
// The words of the Reports library and Dashboards: every word has a tone that exists and a readable label, the colours keep their meaning, and a word nobody registered reads neutral.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TONE, type Statuses } from '../status.ts';
import { reportSync, reportVisibility, tileState } from './reports.ts';

const ALL: Statuses[] = [reportSync, reportVisibility, tileState];

test('every word has a tone that exists and a readable label', () => {
  for (const registry of ALL) {
    assert.ok(registry.words.length > 0, registry.record);
    for (const word of registry.words) {
      assert.ok(Object.keys(TONE).includes(registry.tone(word)), `${registry.record}.${word}: tone`);
      assert.match(registry.label(word), /^[A-Z][A-Za-z' ]+$/, `${registry.record}.${word}: label`);
    }
  }
});

test('where a report lives: saved is success, kept on this device is a warning, a server refusal is danger', () => {
  assert.deepEqual(reportSync.words, ['synced', 'device', 'refused']);
  assert.equal(reportSync.tone('synced'), 'success');
  assert.equal(reportSync.tone('device'), 'warning');
  assert.equal(reportSync.tone('refused'), 'danger');
  assert.equal(reportSync.label('device'), 'This device only');
  assert.equal(reportSync.label('refused'), 'Not accepted');
});

test('who can open it: the three words a person reads in the Visibility column', () => {
  assert.deepEqual(reportVisibility.words.map((w) => reportVisibility.label(w)), ['Only you', 'Shared', 'Shared with you']);
});

test('a tile that cannot draw its report says which of the four reasons it is', () => {
  assert.deepEqual(tileState.words.map((w) => tileState.label(w)), ['Report not available', 'No access to this module', "Couldn't load", 'Part of the data']);
  assert.equal(tileState.tone('error'), 'danger');
  assert.equal(tileState.tone('no_module'), 'neutral');
});

test('a word nobody registered is neutral with a readable label, and no word is a vendor or a technical term', () => {
  for (const registry of ALL) {
    assert.equal(registry.tone('something_new'), 'neutral');
    assert.equal(registry.label('something_new'), 'Something new');
    for (const word of registry.words) assert.doesNotMatch(registry.label(word), /openai|gpt|metabase|sql|http|id\b/i, `${registry.record}.${word}`);
  }
});
