// node --test "src/app/(dashboard)/dashboard/_overview/kpiModel.test.ts"
// The Cyber Security KPI strip's rules: its states (a failed request is said; no KPI report and a report with no KPIs are said, not hidden; a tenant with no report is
// an answer, never a failure), the counts, the KPIs furthest from their target, where Open KPI Report goes, and the snapshot (the GET writes nothing, so after a read the
// strip asks the server to keep today's value: once per read, never in a loop, silent when it fails). Source pins at the end hold CyberKpis.tsx to the same contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';
import { loadOf } from './overviewModel.ts';
import {
  SNAPSHOT_PATH, UPLOAD_HREF, countChips, furthestFromTarget, gapWords, historyWords, kpiCounts, newestNote, panelState, reportHref, rowFacts, shouldKeepSnapshot, snapshotKeeper, stripBody,
  type KpiData,
} from './kpiModel.ts';

const kpi = (topic: string, actual: number | null, target: number | null, extra: Record<string, unknown> = {}) => ({
  domain: 'Vulnerability management', topic, live: true, lowerBetter: false, actual, target, history: [], source: 'S', href: '/vulnerabilities',
  onTarget: actual == null || target == null ? null : actual >= target, ...extra,
}) as any;
const data = (items: unknown[], extra: Partial<KpiData> = {}): KpiData => ({ items, metrics: {}, liveFailed: false, workbook: { id: 7, total: 1 }, ...extra });

// ── the strip's states ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the strip is loading, failed, absent (no KPI report), empty (a report with no KPIs) or ready; a failed live feed does not hide the rows', () => {
  assert.deepEqual(panelState('loading', undefined), { state: 'loading' });
  assert.deepEqual(panelState('error', undefined), { state: 'error' });
  assert.deepEqual(panelState('ready', null), { state: 'absent' });
  assert.deepEqual(panelState('ready', undefined), { state: 'absent' });
  assert.deepEqual(panelState('ready', data([], { workbook: null })), { state: 'absent' }, 'the query answers "no report" as data');
  assert.deepEqual(panelState('ready', data([])), { state: 'empty', workbook: { id: 7, total: 1 } }, 'a report with no rows used to be a silent nothing');
  assert.deepEqual(panelState('ready', data([{}])), { state: 'ready', liveFailed: false, workbook: { id: 7, total: 1 } });
  assert.deepEqual(panelState('ready', data([{}], { liveFailed: true })), { state: 'ready', liveFailed: true, workbook: { id: 7, total: 1 } });
});

test('a tenant with no KPI report is an ANSWER: loadOf must not read it as a failure (a stored null does, which is why the query answers an object)', () => {
  const noReport = data([], { workbook: null });
  assert.equal(loadOf({ status: 'success', data: noReport }), 'ready');
  assert.deepEqual(panelState(loadOf({ status: 'success', data: noReport }), noReport), { state: 'absent' });
  assert.equal(loadOf({ status: 'success', data: null }), 'error', 'the trap this avoids: a stored null is an error');
});

test('Open KPI Report goes straight to the report the strip shows; with none, to where one is uploaded; several reports are said in the heading', () => {
  assert.equal(reportHref({ id: 12, total: 1 }), '/assessments/a/12');
  assert.equal(reportHref({ id: 12, total: 3 }), '/assessments/a/12', 'the newest, which is the one whose KPIs the strip shows');
  assert.equal(reportHref(null), UPLOAD_HREF);
  assert.equal(UPLOAD_HREF, '/assessments/types?type=kpi_report');
  assert.equal(newestNote({ id: 1, total: 1 }), '');
  assert.equal(newestNote(null), '');
  assert.equal(newestNote({ id: 1, total: 3 }), 'Newest of 3 KPI reports');
  assert.equal(newestNote({ id: 1, total: 1200 }), 'Newest of 1,200 KPI reports');
});

// ── the counts ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('counts: live KPIs, on target, below target (nothing measured is neither) and the not measured rest, so the parts add up', () => {
  const k = (onTarget: boolean | null) => ({ onTarget }) as any;
  assert.deepEqual(kpiCounts([k(true), k(false), k(null), k(true), k(false), k(false)]), { live: 6, onTarget: 2, below: 3, notMeasured: 1 });
  assert.deepEqual(kpiCounts([]), { live: 0, onTarget: 0, below: 0, notMeasured: 0 });
});

test('the one line of counts uses the registry\'s words and tones; "Not measured" only when there is one; one KPI is singular', () => {
  const chips = countChips({ live: 9, onTarget: 2, below: 6, notMeasured: 1 });
  assert.deepEqual(chips.map((c) => [c.key, c.label, c.count, c.tone]), [
    ['live', 'Live KPIs', 9, 'neutral'], ['on_target', 'On target', 2, 'success'], ['below_target', 'Below target', 6, 'danger'], ['not_measured', 'Not measured', 1, 'neutral'],
  ]);
  assert.deepEqual(countChips({ live: 1, onTarget: 1, below: 0, notMeasured: 0 }).map((c) => c.label), ['Live KPI', 'On target', 'Below target']);
});

// ── the KPIs furthest from their target ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the furthest KPIs: below target only, the furthest first, three at most, ties by name; a KPI with nothing measured is not ranked', () => {
  const live = [kpi('Beta', 80, 90), kpi('On time', 95, 90), kpi('Alpha', 80, 90), kpi('Far', 20, 90), kpi('Nothing', null, 90), kpi('Near', 89, 90), kpi('No target', 40, null)];
  assert.deepEqual(furthestFromTarget(live).map((f) => [f.topic, f.gap]), [['Far', 70], ['Alpha', 10], ['Beta', 10]], 'Alpha before Beta: same distance, by name');
  assert.deepEqual(furthestFromTarget(live, 5).map((f) => f.topic), ['Far', 'Alpha', 'Beta', 'Near']);
  assert.deepEqual(furthestFromTarget([kpi('Fine', 99, 90)]), []);
  assert.deepEqual(furthestFromTarget([]), []);
});

test('lower is better: the distance is above the target; the link is the KPI\'s own module, none when it has none', () => {
  const [slow] = furthestFromTarget([kpi('Time to contain', 30, 10, { lowerBetter: true, onTarget: false, href: '/erm' })]);
  assert.equal(slow.gap, 20);
  assert.equal(slow.href, '/erm');
  assert.equal(gapWords(slow), '20 points above');
  assert.equal(furthestFromTarget([kpi('No page', 10, 90, { href: '' })])[0].href, undefined);
});

test('two rows of the report on one live measure are named once (the counts still count both, as the KPI report page does)', () => {
  const live = [kpi('Vulnerabilities within remediation SLA', 40, 90, { domain: 'Vulnerability management' }), kpi('Vulnerabilities within remediation SLA', 40, 90, { domain: 'Patching' }), kpi('Assets seen', 70, 90)];
  assert.equal(kpiCounts(live).below, 3);
  assert.deepEqual(furthestFromTarget(live).map((f) => f.topic), ['Vulnerabilities within remediation SLA', 'Assets seen']);
});

test('the readings kept for a KPI are its sparkline: numbers only, oldest first, a day with no number left out; in words for a screen reader, nothing with under two readings', () => {
  const [f] = furthestFromTarget([kpi('Patch SLA', 48, 90, { history: [{ date: '2026-05-05', value: 30 }, { date: '2026-05-20', value: null }, { date: '2026-06-05', value: 41.5 }, { date: '2026-06-20', value: 48 }] })]);
  assert.deepEqual(f.history, [30, 41.5, 48]);
  assert.equal(historyWords(f), 'From 30% to 48% in 3 readings');
  const [none] = furthestFromTarget([kpi('No history', 48, 90)]);
  assert.deepEqual(none.history, []);
  assert.equal(historyWords(none), '');
  assert.equal(historyWords({ history: [48] }), '');
});

test('how far, in words: points, one point, and "just" under half a point; the row says the value, the target and the distance', () => {
  assert.equal(gapWords({ gap: 42.4, lowerBetter: false }), '42 points below');
  assert.equal(gapWords({ gap: 1, lowerBetter: false }), '1 point below');
  assert.equal(gapWords({ gap: 0.4, lowerBetter: false }), 'Just below');
  assert.equal(gapWords({ gap: 0.4, lowerBetter: true }), 'Just above');
  assert.equal(gapWords({ gap: 1204, lowerBetter: false }), '1,204 points below');
  const [row] = furthestFromTarget([kpi('Patch SLA', 47.6, 90)]);
  assert.deepEqual(rowFacts(row), { value: '48%', target: 'Target 90%', gap: '42 points below' });
  assert.deepEqual(rowFacts(furthestFromTarget([kpi('Small', 4.25, 90)])[0]), { value: '4.3%', target: 'Target 90%', gap: '86 points below' });
});

test('under the counts: the rows, "every live KPI is on target", "none is measured by the platform", or nothing when some are not measured and none is below', () => {
  const counts = (live: number, onTarget: number, below: number) => ({ live, onTarget, below, notMeasured: live - onTarget - below });
  assert.equal(stripBody(counts(0, 0, 0), []), 'no_live_feed');
  assert.equal(stripBody(counts(5, 2, 3), [{}]), 'rows');
  assert.equal(stripBody(counts(4, 4, 0), []), 'all_on_target');
  assert.equal(stripBody(counts(4, 3, 0), []), 'quiet', 'one is not measured: "every KPI is on target" would not be true');
});

// ── keeping today's value ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('after a read the live values were got in, the snapshot is due; without a report (kpi-live was never asked) or with the live values failed, it is not', () => {
  assert.equal(shouldKeepSnapshot(data([{}])), true);
  assert.equal(shouldKeepSnapshot(data([])), true, 'a report with no rows still read the live values');
  assert.equal(shouldKeepSnapshot(data([{}], { liveFailed: true })), false);
  assert.equal(shouldKeepSnapshot(data([], { workbook: null })), false);
  assert.equal(shouldKeepSnapshot(null), false);
  assert.equal(shouldKeepSnapshot(undefined), false);
});

test('the snapshot is asked ONCE per read: not twice for the same read (re-render, strict mode, a remount on the cached read), again for the next read', () => {
  let calls = 0;
  const keep = snapshotKeeper(() => { calls++; return Promise.resolve({ written: 5 }); });
  assert.equal(keep({ ok: true, at: 1000 }), true);
  for (let i = 0; i < 50; i++) assert.equal(keep({ ok: true, at: 1000 }), false);
  assert.equal(calls, 1, 'fifty more renders of the same read ask for nothing');
  assert.equal(keep({ ok: true, at: 2000 }), true, 'Retry, or a visit after the data went stale, is a new read');
  assert.equal(keep({ ok: true, at: 2000 }), false);
  assert.equal(calls, 2);
});

test('nothing is asked when the read is not ok or has no time (nothing was read)', () => {
  let calls = 0;
  const keep = snapshotKeeper(() => { calls++; return Promise.resolve(); });
  assert.equal(keep({ ok: false, at: 1000 }), false);
  assert.equal(keep({ ok: true, at: 0 }), false);
  assert.equal(keep({ ok: false, at: 0 }), false);
  assert.equal(calls, 0);
  assert.equal(keep({ ok: true, at: 1000 }), true, 'a read that was not ok is not "kept": the same time, once ok, is');
  assert.equal(calls, 1);
});

test('a failed snapshot is silent and is not tried again in a loop: a rejection, a throw and a call that returns nothing all leave the strip alone', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => { unhandled.push(e); };
  process.on('unhandledRejection', onUnhandled);
  try {
    let calls = 0;
    const rejects = snapshotKeeper(() => { calls++; return Promise.reject(new Error('503')); });
    const throws = snapshotKeeper(() => { calls++; throw new Error('offline'); });
    const nothing = snapshotKeeper((() => { calls++; return undefined; }) as never);
    for (const keep of [rejects, throws, nothing]) {
      assert.doesNotThrow(() => keep({ ok: true, at: 1000 }));
      for (let i = 0; i < 20; i++) keep({ ok: true, at: 1000 });          // every render after the failure
    }
    await new Promise((resolve) => setTimeout(resolve, 20));              // let a rejection reach the unhandled-rejection check
    assert.equal(calls, 3, 'each failed once and was not asked again for the same read');
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('the snapshot is not waited for: the keeper answers before a slow post finishes, and a second read does not wait for the first', async () => {
  let release: () => void = () => undefined;
  let calls = 0;
  const keep = snapshotKeeper(() => { calls++; return new Promise<void>((resolve) => { release = resolve; }); });
  assert.equal(keep({ ok: true, at: 1 }), true);
  assert.equal(keep({ ok: true, at: 2 }), true);
  assert.equal(calls, 2);
  release();
  await Promise.resolve();
});

// ── the strip keeps its contract in the file that draws it ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/\s.*$/gm, '$1');
const strip_ = strip(read('./CyberKpis.tsx'));
const model_ = strip(read('./kpiModel.ts'));

test('the snapshot path is the route the backend declares, and the GET and the POST are told apart', () => {
  assert.equal(SNAPSHOT_PATH, '/compliance/assessments/kpi-live/snapshot');
  let source = '';
  try { source = readFileSync(new URL('../../../../../../backend/grc/routers/compliance_assessments_router.py', import.meta.url), 'utf8'); } catch { /* the backend is not in every checkout */ }
  if (source) {
    assert.match(source, /@router\.get\("\/kpi-live"\)/);
    assert.match(source, /@router\.post\("\/kpi-live\/snapshot"\)/);
    assert.match(source, /router = APIRouter\(prefix="\/compliance\/assessments"/);
  }
  assert.match(strip_, /apiClient\.get\('\/compliance\/assessments\/kpi-live'\)/, 'the live values are still read with the GET');
});

test('CyberKpis posts the snapshot only through the keeper, once per read, from an effect that cannot chain into another read', () => {
  assert.equal((strip_.match(/apiClient\.post\(/g) ?? []).length, 1, 'one place posts');
  assert.match(strip_, /const keepSnapshot = snapshotKeeper\(\(\) => apiClient\.post\(SNAPSHOT_PATH\)\);/, 'at module level: one keeper for the page, so a remount on the cached read asks for nothing');
  const effect = /useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]\)/.exec(strip_.slice(strip_.indexOf('export function CyberKpis')));
  assert.ok(effect, 'an effect asks for the snapshot');
  assert.match(effect[1], /keepSnapshot\(\{ ok: keepable, at: query\.dataUpdatedAt \}\)/);
  assert.deepEqual(effect[2].split(',').map((s) => s.trim()).sort(), ['keepable', 'query.dataUpdatedAt']);
  assert.doesNotMatch(effect[1], /refetch|invalidate|setQueryData|setState|set[A-Z]\w*\(/, 'asking for the snapshot never starts a read or changes what is shown');
  assert.doesNotMatch(strip_, /invalidateQueries|useMutation|useReportedMutation|useNotify|toast/, 'a snapshot is not a mutation the person made: no message');
  assert.match(strip_, /const keepable = shouldKeepSnapshot\(query\.data\);/);
  assert.equal((strip_.match(/\.catch\(/g) ?? []).length, 1, 'the one catch records that the live values failed; the snapshot\'s silence lives in the keeper');
  assert.match(model_, /Promise\.resolve\(post\(\)\)\.catch\(\(\) => undefined\)/);
});

test('the strip keeps the requests, the key and the states the Performance Overview relies on', () => {
  assert.match(strip_, /queryKey: \['main-kpi-live'\],/);
  assert.match(strip_, /apiClient\.get\('\/compliance\/assessments', \{ params: \{ limit: 50, assessment_format: KPI_FORMAT \} \}\)/);
  assert.match(strip_, /staleTime: 60_000,\s*retry: retryDashboard,/);
  assert.match(strip_, /\.catch\(\(\) => \{ liveFailed = true; return \{ metrics: \{\} \}; \}\)/);
  assert.match(strip_, /panelState\(loadOf\(query\), query\.data\)/);
  assert.match(strip_, /panel\.state === 'error'/);
  assert.match(strip_, /Couldn't load the Cyber Security KPIs/);
  assert.match(strip_, /panel\.liveFailed/);
  assert.match(strip_, /return \{ items: \[\], metrics: \{\}, liveFailed: false, workbook: null \};/, 'no KPI report is an answer, not a stored null (loadOf reads null as a failure)');
  assert.doesNotMatch(strip_, /return null;/);
});

test('the strip and its model follow the kit: only the --ds tokens, 12px floor, no native dialog, nothing hover-only, no text-size-less <p>/<td>/<th>/<h2>/<h3>', () => {
  for (const [name, text] of [['CyberKpis.tsx', read('./CyberKpis.tsx')], ['kpiModel.ts', read('./kpiModel.ts')]] as const) {
    assert.deepEqual(findViolations(text).map((v) => `${name}:${v.line} ${v.rule}: ${v.text}`), []);
    assert.doesNotMatch(strip(text), /window\.(confirm|alert|prompt)|(^|[^.\w])(confirm|alert|prompt)\(/m, `${name}: no native dialog`);
    assert.doesNotMatch(text, /opacity-0[^"'`]*group-hover|group-hover[^"'`]*opacity-0/, `${name}: no action that appears on hover only`);
    assert.doesNotMatch(strip(text), /toLocaleDateString|\.toLocaleString\(|localStorage|sessionStorage/, `${name}: numbers go through lib/format; nothing is kept in the browser`);
    assert.doesNotMatch(strip(text), /governance-light|AnimatedModal|dash-card|className="dash /, `${name}: no legacy scope, no legacy overlay`);
  }
  const SIZE = /(?<![\w:\-[])!?text-(?:ds-(?:title|section|body|label)|\[\d[^\]]*\])(?![\w-])/;
  let scanned = 0;
  for (const tag of ['p', 'td', 'th', 'h2', 'h3']) {
    for (const m of Array.from(strip_.matchAll(new RegExp(`<${tag}(?=[\\s>])`, 'g')))) {
      const start = m.index ?? 0;
      const opening = strip_.slice(start, strip_.indexOf('>', start) + 1);
      scanned++;
      assert.match(opening, SIZE, `<${tag}> names no text size: ${opening.slice(0, 90)}`);
    }
  }
  assert.ok(scanned >= 2, `the scan found ${scanned} elements: the check reads the file`);
});

test('every row is one target (a link to the KPI\'s module, or plain text), a 44px target on a phone, with a visible focus ring', () => {
  assert.match(strip_, /<Link href=\{f\.href\}/);
  assert.match(strip_, /min-h-ds-control/);
  assert.match(strip_, /focus-visible:shadow-\[inset_0_0_0_2px_var\(--ds-focus\)\]/);
  assert.doesNotMatch(strip_, /<button/, 'no card button, no dialog: the detail lives in the KPI report');
});
