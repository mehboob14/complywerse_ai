// node --test "src/app/(dashboard)/governance/_overview/overviewModel.test.ts"
// What the Governance Overview promises and a screenshot cannot hold for long: the eight counters of the API each open somewhere real and different,
// a failed request is "Unavailable" and never 0, the number a counter shows is the scorecard's (the dedicated request only stands in when the
// scorecard cannot), and a chart has its numbers in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  ATTENTION, ATTENTION_KEYS, GOVERNANCE_SOURCES, allUnavailable, attentionTotal, breakdownSections, counterFor, coverageTile, documentsHref, documentsTile, isRefused, loadOf, monthLabel,
  performanceTile, postureRows, postureSummary, radarSpokes, retryOverview, scoreText, trendIsEmpty, trendRows, trendSummary, trendTotals,
  type Attention, type AttentionSources, type Load, type Scorecard,
} from './overviewModel.ts';
import { KPI_STATUSES, fromParams, sameSet } from '../documents/_workspace/libraryModel.ts';
import { overdueFromSearch } from '../../../../lib/committees.ts';

const read = (rel: string): string | null => {
  const url = new URL(rel, import.meta.url);
  return existsSync(url) ? readFileSync(url, 'utf8') : null;
};
const def = (key: string): Attention => ATTENTION.find((a) => a.key === key)!;

// ── the counters of the API ──────────────────────────────────────────────────
const dashboard = read('../../../../../../backend/grc/modules/governance/routers/dashboard.py');
test('every counter of the scorecard\'s attention_queue has a destination, in the order the page lists them', { skip: dashboard === null }, () => {
  const at = dashboard!.lastIndexOf('"attention_queue": {');
  const block = dashboard!.slice(at, dashboard!.indexOf('"performance":', at));
  const keys = Array.from(block.matchAll(/"([a-z_0-9]+)":/g), (m) => m[1]).filter((k) => k !== 'attention_queue' && k !== 'total');
  assert.equal(keys.length, 8, 'the API lists eight counters (did the backend change shape?)');
  assert.deepEqual([...ATTENTION_KEYS], keys);
  for (const key of keys) assert.match(def(key).href, /^\/[a-z]/, key);
});

test('no two counters open the same address, and every address is a path of this app', () => {
  assert.equal(new Set(ATTENTION.map((a) => a.href)).size, ATTENTION.length);
  for (const a of ATTENTION) assert.match(a.href, /^\/[a-z-]+(\/[a-z-]+)*(\?[a-z_]+=[a-z_,0-9]+)?$/, a.key);
});

test('a counter that does not open exactly its records says what its destination cannot do', () => {
  for (const a of ATTENTION) assert.equal(a.exact, a.gap === undefined, `${a.key}: exact and gap disagree`);
  assert.ok(ATTENTION.some((a) => a.exact), 'the library answers at least the documents awaiting approval');
});

test('the library addresses use the filters the library reads, and mean what the counter counts', () => {
  const statuses = (href: string) => fromParams(new URLSearchParams(href.split('?')[1])).filters.statuses;
  assert.deepEqual(statuses(def('documents_awaiting_approval').href), ['pending_review', 'pending_approval']);
  assert.ok(sameSet(statuses(def('documents_awaiting_approval').href), KPI_STATUSES.inReview), 'the library\'s own "In review" card');
  // the expiry counter opens the library's own expiry filter (the server's rule restated in libraryModel), with no status narrowing
  const expiring = fromParams(new URLSearchParams(def('expiring_documents_30d').href.split('?')[1]));
  assert.equal(expiring.filters.expiring, true);
  assert.deepEqual(expiring.filters.statuses, []);
  assert.equal(def('expiring_documents_30d').exact, true);
  assert.deepEqual(statuses(documentsHref.published), KPI_STATUSES.published);
  assert.deepEqual(statuses(documentsHref.archived), KPI_STATUSES.archived);
  assert.ok(sameSet(statuses(documentsHref.inReview), KPI_STATUSES.inReview));
});

test('the committee actions page opens its Overdue filter from the address, as the counter asks', () => {
  const page = read('../committees/actions/page.tsx');
  assert.ok(page, 'the actions page exists');
  assert.match(def('overdue_actions').href, /\?overdue=1$/);
  // the page keeps its filters in the address through the Committees model's schema (its `overdue` flag is the counter's ?overdue=1) and opens on the Overdue view through the model's
  // viewOf (lib/committeeHome.test.ts pins both; lib/committees.test.ts pins the parser)
  assert.match(page!, /useAddressState\(ACTIONS_SCHEMA\)/);
  assert.match(page!, /viewOf\(address\)/);
  assert.equal(overdueFromSearch(def('overdue_actions').href.split('?')[1]), true, 'the counter\'s address switches the filter on');
});

// ── what a counter shows ─────────────────────────────────────────────────────
const src = (over: Partial<Record<keyof AttentionSources, { load: Load; data?: unknown }>> = {}): AttentionSources => ({
  scorecard: { load: 'ready', data: { attention_queue: { documents_awaiting_approval: 6, overdue_reviews: 0, expiring_documents_30d: 3, exceptions_attention: 53, open_gaps: 0, overdue_attestations: 4, overdue_actions: 2, red_kris: 1, total: 69 } } },
  pending: { load: 'ready', data: { count: 9 } },
  overdue: { load: 'ready', data: { count: 7 } },
  expiring: { load: 'ready', data: { by_timeframe: { '30_days': 5 } } },
  exceptions: { load: 'ready', data: { pending_approval: 50, expiring_soon: 3 } },
  ...over,
} as AttentionSources);

test('the scorecard\'s number is the counter, and 0 is a number', () => {
  const s = src();
  assert.deepEqual(counterFor(def('documents_awaiting_approval'), s), { state: 'ready', value: 6 });   // not the dedicated request's 9
  assert.deepEqual(counterFor(def('overdue_reviews'), s), { state: 'ready', value: 0 });              // not the dedicated 7
  assert.deepEqual(counterFor(def('red_kris'), s), { state: 'ready', value: 1 });
});

test('while the scorecard loads, every counter waits for it (the dedicated answer would show first and then change)', () => {
  const s = src({ scorecard: { load: 'loading' } });
  for (const a of ATTENTION) assert.deepEqual(counterFor(a, s), { state: 'loading' }, a.key);
});

test('a failed scorecard: four counters keep their dedicated answer, the other four say Unavailable, none says 0', () => {
  const s = src({ scorecard: { load: 'error' } });
  assert.deepEqual(counterFor(def('documents_awaiting_approval'), s), { state: 'ready', value: 9 });
  assert.deepEqual(counterFor(def('overdue_reviews'), s), { state: 'ready', value: 7 });
  assert.deepEqual(counterFor(def('expiring_documents_30d'), s), { state: 'ready', value: 5 });
  assert.deepEqual(counterFor(def('exceptions_attention'), s), { state: 'ready', value: 53 });         // 50 pending + 3 expiring, as it always added them
  for (const key of ['open_gaps', 'overdue_attestations', 'overdue_actions', 'red_kris']) {
    assert.deepEqual(counterFor(def(key), s), { state: 'error', retry: ['scorecard'] }, key);
  }
});

test('both requests of a counter failed: it says Unavailable and Retry asks for both; one still loading: it waits', () => {
  assert.deepEqual(counterFor(def('overdue_reviews'), src({ scorecard: { load: 'error' }, overdue: { load: 'error' } })), { state: 'error', retry: ['scorecard', 'overdue'] });
  assert.deepEqual(counterFor(def('overdue_reviews'), src({ scorecard: { load: 'error' }, overdue: { load: 'loading' } })), { state: 'loading' });
  assert.deepEqual(counterFor(def('overdue_reviews'), src({ overdue: { load: 'error' } })), { state: 'ready', value: 0 });   // the scorecard answered: the dedicated failure is no concern of this counter
});

test('a scorecard that carries no counters (no organisation in scope) leaves the dedicated answers and shows the rest as not recorded', () => {
  const s = src({ scorecard: { load: 'ready', data: { attention_queue: {} } } });
  assert.deepEqual(counterFor(def('overdue_reviews'), s), { state: 'ready', value: 7 });
  assert.deepEqual(counterFor(def('red_kris'), s), { state: 'none' });
  assert.deepEqual(attentionTotal(s), { state: 'none' });
});

test('a number that is not a number is no number', () => {
  const s = src({ scorecard: { load: 'ready', data: { attention_queue: { red_kris: Number.NaN } } } });
  assert.deepEqual(counterFor(def('red_kris'), s), { state: 'none' });
});

test('the total is the server\'s, and Unavailable when the scorecard failed', () => {
  assert.deepEqual(attentionTotal(src()), { state: 'ready', value: 69 });
  assert.deepEqual(attentionTotal(src({ scorecard: { load: 'loading' } })), { state: 'loading' });
  assert.deepEqual(attentionTotal(src({ scorecard: { load: 'error' } })), { state: 'error' });
});

test('"every counter failed" is one message, not eight', () => {
  const s = src({ scorecard: { load: 'error' }, pending: { load: 'error' }, overdue: { load: 'error' }, expiring: { load: 'error' }, exceptions: { load: 'error' } });
  assert.equal(allUnavailable(ATTENTION.map((a) => counterFor(a, s))), true);
  assert.equal(allUnavailable(ATTENTION.map((a) => counterFor(a, src({ scorecard: { load: 'error' } })))), false);
  assert.equal(allUnavailable([]), false);
});

// ── requests ─────────────────────────────────────────────────────────────────
test('where a request stands', () => {
  assert.equal(loadOf({ status: 'pending' }), 'loading');
  assert.equal(loadOf({ status: 'error' }), 'error');
  assert.equal(loadOf({ status: 'success', data: {} }), 'ready');
  assert.equal(loadOf({ status: 'error', data: { count: 1 } }), 'ready', 'an earlier answer still stands when a refresh fails');
  assert.equal(loadOf({ status: 'success', data: null }), 'error', 'the main dashboard stores null under the shared scorecard key when its own request failed');
});

test('a refusal is final and said at once; anything else is tried once more', () => {
  const http = (status: number) => ({ isAxiosError: true, response: { status } });
  assert.equal(retryOverview(0, http(403)), false);
  assert.equal(retryOverview(0, http(404)), false);
  assert.equal(retryOverview(0, http(500)), true);
  assert.equal(retryOverview(1, http(500)), false);
  assert.equal(retryOverview(0, http(429)), true);
  assert.equal(retryOverview(0, new Error('Network Error')), true);
});

// ── tiles ────────────────────────────────────────────────────────────────────
test('the documents tile counts what the library counts: documents that are not archived', () => {
  const t = documentsTile({ total_documents: 44, by_status: { published: 23, draft: 8, pending_review: 4, pending_approval: 2, approved: 3, archived: 3, expired: 1 } });
  assert.deepEqual(t, { active: 41, archived: 3, published: 23, inReview: 6 });
  assert.deepEqual(documentsTile(undefined), { active: 0, archived: 0, published: 0, inReview: 0 });
});

const card = (over: Partial<Scorecard> = {}): Scorecard => ({
  sections: {
    documents: { key: 'documents', label: 'Documents', weight: 0.18, score: 65.6, metrics: [] },
    mappings: { key: 'mappings', label: 'Mappings', weight: 0.18, score: 78, metrics: [{ key: 'document_coverage', label: 'Docs mapped', weight: 0.35, score: 78, numerator: 32, denominator: 41, formula: 'documents linked / active documents' }] },
    kpi: { key: 'kpi', label: 'KPI Report', weight: 0.06, score: null, metrics: [] },
    reviews: { key: 'reviews', label: 'Reviews', weight: 0.14, score: 85.8, metrics: [] },
  },
  performance: { score: 66.6, grade: 'fair', components: [
    { key: 'documents', label: 'Documents', score: 65.6, weight: 0.18, target: 85 },
    { key: 'approvals', label: 'Approvals & Sign-off', score: 58.2, weight: 0.14, target: 85 },
    { key: 'kpi', label: 'KPI Report', score: null, weight: 0.06, target: 85 },
  ] },
  ...over,
});

test('the sections of the breakdown come in the breakdown\'s order, whatever order the server wrote them', () => {
  assert.deepEqual(breakdownSections(card()).map((s) => s.key), ['documents', 'mappings', 'reviews', 'kpi']);
  assert.deepEqual(breakdownSections(undefined), []);
});

test('the performance tile never turns "nothing to score" into 0, and counts the sections that were scored', () => {
  assert.deepEqual(performanceTile(card()), { score: 66.6, grade: 'fair', scored: 3, sections: 4 });
  assert.deepEqual(performanceTile(card({ performance: { score: null, grade: null, components: [] } })).score, null);
  assert.equal(performanceTile(undefined).score, null);
});

test('the coverage tile reads the server\'s "Docs mapped" metric with its numbers and its formula', () => {
  assert.deepEqual(coverageTile(card()), { percent: 78, mapped: 32, of: 41, formula: 'documents linked / active documents' });
  assert.equal(coverageTile(card({ sections: {} })), undefined);
  assert.equal(coverageTile(undefined), undefined);
});

// ── charts in words ──────────────────────────────────────────────────────────
test('the radar keeps a section with no data as no data, and plots only the scored ones', () => {
  const rows = postureRows(card().performance!.components);
  assert.deepEqual(rows.map((r) => [r.key, r.short, r.score, r.weightPct]), [['documents', 'Documents', 66, 18], ['approvals', 'Approvals', 58, 14], ['kpi', 'KPI', null, 6]]);
  assert.deepEqual(radarSpokes(rows).map((r) => r.key), ['documents', 'approvals']);
  assert.equal(postureSummary(rows), 'Governance section scores: Documents 66%, Approvals & Sign-off 58%, KPI Report no data. Target 85%.');
  assert.equal(postureSummary([]), 'No section scores yet.');
  assert.equal(scoreText(null), 'No data');
  assert.equal(scoreText(0), '0%');
  assert.equal(scoreText(65.6), '66%');
});

test('a month is named from its text: "2026-05" is May in every time zone', () => {
  assert.equal(monthLabel('2026-05'), 'May 26');
  assert.equal(monthLabel('2026-12'), 'Dec 26');
  assert.equal(monthLabel('2027-01'), 'Jan 27');
  assert.equal(monthLabel('soon'), 'soon');
});

test('the throughput rows, totals and words', () => {
  const rows = trendRows({
    created: [{ month: '2026-04', count: 9 }, { month: '2026-05', count: 4 }, { month: '2026-06', count: 1 }, { month: '2026-07', count: 0 }, { month: '2026-08', count: 5 }, { month: '2026-09', count: 5 }, { month: '2026-10', count: 6 }],
    published: [{ month: '2026-04', count: 9 }, { month: '2026-05', count: 0 }, { month: '2026-06', count: 1 }, { month: '2026-07', count: 0 }, { month: '2026-08', count: 2 }, { month: '2026-09', count: 5 }, { month: '2026-10', count: 5 }],
  });
  assert.equal(rows.length, 6, 'the last six months');
  assert.deepEqual(rows[0], { month: '2026-05', label: 'May 26', created: 4, published: 0 });
  assert.deepEqual(trendTotals(rows), { created: 21, published: 13, liveRate: 62 });
  assert.equal(trendIsEmpty(rows), false);
  assert.match(trendSummary(rows), /^Documents created and published each month: May 26, 4 created, 0 published; Jun 26, 1 created, 1 published;/);
});

test('nothing created is "no rate" and an empty chart, not 0%', () => {
  const rows = trendRows({ created: [{ month: '2026-05', count: 0 }], published: [{ month: '2026-05', count: 0 }] });
  assert.equal(trendTotals(rows).liveRate, null);
  assert.equal(trendIsEmpty(rows), true);
  assert.equal(trendIsEmpty(trendRows(undefined)), true);
  assert.equal(trendSummary(rows), 'No documents were created or published in this period.');
  assert.equal(trendRows({ created: [{ month: '2026-05', count: 2 }], published: [] })[0].published, 0);
});

// ── a refusal and the worklist's sources ─────────────────────────────────────
test('a refusal (403) is a refusal, not a failure to load: only the server saying "not allowed" is one', () => {
  const http = (status: number) => ({ isAxiosError: true, response: { status } });
  assert.equal(isRefused(http(403)), true);
  assert.equal(isRefused(http(401)), false);
  assert.equal(isRefused(http(404)), false);
  assert.equal(isRefused(http(500)), false);
  assert.equal(isRefused(new Error('Network Error')), false);
  assert.equal(isRefused(undefined), false);
});

test('the worklist of the Overview reads the document sources of the shared inbox and nothing else', () => {
  assert.deepEqual([...GOVERNANCE_SOURCES], ['doc.lifecycle', 'doc.signoff']);
});
