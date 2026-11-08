// node --test "src/app/(dashboard)/assessments/_overview/overviewModel.test.ts"
// The Assessments Overview's decisions: the counters and where they open, the order of "Do now", the posture and the categories (the server's numbers, one grade scale 85 / 70 / 50), the portfolio
// clock (headline from the server, due soon and ageing from the points), "What if" and the SLA policy dialog's rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  attentionTotal, categoryRows, countersOf, daysOf, mineLine, mineTotal, nameWithKind, policyChanged, policyDraft, policyOf, policyProblem, portfolioClock, postureOf, whatIfBounds, whatIfMs, workRows, TARGET,
} from './overviewModel.ts';
import type { Board, MyWork, Point, Policy } from '../_data/types.ts';

const board = (over: Partial<Board> = {}): Board => ({
  as_of: '2026-11-08T00:00:00', performance: { score: 72.4, grade: 'good', assessments: 6 },
  sla: { score: 64, gaps: 40, closed: 10, open: 30, overdue: 12 }, attention: { overdue_gaps: 12, open_gaps: 30, not_started: 4 },
  categories: [
    { category: 'NCA', score: 58, sla: 40, count: 1, assessments: [] },
    { category: 'Cyber Security', score: 91, sla: 80, count: 3, assessments: [] },
    { category: 'Audit', score: null, sla: null, count: 1, assessments: [] },
    { category: 'Privacy & Data', score: 70, sla: 55, count: 1, assessments: [] },
  ], ...over,
});
const work = (over: Partial<MyWork> = {}): MyWork => ({
  as_of: '2026-11-08T00:00:00', counts: { assigned: 3, overdue: 1, to_scope: 1, to_approve: 2, can_decide: 5 },
  assigned_items: [
    { item_id: 11, item_number: 'AC-3', domain: 'Access', description: 'Review privileged access every quarter', compliance_status: 'not_complied', priority: 'high', remediation_status: 'open', due: '2026-10-01T00:00:00', overdue: true, via: 'user', assessment_id: 7, assessment_name: 'NCA DCC', assessment_format: 'nca_dcc_tool', category: 'NCA' },
    { item_id: 12, item_number: 'AC-4', domain: 'Access', description: 'Separate duties', compliance_status: 'in_progress', priority: null, remediation_status: null, due: '2026-12-01T00:00:00', overdue: false, via: 'team', assessment_id: 7, assessment_name: 'NCA DCC', assessment_format: 'nca_dcc_tool', category: 'NCA' },
    { item_id: 13, item_number: 'V1.2', domain: 'Auth', description: 'Passwords', compliance_status: 'in_progress', priority: null, remediation_status: null, due: null, overdue: false, via: 'user', assessment_id: 8, assessment_name: 'ASVS Payments', assessment_format: 'asvs_checklist', category: 'Cyber Security' },
  ],
  scoping: [{ id: 9, name: 'OWASP ASVS - Core banking', assessment_format: 'asvs_checklist', category: 'Cyber Security', primary_asset_id: 4, primary_asset_name: 'Core banking', created_at: null, updated_at: null }],
  approvals: [{ id: 21, evidence_id: 5, evidence_name: 'policy.pdf', evidence_file_name: 'policy.pdf', assessment_id: 8, assessment_name: 'PDPL', assessment_format: 'pdpl_assessment_toolkit', item_id: 3, item_number: '4.2', control_description: 'x', current_tier: 1, status: 'pending_tier_1', can_approve: true, addressed_to_me: true, submitted_by_name: 'Bina', submitted_at: null }],
  ...over,
});

test('the counters are the server\'s numbers; one that has not answered is null, never 0', () => {
  const c = countersOf(board(), work());
  assert.deepEqual(c.map((x) => [x.key, x.value]), [['approve', 2], ['overdue', 12], ['assigned', 3], ['scope', 1], ['notstarted', 4]]);
  assert.equal(attentionTotal(c), 22);
  const half = countersOf(undefined, work());
  assert.deepEqual(half.map((x) => x.value), [2, null, 3, 1, null]);
  assert.equal(attentionTotal(half), 6);
  assert.equal(attentionTotal(countersOf(undefined, undefined)), null);
});

test('every counter opens the page that holds what it counts: the decisions in Needs my action, the rest in the register', () => {
  const hrefs = Object.fromEntries(countersOf(board(), work()).map((c) => [c.key, c.href]));
  assert.equal(hrefs.approve, '/needs-my-action');
  assert.equal(hrefs.overdue, '/assessments/register?quick=overdue');
  assert.equal(hrefs.assigned, '/assessments/register?quick=waiting');
  assert.equal(hrefs.scope, '/assessments/register?quick=scoping');
  assert.equal(hrefs.notstarted, '/assessments/register?quick=notstarted');
});

test('Do now: a control past its date first, then evidence to decide, then drafts to scope, then the rest by date', () => {
  const rows = workRows(work());
  assert.deepEqual(rows.map((r) => r.key), ['item:11', 'approval:21', 'draft:9', 'item:12', 'item:13']);
  assert.equal(rows[0].kind.label, 'Overdue');
  assert.equal(rows[0].href, '/assessments/a/7?tab=controls&item=11');
  assert.equal(rows[1].href, '/needs-my-action');
  assert.equal(rows[2].title, 'Core banking', 'a draft is named by its application');
  assert.equal(rows[3].kind.label, 'Your department', 'a control that reached the person through their department says so');
  assert.equal(rows[4].due, null);
  assert.deepEqual(workRows(undefined), []);
});

test('the person\'s total is the sum of the true counts, and the line says when the lists were cut', () => {
  assert.equal(mineTotal(work()), 6);
  assert.equal(mineTotal(undefined), null);
  assert.equal(mineLine(5, 6), 'Showing 5 of 6');
  assert.equal(mineLine(6, 6), '6 items');
  assert.equal(mineLine(1, 1), '1 item');
});

test('posture: the server\'s score, the one grade scale and the distance to the target', () => {
  const p = postureOf(board());
  assert.deepEqual([p.score, p.grade, p.sla, p.assessments, p.toTarget], [72.4, 'good', 64, 6, 12.6]);
  assert.equal(TARGET, 85);
  assert.equal(postureOf(board({ performance: { score: 90, grade: 'excellent', assessments: 2 } })).toTarget, null);
  const none = postureOf(board({ performance: { score: null, grade: null, assessments: 0 } }));
  assert.deepEqual([none.grade, none.toTarget], [null, null]);
  for (const [score, grade] of [[85, 'excellent'], [84.9, 'good'], [70, 'good'], [69.9, 'fair'], [50, 'fair'], [49.9, 'poor']] as const) assert.equal(postureOf(board({ performance: { score, grade: null, assessments: 1 } })).grade, grade, String(score));
});

test('categories: the most assessments first, each opens the register on that category, grades by the same scale', () => {
  const rows = categoryRows(board());
  assert.deepEqual(rows.map((r) => r.category), ['Cyber Security', 'Audit', 'NCA', 'Privacy & Data']);
  assert.equal(rows[0].href, '/assessments/register?category=cyber');
  assert.equal(rows[2].href, '/assessments/register?category=nca');
  assert.equal(rows[3].href, '/assessments/register?category=privacy');
  assert.deepEqual(rows.map((r) => r.grade), ['excellent', null, 'fair', 'good']);
});

const NOW = Date.UTC(2026, 10, 8, 12);
const iso = (days: number): string => new Date(NOW + days * 86_400_000).toISOString();
const pt = (id: number, over: Partial<Point>): Point => ({ id, assessment_id: 1, compliance_status: 'not_complied', priority: 'high', remediation_status: 'open', created_at: iso(-200), ...over });

test('the portfolio clock: the headline counts are the server\'s, the ageing and due soon follow the server\'s due-date rule', () => {
  const points: Point[] = [
    pt(1, { target_date: iso(-5) }),                            // overdue
    pt(2, { target_date: iso(10) }),                            // due within 30 days
    pt(3, { target_date: iso(45) }),                            // 31 to 60
    pt(4, { target_date: iso(400) }),                           // later
    pt(5, { compliance_status: 'complied', remediation_status: null, target_date: iso(10) }),   // not a gap
    pt(6, { closed_at: iso(-1), target_date: iso(10) }),        // closed
  ];
  const clock = portfolioClock(points, daysOf(undefined), board(), NOW);
  assert.deepEqual([clock.gaps, clock.open, clock.overdue, clock.closed], [40, 30, 12, 10], 'the server\'s own counts');
  assert.equal(clock.dueSoon, 1);
  assert.deepEqual(clock.aging.map((b) => [b.key, b.count]), [['overdue', 1], ['d30', 1], ['d60', 1], ['d90', 0], ['later', 1], ['none', 0]]);
  assert.equal(clock.agingTotal, 4);
  const none = portfolioClock(points, daysOf(undefined), undefined, NOW);
  assert.deepEqual([none.gaps, none.open, none.overdue], [null, null, null], 'no board answer: the page shows a dash, the local counts are kept apart');
  assert.equal(none.local.gaps, 5);
});

test('What if: a later day moves "today" forward, so more gaps are past their date', () => {
  const points: Point[] = [pt(1, { target_date: iso(10) }), pt(2, { target_date: iso(40) })];
  const today = portfolioClock(points, daysOf(undefined), board(), NOW);
  const later = portfolioClock(points, daysOf(undefined), board(), NOW + 20 * 86_400_000);
  assert.equal(today.aging[0].count, 0);
  assert.equal(later.aging[0].count, 1);
});

test('What if: a calendar day in the next year, nothing else', () => {
  const now = new Date(2026, 10, 8, 12).getTime();
  assert.ok(whatIfMs('2026-12-31', now) !== null);
  assert.equal(whatIfMs('2026-11-08', now), null, 'today is not a what if');
  assert.equal(whatIfMs('2026-10-01', now), null, 'nor is the past');
  assert.equal(whatIfMs('2028-01-01', now), null, 'nor is beyond a year');
  assert.equal(whatIfMs('2026-02-31', now), null, 'not a date');
  assert.equal(whatIfMs('', now), null);
  assert.equal(whatIfMs('12/31/2026', now), null);
  assert.deepEqual(whatIfBounds(now), { min: '2026-11-09', max: '2027-11-08' });
});

const policy: Policy = { critical_days: 30, high_days: 60, medium_days: 90, low_days: 180, due_soon_days: 30, score_closed_ontime: 100, score_closed_late: 70, score_on_track: 40, score_due_soon: 20, score_overdue: 0, score_no_date: 30 };

test('the SLA policy dialog: days from 1, scores 0 to 100, one request with every field', () => {
  const draft = policyDraft(policy);
  assert.equal(draft.critical_days, '30');
  assert.equal(policyProblem(draft), '');
  assert.deepEqual(policyOf(draft), policy);
  assert.equal(policyChanged(draft, policy), false);
  assert.equal(policyChanged({ ...draft, high_days: ' 61 ' }, policy), true);
  assert.match(policyProblem({ ...draft, critical_days: '0' }), /days from 1 to 3650/, 'the server ignores 0 and less: a typo is refused here');
  assert.match(policyProblem({ ...draft, low_days: '' }), /Low/);
  assert.match(policyProblem({ ...draft, score_overdue: '101' }), /Overdue: a whole number from 0 to 100/);
  assert.match(policyProblem({ ...draft, score_no_date: '-1' }), /No date/);
  assert.equal(policyProblem({ ...draft, score_overdue: '0' }), '', '0 is a valid weight');
});

test('days of the policy: the tenant\'s, else the server\'s defaults', () => {
  assert.equal(daysOf(undefined).high_days, 60);
  assert.equal(daysOf({ ...policy, high_days: 45 }).high_days, 45);
});
