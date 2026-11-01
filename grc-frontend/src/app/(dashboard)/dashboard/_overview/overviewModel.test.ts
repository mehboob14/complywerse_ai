// node --test "src/app/(dashboard)/dashboard/_overview/overviewModel.test.ts"
// The Performance Overview's rules. The nine module definitions were MOVED from MainModuleCards.tsx: a frozen copy of the old expressions is kept below and
// compared with the new ones on fixed payloads and on 4,000 seeded random ones (the only differences are the two said in the comments: the colours the old
// segments carried, and "1 open incidents"). Then what each state of a request, a card and a tile shows: a failure is never "no data" and never 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODULES, MODULE_BY_KEY, PAST_SLA_SOURCES, SLOW_MS, cardRows, cutText, dictSegs, failedViews, isRefusal, isScored, loadOf, modulesTile, modulesWithData, pastSlaTile,
  posture, postureTile, priorities, readiness, readinessTile, retryDashboard, retryableViews, ringLabel, scoreText, sectionSubs, sliceTable, slices, viewOf, visibleModules,
  type Card, type Feed, type ModuleView,
} from './overviewModel.ts';
import { SCORECARD_QUERY_KEYS } from '../../../../components/dashboard/scorecard-query-keys.ts';

// ── the old code, frozen (MainModuleCards.tsx @ 4722ba67): never edit this block to make a test pass ───────────────────────────────────────────────────────────────
/* eslint-disable */
const SEG_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#64748b'];
const oldDictSegs = (obj?: Record<string, number> | null, max = 5): any[] => {
  if (!obj) return [];
  return Object.entries(obj)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([label, value], i) => ({ label: label.replace(/_/g, ' '), value, color: SEG_COLORS[i % SEG_COLORS.length] }));
};
const oldSectionSubs = (d: any): any[] => {
  const comps: any[] = d?.performance?.components ?? Object.values(d?.sections ?? {});
  return (comps || [])
    .filter((c) => c && c.label)
    .map((c) => ({ label: c.label as string, score: (c.score ?? null) as number | null }))
    .sort((a, b) => (a.score ?? 999) - (b.score ?? 999))
    .slice(0, 6);
};
const OLD: Record<string, (d: any) => any> = {
  governance: (d) => ({ score: d?.performance?.score ?? null, subs: oldSectionSubs(d), hasData: d?.performance?.score != null }),
  compliance: (d) => ({ score: d?.performance?.score ?? null, subs: oldSectionSubs(d), hasData: d?.performance?.score != null }),
  assessments: (d) => ({
    score: d?.performance?.score ?? null,
    subs: (d?.categories ?? []).map((c: any) => ({ label: c.category, score: c.score })).sort((a: any, b: any) => (a.score ?? 999) - (b.score ?? 999)),
    pastSla: d?.attention?.overdue_gaps ?? 0,
    hasData: d?.performance?.score != null || (d?.categories?.length ?? 0) > 0,
  }),
  assets: (d) => ({ score: d?.performance?.score ?? null, subs: oldSectionSubs(d), hasData: d?.performance?.score != null }),
  issues: (d) => {
    const subs = oldSectionSubs(d);
    const issueTotal = d?.sections?.issues?.counts?.total ?? 0;
    const incidentTotal = d?.sections?.incidents?.counts?.total ?? 0;
    const hasSectionScores = subs.some((s) => s.score != null);
    const hasRecords = issueTotal > 0 || incidentTotal > 0;
    return {
      score: d?.performance?.score ?? null,
      subs,
      pastSla: d?.attention_queue?.sla_breached_issues ?? 0,
      note: (d?.attention_queue?.open_critical_incidents ?? 0) > 0
        ? `${d.attention_queue.open_critical_incidents} critical incident${d.attention_queue.open_critical_incidents === 1 ? '' : 's'}`
        : hasRecords && d?.performance?.score == null
          ? `${issueTotal} issue${issueTotal === 1 ? '' : 's'} · ${incidentTotal} incident${incidentTotal === 1 ? '' : 's'}`
          : null,
      hasData: d?.performance?.score != null || hasSectionScores || hasRecords,
      segs: hasRecords && !hasSectionScores
        ? [
            ...(issueTotal > 0 ? [{ label: 'Issues', value: issueTotal, color: SEG_COLORS[0] }] : []),
            ...(incidentTotal > 0 ? [{ label: 'Incidents', value: incidentTotal, color: SEG_COLORS[1] }] : []),
          ]
        : undefined,
      total: issueTotal + incidentTotal,
    };
  },
  assurance: (d) => {
    const subs = oldSectionSubs(d);
    const aq = d?.attention_queue ?? {};
    const active = d?.sections?.coverage?.counts?.active ?? 0;
    const overdue = aq.overdue_control_tests ?? 0;
    const untested = aq.controls_untested ?? 0;
    return {
      score: d?.performance?.score ?? null,
      subs,
      pastSla: overdue,
      note: overdue > 0
        ? `${overdue} overdue test${overdue === 1 ? '' : 's'}`
        : untested > 0
          ? `${untested} untested control${untested === 1 ? '' : 's'}`
          : active > 0
            ? `${active} active control${active === 1 ? '' : 's'}`
            : null,
      hasData: d?.performance?.score != null || active > 0 || subs.some((s) => s.score != null),
    };
  },
  frameworks: (d) => {
    const journeys = d?.by_framework ?? [];
    const segs = (d?.status_mix ?? []).map((s: any, i: number) => ({ label: s.name, value: s.value, color: s.color || SEG_COLORS[i % SEG_COLORS.length] }));
    const names = journeys.map((j: any) => j.framework_name || j.name).filter(Boolean).slice(0, 2);
    return {
      score: null,
      subs: [],
      segs,
      total: journeys.length,
      note: journeys.length
        ? names.length
          ? `${journeys.length} journeys · ${names.join(', ')}${journeys.length > names.length ? '…' : ''}`
          : `${journeys.length} certification journeys`
        : null,
      hasData: journeys.length > 0,
    };
  },
  'vendor-risk': (d) => {
    const segs = oldDictSegs(d?.by_tier ?? d?.by_status);
    const expiring = d?.expiring_contracts?.length ?? 0;
    return {
      score: null,
      subs: [],
      segs,
      total: d?.total_vendors ?? 0,
      note: (d?.open_incidents ?? 0) > 0
        ? `${d.open_incidents} open incidents`
        : expiring > 0
          ? `${expiring} contract${expiring === 1 ? '' : 's'} expiring`
          : null,
      hasData: (d?.total_vendors ?? 0) > 0,
    };
  },
  bcm: (d) => ({
    score: null,
    subs: [],
    segs: oldDictSegs(d?.plans_by_status ?? d?.drills_by_status),
    total: d?.totals?.plans ?? 0,
    note: (d?.totals?.overdue_drills ?? 0) > 0
      ? `${d.totals.overdue_drills} overdue drill${d.totals.overdue_drills === 1 ? '' : 's'}`
      : (d?.totals?.active_plans ?? 0) > 0
        ? `${d.totals.active_plans} active plan${d.totals.active_plans === 1 ? '' : 's'}`
        : null,
    hasData: (d?.totals?.plans ?? 0) > 0 || (d?.totals?.drills ?? 0) > 0,
  }),
};
// the old page's aggregates over its cards (every visible module, an unanswered one mapped from undefined)
const oldIsScored = (c: any) => c.score != null || (c.subs?.length > 0 && c.subs.some((s: any) => s.score != null));
function oldAggregates(cards: any[]) {
  const scored = cards.filter(oldIsScored);
  const scores = scored.map((c) => c.score).filter((s: any): s is number => s != null);
  const overall = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null;
  const pastSla = cards.reduce((a, c) => a + (c.pastSla ?? 0), 0);
  const withData = cards.filter((c) => c.score != null || c.hasData).length;
  const weak: any[] = [];
  scored.forEach((c) => { if (c.score == null) return; (c.subs || []).forEach((s: any) => { if (typeof s.score === 'number') weak.push({ label: s.label, score: s.score, module: c.key }); }); });
  weak.sort((a, b) => a.score - b.score);
  return { overall, scored: scores.length, pastSla, withData, top: weak.slice(0, 6) };
}
const oldPosture = (riskScore: number | null) => (riskScore == null ? '—' : riskScore >= 70 ? 'Low' : riskScore >= 50 ? 'Moderate' : 'Elevated');
/* eslint-enable */

// ── a seeded random payload generator ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
type R = () => number;
const pick = <T,>(r: R, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const maybe = (r: R, p: number) => r() < p;
const score = (r: R): number | null => (maybe(r, 0.2) ? null : maybe(r, 0.1) ? 0 : Math.round(r() * 1000) / 10);
const word = (r: R) => pick(r, ['Documents', 'Mappings', 'Approvals', 'Evidence', 'Controls', 'Lifecycle & Hygiene', '', 'Attestations']);

function payload(r: R): any {
  if (maybe(r, 0.05)) return pick(r, [null, undefined, {}, [], 'x', 7]);
  const comps = Array.from({ length: Math.floor(r() * 9) }, () => (maybe(r, 0.1) ? null : { key: `k${Math.floor(r() * 99)}`, label: word(r), score: score(r), weight: r(), target: 85 }));
  const sections = Object.fromEntries(Array.from({ length: Math.floor(r() * 5) }, (_, i) => [`s${i}`, { label: word(r), score: score(r), counts: { total: maybe(r, 0.5) ? Math.floor(r() * 50) : undefined, active: Math.floor(r() * 30) } }]));
  const d: any = {
    performance: maybe(r, 0.9) ? { score: score(r), components: maybe(r, 0.7) ? comps : undefined } : undefined,
    sections: maybe(r, 0.8) ? { ...sections, issues: { counts: { total: Math.floor(r() * 40) } }, incidents: { counts: { total: Math.floor(r() * 40) } }, coverage: { counts: { active: Math.floor(r() * 90) } } } : undefined,
    attention: maybe(r, 0.8) ? { overdue_gaps: pick(r, [0, 1, 2, 7, undefined]) } : undefined,
    attention_queue: maybe(r, 0.8) ? { sla_breached_issues: pick(r, [0, 1, 4, undefined]), open_critical_incidents: pick(r, [0, 1, 2, 5, undefined]), overdue_control_tests: pick(r, [0, 1, 3, undefined]), controls_untested: pick(r, [0, 1, 9, undefined]) } : undefined,
    categories: maybe(r, 0.6) ? Array.from({ length: Math.floor(r() * 12) }, (_, i) => ({ category: `Cat ${i}`, score: score(r) })) : undefined,
    by_framework: maybe(r, 0.7) ? Array.from({ length: Math.floor(r() * 5) }, (_, i) => ({ name: maybe(r, 0.2) ? undefined : `Journey ${i}`, framework_name: maybe(r, 0.5) ? `FW ${i}` : undefined })) : undefined,
    status_mix: maybe(r, 0.7) ? Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({ name: `S${i}`, value: Math.floor(r() * 30), color: maybe(r, 0.5) ? '#123456' : undefined, key: pick(r, ['verified', 'implemented', undefined]) })) : undefined,
    total_vendors: pick(r, [0, 3, 40, undefined]),
    by_tier: maybe(r, 0.6) ? Object.fromEntries(['critical', 'high', 'medium', 'low', 'extra_one', 'extra_two'].map((k) => [k, Math.floor(r() * 9)])) : undefined,
    by_status: maybe(r, 0.6) ? { active: Math.floor(r() * 9), on_hold: Math.floor(r() * 9) } : undefined,
    expiring_contracts: maybe(r, 0.5) ? Array.from({ length: Math.floor(r() * 4) }, () => ({})) : undefined,
    open_incidents: pick(r, [0, 1, 2, 9, undefined]),
    totals: maybe(r, 0.7) ? { plans: pick(r, [0, 4, 170]), drills: pick(r, [0, 2]), overdue_drills: pick(r, [0, 1, 15, undefined]), active_plans: pick(r, [0, 1, 12, undefined]) } : undefined,
    plans_by_status: maybe(r, 0.6) ? { draft: Math.floor(r() * 9), under_review: Math.floor(r() * 9), approved: 0 } : undefined,
    drills_by_status: maybe(r, 0.5) ? { scheduled: Math.floor(r() * 9) } : undefined,
  };
  return d;
}

// what the two versions must agree on (the colours of a segment are not part of the answer any more, and one plural is fixed)
const answer = (c: any) => ({ score: c.score, subs: c.subs, pastSla: c.pastSla, note: c.note, hasData: c.hasData, total: c.total, segs: c.segs?.map((s: any) => ({ label: s.label, value: s.value })) });
const fixPlural = (c: any) => (typeof c.note === 'string' ? { ...c, note: c.note.replace(/^1 open incidents$/, '1 open incident') } : c);

test('the nine modules keep their request, their key, their address and their rights exactly', () => {
  assert.deepEqual(MODULES.map((m) => m.key), ['governance', 'compliance', 'assessments', 'assets', 'issues', 'assurance', 'frameworks', 'vendor-risk', 'bcm']);
  assert.deepEqual(MODULES.map((m) => m.path), [
    '/governance/dashboard/documents-overview', '/compliance/policies/dashboard/sections-overview', '/compliance/assessments/overview', '/assets/inventory-overview',
    '/issue-management/dashboard/sections-overview', '/control-library/assurance/sections-overview', '/compliance/policies/dashboard/frameworks-aggregate',
    '/vendor-risk/vendors/dashboard', '/bcm/dashboard',
  ]);
  assert.deepEqual(MODULES.map((m) => m.href), ['/governance', '/compliance', '/assessments', '/assets', '/issues', '/control-library/assurance', '/frameworks/manage', '/vendor-risk', '/bcm']);
  assert.deepEqual(MODULES.map((m) => m.label), ['Governance', 'Compliance', 'Assessments', 'Assets', 'Issues & Incidents', 'Control Testing & Assurance', 'Frameworks', 'Third-Party Vendor Risk', 'Business Continuity']);
  assert.deepEqual(MODULES.map((m) => m.requiredPermissions), [
    ['governance:policies:*'], ['compliance:frameworks:*', 'controls:control_library:*'], ['compliance:assessments:*'], ['assets:asset_inventory:*'],
    ['issue_management:issues:*', 'erm:incidents:*'], ['controls:control_library:*'], ['compliance:frameworks:*'], ['erm:risks:*'], ['bcm:dashboard:*', 'bcm:plans:*'],
  ]);
  // the first six share their cache with the module pages; the other three have their own
  assert.deepEqual(MODULES.map((m) => m.queryKey), [
    SCORECARD_QUERY_KEYS.governance, SCORECARD_QUERY_KEYS.compliance, SCORECARD_QUERY_KEYS.assessments, SCORECARD_QUERY_KEYS.assets, SCORECARD_QUERY_KEYS.issues, SCORECARD_QUERY_KEYS.assurance,
    undefined, undefined, undefined,
  ]);
  assert.deepEqual(MODULES.map((m) => m.viz), ['radar', 'bars', 'bars', 'radar', 'bars', 'bars', 'donut', 'donut', 'donut']);
});

test('visibleModules: an administrator sees all nine, anyone else the modules whose rights they hold (the old filter)', () => {
  assert.equal(visibleModules(true, () => false).length, 9);
  assert.deepEqual(visibleModules(false, () => false), []);
  const held = new Set(['compliance:frameworks:*', 'bcm:plans:*']);
  const keys = visibleModules(false, (perms) => perms.some((p) => held.has(p))).map((m) => m.key);
  assert.deepEqual(keys, ['compliance', 'frameworks', 'bcm']);
});

test('the answers read exactly as before: 4,000 seeded random payloads through each of the nine rules', () => {
  const r = rng(20261101);
  let compared = 0;
  for (let n = 0; n < 4000; n++) {
    const d = payload(r);
    for (const def of MODULES) {
      let old: any; let threw = false;
      try { old = OLD[def.key](d); } catch { threw = true; }
      if (threw) { assert.throws(() => def.map(d), Error, `${def.key} on ${JSON.stringify(d)?.slice(0, 80)}: the old rule threw, the new one must not return an answer`); continue; }
      assert.deepEqual(answer(fixPlural(def.map(d))), answer(fixPlural(old)), `${def.key} #${n}`);
      compared++;
    }
  }
  assert.ok(compared > 30000, `compared ${compared}`);
});

test('sectionSubs: the six weakest, a section with no score last, a missing name left out', () => {
  const d = { performance: { components: [{ label: 'A', score: 90 }, { label: 'B', score: null }, { label: '', score: 5 }, null, { label: 'C', score: 10 }, { label: 'D', score: 50 }, { label: 'E', score: 60 }, { label: 'F', score: 70 }, { label: 'G', score: 80 }] } };
  assert.deepEqual(sectionSubs(d).map((s) => s.label), ['C', 'D', 'E', 'F', 'G', 'A']);
  assert.deepEqual(sectionSubs({ sections: { x: { label: 'S', score: 1 } } }), [{ label: 'S', score: 1 }]);
  assert.deepEqual(sectionSubs(null), []);
  const g = MODULE_BY_KEY.governance.map(d);
  assert.equal(g.subsTotal, 7, 'the module has seven named sections; the card lists six');
  assert.equal(g.subs.length, 6);
});

test('a note says how serious it is, and the plural reads right', () => {
  const issues = MODULE_BY_KEY.issues.map({ attention_queue: { open_critical_incidents: 1 }, performance: { score: 40 } });
  assert.deepEqual([issues.note, issues.noteTone], ['1 critical incident', 'danger']);
  assert.equal(MODULE_BY_KEY.issues.map({ attention_queue: { open_critical_incidents: 3 } }).note, '3 critical incidents');
  const vendor = MODULE_BY_KEY['vendor-risk'].map({ total_vendors: 5, open_incidents: 1 });
  assert.deepEqual([vendor.note, vendor.noteTone], ['1 open incident', 'danger']);
  assert.equal(MODULE_BY_KEY['vendor-risk'].map({ total_vendors: 5, expiring_contracts: [{}, {}] }).note, '2 contracts expiring');
  const assurance = MODULE_BY_KEY.assurance.map({ attention_queue: { controls_untested: 4 } });
  assert.deepEqual([assurance.note, assurance.noteTone], ['4 untested controls', 'warning']);
  assert.equal(MODULE_BY_KEY.bcm.map({ totals: { plans: 3, active_plans: 3 } }).noteTone, 'neutral');
});

test('a donut says what it counts: the caption follows the answer that fed it', () => {
  assert.deepEqual(MODULE_BY_KEY['vendor-risk'].map({ by_tier: { high: 2 } }).chart, { title: 'Vendors by tier', by: 'Tier', unit: 'vendors' });
  assert.deepEqual(MODULE_BY_KEY['vendor-risk'].map({ by_status: { active: 2 } }).chart, { title: 'Vendors by status', by: 'Status', unit: 'vendors' });
  assert.equal(MODULE_BY_KEY.bcm.map({ plans_by_status: { draft: 1 } }).chart?.title, 'Plans by status');
  assert.equal(MODULE_BY_KEY.bcm.map({ drills_by_status: { done: 1 } }).chart?.title, 'Drills by status');
  assert.equal(MODULE_BY_KEY.frameworks.map({ by_framework: [{}, {}], status_mix: [] }).chart?.unit, 'certification journeys');
  const segs = MODULE_BY_KEY.frameworks.map({ status_mix: [{ key: 'verified', name: 'Verified', value: 4, color: '#e2e8f0' }] }).segs;
  assert.deepEqual(segs, [{ label: 'Verified', value: 4, key: 'verified' }], 'the key stays (the donut takes its colour from the control status), the server colour does not');
});

// ── where a request stands ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('loadOf: an earlier answer stands when a refresh fails; a stored null is no answer, never "no data"', () => {
  assert.equal(loadOf({ status: 'pending' }), 'loading');
  assert.equal(loadOf({ status: 'success', data: { a: 1 } }), 'ready');
  assert.equal(loadOf({ status: 'success', data: 0 }), 'ready');
  assert.equal(loadOf({ status: 'error', data: { a: 1 } }), 'ready', 'a refresh failed but the answer before it stands');
  assert.equal(loadOf({ status: 'error' }), 'error');
  assert.equal(loadOf({ status: 'success', data: null }), 'error', 'another page stores null under the shared key when its own request failed');
});

test('retryDashboard: a refusal is final and said at once; anything else is tried once more', () => {
  const http = (status: number) => ({ isAxiosError: true, response: { status } });
  assert.equal(retryDashboard(0, http(500)), true);
  assert.equal(retryDashboard(1, http(500)), false);
  for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(retryDashboard(0, http(status)), false, String(status));
  assert.equal(retryDashboard(0, http(429)), true);
  assert.equal(retryDashboard(0, new Error('network down')), true);
  assert.equal(isRefusal(http(403)), true);
  assert.equal(isRefusal(http(401)), true);
  assert.equal(isRefusal(http(500)), false);
  assert.equal(isRefusal(undefined), false);
  assert.ok(SLOW_MS >= 5000 && SLOW_MS <= 15000);
});

const ready = (data: unknown): Feed => ({ load: 'ready', data });
const view = (key: string, data: unknown): ModuleView => viewOf(MODULE_BY_KEY[key], ready(data));
const failed = (key: string, status = 500): ModuleView => viewOf(MODULE_BY_KEY[key], { load: 'error', error: { isAxiosError: true, response: { status } } });
const loading = (key: string): ModuleView => viewOf(MODULE_BY_KEY[key], { load: 'loading' });

test('viewOf: a card is waiting, failed, refused or its answer; a failure is never "no data"', () => {
  assert.equal(loading('governance').state, 'loading');
  assert.deepEqual([failed('governance').state, failed('governance', 403).state, failed('governance', 401).state, failed('governance', 404).state], ['error', 'denied', 'denied', 'error']);
  const empty = view('governance', {});
  assert.equal(empty.state, 'ready', 'an answer with nothing in it is "no data", and it is an answer');
  assert.equal(empty.scored, false);
  assert.equal(view('governance', { performance: { score: 58, components: [{ label: 'Docs', score: 50 }] } }).scored, true);
  assert.equal(view('governance', { performance: { score: null, components: [{ label: 'Docs', score: 50 }] } }).scored, true, 'a section score is enough');
  // an answer the rules cannot read is a failed card, not a crash
  const bad = viewOf(MODULE_BY_KEY.frameworks, ready({ by_framework: 5, status_mix: 'x' }));
  assert.equal(bad.state, 'error');
  assert.equal(retryableViews([bad]).length, 1);
});

test('failedViews and retryableViews: a refusal is listed but cannot be retried', () => {
  const views = [view('compliance', {}), failed('governance'), failed('assets', 403), loading('bcm')];
  assert.deepEqual(failedViews(views).map((v) => v.def.key), ['governance', 'assets']);
  assert.deepEqual(retryableViews(views).map((v) => v.def.key), ['governance']);
});

// ── the tiles ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const scored = (key: string, score: number, extra: object = {}) => view(key, { performance: { score, components: [{ label: 'One', score: score - 5 }, { label: 'Two', score: score + 5 }] }, ...extra });

test('readiness is the old mean of the module scores, rounded; with no score it is null and never 0', () => {
  const views = [scored('governance', 56), scored('compliance', 23), view('assessments', {}), loading('assets')];
  assert.deepEqual(readiness(views), { overall: Math.round((56 + 23) / 2), scored: 2 });
  assert.deepEqual(readiness([view('governance', {})]), { overall: null, scored: 0 });
  assert.deepEqual(readiness([]), { overall: null, scored: 0 });
  assert.equal(readiness([scored('governance', 79.5), scored('assets', 80)]).overall, 80);
  assert.equal(readiness([view('frameworks', { by_framework: [{}], status_mix: [] })]).overall, null, 'a count snapshot has no score');
});

test('readinessTile and modulesTile: they wait for every module, say when none is shown, and name the modules they leave out', () => {
  assert.deepEqual(readinessTile([]), { state: 'none' });
  assert.deepEqual(readinessTile([scored('governance', 60), loading('compliance')]), { state: 'loading' });
  assert.deepEqual(readinessTile([failed('governance'), failed('assets', 403)]), { state: 'error', failed: ['Governance', 'Assets'] });
  const partial = readinessTile([scored('governance', 60), failed('assets')]);
  assert.deepEqual(partial, { state: 'ready', value: { overall: 60, scored: 1 }, missing: ['Assets'] });
  const all = modulesTile([scored('governance', 60), view('assessments', {}), failed('assets'), view('bcm', { totals: { plans: 2 }, plans_by_status: { draft: 2 } })]);
  assert.deepEqual(all, { state: 'ready', value: { withData: 2, visible: 4 }, missing: ['Assets'] });
});

test('the old aggregates are reproduced on 600 random sets of cards: mean, past-SLA sum, modules with data, the six lowest sections', () => {
  const r = rng(7);
  for (let n = 0; n < 600; n++) {
    const picked = MODULES.filter(() => maybe(r, 0.7));
    const data = picked.map(() => payload(r));
    const oldCards = picked.map((m, i) => { try { return { key: m.key, ...OLD[m.key](data[i]) }; } catch { return null; } });
    if (oldCards.some((c) => c === null)) continue;                              // a shape the old page crashed on is not a card
    const views = picked.map((m, i) => viewOf(m, ready(data[i])));
    if (views.some((v) => v.state !== 'ready')) continue;
    const old = oldAggregates(oldCards as any[]);
    const now = readiness(views);
    assert.deepEqual([now.overall, now.scored], [old.overall, old.scored], `readiness #${n}`);
    assert.equal(modulesWithData(views), old.withData, `with data #${n}`);
    const tile = pastSlaTile(views);
    const sources = views.filter((v) => PAST_SLA_SOURCES.some((s) => s.key === v.def.key));
    if (sources.length === 0) assert.deepEqual(tile, { state: 'none' });
    else assert.equal((tile as any).value.total, old.pastSla, `past SLA #${n}`);
    const top = priorities(views);
    assert.deepEqual(top.rows.map((p) => [p.label, p.score, p.moduleKey]), old.top.map((p: any) => [p.label, p.score, p.module]), `priorities #${n}`);
  }
});

test('the past-SLA tile adds the three overdue counts, names each, and says so when a source is missing: with none shown it has nothing to say (it said 0)', () => {
  assert.deepEqual(pastSlaTile([]), { state: 'none' });
  assert.deepEqual(pastSlaTile([scored('governance', 60)]), { state: 'none' }, 'Governance has no overdue count of its own');
  const views = [view('assessments', { attention: { overdue_gaps: 3 } }), view('issues', { attention_queue: { sla_breached_issues: 2 } }), view('assurance', { attention_queue: { overdue_control_tests: 4 } })];
  const tile = pastSlaTile(views);
  assert.equal(tile.state, 'ready');
  assert.deepEqual((tile as any).value.parts.map((p: any) => [p.label, p.value, p.href]), [['Overdue gaps', 3, '/assessments'], ['SLA-breached issues', 2, '/issues'], ['Overdue control tests', 4, '/control-library/assurance']]);
  assert.equal((tile as any).value.total, 9);
  const partial = pastSlaTile([views[0], failed('issues'), loading('assurance')]);
  assert.deepEqual(partial, { state: 'loading' }, 'it waits for every source');
  const missing = pastSlaTile([views[0], failed('issues'), views[2]]);
  assert.deepEqual([(missing as any).value.total, (missing as any).missing, (missing as any).value.parts[1].value], [7, ['Issues & Incidents'], null], 'the sum leaves the failed source out and says which');
  assert.deepEqual(pastSlaTile([failed('assessments'), failed('issues', 403)]), { state: 'error', failed: ['Assessments', 'Issues & Incidents'] });
});

test('posture: the old thresholds, 70 and 50, at their edges; no score is no word', () => {
  for (const s of [null, 0, 49.99, 50, 69.99, 70, 100, 53, 93]) assert.equal(posture(s) ?? '—', oldPosture(s), String(s));
  assert.equal(posture(undefined), null);
});

test('the risk tile: no right is "denied" (not a dash), waiting, failed (a refusal says so), or the ERM score through posture', () => {
  assert.deepEqual(postureTile(false, ready({ performance: { score: 90 } })), { state: 'denied' });
  assert.deepEqual(postureTile(true, { load: 'loading' }), { state: 'loading' });
  const refused = postureTile(true, { load: 'error', error: { isAxiosError: true, response: { status: 403 } } });
  assert.equal(refused.state, 'error');
  assert.equal((refused as any).refused, true);
  assert.deepEqual(postureTile(true, ready({ performance: { score: 53 } })), { state: 'ready', score: 53, word: 'Moderate' });
  assert.deepEqual(postureTile(true, ready({})), { state: 'ready', score: null, word: null }, 'a register with no score yet is not recorded');
  assert.deepEqual(postureTile(true, ready({ performance: { score: 'x' } })), { state: 'ready', score: null, word: null });
});

// ── "where to act first" ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('priorities: the lowest sections across the scored modules, a module with no score of its own left out, and the count of those in the running', () => {
  const views = [
    view('governance', { performance: { score: 60, components: [{ label: 'Attestations', score: 24 }, { label: 'Documents', score: 90 }] } }),
    view('assets', { performance: { score: null, components: [{ label: 'Scan', score: 0 }] } }),             // no score of its own: left out, as before
    view('compliance', { performance: { score: 30, components: [{ label: 'Frameworks', score: 0 }, { label: 'Evidence', score: null }] } }),
    failed('issues'), loading('bcm'),
  ];
  const { rows, total } = priorities(views);
  assert.deepEqual(rows.map((p) => [p.label, p.module, p.score]), [['Frameworks', 'Compliance', 0], ['Attestations', 'Governance', 24], ['Documents', 'Governance', 90]]);
  assert.equal(total, 3);
  assert.deepEqual(priorities([]), { rows: [], total: 0 });
  const many = view('governance', { performance: { score: 50, components: Array.from({ length: 9 }, (_, i) => ({ label: `S${i}`, score: i * 10 })) } });
  assert.equal(priorities([many]).rows.length, 6, 'the module cuts to its six weakest before the list sees them');
});

// ── a card's rows, the donut ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a card lists its weakest sections and says what it leaves out; a section with no score reads "No data", never 0%', () => {
  const g = MODULE_BY_KEY.governance.map({ performance: { score: 50, components: Array.from({ length: 10 }, (_, i) => ({ label: `S${i}`, score: i === 9 ? null : i * 10 })) } });
  const { rows, total } = cardRows(g);
  assert.equal(rows.length, 6);
  assert.equal(total, 10);
  assert.equal(cutText(rows.length, total), 'Showing the 6 weakest of 10 sections');
  assert.equal(cutText(4, 4), '');
  const a = MODULE_BY_KEY.assessments.map({ categories: Array.from({ length: 45 }, (_, i) => ({ category: `C${i}`, score: i })) });
  assert.equal(a.subs.length, 45, 'Assessments keeps every category (the priorities read them all)');
  assert.deepEqual([cardRows(a).rows.length, cardRows(a).total], [6, 45]);
  assert.equal(scoreText(null), 'No data');
  assert.equal(scoreText(undefined), 'No data');
  assert.equal(scoreText(0), '0%', 'a real zero is a zero');
  assert.equal(scoreText(57.6), '58%');
  assert.equal(ringLabel('Governance', 58.2, 'weak'), 'Governance score 58 out of 100, weak.');
  assert.equal(ringLabel('Assets', null, 'no data'), 'Assets: no score yet.');
});

test('slices: each segment with its share of the whole; the shares add to 100; empty and non-positive segments are left out', () => {
  const list = slices([{ label: 'a', value: 1 }, { label: 'b', value: 1 }, { label: 'c', value: 1 }]);
  assert.deepEqual(list.map((s) => s.share), [34, 33, 33]);
  assert.equal(list.reduce((n, s) => n + s.share, 0), 100);
  assert.deepEqual(slices([{ label: 'x', value: 0 }, { label: 'y', value: -2 }, { label: 'z', value: NaN }]), []);
  assert.deepEqual(slices(undefined), []);
  const r = rng(3);
  for (let n = 0; n < 500; n++) {
    const segs = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) => ({ label: `s${i}`, value: 1 + Math.floor(r() * 200) }));
    assert.equal(slices(segs).reduce((t, s) => t + s.share, 0), 100);
  }
  assert.deepEqual(sliceTable(slices([{ label: 'Draft', value: 3 }, { label: 'Approved', value: 1 }]), 'Status'), { columns: ['Status', 'Count', 'Share'], rows: [['Draft', 3, '75%'], ['Approved', 1, '25%']] });
  assert.deepEqual(dictSegs({ draft: 3, under_review: 5, retired: 0 }), [{ label: 'under review', value: 5 }, { label: 'draft', value: 3 }]);
});

test('isScored: a score of its own or one section with a score; a count snapshot is neither', () => {
  const card = (c: Partial<Card>): Card => ({ score: null, subs: [], subsTotal: 0, ...c });
  assert.equal(isScored(card({ score: 0 })), true);
  assert.equal(isScored(card({ subs: [{ label: 'a', score: null }] })), false);
  assert.equal(isScored(card({ subs: [{ label: 'a', score: 0 }] })), true);
  assert.equal(isScored(card({})), false);
});
