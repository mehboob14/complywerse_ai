// node --test "src/lib/statuses/assessmentLenses.test.ts"
// Every word the lenses can draw has a tone and a readable label; a word nobody registered is neutral and still readable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kpiStanding, planStatus, riskBand } from './assessmentLenses.ts';
import { statusPill } from '../status.ts';

test('the audit plan statuses each have a tone and a label', () => {
  assert.deepEqual(statusPill(planStatus, 'planned'), { tone: 'neutral', label: 'Planned' });
  assert.deepEqual(statusPill(planStatus, 'in_progress'), { tone: 'progress', label: 'In progress' });
  assert.deepEqual(statusPill(planStatus, 'In Progress'), { tone: 'progress', label: 'In progress' }, 'case and spacing do not matter');
  assert.equal(statusPill(planStatus, 'completed').tone, 'success');
  assert.equal(statusPill(planStatus, 'cancelled').tone, 'danger');
});

test('the risk bands, the DPIA and the NCA registers', () => {
  for (const [w, tone] of [['critical', 'danger'], ['high', 'warning'], ['medium', 'progress'], ['low', 'success'], ['none', 'neutral']] as const) assert.equal(statusPill(riskBand, w).tone, tone);
  assert.equal(statusPill(riskBand, 'critical').label, 'Critical');
});

test('where a KPI stands', () => {
  assert.equal(statusPill(kpiStanding, 'below').label, 'Below target');
  assert.equal(statusPill(kpiStanding, 'on').tone, 'success');
  assert.equal(statusPill(kpiStanding, 'external').tone, 'neutral');
});

test('a word nobody registered is neutral with a readable label', () => {
  assert.deepEqual(statusPill(planStatus, 'on_hold'), { tone: 'neutral', label: 'On hold' });
  assert.equal(statusPill(planStatus, '').tone, 'neutral');
  assert.equal(statusPill(riskBand, 'very_low').tone, 'neutral');
});
