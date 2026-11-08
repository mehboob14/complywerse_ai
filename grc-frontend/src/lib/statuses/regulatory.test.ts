// node --test "src/lib/statuses/regulatory.test.ts"
// The words of Regulatory Changes and the Feed: every word the server writes has a tone and a label (and nothing else is registered), the colours keep their meaning, and a word nobody
// registered reads neutral with a readable label. The server's own lists are read from the backend sources, so a new word fails here until it is registered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { TONE, priority, type Statuses } from '../status.ts';
import { analysisStatus, assessmentKind, changeStatus, compliance, feedItemStatus, gapState, linkStatus, obligationType, optionsOf, taskStatus, taskType } from './regulatory.ts';

const ALL: Statuses[] = [changeStatus, compliance, taskStatus, linkStatus, feedItemStatus, analysisStatus, gapState, taskType, obligationType, assessmentKind];
const BACKEND = new URL('../../../../backend/grc/', import.meta.url);
const read = (path: string): string | null => (existsSync(new URL(path, BACKEND)) ? readFileSync(new URL(path, BACKEND), 'utf8') : null);
const list = (source: string | null, pattern: RegExp): string[] | null => {
  const m = source ? pattern.exec(source) : null;
  return m ? Array.from(m[1].matchAll(/"([a-z_]+)"/g)).map((x) => x[1]) : null;
};

test('every word has a tone that exists and a readable label; no word is blank', () => {
  for (const registry of ALL) {
    assert.ok(registry.words.length > 0, registry.record);
    for (const word of registry.words) {
      assert.ok(Object.keys(TONE).includes(registry.tone(word)), `${registry.record}.${word}: tone`);
      assert.match(registry.label(word), /^[A-Z][A-Za-z -]+$/, `${registry.record}.${word}: label`);
    }
  }
});

test('a change status reads as the module always said it, with the full words for the two that were short', () => {
  assert.deepEqual(optionsOf(changeStatus), [
    { value: 'identified', label: 'Identified' }, { value: 'under_assessment', label: 'Under assessment' }, { value: 'implementation', label: 'Implementation' },
    { value: 'completed', label: 'Completed' }, { value: 'closed', label: 'Closed' }, { value: 'not_applicable', label: 'Not applicable' },
  ]);
  assert.equal(compliance.label('partially_compliant'), 'Partially compliant', 'the pill used to say "Partial"');
  assert.equal(compliance.label('not_applicable'), 'Not applicable', 'the pill used to say "N/A"');
  assert.equal(feedItemStatus.label('processed'), 'Converted');
  assert.equal(feedItemStatus.label('ignored'), 'Not relevant');
});

test('colours keep their meaning: done is success, refused or late is danger, waiting is pending, a kind has no meaning to colour', () => {
  assert.equal(changeStatus.tone('completed'), 'success');
  assert.equal(changeStatus.tone('closed'), 'success');
  assert.equal(changeStatus.tone('identified'), 'pending');
  assert.equal(compliance.tone('non_compliant'), 'danger');
  assert.equal(compliance.tone('compliant'), 'success');
  assert.equal(taskStatus.tone('blocked'), 'danger');
  assert.equal(linkStatus.tone('proposed'), 'pending');
  assert.equal(analysisStatus.tone('failed'), 'danger');
  for (const kind of [taskType, obligationType, assessmentKind]) for (const word of kind.words) assert.equal(kind.tone(word), 'neutral', `${kind.record}.${word}`);
  assert.equal(priority.tone('critical'), 'danger', 'priorities are the platform\'s scale');
});

test('a word nobody registered is neutral with a readable label', () => {
  assert.equal(changeStatus.tone('under_audit'), 'neutral');
  assert.equal(changeStatus.label('under_audit'), 'Under audit');
  assert.equal(feedItemStatus.label(undefined), '—');
});

test('the server\'s lists are all registered, and nothing else is', () => {
  const statuses = list(read('modules/governance/routers/regulatory_changes.py'), /valid_statuses = \[([^\]]+)\]/);
  if (statuses) assert.deepEqual(changeStatus.words.slice().sort(), statuses.slice().sort(), 'RegulatoryChange.status');
  const compl = list(read('modules/governance/routers/regulatory_changes.py'), /_COMPLIANCE_STATUSES = \(([^)]+)\)/);
  if (compl) assert.deepEqual(compliance.words.slice().sort(), compl.slice().sort(), 'compliance_status');
  const types = list(read('modules/governance/regulatory_engine.py'), /OBLIGATION_TYPES = \(([^)]+)\)/) ?? list(read('modules/governance/regulatory_engine.py'), /OBLIGATION_TYPES = \[([^\]]+)\]/);
  if (types) assert.deepEqual(obligationType.words.slice().sort(), types.slice().sort(), 'obligation_type');
});
