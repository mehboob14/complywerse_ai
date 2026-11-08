// node --test "src/lib/statuses/frameworkRegisters.test.ts"
// The words of the Registers and Artifacts tabs: every word has a tone and a readable label, an unknown word reads neutral with its own label, and
// every colour word the register definitions and the ISO configs use maps to a tone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { statusPill, type Statuses } from '../status.ts';
import { REGISTER_CONFIGS } from '../../app/(dashboard)/frameworks/[id]/_tabs/templateConfigs.ts';
import {
  artifactStatus, assetCriticality, documentSectionState, frameworkDocumentStatus, registerTone, LEGACY_TONE_WORDS,
} from './frameworkRegisters.ts';

const ALL: Statuses[] = [frameworkDocumentStatus, documentSectionState, artifactStatus, assetCriticality];

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

test('a document goes draft, in review, approved; a section to start, draft, ready', () => {
  assert.deepEqual(frameworkDocumentStatus.words, ['draft', 'in_review', 'approved']);
  assert.deepEqual(['draft', 'in_review', 'approved'].map((w) => frameworkDocumentStatus.label(w)), ['Draft', 'In review', 'Approved']);
  assert.equal(frameworkDocumentStatus.tone('approved'), 'success');
  assert.deepEqual(documentSectionState.words, ['to_start', 'draft', 'ready']);
  assert.deepEqual(['to_start', 'draft', 'ready'].map((w) => documentSectionState.label(w)), ['To start', 'Draft', 'Ready']);
});

test('the four words of an artifact are the four the form can send, and an asset is critical, high, medium or low', () => {
  assert.deepEqual(artifactStatus.words, ['draft', 'in_review', 'approved', 'archived']);
  assert.deepEqual(assetCriticality.words, ['low', 'medium', 'high', 'critical']);
  assert.equal(assetCriticality.tone('critical'), 'danger');
  assert.equal(assetCriticality.label('HIGH'), 'High');
});

test('a colour word of a register definition maps to a tone, an unknown or missing one to neutral', () => {
  assert.deepEqual(['slate', 'emerald', 'amber', 'orange', 'rose', 'sky', 'teal'].map((w) => registerTone(w)),
    ['neutral', 'success', 'warning', 'warning', 'danger', 'progress', 'progress']);
  assert.equal(registerTone('Rose'), 'danger');
  assert.equal(registerTone(undefined), 'neutral');
  assert.equal(registerTone('purple'), 'neutral');
  assert.equal(registerTone('constructor'), 'neutral');
});

test('every colour word the shipped definitions and the ISO configs use is a word the mapper knows', () => {
  const used = new Set<string>();
  for (const cfg of Object.values(REGISTER_CONFIGS)) for (const col of cfg.columns) for (const o of col.options ?? []) if (o.tone) used.add(o.tone);
  const dir = fileURLToPath(new URL('../../../../backend/grc/seed_data/framework_templates/', import.meta.url));
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('_'))) {
      const def = JSON.parse(readFileSync(dir + f, 'utf8'));
      for (const reg of def.registers ?? []) for (const col of reg.columns ?? []) for (const o of col.options ?? []) if (o.tone) used.add(o.tone);
    }
  }
  assert.ok(used.size > 0);
  for (const word of Array.from(used)) assert.ok(LEGACY_TONE_WORDS.indexOf(word) >= 0, `${word} has no tone`);
});
