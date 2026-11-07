// node --test "src/lib/erm/registers.test.ts"
// The rules of the incident and mitigation registers, the dependency strength and the five numbers/contract bugs the audit proved (G8 P-2, P-4, P-5, P-8, P-13):
// each test below FAILS on the old behaviour (named in the test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LINK_KEYS, incidentTiles, isOpenIncident, linkPayload, linkedTotal, mayBeSaved, parseTags, formatImpact, type LinkSet } from './incident.ts';
import { actionTiles, completeParams, isOverdueAction, parseReduction, reductionWords, shownStatus, ACTION_STATUSES, SETTABLE_STATUSES } from './mitigation.ts';
import { DEFAULT_STRENGTH, dependencyError, factorOfStrength, flattenCascade, reachedCount, strengthOfFactor, strengthWords, type CascadeResult } from './dependency.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// ── incidents ──
test('P-8: the Investigating and Resolved-this-month tiles count what the server sends (they read fields it never sent, so both were always 0)', () => {
  const dashboard = { by_status: { open: 4, investigating: 3, resolved: 2, closed: 1 }, open_incidents: 7, total_financial_impact: 1250000 };
  const incidents = [
    { status: 'resolved', resolved_at: '2026-11-03T09:00:00' },
    { status: 'closed', resolved_at: '2026-10-30T09:00:00' },
    { status: 'open', resolved_at: null },
  ];
  assert.deepEqual(incidentTiles(dashboard, incidents, new Date(2026, 10, 15)), { open: 7, investigating: 3, resolvedThisMonth: 1, totalImpact: 1250000 });
  assert.deepEqual(incidentTiles(undefined, [], new Date(2026, 10, 15)), { open: 0, investigating: 0, resolvedThisMonth: 0, totalImpact: 0 });
  assert.equal(incidentTiles({ by_status: { open: 2, investigating: 1 } }, [], new Date()).open, 3, 'open = open + investigating when the total is missing');
});

test('the server\'s dashboard really sends open_incidents and by_status (and not the two fields the page read)', () => {
  const source = readFileSync(here('../../../../backend/grc/modules/erm/routers/incidents.py'), 'utf8');
  const dashboard = /def get_incident_dashboard[\s\S]*?return \{([\s\S]*?)\n    \}/.exec(source)![1];
  assert.match(dashboard, /"by_status"/);
  assert.match(dashboard, /"open_incidents"/);
  assert.doesNotMatch(dashboard, /"investigating"\s*:|"resolved_this_month"/);
});

test('money is a plain grouped number, with no dollar sign and no K', () => {
  assert.equal(formatImpact(1250000), '1,250,000');
  assert.equal(formatImpact(0), '0');
  assert.equal(formatImpact(null), '—');
  assert.equal(linkedTotal({ assets: 2, vulnerabilities: 0, risks: 1, evidence: 3 }), 6);
  assert.equal(linkedTotal(null), 0);
  assert.deepEqual(parseTags(' a, b;c ,, '), ['a', 'b', 'c']);
  assert.equal(isOpenIncident('investigating'), true);
  assert.equal(isOpenIncident('resolved'), false);
});

const SET: LinkSet = { linked_asset_ids: [1], linked_vulnerability_ids: [], linked_risk_ids: [5], linked_evidence_ids: [] };
test('P-5: an existing incident is not saved before its links are in or after the read failed, and then sends no link keys at all (an empty list would delete every link)', () => {
  assert.equal(mayBeSaved(false, 'loading'), false);
  assert.equal(mayBeSaved(false, 'failed'), false);
  assert.equal(mayBeSaved(false, 'ready'), true);
  assert.equal(mayBeSaved(true, 'not_needed'), true);
  assert.deepEqual(linkPayload(false, 'loading', SET), {});
  assert.deepEqual(linkPayload(false, 'failed', { ...SET, linked_asset_ids: [] }), {});
  assert.deepEqual(Object.keys(linkPayload(false, 'ready', SET)).sort(), LINK_KEYS.slice().sort());
  assert.deepEqual(linkPayload(false, 'ready', { ...SET, linked_asset_ids: [] }).linked_asset_ids, [], 'after a good read, an emptied list is a real removal');
  assert.deepEqual(Object.keys(linkPayload(true, 'not_needed', SET)).length, 4);
});

test('the server replaces links when a key is present, even an empty list (why P-5 matters)', () => {
  const source = readFileSync(here('../../../../backend/grc/modules/erm/routers/incident_links.py'), 'utf8');
  assert.match(source, /replace/);
});

// ── mitigation actions ──
const NOW = new Date('2026-11-08T12:00:00Z');
test('P-13: Overdue is derived: an open or in-progress action past its date, or one a workflow flagged; never completed or cancelled', () => {
  assert.equal(isOverdueAction({ status: 'open', due_date: '2026-11-07T00:00:00' }, NOW), true);
  assert.equal(isOverdueAction({ status: 'in_progress', due_date: '2026-11-08T00:00:00' }, NOW), true, 'due today is overdue from midnight, as on the server');
  assert.equal(isOverdueAction({ status: 'open', due_date: '2026-11-09T00:00:00' }, NOW), false);
  assert.equal(isOverdueAction({ status: 'overdue', due_date: null }, NOW), true);
  assert.equal(isOverdueAction({ status: 'completed', due_date: '2026-01-01T00:00:00' }, NOW), false);
  assert.equal(isOverdueAction({ status: 'cancelled', due_date: '2026-01-01T00:00:00' }, NOW), false);
  assert.equal(isOverdueAction({ status: 'open', due_date: null }, NOW), false);
  assert.equal(shownStatus({ status: 'open', due_date: '2026-11-01T00:00:00' }, NOW), 'overdue');
  assert.equal(shownStatus({ status: 'completed', due_date: '2026-11-01T00:00:00' }, NOW), 'completed');
});

test('the tiles count the whole list: total, open, overdue, completed this month', () => {
  const rows = [
    { status: 'open', due_date: '2026-11-01T00:00:00' }, { status: 'in_progress', due_date: '2026-12-01T00:00:00' },
    { status: 'completed', completed_at: '2026-11-02T10:00:00' }, { status: 'completed', completed_at: '2026-10-02T10:00:00' }, { status: 'cancelled' },
  ];
  assert.deepEqual(actionTiles(rows, NOW), { total: 5, open: 2, overdue: 1, completedThisMonth: 1 });
});

test('P-4: the achieved reduction goes where the server reads it - the QUERY parameter actual_reduction of POST /mitigation-actions/{id}/complete', () => {
  const source = readFileSync(here('../../../../backend/grc/modules/erm/routers/mitigation_actions.py'), 'utf8');
  const route = /def complete_action\(([\s\S]*?)\):/.exec(source)![1];
  assert.match(route, /actual_reduction: Optional\[float\] = None/, 'a plain parameter of the route: a query string, not a body');
  assert.doesNotMatch(route, /BaseModel|Body\(/);
  assert.deepEqual(completeParams(70), { actual_reduction: 70 });
  assert.deepEqual(completeParams(0), { actual_reduction: 0 }, '0% achieved is a value');
  assert.equal(completeParams(null), undefined);
  assert.equal(completeParams(undefined), undefined);
  // and the shared client sends it as `params`, not as the body (the old call sent {actual_residual_reduction} as the body, which FastAPI ignores)
  const api = readFileSync(here('../api.ts'), 'utf8');
  const call = /complete: \(actionId: number[\s\S]*?listAll:/.exec(api)![0];
  assert.match(call, /params/);
  assert.doesNotMatch(call, /actual_residual_reduction/);
});

test('the status values are the server\'s (the workflow events read them) and the edit form never sets completed or overdue', () => {
  const model = readFileSync(here('../../../../backend/grc/models/_11_enterprise_risk_management.py'), 'utf8');
  const listed = /class RiskMitigationAction[\s\S]*?status = Column\(String\(50\), default="open"\)\s+# ([^\n]+)/.exec(model)![1].split(',').map((s) => s.trim());
  assert.deepEqual(Array.from(ACTION_STATUSES), listed);
  assert.deepEqual(Array.from(SETTABLE_STATUSES), ['open', 'in_progress', 'cancelled']);
});

test('reduction words and the form\'s percent field', () => {
  assert.equal(reductionWords({ expected_residual_reduction: 80, actual_residual_reduction: 70 }), '70% of 80%');
  assert.equal(reductionWords({ expected_residual_reduction: 80 }), '80% expected');
  assert.equal(reductionWords({}), '—');
  assert.equal(parseReduction(''), null);
  assert.equal(parseReduction('55'), 55);
  assert.equal(parseReduction('101'), undefined);
  assert.equal(parseReduction('-1'), undefined);
  assert.equal(parseReduction('x'), undefined);
});

// ── dependencies ──
test('P-2: strength 1-5 is sent as the impact_factor the server stores (5 = 1.0, what every dependency has had), and read back as a step or a plain factor', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(factorOfStrength), [0.2, 0.4, 0.6, 0.8, 1]);
  assert.equal(factorOfStrength(DEFAULT_STRENGTH), 1);
  assert.equal(factorOfStrength(9), 1);
  assert.equal(factorOfStrength(0), 0.2);
  assert.deepEqual([0.2, 0.4, 0.6, 0.8, 1, 1.0].map(strengthOfFactor), [1, 2, 3, 4, 5, 5]);
  assert.equal(strengthOfFactor(1.5), null);
  assert.equal(strengthOfFactor(0.55), null);
  assert.equal(strengthWords(1), '5 of 5 (x1)');
  assert.equal(strengthWords(0.6), '3 of 5 (x0.6)');
  assert.equal(strengthWords(1.5), 'x1.5');
  assert.equal(strengthWords(undefined), '—');
});

test('P-2: the cascade card reads the fields the server sends, nested, and the form checks both ends (the page started with 0 and 0)', () => {
  const server: CascadeResult = {
    source_risk_id: 1, source_risk_title: 'Outage', source_score: 20, total_cascade_score: 15,
    cascade_impact: [
      { risk_id: 2, risk_title: 'Churn', dependency_type: 'causes', impact_factor: 0.6, cascade_score: 9, depth: 1, downstream: [{ risk_id: 3, risk_title: 'Revenue', cascade_score: 6, depth: 2, downstream: [] }] },
      { risk_id: 4, risk_title: 'Fines', cascade_score: 6, depth: 1, downstream: [] },
    ],
  };
  const flat = flattenCascade(server.cascade_impact);
  assert.deepEqual(flat.map((r) => [r.node.risk_title, r.depth]), [['Churn', 1], ['Revenue', 2], ['Fines', 1]]);
  assert.equal(reachedCount(server), 3);
  assert.equal(reachedCount(undefined), 0);
  assert.equal(dependencyError(null, 3), 'Choose the risk that causes the impact.');
  assert.equal(dependencyError(1, null), 'Choose the risk that is affected.');
  assert.equal(dependencyError(2, 2), 'A risk cannot depend on itself.');
  assert.equal(dependencyError(1, 2), undefined);
});

test('a pending action (the word a new action is written with) is still to do, counted as open and overdue when late', () => {
  assert.equal(isOverdueAction({ status: 'pending', due_date: '2026-11-01T00:00:00' }, NOW), true);
  assert.equal(isOverdueAction({ status: 'pending', due_date: '2026-12-01T00:00:00' }, NOW), false);
  assert.equal(shownStatus({ status: 'pending', due_date: '2026-12-01T00:00:00' }, NOW), 'pending');
  assert.deepEqual(actionTiles([{ status: 'pending' }, { status: 'open' }, { status: 'completed' }], NOW), { total: 3, open: 2, overdue: 0, completedThisMonth: 0 });
  const route = readFileSync(here('../../../../backend/grc/modules/erm/routers/risks.py'), 'utf8');
  assert.match(route, /def create_risk_mitigation_action[\s\S]*?status="pending"/, 'the route that answers writes pending: if this changes, the page can stop reading it as open');
});
