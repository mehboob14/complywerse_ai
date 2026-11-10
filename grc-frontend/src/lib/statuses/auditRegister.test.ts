// node --test "src/lib/statuses/auditRegister.test.ts"
// The status words of the Issue Register: every word a page can show has a tone and a readable label, an unknown word reads neutral with its own label, the six status codes of the
// client's workbook are all registered (and said in full), and the sources are the ones the importer writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { statusPill, type Statuses } from '../status.ts';
import { NOT_PASSED, STATUS_CODE, STATUS_ORDER, extensionStatus, findingSource, findingStatus, riskRating, validationResult, validationStage } from './auditRegister.ts';

const ALL: Statuses[] = [findingStatus, riskRating, findingSource, extensionStatus, validationStage, validationResult];

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

test('the six codes of the client\'s workbook are registered and said in full; past due is red, closed is green', () => {
  assert.deepEqual(STATUS_ORDER.filter((s) => s !== 'unstated'), ['NS', 'IP', 'DE', 'PD', 'EXT', 'CD']);
  for (const code of STATUS_ORDER) assert.ok(findingStatus.has(code), code);
  assert.deepEqual(Object.keys(STATUS_CODE), ['NS', 'IP', 'DE', 'PD', 'EXT', 'CD']);
  assert.equal(findingStatus.label('PD'), 'Past due');
  assert.equal(findingStatus.tone('PD'), 'danger');
  assert.equal(findingStatus.tone('DE'), 'warning');
  assert.equal(findingStatus.tone('CD'), 'success');
  assert.equal(findingStatus.label('unstated'), 'No status');
  // the words are said in full: none is just its code
  for (const code of STATUS_ORDER) assert.notEqual(findingStatus.label(code), code);
});

test('the status words are the codes the server computes (summary.effective_status)', () => {
  const file = new URL('../../../../backend/grc/modules/issue_management/audit_register/summary.py', import.meta.url);
  if (!existsSync(file)) return;
  const src = readFileSync(file, 'utf8');
  for (const code of ['NS', 'IP', 'DE', 'PD', 'EXT', 'CD', 'unstated']) assert.match(src, new RegExp(`["']${code}["']`), code);
});

test('the sources are the ones the importer writes', () => {
  const file = new URL('../../../../backend/grc/modules/issue_management/audit_register/template.py', import.meta.url);
  if (!existsSync(file)) return;
  const m = /SOURCES = \(([^)]*)\)/.exec(readFileSync(file, 'utf8'));
  assert.ok(m, 'SOURCES is in template.py');
  const written = Array.from((m as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)).map((x) => x[1]);
  for (const source of written) assert.ok(findingSource.has(source), `${source} is registered`);
});

test('an extension request waits for the committee until it is decided, and a rejection is not "rejected" to a person', () => {
  assert.equal(extensionStatus.label('requested'), 'Waiting for the committee');
  assert.equal(extensionStatus.tone('requested'), 'pending');
  assert.equal(extensionStatus.label('rejected'), 'Not approved');
  assert.deepEqual(extensionStatus.words, ['requested', 'approved', 'rejected', 'withdrawn']);
});

test('validation: three results Audit Services can decide, and two ways of not passing', () => {
  assert.deepEqual(validationResult.words, ['pass', 'more_info', 'fail']);
  assert.deepEqual(NOT_PASSED.map((n) => n.value), ['more_info', 'fail']);
  for (const n of NOT_PASSED) assert.ok(validationResult.has(n.value) && n.hint.length > 10);
  assert.deepEqual(validationStage.words, ['open', 'awaiting_validation', 'closed']);
});

test('a risk rating is read in any case, as the workbook writes it', () => {
  assert.equal(riskRating.tone('High'), 'danger');
  assert.equal(riskRating.tone('MODERATE'), 'warning');
  assert.equal(riskRating.tone('Low'), 'neutral');
  assert.equal(riskRating.label('Moderate'), 'Moderate');
});
