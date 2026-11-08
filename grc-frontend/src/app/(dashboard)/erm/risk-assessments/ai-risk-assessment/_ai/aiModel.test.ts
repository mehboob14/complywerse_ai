// node --test "src/app/(dashboard)/erm/risk-assessments/ai-risk-assessment/_ai/aiModel.test.ts"
// The rules of the AI System Risks register: the area's one band system on the likelihood x impact score (the old page used 15 / 8), the Overview's overdue rule, where a suggestion came from,
// the filters and quick views, the address, and the fix for "Accept the suggestion, then Save changes, erases what was accepted".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress } from '../../../../../../lib/addressState.ts';
import {
  AI_SCHEMA, DEFAULT_SORT, EMPTY_FORM, NO_AI_FILTERS, bodyOf, filterCount, filterEntries, filtersOf, formOf, inQuick, isOverdue, levelOf, mergeAccepted, nextSort, openIdOf, scoreOf, sortEntries,
  suggestionOf, type AiAddress, type AiEntry,
} from './aiModel.ts';

const e = (o: Partial<AiEntry> & { id: number }): AiEntry => ({
  risk_id_external: null, ai_system_use_case: `System ${o.id}`, risk_description: 'A risk', risk_category: 'Security', likelihood: null, impact: null, risk_score: null, existing_controls: null, residual_risk_level: null,
  mitigation_plan: null, risk_owner: null, risk_owner_user_id: null, target_review_date: null, status: 'Open', bridged_risk_id: null, ai_suggested_mitigation: null, ai_suggested_controls: null,
  ai_suggested_likelihood: null, ai_suggested_impact: null, ai_suggested_residual_level: null, ai_rationale: null, ai_generated_at: null, ai_model: null, ai_suggestion_accepted: false, created_at: null,
  updated_at: `2026-11-0${o.id}T10:00:00`, ...o,
});

test('the level is the area\'s one band system on likelihood x impact: 20 is critical, 12 high, 6 medium; 16 is high (the old page said 15 was high, 8 medium)', () => {
  assert.deepEqual([25, 20, 16, 12, 9, 6, 5, null].map((s) => levelOf(e({ id: 1, risk_score: s }))), ['critical', 'critical', 'high', 'high', 'medium', 'medium', 'low', 'none']);
  assert.equal(scoreOf(e({ id: 1, likelihood: 4, impact: 5 })), 20);
  assert.equal(levelOf(e({ id: 1, likelihood: 3, impact: 3 })), 'medium');
});

test('overdue is the Overview\'s rule: not closed and the review date is before today', () => {
  assert.equal(isOverdue(e({ id: 1, target_review_date: '2026-11-01' }), '2026-11-08'), true);
  assert.equal(isOverdue(e({ id: 1, target_review_date: '2026-11-08' }), '2026-11-08'), false);
  assert.equal(isOverdue(e({ id: 1, target_review_date: '2026-11-01', status: 'Closed' }), '2026-11-08'), false);
  assert.equal(isOverdue(e({ id: 1, target_review_date: null }), '2026-11-08'), false);
});

test('a suggestion says where it came from', () => {
  assert.equal(suggestionOf(e({ id: 1 })), 'none');
  assert.equal(suggestionOf(e({ id: 1, ai_generated_at: '2026-11-01T00:00:00', ai_model: 'rules.v1' })), 'rules');
  assert.equal(suggestionOf(e({ id: 1, ai_generated_at: '2026-11-01T00:00:00', ai_model: 'AI' })), 'ai');
});

const ROWS = [
  e({ id: 1, risk_score: 20, status: 'Open', target_review_date: '2026-10-01', ai_generated_at: '2026-11-01T00:00:00', ai_model: 'AI' }),
  e({ id: 2, risk_score: 6, status: 'Closed', risk_category: 'Data Privacy', ai_system_use_case: 'Fraud model' }),
  e({ id: 3, risk_score: 12, status: 'In Progress', ai_generated_at: '2026-11-01T00:00:00', ai_model: 'rules.v1', ai_suggestion_accepted: true }),
  e({ id: 4, status: 'Accepted', risk_owner: 'Finance' }),
];
const TODAY = '2026-11-08';

test('quick views and filters', () => {
  const ids = (f: Partial<typeof NO_AI_FILTERS>) => filterEntries(ROWS, { ...NO_AI_FILTERS, ...f }, TODAY).map((x) => x.id);
  assert.deepEqual(ids({}), [1, 2, 3, 4]);
  assert.deepEqual(ids({ quick: 'open' }), [1, 3, 4]);
  assert.deepEqual(ids({ quick: 'high' }), [1, 3]);
  assert.deepEqual(ids({ quick: 'overdue' }), [1]);
  assert.deepEqual(ids({ quick: 'ready' }), [1]);                           // 3 was accepted already
  assert.deepEqual(ids({ category: ['Data Privacy'] }), [2]);
  assert.deepEqual(ids({ status: ['Open', 'Accepted'] }), [1, 4]);
  assert.deepEqual(ids({ search: 'fraud' }), [2]);
  assert.deepEqual(ids({ search: 'finance' }), [4]);
  assert.equal(inQuick('all', ROWS[0], TODAY), true);
  assert.equal(filterCount({ search: 'x', category: ['a'], status: [], quick: 'open' }), 3);
});

test('sorting by score, review date, name; an entry with no review date is last when the dates go up', () => {
  assert.deepEqual(sortEntries(ROWS, { key: 'score', dir: 'desc' }).map((x) => x.id), [1, 3, 2, 4]);
  assert.deepEqual(sortEntries(ROWS, { key: 'review', dir: 'asc' }).map((x) => x.id), [1, 2, 3, 4]);
  assert.deepEqual(sortEntries(ROWS, { key: 'name', dir: 'asc' }).map((x) => x.ai_system_use_case), ['Fraud model', 'System 1', 'System 3', 'System 4']);
  assert.deepEqual(nextSort(DEFAULT_SORT, 'score'), { key: 'score', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'score', dir: 'asc' }, 'score'), DEFAULT_SORT);
});

test('the address', () => {
  const a = readAddress(AI_SCHEMA, '?quick=overdue&cat=Security,Data%20Privacy&status=Open&sort=score:desc&open=12&q=bot') as AiAddress;
  assert.deepEqual(filtersOf(a), { search: 'bot', category: ['Security', 'Data Privacy'], status: ['Open'], quick: 'overdue' });
  assert.equal(openIdOf(a), 12);
  assert.equal(openIdOf({ open: 'x' }), null);
  assert.equal((readAddress(AI_SCHEMA, '?quick=nope') as AiAddress).quick, 'all');
});

test('accepting a suggestion and then saving does not erase what was accepted', () => {
  const opened = formOf(e({ id: 1, mitigation_plan: null, existing_controls: null, likelihood: null, impact: null, residual_risk_level: null }));
  assert.equal(opened.mitigation_plan, '');
  // the server fills the blanks of the entry
  const after = e({ id: 1, mitigation_plan: 'Add human review', existing_controls: 'Logging', likelihood: 4, impact: 5, residual_risk_level: 'High', risk_score: 20 });
  const merged = mergeAccepted(opened, after);
  assert.deepEqual([merged.mitigation_plan, merged.existing_controls, merged.likelihood, merged.impact, merged.residual_risk_level], ['Add human review', 'Logging', 4, 5, 'High']);
  assert.equal(bodyOf(merged).mitigation_plan, 'Add human review');                      // what a Save now sends
  // what the person typed meanwhile stays
  const typed = { ...opened, mitigation_plan: 'My own plan' };
  assert.equal(mergeAccepted(typed, after).mitigation_plan, 'My own plan');
  // the old behaviour, for the record: saving the OPEN form would have sent the blanks
  assert.equal(bodyOf(opened).mitigation_plan, '');
});

test('a save sends no empty score or date', () => {
  const body = bodyOf({ ...EMPTY_FORM, risk_description: 'x' });
  assert.ok(!('likelihood' in body) && !('impact' in body) && !('target_review_date' in body) && !('risk_owner_user_id' in body));
  assert.equal(body.status, 'Open');
});
