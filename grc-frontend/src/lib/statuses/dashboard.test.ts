// node --test "src/lib/statuses/dashboard.test.ts"
// The Performance Overview's words: one vocabulary for a score (the server's grade), every grade the page can show has a tone and a readable label, a KPI is on target, below it
// or not measured, an unknown word reads neutral with its own readable label, and the old band / posture words are gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { statusPill } from '../status.ts';
import { GRADES, GRADE_LINES, gradeOf } from '../perf/moduleFeeds.ts';
import { gradeStatus, kpiTarget } from './dashboard.ts';
import * as registries from './dashboard.ts';

test('the grade words are the server\'s four, every one the page can show is registered: green excellent and good, amber fair, red poor', () => {
  assert.deepEqual(gradeStatus.words, ['excellent', 'good', 'fair', 'poor']);
  assert.deepEqual([...GRADES], gradeStatus.words.slice(), 'moduleFeeds writes exactly the words that are registered');
  assert.deepEqual(GRADES.map((g) => gradeStatus.tone(g)), ['success', 'success', 'warning', 'danger']);
  assert.deepEqual(GRADES.map((g) => gradeStatus.label(g)), ['Excellent', 'Good', 'Fair', 'Poor']);
  assert.deepEqual(GRADES.map((g) => statusPill(gradeStatus, g).label), ['Excellent', 'Good', 'Fair', 'Poor'], 'a grade is always a word, never a colour alone');
});

test('a score becomes a grade by the server\'s cut, 85 / 70 / 50, at the edges and nowhere else', () => {
  assert.deepEqual(GRADE_LINES, { excellent: 85, good: 70, fair: 50 });
  assert.deepEqual([100, 85, 84.9, 70, 69.9, 50, 49.9, 0].map(gradeOf), ['excellent', 'excellent', 'good', 'good', 'fair', 'fair', 'poor', 'poor']);
  assert.equal(gradeOf(null), null);
  assert.equal(gradeOf(Number.NaN), null);
  // the same cut the scorecards write: backend/grc/modules/compliance/routers/dashboard.py (the backend is not in every checkout)
  let source = '';
  try { source = readFileSync(new URL('../../../../backend/grc/modules/compliance/routers/dashboard.py', import.meta.url), 'utf8'); } catch { /* not in this checkout */ }
  if (source) assert.match(source, /"excellent" if perf >= 85 else "good" if perf >= 70\s+else "fair" if perf >= 50 else "poor"/);
});

test('the older vocabularies are gone from this file: no strong / fair / weak band, no low / moderate / elevated posture, no control-status donut', () => {
  assert.deepEqual(Object.keys(registries).sort(), ['gradeStatus', 'kpiTarget']);
});

test('a KPI is on target, below it, or not measured: never a colour alone, and not measured is not "below target"', () => {
  assert.deepEqual(['on_target', 'below_target', 'not_measured'].map((w) => statusPill(kpiTarget, w)), [
    { tone: 'success', label: 'On target' }, { tone: 'danger', label: 'Below target' }, { tone: 'neutral', label: 'Not measured' },
  ]);
  assert.equal(kpiTarget.has('Below target'), true, 'the readable form is one spelling of the word');
});

test('an unknown word is neutral with its own readable label, and none at all is the dash: never a guess', () => {
  for (const registry of [gradeStatus, kpiTarget]) {
    assert.equal(registry.tone('something_new'), 'neutral', registry.record);
    assert.equal(registry.label('something_new'), 'Something new', registry.record);
    assert.equal(registry.label(null), '—', registry.record);
    assert.equal(registry.tone('constructor'), 'neutral', registry.record);
  }
});
