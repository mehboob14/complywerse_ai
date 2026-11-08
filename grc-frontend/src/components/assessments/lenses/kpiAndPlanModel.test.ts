// node --test "src/components/assessments/lenses/kpiAndPlanModel.test.ts"
// The KPI report's order and counts, and the audit plan's form, body and counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countKpis, kpiRemarks, orderKpis, stateOf } from './kpiModel.ts';
import { adviceOf, bodyOf, countPlan, EMPTY_FORM, formOf, formProblem, type PlanEntry } from './auditPlanModel.ts';

const k = (domain: string, live: boolean, onTarget: boolean | null) => ({ domain, live, onTarget });

test('a KPI is external, on target or below; below target comes first, then on target, then external, by domain', () => {
  assert.equal(stateOf(k('A', false, null)), 'external');
  assert.equal(stateOf(k('A', true, false)), 'below');
  assert.equal(stateOf(k('A', true, true)), 'on');
  assert.equal(stateOf(k('A', true, null)), 'on', 'a live KPI with no target is not below one');
  const ordered = orderKpis([k('B', false, null), k('B', true, true), k('A', true, false), k('A', true, true), k('C', true, false)]);
  assert.deepEqual(ordered.map((x) => `${x.domain}:${stateOf(x)}`), ['A:below', 'C:below', 'A:on', 'B:on', 'B:external']);
});

test('the counts of the report', () => {
  assert.deepEqual(countKpis([k('A', true, true), k('A', true, false), k('B', false, null)]), { total: 3, live: 2, onTarget: 1, below: 1, external: 1, domains: 2 });
  assert.deepEqual(countKpis([]), { total: 0, live: 0, onTarget: 0, below: 0, external: 0, domains: 0 });
});

test('a KPI added by hand carries its definition and source the way the catalogue reads them back', () => {
  assert.equal(kpiRemarks('Patched in time', 'Nessus'), 'Def: Patched in time | Source: Nessus');
  assert.equal(kpiRemarks('', ' SIEM '), 'Source: SIEM');
  assert.equal(kpiRemarks('', ''), '');
});

const entry = (over: Partial<PlanEntry> = {}): PlanEntry => ({
  id: 1, entry_type: 'Audit', audit_id: 'A-1', audit_name: 'Annual audit', team_responsible: null, lead_auditor: null, audit_type: null, scope: null, methods: null, criteria: null, sampling: null,
  evidence_needed: null, duration: null, schedule: null, audit_start: '2026-09-01T00:00:00', audit_end: null, cost: null, comment: null, status: null, priority: null, ai_recommendation: null,
  ai_recommendation_generated_at: null, ...over,
});

test('the plan form starts empty, reads an entry as text and sends an empty field as null', () => {
  assert.equal(formOf(null).status, 'planned');
  assert.equal(formOf(null).entry_type, 'Audit');
  const f = formOf(entry({ status: 'in_progress', lead_auditor: 'Lee' }));
  assert.equal(f.audit_start, '2026-09-01', 'a date is its calendar day');
  assert.equal(f.status, 'in_progress');
  assert.equal(f.cost, '');
  const body = bodyOf({ ...EMPTY_FORM, audit_name: ' Annual audit ' });
  assert.equal(body.audit_name, 'Annual audit');
  assert.equal(body.scope, null);
  assert.equal(body.status, 'planned');
});

test('an entry needs its name and cannot end before it starts', () => {
  assert.equal(formProblem({ ...EMPTY_FORM }), 'Give the audit or review a name.');
  assert.equal(formProblem({ ...EMPTY_FORM, audit_name: 'x' }), '');
  assert.equal(formProblem({ ...EMPTY_FORM, audit_name: 'x', audit_start: '2026-09-10', audit_end: '2026-09-01' }), 'The end date is before the start date.');
  assert.equal(formProblem({ ...EMPTY_FORM, audit_name: 'x', audit_start: '2026-09-01', audit_end: '2026-09-01' }), '');
});

test('plan counts: an entry with no status is planned, no type is an audit', () => {
  const c = countPlan([entry(), entry({ entry_type: 'Review', status: 'completed' }), entry({ status: 'in_progress' })]);
  assert.deepEqual(c, { total: 3, audits: 2, reviews: 1, planned: 1, inProgress: 1, completed: 1 });
});

test('the AI recommendation is JSON with a summary and lists, or a sentence', () => {
  assert.deepEqual(adviceOf(JSON.stringify({ summary: 'Do it', scope_advice: ['a'], methods: ['b', 'c'], evidence: [] })), { summary: 'Do it', scope: ['a'], methods: ['b', 'c'], evidence: [] });
  assert.deepEqual(adviceOf('just words'), { summary: 'just words', scope: [], methods: [], evidence: [] });
  assert.equal(adviceOf(null), null);
  assert.equal(adviceOf(''), null);
});
