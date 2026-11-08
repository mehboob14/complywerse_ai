// node --test "src/app/(dashboard)/automation/overview/_overview/overviewModel.test.ts"
// The Overview's decisions: each counter opens what it counts, the work list is the person's own and ordered, the posture and framework figures keep their formulas, a failed source is never 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTERS, buildWork, collectorsToWatch, controlHref, frameworkBars, latestTrend, listCounter, pct, plainCounter, postureSlices, rankedCategories, setupSteps, showSetup,
  type CollectionRow, type ConnectorCategory,
} from './overviewModel.ts';
import { readAddress } from '../../../../../lib/addressState.ts';
import { EXPLORER_SCHEMA, pageOf, type ExplorerAddress } from '../../soc2-controls/_explorer/controlsAddress.ts';
import { inQuick, type ControlRow } from '../../soc2-controls/_explorer/controlsModel.ts';

const NOW = new Date('2026-11-08T10:00:00Z');
const row = (id: string, over: Partial<ControlRow> = {}): ControlRow => ({
  control_id: id, title: `Title ${id}`, category: 'Identity', checks_count: 0, overall_status: 'manual', owner_user_id: null, ownership_status: 'unowned', assigned_user_ids: [], next_test_date: null, ...over,
});
const rows = [
  row('A-1', { overall_status: 'failed', owner_user_id: 7, ownership_status: 'ok' }),
  row('A-2', { overall_status: 'passed', owner_user_id: 7, ownership_status: 'ok', next_test_date: '2026-10-01T00:00:00' }),
  row('A-3', { overall_status: 'expired', assigned_user_ids: [7] }),
  row('A-4', { overall_status: 'collection_failed', owner_user_id: 7, ownership_status: 'overdue' }),
  row('A-5', { overall_status: 'passed', owner_user_id: 9, ownership_status: 'ok' }),
  row('A-6', { overall_status: 'failed' }),
];

test('every counter of the band opens the explorer on exactly what it counts', () => {
  const key = (k: string) => COUNTERS.find((c) => c.key === k)!;
  const page = (href: string) => pageOf(readAddress(EXPLORER_SCHEMA, `?${href.split('?')[1] ?? ''}`) as ExplorerAddress);
  const ctx = { me: 7, now: NOW };
  const opened = (k: string) => {
    const p = page(key(k).href);
    return rows.filter((r) => (p.filters.quick ? inQuick(p.filters.quick, r, ctx) : true) && (p.filters.status.length ? p.filters.status.includes(r.overall_status) : true));
  };
  for (const k of ['failed', 'expired', 'collection_failed', 'overdue', 'unowned']) {
    const counted = listCounter(rows, false, false, NOW, k).value;
    assert.equal(opened(k).length, counted, k);
  }
  assert.equal(key('reviews').href, '/automation/soc2-controls/review');
  assert.equal(new Set(COUNTERS.map((c) => c.key)).size, COUNTERS.length);
});

test('a counter over the list is loading while it loads and an error when it failed, never 0', () => {
  assert.deepEqual(listCounter(undefined, true, false, NOW, 'failed'), { state: 'loading' });
  assert.deepEqual(listCounter(undefined, false, true, NOW, 'failed'), { state: 'error' });
  assert.deepEqual(listCounter(rows, false, false, NOW, 'failed'), { state: 'ready', value: 2 });
  assert.deepEqual(listCounter([], false, false, NOW, 'failed'), { state: 'ready', value: 0 }, 'an empty list is a real zero');
  assert.deepEqual(plainCounter(undefined, false, false), { state: 'none' }, 'a number the server did not give is a dash');
  assert.deepEqual(plainCounter(5, false, false), { state: 'ready', value: 5 });
  assert.deepEqual(plainCounter(5, false, true), { state: 'error' });
});

test('the work is the person\'s own, most urgent first, one row a control with its reasons', () => {
  const work = buildWork({
    me: 7, now: NOW, rows,
    myWork: {
      controls: [], overdue: [],
      na_reviews: [{ scf_id: 'BCD-04', name: 'Recovery', reason: 'No facilities' }],
      artifacts: [{ id: 3, name: 'Access policy', scf_id: 'IAC-01', status: 'in_review' }],
    },
  });
  assert.deepEqual(work.map((w) => w.key), ['na-BCD-04', 'control-A-1', 'control-A-2', 'control-A-4', 'control-A-3', 'artifact-3-Access policy']);
  const a2 = work.find((w) => w.key === 'control-A-2')!;
  assert.equal(a2.context, 'Test overdue');
  assert.equal(a2.overdue, true);
  assert.equal(a2.due, '2026-10-01T00:00:00');
  const a1 = work.find((w) => w.key === 'control-A-1')!;
  assert.equal(a1.due, null, 'a failing control with no late date has no date to read');
  assert.equal(a1.overdue, false);
  assert.equal(a2.action.href, controlHref('A-2', 'tests'));
  const a4 = work.find((w) => w.key === 'control-A-4')!;
  assert.equal(a4.context, 'Your review date has passed · Not collected');
  assert.equal(work.find((w) => w.key === 'na-BCD-04')!.context, 'Asked to mark it not applicable: No facilities');
  assert.ok(!work.some((w) => w.key === 'control-A-5' || w.key === 'control-A-6'), 'what is not theirs is not in their list');
  assert.equal(buildWork({ me: null, now: NOW, rows, myWork: undefined }).length, 0, 'nobody is nobody\'s');
});

test('the posture slices keep the order of what needs a person, the library total and a word the model does not know', () => {
  const s = postureSlices({ passed: 60, failed: 18, expired: 10, collection_failed: 19, manual: 371, unbound: 288, connect_one: 34, not_run: 7, error: 0, odd_word: 3 });
  assert.deepEqual(s.map((x) => x.key), ['failed', 'expired', 'collection_failed', 'passed', 'not_run', 'connect_one', 'unbound', 'manual', 'odd_word']);
  assert.equal(s.reduce((n, x) => n + x.value, 0), 810);
  assert.equal(s[0].label, 'Failing');
  assert.equal(s[0].href, '/automation/soc2-controls?status=failed');
  assert.equal(s.at(-1)!.label, 'Odd word');
  assert.equal(s.at(-1)!.tone, 'neutral');
});

test('a framework bar is requirements over the requirement total, and the grey part is what is accounted for but not mappable', () => {
  const [a, b, c] = frameworkBars([
    { key: 'soc2', label: 'SOC 2', controls: 413, requirements: 65, requirement_total: 65, counts: { mapped: 65 }, inferred: 0, inferred_pct: 0 },
    { key: 'pci', label: 'PCI DSS', controls: 371, requirements: 80, requirement_total: 100, counts: { other_party: 12, out_of_scope: 8 }, inferred: 0, inferred_pct: 0 },
    { key: 'x', label: 'X', controls: 1, requirements: 0, requirement_total: null, counts: {}, inferred: 0, inferred_pct: 0 },
  ]);
  assert.deepEqual([a.mappedPct, a.accountedPct], [100, 0]);
  assert.deepEqual([b.mappedPct, b.accountedPct, b.total], [80, 20, 100]);
  assert.deepEqual([c.mappedPct, c.total], [0, 0], 'no requirements is 0%, not a division by zero');
  assert.equal(pct(1, 3), 33);
  assert.equal(pct(5, 0), 0);
});

test('connector categories are ranked by what is waiting on them, and only the collectors that need a look are listed', () => {
  const cat = (category: string, connected: boolean, waiting: number, reach: number): ConnectorCategory => ({ category, connected, connected_providers: [], providers: [], controls_reachable: reach, controls_waiting: waiting });
  assert.deepEqual(rankedCategories([cat('scm', true, 0, 9), cat('cloud', false, 77, 77), cat('hr', false, 3, 3), cat('mdm', false, 3, 8)]).map((c) => c.category), ['cloud', 'mdm', 'hr', 'scm']);
  const col = (provider: string, state: CollectionRow['state'], affected: number): CollectionRow => ({ plugin_key: provider, title: null, provider, state, last_success_at: null, days_since_success: null, last_attempt_at: null, error: null, controls_affected: affected });
  assert.deepEqual(collectorsToWatch([col('a', 'healthy', 9), col('b', 'stale', 2), col('c', 'failing', 1), col('d', 'failing', 5), col('e', 'never_run', 4)]).map((c) => c.provider), ['d', 'c', 'b']);
});

test('the trend shows the latest snapshots and says how many it leaves out', () => {
  assert.deepEqual(latestTrend([1, 2, 3], 8), { shown: [1, 2, 3], hidden: 0 });
  assert.deepEqual(latestTrend([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8), { shown: [3, 4, 5, 6, 7, 8, 9, 10], hidden: 2 });
});

test('the setup journey: done is read from what exists, and the card is not drawn once a source is connected', () => {
  const none = setupSteps({ frameworksChosen: false, owned: 0, sourcesConnected: 0, checksRun: 0 });
  assert.deepEqual(none.map((s) => s.done), [false, false, false, false]);
  assert.equal(showSetup(none), true);
  const some = setupSteps({ frameworksChosen: true, owned: 34, sourcesConnected: 0, checksRun: 0 });
  assert.deepEqual(some.map((s) => s.done), [true, true, false, false]);
  assert.equal(showSetup(some), true);
  const begun = setupSteps({ frameworksChosen: true, owned: null, sourcesConnected: 2, checksRun: 0 });
  assert.equal(showSetup(begun), false);
  assert.equal(setupSteps({ frameworksChosen: true, owned: 1, sourcesConnected: 1, checksRun: 1 }).every((s) => s.done), true);
});
