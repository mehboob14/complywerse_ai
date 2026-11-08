// node --test "src/lib/statuses/assessments.test.ts"
// The words of Risk Assessments: every word the server writes has a tone and a readable label, one tone per word for the whole area, an unknown word is neutral with its own label.
// The manual and framework statuses are read from the server's own lists so a new one fails here until it is registered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { TONE, statusPill } from '../status.ts';
import {
  aiEntryStatus, assessmentStatus, controlEffectiveness, frameworkAssessmentStatus, questionStatus, residualWord, suggestionSource, thresholdStatus, treatmentDecision,
} from './assessments.ts';

const ALL = [assessmentStatus, frameworkAssessmentStatus, questionStatus, aiEntryStatus, residualWord, treatmentDecision, controlEffectiveness, thresholdStatus, suggestionSource];

test('every word has a tone of the platform\'s families and a readable label', () => {
  for (const reg of ALL) for (const w of reg.words) {
    assert.ok(Object.keys(TONE).includes(reg.tone(w)), `${reg.record}.${w}`);
    assert.ok(reg.label(w).length > 1 && reg.label(w) !== '—', `${reg.record}.${w}`);
  }
});

test('every status word the server writes is registered', () => {
  const root = new URL('../../../../backend/grc/modules/erm/routers/', import.meta.url);
  if (!existsSync(new URL('risk_assessments.py', root))) return;
  const manual = readFileSync(new URL('risk_assessments.py', root), 'utf8');
  const block = manual.slice(manual.indexOf('VALID_STATUS_TRANSITIONS = {'), manual.indexOf('def _get_assessment_or_404'));
  const words = new Set(Array.from(block.matchAll(/"([a-z_]+)"/g), (m) => m[1]));
  ['draft', 'in_progress', 'under_review', 'approved', 'closed'].forEach((w) => assert.ok(words.has(w), `the server no longer writes "${w}"?`));
  words.forEach((w) => assert.ok(assessmentStatus.has(w), `register "${w}" in lib/statuses/assessments.ts`));
  const fw = readFileSync(new URL('framework_risk_assessments.py', root), 'utf8');
  const q = /VALID_QUESTION_STATUSES = \{([^}]*)\}/.exec(fw);
  assert.ok(q, 'VALID_QUESTION_STATUSES');
  Array.from((q as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g), (m) => m[1]).forEach((w) => assert.ok(questionStatus.has(w), `register question "${w}"`));
});

test('the colours keep their meaning: moving blue, waiting purple, done green, blocked red, at rest grey', () => {
  assert.deepEqual(['draft', 'in_progress', 'under_review', 'approved', 'closed'].map((w) => assessmentStatus.tone(w)), ['neutral', 'progress', 'pending', 'success', 'neutral']);
  assert.deepEqual(['not_started', 'in_progress', 'completed', 'blocked'].map((w) => questionStatus.tone(w)), ['neutral', 'progress', 'success', 'danger']);
  // the same word is the same colour on both kinds of assessment and on a question
  assert.equal(assessmentStatus.tone('in_progress'), frameworkAssessmentStatus.tone('in_progress'));
  assert.equal(frameworkAssessmentStatus.tone('in_progress'), questionStatus.tone('in_progress'));
  assert.equal(assessmentStatus.label('under_review'), 'Under review');
  assert.equal(controlEffectiveness.label('partially_effective'), 'Partly effective');
});

test('the AI-system words are read the way the server stores them (Title Case, with a space)', () => {
  assert.equal(statusPill(aiEntryStatus, 'In Progress').label, 'In progress');
  assert.equal(statusPill(aiEntryStatus, 'Open').tone, 'warning');
  assert.equal(statusPill(residualWord, 'High').label, 'High');
});

test('a rules answer and an AI answer read differently', () => {
  assert.equal(suggestionSource.label('rules'), 'Suggested by rules');
  assert.equal(suggestionSource.label('ai'), 'Suggested by AI');
});

test('an unknown word is neutral with a readable label', () => {
  assert.deepEqual(statusPill(assessmentStatus, 'awaiting_board'), { tone: 'neutral', label: 'Awaiting board' });
  assert.equal(assessmentStatus.label(null), '—');
});
