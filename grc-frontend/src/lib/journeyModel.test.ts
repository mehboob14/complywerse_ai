// node --test "src/lib/journeyModel.test.ts"
// The one model of a framework journey: the numbers (the journey function's, verified counted once), the one set of readiness lines, the figure over
// several journeys, the target date, the tabs that can be reached, the stages without an invented status, what is waiting for a person, scope decisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aliasesFor, controlOfDecision, CORE_TABS, isActiveJourney, journeyNumbers, journeyTabKeys, landingTab, openItem, portfolioNumbers, readinessBand,
  recentActivity, REGISTERS_TAB, requirementCount, scopeCounts, scopeEffect, scopeList, stageRows, stageSummary, TAB_ALIASES, targetState, waitingForMe,
  type ControlLite, type ScopeRecordLite,
} from './journeyModel.ts';
import { resolveTab } from './tabsModel.ts';

// A journey of 10 requirements the way calculate_progress_summary counts it: 2 out of scope; of the 8 that are in scope 4 are implemented (one of
// them verified: "implemented" ALREADY holds it), 2 are in progress, 2 not started; 3 have all the approved evidence they ask for.
const DETAIL = {
  total_controls: 10, implemented_count: 4, verified_count: 1, in_progress_count: 2, not_started_count: 2, not_applicable_count: 2,
  completion_percentage: 50, with_evidence_count: 5, fully_evidenced_count: 4, approved_evidence_controls: 3, evidence_coverage_percentage: 50, readiness_percentage: 37.5,
  // the legacy keys only the journey DETAIL adds
  implemented: 4, verified: 1, in_progress: 2, not_started: 2, not_applicable: 2,
};
const { implemented: _i, verified: _v, in_progress: _p, not_started: _n, not_applicable: _a, ...LIST_ROW } = DETAIL;

test('the numbers of a journey: implemented counts the verified ones once, the denominator leaves out what is out of scope', () => {
  const n = journeyNumbers(DETAIL);
  assert.ok(n);
  assert.deepEqual([n.total, n.applicable, n.notApplicable], [10, 8, 2]);
  assert.deepEqual([n.implemented, n.verified, n.inProgress, n.toStart], [4, 1, 2, 2]);
  assert.equal(n.implemented + n.inProgress + n.toStart, n.applicable, 'implemented + in progress + to start = applicable: verified is not added on top');
  assert.deepEqual([n.implementedPct, n.readyPct, n.evidencePct], [50, 37.5, 50]);
  assert.notEqual(n.implemented + n.verified, n.implemented, 'the old page said "5 of 8 compliant" for this journey');
});

test('a list row (no legacy keys) and the detail payload give the same numbers; the legacy keys alone also read', () => {
  assert.deepEqual(journeyNumbers(LIST_ROW), journeyNumbers(DETAIL));
  const legacyOnly = journeyNumbers({ total_controls: 10, implemented: 4, in_progress: 2, not_applicable: 2 });
  assert.ok(legacyOnly);
  assert.deepEqual([legacyOnly.implemented, legacyOnly.inProgress, legacyOnly.notApplicable], [4, 2, 2]);
});

test('a payload that is missing is no answer, never zeros; a percentage the server did not send is worked out by the same rule', () => {
  assert.equal(journeyNumbers(null), null);
  assert.equal(journeyNumbers(undefined), null);
  assert.equal(journeyNumbers({}), null);
  const n = journeyNumbers({ total_controls: 8, implemented_count: 3, approved_evidence_controls: 2 });
  assert.ok(n);
  assert.deepEqual([n.implementedPct, n.readyPct], [37.5, 25]);
  const empty = journeyNumbers({ total_controls: 0 });
  assert.ok(empty);
  assert.deepEqual([empty.implementedPct, empty.readyPct, empty.toStart], [0, 0, 0], 'a journey with nothing to divide by reads 0, not NaN');
  assert.equal(journeyNumbers({ total_controls: 4, not_applicable_count: 9 })?.applicable, 0, 'never negative');
});

test('one set of readiness lines: 75, 50 and 25, the line itself belongs to the higher band', () => {
  assert.deepEqual([100, 75, 74.9, 50, 49.9, 25, 24.9, 0].map(readinessBand), ['strong', 'strong', 'building', 'building', 'early', 'early', 'start', 'start']);
  assert.equal(readinessBand(null), 'start');
  assert.equal(readinessBand(undefined), 'start');
});

test('the figure over several journeys is controls-weighted for both numbers, leaves out finished journeys, and says how many rows had no answer', () => {
  const big = { status: 'in_progress', progress: { total_controls: 400, implemented_count: 100, in_progress_count: 100, not_started_count: 200, not_applicable_count: 0, approved_evidence_controls: 40 } };
  const small = { status: 'in_progress', progress: { total_controls: 20, implemented_count: 20, in_progress_count: 0, not_started_count: 0, not_applicable_count: 0, approved_evidence_controls: 20 } };
  const done = { status: 'completed', progress: { total_controls: 50, implemented_count: 50, approved_evidence_controls: 50 } };
  const noAnswer = { status: 'in_progress', progress: null };
  const all = portfolioNumbers([big, small, done, noAnswer]);
  assert.deepEqual([all.journeys, all.missing, all.applicable, all.implemented, all.approved], [2, 1, 420, 120, 60]);
  assert.equal(all.implementedPct, 28.6);
  assert.equal(all.readyPct, 14.3);
  // the unweighted mean the Dashboard's Readiness bar used (10% and 100% -> 55%) is gone
  assert.notEqual(all.readyPct, 55);
  assert.equal(all.open, 300, 'not started plus in progress, of the journeys that were counted');
  assert.equal(portfolioNumbers([big, small, done], { activeOnly: false }).journeys, 3);
  assert.deepEqual([isActiveJourney('in_progress'), isActiveJourney('completed'), isActiveJourney('cancelled'), isActiveJourney(null)], [true, false, false, true]);
  assert.deepEqual(portfolioNumbers([]), { journeys: 0, missing: 0, applicable: 0, implemented: 0, approved: 0, open: 0, implementedPct: 0, readyPct: 0 });
});

test('the target date is a day, whatever the zone: soon is 30 days or fewer, past is overdue, a completed journey is done', () => {
  const today = new Date(2026, 10, 8, 23, 59);
  assert.deepEqual(targetState('2026-11-12T00:00:00', 'in_progress', today), { day: '2026-11-12', days: 4, state: 'soon' });
  assert.equal(targetState('2026-11-08', 'in_progress', today).state, 'soon');
  assert.equal(targetState('2026-11-08', 'in_progress', today).days, 0);
  assert.equal(targetState('2026-12-08', 'in_progress', today).state, 'soon', '30 days is still soon');
  assert.equal(targetState('2026-12-09', 'in_progress', today).state, 'later');
  assert.equal(targetState('2026-11-07T00:00:00', 'in_progress', today).state, 'overdue');
  assert.equal(targetState('2026-11-07T00:00:00', 'completed', today).state, 'done');
  assert.deepEqual(targetState(null, 'in_progress', today), { day: null, days: null, state: 'none' });
  assert.deepEqual(targetState('not a date', 'in_progress', today), { day: null, days: null, state: 'none' });
});

test('the tabs: a framework with a flow gets Journey AND Overview, the others land on Overview, the registers sit behind one tab', () => {
  assert.deepEqual(journeyTabKeys({ hasFlow: true, templateKeys: [] }), ['journey', 'overview', 'controls', 'scope', 'artifacts', 'activity']);
  assert.deepEqual(journeyTabKeys({ hasFlow: false, templateKeys: ['gap-analysis', 'risk_register'] }), ['overview', 'controls', 'scope', REGISTERS_TAB, 'artifacts', 'activity']);
  assert.equal(landingTab(true), 'journey');
  assert.equal(landingTab(false), 'overview');
  for (const hasFlow of [true, false]) assert.ok(journeyTabKeys({ hasFlow, templateKeys: ['x'] }).indexOf(landingTab(hasFlow)) >= 0, 'the landing tab is on offer');
  for (const key of journeyTabKeys({ hasFlow: true, templateKeys: ['x'] })) assert.ok(CORE_TABS.indexOf(key as never) >= 0 || key === REGISTERS_TAB, `${key} is a known tab`);
});

test('every old address still opens the tab that holds its content: ?tab=controls (My Work, the requirement link) and the tabs nobody could open before', () => {
  const keys = journeyTabKeys({ hasFlow: true, templateKeys: ['gap-analysis'] });
  const open = (search: string) => resolveTab(search, 'tab', keys, aliasesFor(['gap-analysis']), landingTab(true));
  assert.equal(open('?tab=controls&req=12'), 'controls');
  assert.equal(open('?tab=applicability'), 'scope');
  assert.equal(open('?tab=soa'), 'scope');
  assert.equal(open('?tab=history'), 'activity');
  assert.equal(open('?tab=phases'), 'overview');
  assert.equal(open('?tab=assigned-to-me'), 'controls');
  assert.equal(open('?tab=gap-analysis'), REGISTERS_TAB, 'a register that was a tab of its own opens inside Registers');
  assert.equal(open('?tab=training'), 'journey', 'a placeholder that never had a page falls back to the landing tab');
  assert.equal(open(''), 'journey');
  assert.equal(open('?tab=constructor'), 'journey');
  for (const target of Object.values(TAB_ALIASES)) assert.ok(keys.indexOf(target) >= 0, `${target} (an alias target) is on offer`);
});

test('the open register or document: ?item=, else a legacy ?tab=<type>, else the first; none when the framework has none', () => {
  const types = ['gap-analysis', 'risk_register', 'isms_scope_statement'];
  assert.equal(openItem('?tab=registers&item=risk_register', types), 'risk_register');
  assert.equal(openItem('?tab=risk_register', types), 'risk_register');
  assert.equal(openItem('?tab=registers', types), 'gap-analysis');
  assert.equal(openItem('?item=nope', types), 'gap-analysis');
  assert.equal(openItem('?tab=registers', []), null);
});

test('stages carry their owner and their counts and NO status: the old Done badge was one percentage spread over the stages', () => {
  const phases = [
    { n: 1, name: 'Context', coverage: 'Clause 4', deliverables: ['a', 'b'], evidence: ['c'], owner: 'CISO', ext: false },
    { n: 2, name: 'Audit', coverage: 'Stage 2', deliverables: [], evidence: ['d', 'e', 'f'], owner: 'Certifier', ext: true },
  ];
  const rows = stageRows(phases, { '1': { type: 'user', ref_id: 7, label: ' A. Khan ' }, '2': { type: 'role', label: '' } });
  assert.deepEqual(rows[0], { n: 1, name: 'Context', coverage: 'Clause 4', external: false, deliverables: 2, artifacts: 1, owner: 'A. Khan', suggestedOwner: 'CISO' });
  assert.equal(rows[1].owner, null, 'an owner with no name is no owner; the flow\'s own owner stays a suggestion');
  assert.deepEqual(stageSummary(rows), { stages: 2, withOwner: 1, withoutOwner: 1, external: 1 });
  assert.equal(Object.keys(rows[0]).some((k) => /status|done|progress/i.test(k)), false);
  assert.deepEqual(stageRows(phases, null).map((r) => r.owner), [null, null]);
});

const ctrl = (id: number, over: Partial<ControlLite> = {}): ControlLite => ({ id, control_code: `A.${id}`, status: 'not_started', is_applicable: true, assigned_user_ids: [], evidence: [], ...over });

test('what waits for a person: their own open requirements (critical first), files nobody reviewed, scope decisions oldest first; a reader has only their own', () => {
  const controls: ControlLite[] = [
    ctrl(1, { assigned_user_ids: [7], status: 'in_progress', priority_level: 'P2' }),
    ctrl(2, { assigned_user_ids: [7], is_critical: true, priority_level: 'P3' }),
    ctrl(3, { assigned_user_ids: [7], status: 'implemented' }),
    ctrl(4, { assigned_user_ids: [9] }),
    ctrl(5, { assigned_to_user_id: 7, priority_level: 'P1' }),
    ctrl(6, { assigned_user_ids: [7], is_applicable: false }),
    ctrl(10, { evidence: [{ id: 1, review_status: 'pending' }, { id: 2, review_status: 'approved' }, { id: 3, review_status: 'pending' }] }),
  ];
  const records: ScopeRecordLite[] = [
    { id: 2, control_id: 22, is_applicable: false, status: 'pending', requested_at: '2026-11-03T09:00:00' },
    { id: 1, control_id: 21, is_applicable: true, status: 'pending', requested_at: '2026-11-01T09:00:00' },
    { id: 3, control_id: 23, is_applicable: true, status: 'approved', requested_at: '2026-10-01T09:00:00' },
  ];
  const lead = waitingForMe({ controls, userId: 7, canReview: true, records });
  assert.deepEqual(lead.mine.map((c) => c.id), [2, 5, 1], 'critical first, then P1 before P2');
  assert.deepEqual([lead.evidenceToReview, lead.toReview.length], [2, 1]);
  assert.deepEqual(lead.decisions.map((r) => r.id), [1, 2], 'the queue is oldest first');
  assert.equal(lead.total, 3 + 2 + 2);
  const reader = waitingForMe({ controls, userId: 7, canReview: false, records });
  assert.deepEqual([reader.mine.length, reader.evidenceToReview, reader.decisions.length, reader.total], [3, 0, 0, 3]);
  assert.equal(waitingForMe({ controls, userId: null, canReview: false, records }).total, 0);
  assert.equal(waitingForMe({ controls: null, userId: 7, canReview: true, records: null }).total, 0);
});

test('the Requirements count is the requirements the list shows: the ones out of scope are not in it', () => {
  assert.equal(requirementCount([ctrl(1), ctrl(2, { is_applicable: false }), ctrl(3, { status: 'not_applicable' })]), 2);
  assert.equal(requirementCount(null), 0);
});

const REC = (id: number, over: Partial<ScopeRecordLite> = {}): ScopeRecordLite => ({ id, control_id: id + 100, is_applicable: true, status: 'pending', requested_at: `2026-11-0${id}T10:00:00`, ...over });

test('scope decisions: counts, the order a reviewer works them, and what a decision does in plain words', () => {
  const records = [
    REC(1), REC(2, { status: 'approved', is_applicable: false, reviewed_at: '2026-11-06T10:00:00' }), REC(3, { status: 'rejected', reviewed_at: '2026-11-07T10:00:00' }),
    REC(4, { status: 'approved', reviewed_at: '2026-11-05T10:00:00' }), REC(5),
  ];
  assert.deepEqual(scopeCounts(records), { all: 5, pending: 2, approved: 2, rejected: 1, out: 1 });
  assert.deepEqual(scopeList(records, 'pending').map((r) => r.id), [1, 5], 'waiting: oldest first');
  assert.deepEqual(scopeList(records, 'approved').map((r) => r.id), [2, 4], 'the rest: newest decision first');
  assert.deepEqual(scopeList(records, 'out').map((r) => r.id), [2]);
  assert.deepEqual(scopeList(records, 'all').map((r) => r.id), [3, 2, 4, 5, 1]);
  assert.deepEqual(scopeCounts(null), { all: 0, pending: 0, approved: 0, rejected: 0, out: 0 });
  // plain words: nothing changes until a reviewer approves
  assert.match(scopeEffect({ is_applicable: false, status: 'pending' }, true), /stays in scope.*goes out of scope/);
  assert.match(scopeEffect({ is_applicable: true, status: 'approved' }, true), /in scope/);
  assert.match(scopeEffect({ is_applicable: false, status: 'approved' }, false), /left out of every figure/);
  assert.match(scopeEffect({ is_applicable: false, status: 'rejected' }, true), /turned down.*stays in scope/);
  // a decision is keyed by the library clause, the journey lists its own rows
  const controls = [ctrl(1, { parsed_control_id: 101 }), ctrl(2, { parsed_control_id: 102 })];
  assert.equal(controlOfDecision({ control_id: 102 }, controls)?.id, 2);
  assert.equal(controlOfDecision({ control_id: 999 }, controls), null);
});

test('recent activity: newest first, asked or decided, snapshots, capped; it reads what the page already holds', () => {
  const items = recentActivity({
    records: [
      { ...REC(1), control_reference: 'A.5.1', requested_by_name: 'Sara' },
      { ...REC(2, { status: 'approved', reviewed_at: '2026-11-07T09:00:00' }), control_reference: 'A.5.2', reviewed_by_name: 'Khalid' },
    ],
    snapshots: [{ id: 1, label: '2026 Assessment', captured_at: '2026-11-05T08:00:00', overall_pct: 41 }],
    limit: 5,
  });
  assert.deepEqual(items.map((i) => i.kind), ['decision', 'snapshot', 'decision']);
  assert.match(items[0].text, /Khalid approved the scope request for A\.5\.2/);
  assert.match(items[2].text, /Sara asked to put A\.5\.1 in scope/);
  assert.match(items[1].text, /2026 Assessment.*41%/);
  assert.equal(recentActivity({ records: null, snapshots: null }).length, 0);
  assert.equal(recentActivity({ records: Array.from({ length: 9 }, (_, i) => REC(i + 1)), snapshots: [], limit: 3 }).length, 3);
});
