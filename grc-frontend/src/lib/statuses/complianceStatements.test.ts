// node --test "src/lib/statuses/complianceStatements.test.ts"
// The words of the statements register: every word the page can show has a tone and a readable label, an unknown word reads neutral with its own label, and the five
// compliance words are the five the server accepts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { statusPill, type Statuses } from '../status.ts';
import { areaBand, statementCompliance, statementPriority } from './complianceStatements.ts';

const ALL: Statuses[] = [statementCompliance, statementPriority, areaBand];

test('every registered word has a tone and a readable label; an unknown word is neutral with its own label', () => {
  for (const registry of ALL) {
    assert.ok(registry.words.length > 0, registry.record);
    for (const word of registry.words) {
      assert.match(registry.tone(word), /^(success|danger|warning|progress|pending|neutral)$/, `${registry.record}: ${word}`);
      assert.ok(registry.label(word).trim().length > 1 && registry.label(word) !== '—', `${registry.record}: ${word} has a label`);
    }
    assert.deepEqual(statusPill(registry, 'some_new_word'), { tone: 'neutral', label: 'Some new word' }, registry.record);
    assert.equal(registry.tone('constructor'), 'neutral', `${registry.record}: not an inherited property`);
  }
});

test('the compliance words are said the way people say them (one capital, hyphen in non-compliant) and match what the server accepts', () => {
  assert.deepEqual(statementCompliance.words.map((w) => statementCompliance.label(w)), ['Compliant', 'Partially compliant', 'Non-compliant', 'Not assessed', 'Not applicable']);
  assert.deepEqual(['compliant', 'partially_compliant', 'non_compliant', 'not_assessed'].map((w) => statementCompliance.tone(w)), ['success', 'warning', 'danger', 'neutral']);
  const url = new URL('../../../../backend/grc/modules/compliance/routers/statements.py', import.meta.url);
  if (existsSync(url)) {
    const text = readFileSync(url, 'utf8');
    const m = /valid_statuses = \[([^\]]+)\]/.exec(text);
    assert.ok(m, 'the server lists the words it accepts');
    const server = (m as RegExpExecArray)[1].split(',').map((s) => s.trim().replace(/"/g, ''));
    assert.deepEqual(statementCompliance.words.slice().sort(), server.slice().sort());
  }
});

test('priority runs critical to low with a tone each (a statement with none is not given one: the register shows a dash)', () => {
  assert.deepEqual(statementPriority.words, ['critical', 'high', 'medium', 'low']);
  assert.deepEqual(statementPriority.words.map((w) => statementPriority.tone(w)), ['danger', 'warning', 'progress', 'neutral']);
});
