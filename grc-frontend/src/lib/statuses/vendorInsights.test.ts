// node --test "src/lib/statuses/vendorInsights.test.ts"
// The words of Insights: every word a page can show has a tone of the platform's families and a readable label; the report kinds are the server's (read from tpra/reports.py); a word nobody
// registered reads neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { TONE, statusPill } from '../status.ts';
import {
  ANALYSIS_EFFECTS, EFFECT_WORDS, REPORT_KINDS, analysisConfidence, analysisCover, analysisRisk, analysisState, reportKind, reportState,
} from './vendorInsights.ts';

const ALL = [analysisState, analysisCover, analysisRisk, analysisConfidence, reportState, reportKind];

test('every word has a tone of the platform\'s families and a readable label', () => {
  for (const reg of ALL) for (const w of reg.words) {
    assert.ok(Object.keys(TONE).includes(reg.tone(w)), `${reg.record}.${w}`);
    assert.ok(reg.label(w).length > 1 && reg.label(w) !== '—', `${reg.record}.${w}`);
  }
  REPORT_KINDS.forEach((k) => assert.ok(reportKind.words.includes(k), `kind ${k}`));
  ANALYSIS_EFFECTS.forEach((e) => assert.ok(EFFECT_WORDS[e].length > 3, `effect ${e}`));
});

test('the report kinds and their labels are the ones the server writes', () => {
  const src = new URL('../../../../backend/grc/modules/vendor_risk/tpra/reports.py', import.meta.url);
  if (!existsSync(src)) return;
  const block = /KINDS = \{([^}]+)\}/.exec(readFileSync(src, 'utf8'))?.[1] ?? '';
  const pairs = Array.from(block.matchAll(/"([a-z_]+)":\s*"([^"]+)"/g)).map((m) => [m[1], m[2]]);
  assert.deepEqual(pairs.map((p) => p[0]), Array.from(REPORT_KINDS), 'reports.py KINDS and lib/statuses/vendorInsights.ts say the same kinds');
  pairs.forEach(([key, label]) => assert.equal(reportKind.label(key), label, key));
});

test('a draft is waiting for someone, an approved report is good, a shared one is live; none rests on colour alone', () => {
  assert.equal(reportState.tone('draft'), 'pending');
  assert.equal(reportState.tone('approved'), 'success');
  assert.equal(statusPill(reportState, 'shared').label, 'Shared with an examiner');
  assert.notEqual(analysisState.label('draft'), analysisState.label('final'));
});

test('insurance that falls short is a warning, not a danger, and says so in words', () => {
  assert.equal(analysisCover.tone('short'), 'warning');
  assert.equal(analysisCover.label('none'), 'No cover recorded');
  assert.equal(analysisCover.tone('covers'), 'success');
});

test('a word nobody registered reads neutral with a readable label', () => {
  assert.equal(analysisRisk.tone('catastrophic'), 'neutral');
  assert.equal(analysisRisk.label('very_high'), 'Very high');
  assert.equal(reportState.tone('constructor'), 'neutral');
});
