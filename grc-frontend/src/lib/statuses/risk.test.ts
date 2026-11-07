// node --test "src/lib/statuses/risk.test.ts"
// The words of the Risk Register: every word the server writes has a tone and a readable label, the colours keep their meaning, a word nobody registered reads neutral with its own label.
// The status words are read from the server's own list (`_bucket_status` in modules/erm/routers/risks.py) so a new one fails here until it is registered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { TONE, statusPill } from '../status.ts';
import { riskActionStatus, riskLevel, riskReviewStatus, riskSla, riskSource, riskStatus, riskTreatment } from './risk.ts';

const ALL = [riskStatus, riskLevel, riskSla, riskTreatment, riskReviewStatus, riskActionStatus, riskSource];

test('every word has a tone of the platform\'s families and a readable label', () => {
  for (const reg of ALL) for (const w of reg.words) {
    assert.ok(Object.keys(TONE).includes(reg.tone(w)), `${reg.record}.${w}`);
    assert.ok(reg.label(w).length > 1 && reg.label(w) !== '—', `${reg.record}.${w}`);
  }
});

test('every status word the server folds is registered', () => {
  const src = new URL('../../../../backend/grc/modules/erm/routers/risks.py', import.meta.url);
  if (!existsSync(src)) return;
  const code = readFileSync(src, 'utf8');
  const fn = code.slice(code.indexOf('def _bucket_status'), code.indexOf('def get_risk_dashboard_by_register'));
  const known = new Set(Array.from(fn.matchAll(/"([a-z_]{2,})"/g), (m) => m[1]));
  for (const w of ['closed', 'resolved', 'cancelled', 'in_treatment', 'under_review', 'mitigating', 'mitigated', 'accepted']) assert.ok(known.has(w), `the server no longer writes "${w}"?`);
  const spellings = ['canceled', 'treating', 'under_treatment', 'in_progress', 'open'];          // folded spellings that are not words a risk is shown with
  for (const w of known) if (!spellings.includes(w)) assert.ok(riskStatus.has(w), `register "${w}" in lib/statuses/risk.ts`);
});

test('the colours keep their meaning: open amber, moving blue, done green, a decision purple, closed grey; critical red, high amber, medium blue, low green', () => {
  assert.deepEqual(['open', 'in_treatment', 'mitigated', 'accepted', 'closed'].map((w) => riskStatus.tone(w)), ['warning', 'progress', 'success', 'pending', 'neutral']);
  assert.deepEqual(['critical', 'high', 'medium', 'low', 'none'].map((w) => riskLevel.tone(w)), ['danger', 'warning', 'progress', 'success', 'neutral']);
  assert.deepEqual(['breached', 'due_soon', 'on_track'].map((w) => riskSla.tone(w)), ['danger', 'warning', 'success']);
  assert.equal(riskLevel.label('none'), 'Not scored');
  assert.equal(riskSla.label('breached'), 'Overdue');
  assert.equal(riskStatus.label('in_treatment'), 'In treatment');
});

test('an unknown word is neutral with a readable label', () => {
  assert.deepEqual(statusPill(riskStatus, 'awaiting_board'), { tone: 'neutral', label: 'Awaiting board' });
  assert.equal(riskStatus.label(null), '—');
});
