// node --test "src/lib/statuses/dashboard.test.ts"
// The Performance Overview's words: every word the dashboard's code can produce has a tone and a readable label (checked against the files that write them),
// an unknown word reads neutral with its own readable label, and the tones keep the meaning the old colours had (green strong, amber fair, red weak).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { statusPill } from '../status.ts';
import { bandStatus, controlImplementation, kpiTarget, riskPosture } from './dashboard.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('every band word score-kit writes is registered, and nothing else is: green strong, amber fair, red weak, grey no data', () => {
  const kit = read('../../components/dashboard/score-kit.tsx');
  const written = Array.from(kit.matchAll(/label: '([a-z ]+)'/g), (m) => m[1]);
  assert.deepEqual(written, ['strong', 'fair', 'weak', 'no data'], 'scoreBand writes these four words: add a new one to bandStatus first');
  for (const word of written) assert.ok(bandStatus.has(word), word);
  assert.deepEqual(bandStatus.words.map((w) => bandStatus.tone(w)), ['success', 'warning', 'danger', 'neutral']);
  assert.deepEqual(['strong', 'fair', 'weak', 'no data'].map((w) => bandStatus.label(w)), ['Strong', 'Fair', 'Weak', 'No data']);
});

test('the risk posture words are the three the tile writes, with the tones of a risk: low is good, elevated is bad', () => {
  const model = read('../../app/(dashboard)/dashboard/_overview/overviewModel.ts');
  const written = Array.from(model.matchAll(/return '(Low|Moderate|Elevated)'/g), (m) => m[1].toLowerCase());
  assert.deepEqual(written, ['low', 'moderate', 'elevated']);
  for (const word of written) assert.ok(riskPosture.has(word), word);
  assert.deepEqual(['Low', 'Moderate', 'Elevated'].map((w) => riskPosture.tone(w)), ['success', 'warning', 'danger']);
  assert.deepEqual(['Low', 'Moderate', 'Elevated'].map((w) => riskPosture.label(w)), ['Low', 'Moderate', 'Elevated']);
});

test('a KPI is on target, below it, or not measured: never a colour alone, and not measured is not "below target"', () => {
  assert.deepEqual(['on_target', 'below_target', 'not_measured'].map((w) => statusPill(kpiTarget, w)), [
    { tone: 'success', label: 'On target' }, { tone: 'danger', label: 'Below target' }, { tone: 'neutral', label: 'Not measured' },
  ]);
  assert.equal(kpiTarget.has('Below target'), true, 'the readable form is one spelling of the word');
});

test('every control status the frameworks aggregate writes is registered with a tone (the donut takes its colours from them)', () => {
  const backend = new URL('../../../../backend/grc/modules/compliance/routers/dashboard.py', import.meta.url);
  let source = '';
  try { source = readFileSync(backend, 'utf8'); } catch { /* the backend is not in every checkout */ }
  const block = /STATUS_LABELS = \{([\s\S]*?)\}/.exec(source)?.[1] ?? '';
  const words = Array.from(block.matchAll(/"([a-z_]+)":/g), (m) => m[1]);
  if (words.length) for (const word of words) assert.ok(controlImplementation.has(word), `${word} is written by the server and not registered`);
  assert.deepEqual(controlImplementation.words, ['verified', 'implemented', 'in_progress', 'not_started', 'not_applicable']);
  assert.deepEqual(controlImplementation.words.map((w) => controlImplementation.tone(w)), ['success', 'progress', 'warning', 'neutral', 'neutral']);
  assert.equal(controlImplementation.label('in_progress'), 'In progress');
});

test('an unknown word is neutral with its own readable label, and none at all is the dash: never a guess', () => {
  for (const registry of [bandStatus, riskPosture, kpiTarget, controlImplementation]) {
    assert.equal(registry.tone('something_new'), 'neutral', registry.record);
    assert.equal(registry.label('something_new'), 'Something new', registry.record);
    assert.equal(registry.label(null), '—', registry.record);
    assert.equal(registry.tone('constructor'), 'neutral', registry.record);
  }
});
