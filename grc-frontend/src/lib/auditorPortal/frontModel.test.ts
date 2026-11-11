// node --test "src/lib/auditorPortal/frontModel.test.ts"
// What the Auditor Portal's front door draws: the months are labelled so twelve are unique; a missing or short answer is "no data" and never a row of zeros; the age buckets are named
// from the server's edges; the journeys are ordered by what waits and a journey with no file is not a bar; the scope slices add up to the requirements; the observation grid, deadline
// bars and regulator list follow the register's own words and addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { JourneyCard } from './portalModel.ts';
import {
  ageLabels, agingCategories, journeyFileSlices, journeyScopeSlices, agingTotal, deadlineRows, flowRows, hasFlow, journeyFiles, journeyMix, monthLabels, monthOfObservations, observationHeat, oldestWaiting,
  openedClosedRows, regulatorRows, scopeSlices, thisAndLast, tileOf, waitTone, kindSeries, bothSeries, type ObservationSummary, type WorkSummary,
} from './frontModel.ts';

const MONTHS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const run = (n: number, f: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => f(i));

const summary = (extra: Partial<WorkSummary> = {}): WorkSummary => ({
  as_of: '2026-11-11T09:00:00', months: MONTHS,
  files: { sent: run(12, (i) => i), decided: run(12, (i) => i % 3), waiting: run(12, (i) => 2 * i) },
  scope: { sent: run(12, () => 1), decided: run(12, () => 0), waiting: run(12, () => 1) },
  aging: { edges_days: [7, 14, 30, 90], files: [3, 0, 2, 1, 4], scope: [1, 1, 0, 0, 0], undated: { files: 0, scope: 0 } },
  scope_totals: { controls: 10, in_scope: 4, out_of_scope: 1, waiting: 2, turned_down: 1, no_request: 2 },
  ...extra,
});

const card = (id: number, name: string, p: number, a: number, r: number, scopePending = 0, status: string | null = 'in_progress'): JourneyCard => ({
  id, name, status, framework: null, version: null, files: { pending: p, approved: a, rejected: r, total: p + a + r },
  scope: { pending: scopePending, approved: 0, rejected: 0, total: scopePending }, controls_total: 10, no_request: 0,
});

test('twelve months are labelled so they are unique and read as a calendar: the year on the first and on every January', () => {
  const labels = monthLabels(MONTHS);
  assert.deepEqual(labels, ['Dec 2025', 'Jan 2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
  assert.equal(new Set(labels).size, 12);
  assert.deepEqual(monthLabels(['2026-03', 'not a month']), ['Mar 2026', 'not a month']);
});

test('raised and decided are files plus scope requests per month; a short or missing answer is no data, not zeros', () => {
  const rows = flowRows(summary());
  assert.ok(rows);
  assert.deepEqual(rows![0], { label: 'Dec 2025', sent: 1, decided: 0 });
  assert.deepEqual(rows![5], { label: 'May', sent: 6, decided: 2 });
  assert.equal(hasFlow(rows), true);
  assert.equal(flowRows(null), null);
  assert.equal(flowRows(summary({ files: { sent: [1, 2], decided: [0, 0], waiting: [0, 0] } })), null, 'two months of twelve is not a chart of twelve');
  const quiet = flowRows(summary({ files: { sent: run(12, () => 0), decided: run(12, () => 0), waiting: run(12, () => 0) }, scope: { sent: run(12, () => 0), decided: run(12, () => 0), waiting: run(12, () => 0) } }));
  assert.equal(hasFlow(quiet), false, 'twelve quiet months say "no history yet"');
});

test('the backlog is what waited at each month end, per kind or together, and its tile says which way it went', () => {
  const waiting = bothSeries(summary(), 'waiting');
  assert.equal(waiting![11], 23);
  assert.equal(kindSeries(summary(), 'files', 'waiting')![11], 22);
  assert.equal(kindSeries(summary(), 'scope', 'waiting')![11], 1);
  assert.equal(bothSeries(null, 'waiting'), null);
  assert.equal(kindSeries(summary({ scope: { sent: [1], decided: [1], waiting: [1] } }), 'scope', 'waiting'), null);
  assert.equal(bothSeries(summary({ scope: { sent: [1], decided: [1], waiting: [1] } }), 'waiting'), null, 'half an answer is no answer');
  const tile = tileOf(MONTHS, waiting, 'Waiting', 'down');
  assert.equal(tile!.delta!.direction, 'up');
  assert.equal(tile!.delta!.tone, 'bad', 'more waiting is worse');
  assert.match(tile!.delta!.text, /^Up 2$/);
  assert.match(tile!.summary, /Waiting: from 1 in Dec 2025 to 23 in Nov, up 22\./);
  assert.equal(tileOf(MONTHS, waiting, 'Waiting', 'down', false)!.delta, null, 'a tile can have no comparison');
  assert.equal(tileOf(MONTHS, [1, 2], 'x'), null);
  assert.deepEqual(thisAndLast([1, 4, 9]), { now: 9, before: 4 });
  assert.deepEqual(thisAndLast([5]), { now: 5, before: null });
  assert.equal(thisAndLast([]), null);
});

test('age buckets are named from the server\'s cuts and cover every waiting item', () => {
  assert.deepEqual(ageLabels([7, 14, 30, 90]), ['Under 7 days', '7-13 days', '14-29 days', '30-89 days', '90+ days']);
  const cats = agingCategories(summary());
  assert.deepEqual(cats!.map((c) => [c.label, c.cells.files, c.cells.scope]), [['Under 7 days', 3, 1], ['7-13 days', 0, 1], ['14-29 days', 2, 0], ['30-89 days', 1, 0], ['90+ days', 4, 0]]);
  assert.equal(agingTotal(cats), 12);
  assert.equal(agingTotal(null), 0);
  assert.equal(agingCategories(summary({ aging: { edges_days: [7, 14], files: [1], scope: [1], undated: { files: 0, scope: 0 } } })), null, 'buckets that do not match the cuts are no data');
});

test('the oldest wait is the first row, in whole days, never negative; a wait of a month is a warning and of three months a problem', () => {
  const now = new Date('2026-11-11T12:00:00');
  assert.equal(oldestWaiting([{ since: '2026-10-01T12:00:00' }, { since: '2026-11-01T12:00:00' }], now)!.days, 41);
  assert.equal(oldestWaiting([{ since: '2026-11-12T12:00:00' }], now)!.days, 0);
  assert.equal(oldestWaiting([{ since: null }, { since: 'soon' }], now), null);
  assert.equal(oldestWaiting([], now), null);
  assert.equal(oldestWaiting(null, now), null);
  assert.deepEqual([waitTone(5), waitTone(30), waitTone(89), waitTone(90)], ['default', 'warning', 'warning', 'danger']);
});

test('the journeys are drawn with the most waiting first, a journey with no file is not a bar, and a cut says how many there were', () => {
  const cards = [card(1, 'PCI DSS', 2, 8, 0), card(2, 'ISO 27001', 9, 3, 1, 2), card(3, 'Empty', 0, 0, 0), card(4, 'SOC 2', 0, 5, 0)];
  const out = journeyFiles(cards, 2);
  assert.deepEqual(out.categories.map((c) => c.label), ['ISO 27001', 'PCI DSS']);
  assert.deepEqual(out.categories[0].cells, { approved: 3, rejected: 1, pending: 9 });
  assert.equal(out.categories[0].href, '/auditor-portal/2');
  assert.equal(out.shown, 2);
  assert.equal(out.withFiles, 3);
  assert.deepEqual(journeyFiles([card(3, 'Empty', 0, 0, 0)]).categories, []);
  const label = (s: string | null) => ({ in_progress: 'In progress', on_hold: 'On hold', completed: 'Completed' } as Record<string, string>)[String(s)] ?? 'Unknown';
  assert.equal(journeyMix([card(1, 'a', 0, 0, 0), card(2, 'b', 0, 0, 0), card(3, 'c', 0, 0, 0, 0, 'completed')], label), '3 journeys: 2 in progress, 1 completed');
  assert.equal(journeyMix([], label), '0 journeys');
  assert.equal(journeyMix([card(1, 'a', 0, 0, 0, 0, 'on_hold')], label), '1 journey: 1 on hold');
});

test('the scope slices add up to the requirements and the waiting slice opens the queue', () => {
  const slices = scopeSlices(summary().scope_totals, [card(7, 'ISO', 0, 0, 0, 2)]);
  assert.equal(slices!.reduce((n, s) => n + s.value, 0), 10);
  assert.equal(slices!.find((s) => s.key === 'waiting')!.href, '/auditor-portal/7?kind=scope');
  assert.equal(slices!.find((s) => s.key === 'down')!.href, undefined);
  assert.equal(scopeSlices(null, []), null);
  assert.equal(scopeSlices({ controls: 1, in_scope: Number.NaN, out_of_scope: 0, waiting: 0, turned_down: 0, no_request: 0 }, []), null);
  const none = scopeSlices({ controls: 3, in_scope: 0, out_of_scope: 0, waiting: 0, turned_down: 0, no_request: 3 }, []);
  assert.equal(none!.find((s) => s.key === 'waiting')!.href, undefined, 'nothing waiting opens nothing');
});

const obs = (extra: Partial<ObservationSummary> = {}): ObservationSummary => ({
  total: 9, open: 6, deadlines: { overdue: 2, due_30: 1, later: 2, paused: 1, no_deadline: 0 },
  levels: [{ key: 'open', label: 'Open', terminal: false }, { key: 'in_progress', label: 'In progress', terminal: false }, { key: 'closed', label: 'Closed', terminal: true }],
  priorities: ['critical', 'high', 'medium', 'low'],
  by_priority: { critical: { open: 2 }, high: { open: 1, in_progress: 2 }, low: { closed: 3 } },
  months: MONTHS, opened: run(12, (i) => (i === 11 ? 4 : 0)), closed: run(12, (i) => (i === 11 ? 1 : 0)),
  regulators: [{ name: 'SBP', open: 4, total: 6 }, { name: 'SECP', open: 2, total: 2 }, { name: null, open: 0, total: 1 }],
  ...extra,
});

test('the observation grid is priority by the organisation\'s own statuses, with the register\'s address in every cell', () => {
  const heat = observationHeat(obs(), (p) => p.toUpperCase());
  assert.deepEqual(heat!.rows, ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
  assert.deepEqual(heat!.cols, ['Open', 'In progress', 'Closed']);
  assert.deepEqual(heat!.cells, [[2, 0, 0], [1, 2, 0], [0, 0, 0], [0, 0, 3]]);
  assert.equal(heat!.max, 3);
  assert.equal(heat!.href(1, 1), '/auditor-portal/statutory-audit?priority=high&status=in_progress');
  assert.equal(observationHeat(null, (p) => p), null);
});

test('the deadline bars are the register\'s chips: overdue and due in 30 days open them, and a bar with nothing in it opens nothing', () => {
  const rows = deadlineRows(obs());
  assert.deepEqual(rows!.map((r) => [r.key, r.value]), [['overdue', 2], ['due30', 1], ['later', 2], ['paused', 1], ['none', 0]]);
  assert.equal(rows![0].href, '/auditor-portal/statutory-audit?quick=overdue');
  assert.equal(rows![1].href, '/auditor-portal/statutory-audit?quick=due30');
  assert.equal(rows![2].href, undefined);
  assert.equal(deadlineRows(obs({ deadlines: { overdue: 0, due_30: 0, later: 0, paused: 0, no_deadline: 0 } }))![0].href, undefined);
  assert.equal(deadlineRows(null), null);
});

test('opened and closed per month need the full twelve; the tile\'s month is the last one', () => {
  assert.equal(openedClosedRows(obs())!.length, 12);
  assert.deepEqual(openedClosedRows(obs())![11], { label: 'Nov', opened: 4, closed: 1 });
  assert.equal(openedClosedRows(obs({ opened: [1] })), null);
  assert.deepEqual(monthOfObservations(obs()), { opened: 4, closed: 1 });
  assert.equal(monthOfObservations(null), null);
});

test('the regulators are the ones with open observations, the tail folds into Other, and each opens the register on that regulator', () => {
  const rows = regulatorRows(obs());
  assert.deepEqual(rows!.map((r) => [r.label, r.value]), [['SBP', 4], ['SECP', 2]], 'one with nothing open is not a bar');
  assert.equal(rows![0].note, '6 in all');
  assert.equal(rows![1].note, undefined);
  assert.equal(rows![0].href, '/auditor-portal/statutory-audit?regulator=SBP');
  const many = obs({ regulators: Array.from({ length: 9 }, (_, i) => ({ name: `R ${i}`, open: 9 - i, total: 9 - i })) });
  const folded = regulatorRows(many, 3)!;
  assert.equal(folded.length, 4);
  assert.equal(folded[3].label, 'Other');
  assert.equal(folded[3].value, 6 + 5 + 4 + 3 + 2 + 1, 'nothing is dropped');
  assert.equal(folded[3].href, undefined);
  const blank = regulatorRows(obs({ regulators: [{ name: null, open: 3, total: 3 }] }))!;
  assert.equal(blank[0].label, 'No regulator');
  assert.equal(blank[0].href, '/auditor-portal/statutory-audit?regulator=none');
  assert.equal(regulatorRows(null), null);
});

test('one journey files and requirements by state: the parts add up, the ones with something in them open the queue, the empty ones open nothing', () => {
  const files = journeyFileSlices(4, { pending: 3, approved: 5, rejected: 0, total: 8 });
  assert.deepEqual(files!.map((s) => [s.key, s.value]), [['approved', 5], ['rejected', 0], ['pending', 3]]);
  assert.equal(files!.find((s) => s.key === 'pending')!.href, '/auditor-portal/4');
  assert.equal(files!.find((s) => s.key === 'approved')!.href, '/auditor-portal/4?tab=decisions');
  assert.equal(files!.find((s) => s.key === 'rejected')!.href, undefined);
  assert.equal(journeyFileSlices(4, null), null);
  const counts = { files: { pending: 0, approved: 0, rejected: 0, total: 0 }, scope: { pending: 2, approved: 4, rejected: 1, in_scope: 3, out_of_scope: 1, total: 7 }, untouched: 5, untouched_manual: 1, decided: 0 };
  const scope = journeyScopeSlices(4, counts);
  assert.equal(scope!.reduce((n, s) => n + s.value, 0), 12, 'requests plus the requirements nobody asked about');
  assert.equal(scope!.find((s) => s.key === 'waiting')!.href, '/auditor-portal/4?kind=scope');
  assert.equal(scope!.find((s) => s.key === 'none')!.href, '/auditor-portal/4?kind=untouched');
  assert.equal(journeyScopeSlices(4, undefined), null);
});
