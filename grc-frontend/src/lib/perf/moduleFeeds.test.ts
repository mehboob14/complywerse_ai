// node --test "src/lib/perf/moduleFeeds.test.ts"
// What the Performance Overview reads from each area: the requests and their keys (the module pages' own), who is shown what (the sidebar's rights, the server's where it is
// stricter), the score / grade / target of a scorecard, the counters each area hands the band, and that a number the answer does not carry is a dash and never 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { navPermissions } from '../../components/layout/navAccess.ts';
import { SCORECARD_QUERY_KEYS } from '../../components/dashboard/scorecard-query-keys.ts';
import {
  AREAS, AREA_BY_KEY, FEEDS, GRADES, areasFor, feedsFor, gradeOf, journeyList, readArea,
  type Area, type FeedKey,
} from './moduleFeeds.ts';

const area = (key: string): Area => AREA_BY_KEY[key];
const read = (key: string, payload: unknown) => {
  const r = readArea(area(key), payload);
  assert.ok(r, `${key}: the fixture is read`);
  return r;
};
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** A scorecard answer: performance, sections and the attention queue, as the six scorecard routers send them. */
const scorecard = (over: Record<string, unknown> = {}) => ({
  as_of: '2026-11-08T10:00:00',
  performance: { score: 56.4, grade: 'fair', components: [{ key: 'documents', label: 'Documents', score: 71, weight: 0.3, target: 85 }, { key: 'attestations', label: 'Attestations', score: 24, weight: 0.2, target: 85 }, { key: 'reviews', label: 'Reviews', score: null, weight: 0.2, target: 85 }] },
  sections: {},
  attention_queue: { overdue_reviews: 12, overdue_attestations: 0, controls_without_evidence: 5, critical_open_risks: 2, red_kris: 1, sla_breached_issues: 6, open_critical_incidents: 0, overdue_control_tests: 4, regulatory_overdue_tasks: 3 },
  ...over,
});

test('the areas: seventeen, each once; a link has no request, every other area has one and a reader; seven are scored, eight carry a headline, two are links', () => {
  assert.equal(AREAS.length, 17);
  assert.equal(new Set(AREAS.map((a) => a.key)).size, 17);
  assert.deepEqual(AREAS.filter((a) => a.kind === 'link').map((a) => a.key), ['access-reviews', 'cyber']);
  AREAS.forEach((a) => {
    if (a.kind === 'link') { assert.equal(a.feed, null, a.key); assert.equal(a.read, undefined, a.key); return; }
    assert.ok(a.feed && FEEDS[a.feed], `${a.key}: a request`);
    assert.equal(typeof a.read, 'function', a.key);
  });
  assert.deepEqual(AREAS.filter((a) => a.kind === 'score').map((a) => a.key), ['governance', 'compliance', 'risk', 'assessments', 'assets', 'issues', 'assurance']);
  assert.equal(AREAS.filter((a) => a.kind === 'count').length, 8);
  assert.deepEqual(AREAS.map((a) => a.label).filter((l) => /[?]|N\/A|None/.test(l)), []);
});

test('the six areas G12 found missing are rows now: Tasks, Evidence, Regulatory, Controls Automation, Auditor Portal; Access Reviews and Cyber stay links', () => {
  ['tasks', 'evidence', 'regulatory', 'automation', 'auditor'].forEach((k) => assert.ok(AREA_BY_KEY[k], k));
  assert.equal(area('access-reviews').href, '/compliance/access-reviews');
  assert.equal(area('cyber').href, '/cyber-assurance/dashboard');
});

test('every request uses the key its module page uses, so opening the module afterwards asks for nothing', () => {
  assert.deepEqual(FEEDS.governance.queryKey, SCORECARD_QUERY_KEYS.governance);
  assert.deepEqual(FEEDS.compliance.queryKey, SCORECARD_QUERY_KEYS.compliance);
  assert.deepEqual(FEEDS.assessments.queryKey, SCORECARD_QUERY_KEYS.assessments);
  assert.deepEqual(FEEDS.assets.queryKey, SCORECARD_QUERY_KEYS.assets);
  assert.deepEqual(FEEDS.issues.queryKey, SCORECARD_QUERY_KEYS.issues);
  assert.deepEqual(FEEDS.assurance.queryKey, SCORECARD_QUERY_KEYS.assurance);
  assert.deepEqual(FEEDS.erm.queryKey, SCORECARD_QUERY_KEYS.erm);
  assert.match(src('../../app/(dashboard)/bcm/bcmData.ts'), /export const DASHBOARD_KEY = \['bcm-dashboard'\] as const;/);
  assert.deepEqual(FEEDS.bcm.queryKey, ['bcm-dashboard']);
  assert.match(src('../../components/compliance/overview/overviewData.ts'), /queryKey: \['ev-ws-summary'\],\s*queryFn: async \(\) => \(await apiClient\.get\('\/evidence-mgmt\/items\/dashboard\/summary'\)\)/);
  assert.deepEqual(FEEDS.evidence.queryKey, ['ev-ws-summary']);
  assert.match(src('../../components/compliance/overview/overviewData.ts'), /queryKey: \['certifications'\]/);
  assert.deepEqual(FEEDS.journeys.queryKey, ['certifications']);
  assert.match(src('../../app/(dashboard)/vendor-risk/page.tsx'), /queryKey: \['tprm-dashboard', scope\],\s*queryFn: async \(\) => \(await tpraApi\.dashboard\(scope\)\)\.data as Dashboard/);
  assert.deepEqual(FEEDS.vendors.queryKey, ['tprm-dashboard', 'portfolio']);
  assert.equal(FEEDS.vendors.path, '/vendor-risk/tpra/dashboard', 'the Vendor Overview\'s endpoint, not /vendors/dashboard');
  assert.match(src('../../app/(dashboard)/automation/overview/_overview/overviewData.ts'), /queryKey: \['common-overview', 'in_scope'\]/);
  assert.deepEqual(FEEDS.automation.queryKey, ['common-overview', 'in_scope']);
  assert.deepEqual(FEEDS.tasks.queryKey.slice(0, 1), ['critical-tasks'], 'a task write refreshes it: its key starts with the one every task mutation invalidates');
  assert.equal(Object.keys(FEEDS).length, 13);
  Object.entries(FEEDS).forEach(([k, f]) => assert.equal(f.key, k));
});

test('nothing asks for the frameworks aggregate or the older vendors dashboard any more', () => {
  const paths = Object.values(FEEDS).map((f) => f.path);
  assert.ok(!paths.some((p) => /frameworks-aggregate/.test(p)));
  assert.ok(!paths.includes('/vendor-risk/vendors/dashboard'));
});

test('who is shown what: the sidebar\'s rights, except where the SERVER is stricter (Issues and Business Continuity); an administrator sees every area', () => {
  ['governance', 'compliance', 'risk', 'assessments', 'assets', 'issues', 'frameworks', 'vendors', 'tasks', 'evidence', 'regulatory', 'automation', 'auditor', 'access-reviews', 'cyber'].forEach((k) => {
    const a = area(k);
    assert.deepEqual(a.gate, navPermissions(k === 'regulatory' ? '/governance/regulatory-changes' : a.href), `${k}: the sidebar's rights`);
    assert.ok(a.gate.length > 0, `${k}: somebody may open it`);
  });
  assert.deepEqual(area('issues').gate, ['issue_management:issues:*'], 'the server answers the Issues scorecard to issues:view only; erm:incidents:* alone is no longer offered it');
  assert.deepEqual(area('bcm').gate, ['bcm:dashboard:*'], 'the server answers /bcm/dashboard to bcm:dashboard:view only; plans or drills alone are no longer offered it');
  assert.deepEqual(area('assurance').gate, ['controls:control_library:*']);
  assert.ok(area('compliance').gate.includes('evidence:evidence_library:*'), 'the sidebar admits an evidence-only role to Compliance; the old card did not');
  assert.equal(areasFor(true, () => false).length, 17);
  assert.deepEqual(areasFor(false, () => false), []);
  const holds = (needed: string[]) => (perms: string[]) => perms.some((p) => needed.includes(p));
  assert.deepEqual(areasFor(false, holds(['bcm:dashboard:*'])).map((a) => a.key), ['bcm']);
  assert.deepEqual(areasFor(false, holds(['erm:risks:*'])).map((a) => a.key), ['risk', 'vendors', 'cyber']);
});

test('a request is made once, only when an area that is shown reads it: Frameworks and the Auditor Portal share the journeys, Regulatory reads the Compliance scorecard', () => {
  assert.deepEqual(feedsFor(AREAS).sort(), (Object.keys(FEEDS) as FeedKey[]).sort());
  assert.equal(feedsFor(AREAS).length, 13);
  assert.deepEqual(feedsFor([area('frameworks'), area('auditor')]), ['journeys']);
  assert.deepEqual(feedsFor([area('regulatory')]), ['compliance']);
  assert.deepEqual(feedsFor([area('cyber')]), [], 'a link asks for nothing');
});

test('a scorecard: the server\'s score, grade and target; the grade by the server\'s cut where none is sent; a top-level target wins over the components\' and is never a literal 85', () => {
  const g = read('governance', scorecard());
  assert.equal(g.score, 56.4);
  assert.equal(g.grade, 'fair');
  assert.equal(g.target, 85, 'the target every component carries');
  assert.equal(g.customized, null, 'the server does not say');
  assert.deepEqual(g.sections.map((s) => [s.label, s.score]), [['Documents', 71], ['Attestations', 24], ['Reviews', null]], 'a section with no score stays null, it is not 0');
  const tuned = read('governance', scorecard({ target: 70, customized: true }));
  assert.equal(tuned.target, 70);
  assert.equal(tuned.customized, true);
  const noGrade = read('governance', scorecard({ performance: { score: 91, components: [] } }));
  assert.equal(noGrade.grade, 'excellent');
  assert.equal(noGrade.target, null, 'no target in the answer: null, not 85');
  const noScore = read('governance', scorecard({ performance: { score: null, grade: 'poor', components: [] } }));
  assert.equal(noScore.score, null);
  assert.equal(noScore.grade, null, 'a grade without a score is not shown');
  assert.equal(read('governance', {}).score, null);
});

test('sections come from the performance components, else the sections of the answer', () => {
  const r = read('assets', { performance: { score: 60, grade: 'fair' }, sections: { a: { key: 'a', label: 'Coverage', score: 40 }, b: { key: 'b', label: 'Owners', score: 80 }, c: { score: 5 } } });
  assert.deepEqual(r.sections.map((s) => s.label), ['Coverage', 'Owners'], 'a section with no label is not a row');
});

test('the counters of the scorecard areas are the modules\' own definitions (label, address, tone) with the number from the answer', () => {
  const g = read('governance', scorecard());
  assert.deepEqual(g.counters.map((c) => [c.key, c.label, c.value, c.tone]), [['overdue_reviews', 'Overdue reviews', 12, 'danger'], ['overdue_attestations', 'Overdue attestations', 0, 'danger']]);
  assert.equal(g.counters[0].href, '/governance/documents?review=overdue');
  const c = read('compliance', scorecard());
  assert.deepEqual(c.counters.map((x) => [x.label, x.value, x.href]), [['Controls without evidence', 5, '/controls']]);
  const r = read('risk', scorecard());
  assert.deepEqual(r.counters.map((x) => [x.label, x.value, x.href]), [['Critical open risks', 2, '/erm/risks'], ['Breached KRIs', 1, '/erm/kris']]);
  const i = read('issues', scorecard());
  assert.deepEqual(i.counters.map((x) => [x.label, x.value, x.href]), [['SLA-breached issues', 6, '/issues'], ['Critical open incidents', 0, '/erm/incidents']]);
  const a = read('assurance', scorecard());
  assert.deepEqual(a.counters.map((x) => [x.label, x.value, x.href]), [['Overdue control tests', 4, '/control-library/assurance']]);
  const reg = read('regulatory', scorecard());
  assert.deepEqual(reg.counters.map((x) => [x.label, x.value, x.href]), [['Overdue regulatory tasks', 3, '/governance/regulatory-changes']]);
  assert.equal(reg.score, null, 'Regulatory is a row of counters: its score lives inside Compliance');
});

test('a counter the answer does not carry is a dash (null), never 0; an empty queue gives dashes, not zeros', () => {
  const g = read('governance', scorecard({ attention_queue: {} }));
  assert.deepEqual(g.counters.map((c) => c.value), [null, null]);
  assert.deepEqual(read('governance', scorecard({ attention_queue: undefined })).counters.map((c) => c.value), [null, null]);
  assert.deepEqual(read('governance', scorecard({ attention_queue: { overdue_reviews: '7' } })).counters.map((c) => c.value), [null, null], 'a string is not a number');
});

test('Assessments: the server\'s score and grade, its categories as sections, the overdue gaps as a counter, and the Assessments Overview\'s own target', () => {
  const r = read('assessments', { performance: { score: 62, grade: 'fair' }, categories: [{ category: 'Access', score: 40 }, { category: 'Backup', score: null }], attention: { overdue_gaps: 9, open_gaps: 20, not_started: 3 } });
  assert.equal(r.score, 62);
  assert.equal(r.grade, 'fair');
  assert.equal(r.target, 85);
  assert.deepEqual(r.sections.map((s) => [s.label, s.score]), [['Access', 40], ['Backup', null]]);
  assert.deepEqual(r.counters.map((c) => [c.key, c.label, c.value, c.href]), [['assessments_overdue', 'Overdue gaps', 9, '/assessments/register?quick=overdue']]);
  assert.equal(read('assessments', { performance: { score: null }, categories: [] }).counters[0].value, null, 'no attention block: a dash');
});

test('Frameworks and the Auditor Portal read the journeys list: active journeys and Ready % (the journey model\'s), journeys past their target date, one line for the portal', () => {
  const journey = (id: number, status: string, target: string | null, applicable: number, approved: number) => ({
    id, name: `Journey ${id}`, status, target_date: target,
    progress: { total_controls: applicable, implemented_count: approved, approved_evidence_controls: approved, in_progress_count: 0, not_applicable_count: 0 },
  });
  const list = [journey(1, 'in_progress', '2020-01-01', 100, 50), journey(2, 'completed', '2020-01-01', 100, 100), journey(3, 'in_progress', null, 100, 25)];
  const f = read('frameworks', list);
  assert.equal(f.score, null, 'a count area is never ranked by a score');
  assert.equal(f.headline, '2 active journeys · 38% ready', "Ready % is the journey model's controls-weighted figure (75 of 200), as the Compliance Overview prints it");
  assert.deepEqual(f.counters.map((c) => [c.key, c.value, c.href]), [['journeys_late', 1, '/frameworks']], 'a finished journey is not late');
  assert.equal(read('frameworks', []).headline, 'No framework journeys yet');
  assert.equal(read('auditor', list).headline, '3 certification journeys to review');
  assert.equal(read('auditor', [list[0]]).headline, '1 certification journey to review');
  assert.equal(read('auditor', { items: list }).headline, '3 certification journeys to review', 'an object that wraps the list');
});

test('journeyList accepts the list or an object that wraps it, and nothing else', () => {
  assert.deepEqual(journeyList([1]), [1]);
  assert.deepEqual(journeyList({ items: [2] }), [2]);
  assert.deepEqual(journeyList({ results: [3] }), [3]);
  assert.deepEqual(journeyList(null), []);
  assert.deepEqual(journeyList('x'), []);
});

test('Vendors: the Vendor Overview\'s tiles (reassessment overdue, critical findings) with its addresses, and the active vendors as the line', () => {
  const r = read('vendors', { kpis: { active_vendors: 37, open_critical_findings: 4, open_critical_overdue: 1 }, reassessment_overdue: 6, not_tiered: 2, no_owner: 3 });
  assert.equal(r.headline, '37 active vendors');
  assert.deepEqual(r.counters.map((c) => [c.label, c.value, c.href, c.tone]), [
    ['Reassessment overdue', 6, '/vendor-risk/vendors?attention=reassessment_overdue', 'danger'],
    ['Critical findings', 4, '/vendor-risk/findings?severity=critical', 'danger'],
  ]);
  assert.equal(readArea(area('vendors'), {}), null, 'an answer without the kpis block is not read: the row says so, it does not draw zeros');
});

test('Business Continuity: the BCM Overview\'s counters (overdue drills, reviews due) and its plans and drills as the line; an answer in another shape is not read', () => {
  const r = read('bcm', { totals: { plans: 12, active_plans: 9, drills: 5, overdue_drills: 2, bia_records: 3, open_findings: 1 }, plans_by_status: { draft: 2 }, attention: { reviews_due: 4, bia_without_strategy: 0, findings_without_issue: 1 } });
  assert.equal(r.headline, '12 plans · 5 drills');
  assert.deepEqual(r.counters.map((c) => [c.label, c.value, c.href]), [['Overdue drills', 2, '/bcm/drills?quick=overdue'], ['Reviews due', 4, '/bcm/plans?quick=review']]);
  const older = read('bcm', { totals: { plans: 1, drills: 0, overdue_drills: 0 }, plans_by_status: {} });
  assert.equal(older.counters[1].value, null, 'an older server sends no attention block: a dash');
  assert.equal(readArea(area('bcm'), { totals: {} }), null);
});

test('Tasks: the server\'s summary for the tasks the person may see, with the register\'s own address for the overdue ones', () => {
  const r = read('tasks', { total: 41, overdue: 7, by_status: {} });
  assert.equal(r.headline, '41 tasks you can see');
  assert.deepEqual(r.counters.map((c) => [c.label, c.value, c.href]), [['Overdue tasks', 7, '/tasks?tab=all&due=overdue']]);
  assert.equal(read('tasks', { total: 1 }).counters[0].value, null);
});

test('Evidence: the lapsed count of the evidence summary (the Compliance Overview\'s definition), then the stale count, and what waits for review', () => {
  const r = read('evidence', { total_count: 120, lapsed_count: 14, stale_count: 3, pending_review_count: 5 });
  assert.equal(r.headline, '120 items · 5 waiting for review');
  assert.deepEqual(r.counters.map((c) => [c.label, c.value, c.href]), [['Lapsed evidence', 14, '/evidence?fresh=lapsed']]);
  assert.equal(read('evidence', { stale_count: 3 }).counters[0].value, 3);
  assert.equal(read('evidence', { total_count: 1 }).headline, '1 item');
});

test('Controls Automation: failing controls and failing sources from the overview, with the explorer\'s addresses', () => {
  const r = read('automation', { library: { controls: 1534 }, automation: { controls_with_checks: 210, posture: { failed: 8, passed: 100 } }, collection: { counts: { failing: 2 } } });
  assert.equal(r.headline, '210 of 1,534 controls have automated checks');
  assert.deepEqual(r.counters.map((c) => [c.key, c.label, c.value]), [['automation_failed', 'Failing', 8], ['automation_sources', 'Sources failing', 2]]);
  assert.ok(r.counters.every((c) => c.href.startsWith('/')));
  assert.equal(read('automation', { library: { controls: 3 }, automation: { controls_with_checks: 0, posture: {} }, collection: { counts: {} } }).counters[0].value, null, 'no failed key: a dash');
});

test('an answer in a shape the rules do not know is null (the row says it could not be read), never a row of zeros', () => {
  assert.equal(readArea(area('cyber'), {}), null);
  assert.equal(readArea({ ...area('governance'), read: () => { throw new Error('x'); } }, {}), null);
});

test('the grade words moduleFeeds writes are the registry\'s four', () => {
  assert.deepEqual([...GRADES], ['excellent', 'good', 'fair', 'poor']);
  assert.equal(gradeOf(72), 'good');
});
