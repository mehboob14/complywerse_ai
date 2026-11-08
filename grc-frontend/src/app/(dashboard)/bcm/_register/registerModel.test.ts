// node --test "src/app/(dashboard)/bcm/_register/registerModel.test.ts"
// The three Business Continuity registers as configuration: the address each one keeps, the facets and quick views (held to a plain filter, so the engine's counts are the numbers a
// person would get by hand), the day rules shared with the Overview's counters, the sorts, the board and the export. The shared plumbing is registerModel.ts; the registers are
// _plans/plansConfig.ts, _drills/drillsConfig.ts and _findings/findingsConfig.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, countOf } from '../../../../components/records/facetEngine.ts';
import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import type { DrillRow, FindingRow, PlanRow } from '../bcmModel.ts';
import { PLANS } from '../_plans/plansConfig.ts';
import { DRILLS, whenOf, findingsOf } from '../_drills/drillsConfig.ts';
import { FINDINGS, isMine, dueWindowOf } from '../_findings/findingsConfig.ts';
import {
  NONE, boardOf, chipsOf, csvCell, csvOf, exportName, filtersOf, filterCount, indexOf, nextSort, noFilters, optionsOf, orderedOptions, patchOf, plainFilter, quickCounts, removeChip,
  ruleOf, schemaFor, sortRows, chosenOf, countLine, type Ctx, type Filters, type RegisterDef,
} from './registerModel.ts';

// "now" is 8 Nov 2026, midday in the viewer's calendar
const NOW = new Date(2026, 10, 8, 12, 0, 0).getTime();
const ctx = (me: number | null = 7): Ctx => ({ me, now: NOW });
const at = (offsetDays: number): string => { const d = new Date(2026, 10, 8 + offsetDays); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00`; };
const ago = (days: number): string => new Date(NOW - days * 86_400_000).toISOString().slice(0, 19);

const plan = (id: number, o: Partial<PlanRow> = {}): PlanRow => ({
  id, title: `Plan ${id}`, description: null, business_unit: null, status: 'approved', document_ref_id: null, document_title: null, owner_id: 7, owner_name: 'Sara Ali', rto_hours: 4, rpo_hours: 1,
  testing_frequency: 'annual', version: 1, approved_by_name: null, approved_date: null, next_review_due: at(200), bia_count: 2, drill_count: 1, bia_incomplete: 0, last_drill_at: ago(30), updated_at: ago(id), ...o,
});
const PLAN_ROWS: PlanRow[] = [
  plan(1, { title: 'Core banking', next_review_due: at(10), bia_incomplete: 1 }),                             // due soon, a process without a strategy
  plan(2, { title: 'Payments', status: 'draft', owner_id: 9, owner_name: 'Omar Khan', next_review_due: at(-3), last_drill_at: null, drill_count: 0, business_unit: 'Retail' }),        // overdue review, never tested
  plan(3, { title: 'Old site', status: 'retired', owner_id: null, owner_name: null, next_review_due: at(-90), last_drill_at: ago(800), bia_incomplete: 2 }),                       // retired: out of every chase
  plan(4, { title: 'Treasury', next_review_due: null, last_drill_at: ago(400), business_unit: 'Retail' }),    // no review day, tested over a year ago
  plan(5, { title: 'Card services', next_review_due: at(31), owner_id: 9, owner_name: 'Omar Khan' }),           // 31 days out: later
];

const drill = (id: number, o: Partial<DrillRow> = {}): DrillRow => ({
  id, plan_id: 1, plan_title: 'Core banking', title: `Drill ${id}`, drill_type: 'tabletop', scenario: null, scheduled_date: at(20), actual_start: null, actual_end: null, owner_id: 7, owner_name: 'Sara Ali',
  status: 'scheduled', is_overdue: false, effective_status: 'scheduled', source_type: 'scheduled_test', linked_incident_id: null, linked_incident_title: null, has_result: false, finding_count: 0, open_finding_count: 0,
  updated_at: ago(id), ...o,
});
const DRILL_ROWS: DrillRow[] = [
  drill(1, { title: 'Failover', scheduled_date: at(-9), effective_status: 'overdue', is_overdue: true }),
  drill(2, { title: 'Call tree', drill_type: 'call_tree', scheduled_date: at(12), owner_id: 9, owner_name: 'Omar Khan', plan_id: 2, plan_title: 'Payments' }),
  drill(3, { title: 'Tabletop', status: 'completed', effective_status: 'completed', scheduled_date: at(-60), has_result: true, finding_count: 3, open_finding_count: 2 }),
  drill(4, { title: 'Live invocation', status: 'in_progress', effective_status: 'in_progress', source_type: 'incident_triggered', scheduled_date: at(-1), finding_count: 1, open_finding_count: 0 }),
  drill(5, { title: 'Far off', scheduled_date: at(90) }),
  drill(6, { title: 'Dropped', status: 'cancelled', effective_status: 'cancelled', scheduled_date: null, owner_id: null, owner_name: null }),
  drill(7, { title: 'Wrapped up', status: 'closed', effective_status: 'closed', scheduled_date: at(-100), has_result: true }),
  drill(8, { title: 'Completed without result', status: 'completed', effective_status: 'completed', scheduled_date: at(-5) }),
];

const finding = (id: number, o: Partial<FindingRow> = {}): FindingRow => ({
  id, drill_id: 3, title: `Finding ${id}`, description: null, severity: 'medium', linked_issue_id: null, issue_code: null, issue_status: 'open', is_open: true, linked_risk_id: null, linked_risk_title: null,
  owner_id: null, owner_name: null, due_date: null, drill_title: 'Tabletop', drill_owner_id: 9, plan_id: 1, plan_title: 'Core banking', created_at: ago(id), ...o,
});
const FINDING_ROWS: FindingRow[] = [
  finding(1, { title: 'Slow failover', severity: 'high', linked_issue_id: 11, issue_code: 'ISS-11', issue_status: 'in_progress', owner_id: 9, owner_name: 'Omar Khan', due_date: at(-4) }),       // open, late
  finding(2, { title: 'Old gap', severity: 'low', linked_issue_id: 12, issue_code: 'ISS-12', issue_status: 'closed', is_open: false, due_date: at(-40) }),                                  // closed: a past day is not late
  finding(3, { title: 'No runbook', severity: 'critical', owner_id: 7, owner_name: 'Sara Ali', due_date: at(5), linked_risk_id: 3, linked_risk_title: 'Loss of site' }),
  finding(4, { title: 'Stale call list', drill_id: 1, drill_title: 'Failover', drill_owner_id: 7, plan_id: 1 }),                                                                         // nobody's, on a drill Sara owns
  finding(5, { title: 'Orphan', drill_id: 99, drill_title: null, drill_owner_id: null, plan_id: null, plan_title: null }),
];

// ── the address ──
test('the address of each register keeps what it kept before: ?status= ?q= ?sort= ?type= ?source= ?new=1 still mean the same, and junk is the default', () => {
  const plans = schemaFor(PLANS);
  const a = readAddress(plans, '?status=approved,draft&q=core&sort=title:asc&new=1&page=3&size=10');
  assert.deepEqual(a.status, ['approved', 'draft']);
  assert.equal(a.q, 'core');
  assert.deepEqual(a.sort, { key: 'title', dir: 'asc' });
  assert.equal(a.new, true);
  assert.equal(readAddress(plans, '?sort=cadence:desc').sort?.key, 'cadence');
  assert.deepEqual(readAddress(plans, '?sort=junk:asc').sort, { key: 'updated', dir: 'desc' });
  assert.equal(readAddress(plans, '?quick=junk').quick, null);
  const drills = schemaFor(DRILLS);
  assert.deepEqual(readAddress(drills, '?status=overdue&source=incident_triggered&type=tabletop').source, ['incident_triggered']);
  assert.deepEqual(readAddress(drills, '?status=overdue').status, ['overdue']);
  assert.equal(readAddress(drills, '?view=board').view, 'board');
  assert.equal(readAddress(plans, '?view=board').view, 'list', 'plans have no board');
  assert.equal(writeAddress(drills, '', { ...readAddress(drills, ''), status: ['overdue'], quick: 'overdue' }), 'quick=overdue&status=overdue');
  assert.throws(() => schemaFor({ ...PLANS, facets: [{ ...PLANS.facets[0], key: 'sort' }] }), /cannot be called sort/);
});

test('filters round-trip through the address and count what is on', () => {
  const f = filtersOf(PLANS, readAddress(schemaFor(PLANS), '?status=draft&owner=9&q=pay&quick=review'));
  assert.deepEqual(f, { search: 'pay', quick: 'review', chosen: { status: ['draft'], review: [], tested: [], owner: ['9'], cadence: [], unit: [] } });
  assert.equal(filterCount(f), 4);
  assert.equal(filterCount(noFilters(PLANS)), 0);
  assert.deepEqual(patchOf(PLANS, { ...f, quick: 'all' }).quick, null);
});

// ── plans ──
const hold = <R extends { id: number }>(def: RegisterDef<R>, rows: R[], f: Filters, c: Ctx = ctx()) => {
  const engine = evaluate(indexOf(def, rows, c), chosenOf(f), ruleOf(def, f, c));
  assert.deepEqual(engine.matches.map((r) => r.id), plainFilter(def, rows, f, c).map((r) => r.id), 'the engine and the plain filter agree');
  return engine;
};
const only = <R extends { id: number }>(def: RegisterDef<R>, patch: Partial<Filters> & { chosen?: Record<string, string[]> }): Filters => {
  const base = noFilters(def);
  return { ...base, ...patch, chosen: { ...base.chosen, ...(patch.chosen ?? {}) } };
};

test('plans: the quick views are the Overview\'s rules, and a retired plan is in none of the chases', () => {
  const counts = quickCounts(PLANS, PLAN_ROWS, ctx());
  assert.deepEqual(counts, { all: 5, mine: 2, review: 2, untested: 2, nostrategy: 1, draft: 1 });
  const ids = (quick: string) => hold(PLANS, PLAN_ROWS, only(PLANS, { quick })).matches.map((p) => p.id).sort();
  assert.deepEqual(ids('review'), [1, 2], 'overdue (3 days) and within 30 days; the plan 31 days out and the retired one are not');
  assert.deepEqual(ids('untested'), [2, 4], 'never tested, and tested 400 days ago; the retired plan is left out');
  assert.deepEqual(ids('nostrategy'), [1]);
  assert.deepEqual(ids('mine'), [1, 4]);
});

test('plans: the facets count under each option what choosing it would show, and a day with none reads "No date"', () => {
  const f = only(PLANS, { chosen: { status: ['approved'] } });
  const result = hold(PLANS, PLAN_ROWS, f);
  assert.deepEqual(result.matches.map((p) => p.id), [1, 4, 5]);
  assert.equal(countOf(result.counts, 'status', 'draft'), 1, 'a facet\'s own choice never empties its own list');
  assert.equal(countOf(result.counts, 'review', 'none'), 1, 'the plan with no review day');
  assert.equal(countOf(result.counts, 'review', 'soon'), 1);
  assert.equal(countOf(result.counts, 'review', 'later'), 1, 'the plan 31 days out');
  assert.equal(countOf(hold(PLANS, PLAN_ROWS, noFilters(PLANS)).counts, 'review', 'overdue'), 1, 'the retired plan\'s old review day does not count');
  const options = optionsOf(PLANS, PLAN_ROWS, ctx());
  assert.deepEqual(options.owner.map((o) => o.label), ['Omar Khan', 'Sara Ali', 'Unassigned']);
  assert.deepEqual(options.unit.map((o) => o.label), ['Retail', 'No business unit']);
  assert.deepEqual(options.review.map((o) => o.label), ['Overdue', 'Next 30 days', 'Later', 'No date']);
  assert.deepEqual(orderedOptions(options.unit, [], (v) => (v === 'Retail' ? 2 : 0)).map((o) => o.label), ['Retail']);
});

test('plans: chips name what is on and come off one by one', () => {
  const f = only(PLANS, { search: 'core', quick: 'review', chosen: { owner: ['9'], status: ['draft'] } });
  const options = optionsOf(PLANS, PLAN_ROWS, ctx());
  const chips = chipsOf(PLANS, f, options);
  assert.deepEqual(chips.map((c) => c.label), ['Search: core', 'Review due', 'Status: Draft', 'Owner: Omar Khan']);
  assert.equal(filterCount(removeChip(removeChip(f, chips[0]), chips[1])), 2);
  assert.deepEqual(removeChip(f, chips[3]).chosen.owner, []);
});

test('plans: sorting puts a plan without the value last whichever way it runs, and a header turns round then goes back to the default', () => {
  const byReview = (dir: 'asc' | 'desc') => sortRows(PLANS, PLAN_ROWS, { key: 'review', dir }, ctx()).map((p) => p.id);
  assert.deepEqual(byReview('asc'), [3, 2, 1, 5, 4]);
  assert.deepEqual(byReview('desc'), [5, 1, 2, 3, 4]);
  assert.deepEqual(sortRows(PLANS, PLAN_ROWS, { key: 'owner', dir: 'asc' }, ctx()).map((p) => p.id), [2, 5, 1, 4, 3], 'no owner last');
  assert.deepEqual(nextSort(PLANS, PLANS.defaultSort, 'title'), { key: 'title', dir: 'asc' });
  assert.deepEqual(nextSort(PLANS, { key: 'title', dir: 'asc' }, 'title'), { key: 'title', dir: 'desc' });
  assert.deepEqual(nextSort(PLANS, { key: 'title', dir: 'desc' }, 'title'), PLANS.defaultSort);
  assert.deepEqual(nextSort(PLANS, PLANS.defaultSort, 'updated'), { key: 'updated', dir: 'asc' }, 'the default column turns round at the first press');
  assert.deepEqual(sortRows(PLANS, PLAN_ROWS, PLANS.defaultSort, ctx()).map((p) => p.id), [1, 2, 3, 4, 5], 'most recently updated first');
});

test('plans: the export is the rows as shown, a leading = is made harmless and a comma is quoted', () => {
  const rows = [plan(9, { title: '=SUM(A1)', business_unit: 'Retail, UK' })];
  const csv = csvOf(PLANS, rows, ctx()).split('\r\n');
  assert.equal(csv[0], 'Plan,Status,Business unit,Owner,RTO (hours),RPO (hours),Testing cadence,Review due,Last drill,Processes,Processes without a strategy,Drills');
  assert.match(csv[1], /^'=SUM\(A1\),Approved,"Retail, UK",Sara Ali,4,1,Annual,2027-/);
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(-5), '-5', 'a number is not a formula');
  assert.equal(exportName(PLANS, '2026-11-08', 1, true), 'bcm-plans-2026-11-08-selected-1-plan.csv');
  assert.equal(exportName(DRILLS, '2026-11-08', 42, false), 'bcm-drills-2026-11-08-42-drills.csv');
});

// ── drills ──
test('drills: where a drill stands against its day, and the quick views that chase them', () => {
  assert.deepEqual(DRILL_ROWS.map((d) => whenOf(d, NOW)), ['overdue', 'soon', 'held', 'held', 'later', 'held', 'held', 'held']);
  assert.deepEqual(quickCounts(DRILLS, DRILL_ROWS, ctx()), { all: 8, mine: 6, overdue: 1, soon: 1, needresult: 2, openfindings: 1 });
  const ids = (quick: string) => hold(DRILLS, DRILL_ROWS, only(DRILLS, { quick })).matches.map((d) => d.id).sort();
  assert.deepEqual(ids('needresult'), [4, 8], 'under way or completed with nothing recorded');
  assert.deepEqual(ids('openfindings'), [3]);
  assert.equal(findingsOf(DRILL_ROWS[3]), 'closed');
  assert.equal(findingsOf(DRILL_ROWS[2]), 'open');
  assert.equal(findingsOf(DRILL_ROWS[0]), 'none');
});

test('drills: the status facet is the effective status, so an overdue drill is not "scheduled"', () => {
  const result = hold(DRILLS, DRILL_ROWS, only(DRILLS, { chosen: { status: ['scheduled'] } }));
  assert.deepEqual(result.matches.map((d) => d.id), [2, 5]);
  assert.equal(countOf(result.counts, 'status', 'overdue'), 1);
  const owners = optionsOf(DRILLS, DRILL_ROWS, ctx()).owner.map((o) => o.label);
  assert.deepEqual(owners, ['Omar Khan', 'Sara Ali', 'Unassigned']);
  assert.deepEqual(optionsOf(DRILLS, DRILL_ROWS, ctx()).plan.map((o) => o.label), ['Core banking', 'Payments']);
});

test('drills: the board has four columns, a cancelled drill is not on it and the board says so', () => {
  const board = boardOf(DRILLS, DRILL_ROWS);
  assert.deepEqual(board.map((c) => [c.id, c.rows.map((d) => d.id)]), [['overdue', [1]], ['scheduled', [2, 5]], ['in_progress', [4]], ['done', [3, 7, 8]]]);
  assert.equal(DRILLS.board?.note?.(DRILL_ROWS), '1 cancelled drill is not on the board.');
  assert.equal(DRILLS.board?.note?.(DRILL_ROWS.filter((d) => d.status !== 'cancelled')), undefined);
  assert.deepEqual(boardOf(PLANS, PLAN_ROWS), [], 'plans have no board');
});

test('drills: latest scheduled first by default, a drill with no day last, and Scheduled turns round at the first press', () => {
  assert.deepEqual(sortRows(DRILLS, DRILL_ROWS, DRILLS.defaultSort, ctx()).map((d) => d.id), [5, 2, 4, 8, 1, 3, 7, 6]);
  assert.deepEqual(nextSort(DRILLS, DRILLS.defaultSort, 'scheduled'), { key: 'scheduled', dir: 'asc' });
  assert.deepEqual(sortRows(DRILLS, DRILL_ROWS, { key: 'scheduled', dir: 'asc' }, ctx()).map((d) => d.id), [7, 3, 1, 8, 4, 2, 5, 6]);
});

// ── findings ──
test('findings: mine is a finding I own or one nobody owns on a drill I own; only an open finding can be late', () => {
  assert.equal(isMine(FINDING_ROWS[2], 7), true);
  assert.equal(isMine(FINDING_ROWS[3], 7), true);
  assert.equal(isMine(FINDING_ROWS[0], 7), false, 'omar owns it');
  assert.equal(isMine(FINDING_ROWS[4], 7), false);
  assert.equal(isMine(FINDING_ROWS[2], null), false);
  assert.deepEqual(FINDING_ROWS.map((f) => dueWindowOf(f, NOW)), ['overdue', null, 'soon', 'none', 'none']);
  assert.deepEqual(quickCounts(FINDINGS, FINDING_ROWS, ctx()), { all: 5, mine: 2, open: 4, noissue: 3, overdue: 1, urgent: 2 });
});

test('findings: the facets read the issue\'s state and the plain filter agrees with the engine', () => {
  const f = only(FINDINGS, { chosen: { capa: ['without'], severity: ['critical', 'medium'] } });
  assert.deepEqual(hold(FINDINGS, FINDING_ROWS, f).matches.map((x) => x.id), [3, 4, 5]);
  const result = hold(FINDINGS, FINDING_ROWS, noFilters(FINDINGS));
  assert.equal(countOf(result.counts, 'status', 'in_progress'), 1);
  assert.equal(countOf(result.counts, 'due', 'overdue'), 1, 'the closed finding\'s old day is not overdue');
  assert.equal(countOf(result.counts, 'risk', 'linked'), 1);
  assert.equal(countOf(result.counts, 'plan', NONE), 1);
  assert.deepEqual(optionsOf(FINDINGS, FINDING_ROWS, ctx()).drill.map((o) => o.label), ['A drill that is gone', 'Failover', 'Tabletop']);
});

test('findings: critical first with the closed ones after every open one, the one due first among equals', () => {
  assert.deepEqual(sortRows(FINDINGS, FINDING_ROWS, FINDINGS.defaultSort, ctx()).map((f) => f.id), [3, 1, 4, 5, 2]);
  assert.deepEqual(sortRows(FINDINGS, FINDING_ROWS, { key: 'due', dir: 'asc' }, ctx()).map((f) => f.id), [2, 1, 3, 4, 5]);
  assert.deepEqual(nextSort(FINDINGS, FINDINGS.defaultSort, 'severity'), { key: 'severity', dir: 'desc' });
});

test('findings: the export names the drill, the plan and the issue', () => {
  const csv = csvOf(FINDINGS, [FINDING_ROWS[0]], ctx()).split('\r\n');
  assert.equal(csv[0], 'Finding,Severity,Status,Issue,Risk,Owner,Due,Drill,Plan,Raised');
  assert.match(csv[1], /^Slow failover,High,In Progress,ISS-11,,Omar Khan,2026-11-04,Tabletop,Core banking,/);
});

test('the count line says the true total and how many came when the server cut the list', () => {
  assert.equal(countLine({ one: 'plan', other: 'plans' }, 1, 1, false), '1 plan');
  assert.equal(countLine({ one: 'plan', other: 'plans' }, 12000, 5000, true), '12,000 plans (showing 5,000)');
  assert.equal(countLine({ one: 'plan', other: 'plans' }, undefined, 3, false), '3 plans');
});
