// node --test "src/lib/rcsa/campaignsModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { csvOf, daysToDue, dueWords, isLate, launchBody, launchProblems, progressOf, sortUnits, suggestPeriodLabel, unassigned, unfinished, type CampaignRow, type LaunchForm, type UnitRow } from './campaignsModel.ts';

const NOW = new Date('2026-06-30T10:00:00Z');
const c = (extra: Partial<CampaignRow> = {}): CampaignRow => ({ id: 1, name: 'Q2 RCSA', template_id: 1, start_date: '2026-04-01T00:00:00', due_date: '2026-06-30T00:00:00', status: 'active', assessment_count: 14, completed_count: 5, ...extra });
const u = (extra: Partial<UnitRow>): UnitRow => ({ id: 1, business_unit_id: 1, business_unit_name: 'Treasury', assessor_id: 2, assessor_name: 'A', status: 'in_progress', progress: 0, risk_score: null, control_score: null, findings_count: 0, submitted_at: null, ...extra });
const form = (extra: Partial<LaunchForm> = {}): LaunchForm => ({ templateId: '3', name: 'Q3 RCSA', description: '', periodType: 'quarterly', periodLabel: 'Q3 2026', start: '2026-07-01', due: '2026-09-30', ...extra });

test('progress is approved units over assigned units, whole percent, never rounded up to done', () => {
  assert.equal(progressOf(c()), 35);
  assert.equal(progressOf(c({ completed_count: 14 })), 100);
  assert.equal(progressOf(c({ assessment_count: 0, completed_count: 0 })), 0);
});

test('a campaign is late once its due day has passed with units not approved, and not on the due day itself', () => {
  assert.equal(isLate(c(), NOW), false, 'due today is not late');
  assert.equal(isLate(c({ due_date: '2026-06-29T00:00:00' }), NOW), true);
  assert.equal(isLate(c({ due_date: '2026-06-29T00:00:00', completed_count: 14 }), NOW), false);
  assert.equal(isLate(c({ due_date: '2026-06-29T00:00:00', status: 'closed' }), NOW), false);
  assert.equal(isLate(c({ due_date: '2026-06-29T00:00:00', status: 'draft' }), NOW), false);
});

test('the due words count days, not hours', () => {
  assert.equal(daysToDue('2026-07-05T00:00:00', NOW), 5);
  assert.equal(dueWords(c({ due_date: '2026-07-01T00:00:00' }), NOW), '1 day left');
  assert.equal(dueWords(c(), NOW), 'Due today');
  assert.equal(dueWords(c({ due_date: '2026-06-27T00:00:00' }), NOW), '3 days late');
  assert.equal(dueWords(c({ status: 'closed' }), NOW), 'Closed');
});

test('the units come in the order a chaser reads them, and unassigned ones are named', () => {
  const units = [u({ id: 1, status: 'approved', business_unit_name: 'A' }), u({ id: 2, status: 'not_started', assessor_id: null, assessor_name: null, business_unit_name: 'B' }), u({ id: 3, status: 'requires_changes', business_unit_name: 'C' }), u({ id: 4, status: 'submitted', business_unit_name: 'D' })];
  assert.deepEqual(sortUnits(units).map((x) => x.id), [2, 3, 4, 1]);
  assert.deepEqual(unassigned(units).map((x) => x.id), [2]);
  assert.deepEqual(unfinished(units).map((x) => x.id), [2, 3, 4]);
});

test('the launch form names what is missing, in words', () => {
  assert.deepEqual(launchProblems(form()), {});
  assert.equal(launchProblems(form({ templateId: '' })).templateId, 'Choose the questionnaire the units will answer.');
  assert.equal(launchProblems(form({ name: '  ' })).name, 'Give the campaign a name.');
  assert.equal(launchProblems(form({ due: '2026-06-01' })).due, 'The due day cannot be before the start day.');
});

test('the body keeps the days as written (no toISOString shift) and sends no unit list: the server then takes every active department', () => {
  const body = launchBody(form());
  assert.equal(body.start_date, '2026-07-01T00:00:00');
  assert.equal(body.due_date, '2026-09-30T00:00:00');
  assert.deepEqual(body.business_unit_ids, []);
  assert.equal(body.template_id, 3);
});

test('a period label is suggested from the start day', () => {
  assert.equal(suggestPeriodLabel('quarterly', '2026-05-12'), 'Q2 2026');
  assert.equal(suggestPeriodLabel('semi_annual', '2026-08-01'), 'H2 2026');
  assert.equal(suggestPeriodLabel('annual', '2026-01-01'), '2026');
  assert.equal(suggestPeriodLabel('adhoc', '2026-01-01'), '');
});

test('the export has one line a campaign with days as days', () => {
  const out = csvOf([c({ open_findings: 2, created_by_name: 'Olivia' })]);
  assert.equal(out.header.length, out.rows[0].length);
  assert.deepEqual(out.rows[0].slice(4, 6), ['2026-04-01', '2026-06-30']);
});
