// node --test "src/components/compliance/overview/graphModel.test.ts"
// What the graphs of the Compliance Overview draw: every Ready / Implemented figure is the journey model's (no percentage of its own), an area with no score is "No data" and not a ring at 0, a status mix
// is counts with out-of-scope requirements left out, the framework tiles are in the table's order (the most urgent first) in the band's colour, the history is "no trend" under two days, and for evidence
// a figure a missing key is left out and never 0. Every part that opens records says where.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { journeyNumbers } from '../../../lib/journeyModel.ts';
import { SERIES, STATUS } from '../../overview/charts/palette.ts';
import {
  AREA_WORDS, FRAMEWORK_WORDS, approvedThisMonth, areaNotes, areaTiles, controlBars, daysOf, dueCounts, evidenceFlow, evidenceParts, feedState, figuresOf, frameworkTiles, freshnessBars,
  monthLabel, openWork, requirementParts, scoreTone, sparkOf, toneColor, trendRows,
} from './graphModel.ts';
import { journeyRows, sectionRows, type JourneyListItem } from './overviewModel.ts';

const TODAY = new Date(2026, 10, 11);

// a journey's `progress` as the journey function sends it (calculate_progress_summary): implemented includes verified; applicable = total - not applicable
const progress = (total: number, impl: number, inProg: number, toStart: number, na: number, approved: number, by_domain?: Array<Record<string, unknown>>) => ({
  total_controls: total, implemented_count: impl, verified_count: Math.floor(impl / 3), in_progress_count: inProg, not_started_count: toStart, not_applicable_count: na,
  approved_evidence_controls: approved, by_domain,
});
const J: JourneyListItem[] = [
  { id: 1, name: 'ISO 27001', status: 'in_progress', target_date: '2026-11-20T00:00:00', progress: progress(100, 50, 20, 25, 5, 40) },
  { id: 2, name: 'PCI DSS', status: 'in_progress', target_date: '2026-11-01T00:00:00', progress: progress(200, 40, 60, 90, 10, 20) },
  { id: 3, name: 'GDPR', status: 'in_progress', target_date: null, progress: progress(40, 30, 5, 5, 0, 30) },
  { id: 4, name: 'NIST CSF', status: 'completed', target_date: '2026-09-01T00:00:00', progress: progress(100, 95, 0, 0, 5, 95) },
  { id: 5, name: 'No figures yet', status: 'in_progress', target_date: '2027-06-01T00:00:00', progress: null },
  { id: 6, name: 'On hold one', status: 'on_hold', target_date: '2027-06-01T00:00:00', progress: progress(10, 1, 1, 8, 0, 0) },
];

test('the figures are the active journeys that have progress, in the order of the table (late first, then the lowest Ready), and only the journey model\'s numbers', () => {
  const figs = figuresOf(J, TODAY);
  assert.equal(figs[0].row.name, 'PCI DSS', 'overdue first');
  assert.ok(!figs.some((f) => f.row.name === 'NIST CSF'), 'a finished journey is not drawn');
  assert.ok(!figs.some((f) => f.row.name === 'No figures yet'), 'a journey with no progress is not drawn as zeros');
  const iso = figs.find((f) => f.row.name === 'ISO 27001')!;
  assert.deepEqual(iso.n, journeyNumbers(J[0].progress)!);
  assert.equal(iso.n.applicable, 95, '100 requirements, 5 out of scope');
  assert.deepEqual(figs.map((f) => f.row.id), journeyRows(J, TODAY).filter((r) => r.active && r.ready !== null).map((r) => r.id));
});

test('requirements by status over every journey with work in it: implemented (verified counted once), in progress, not started, out-of-scope left out; no journey with figures is no parts', () => {
  const figs = figuresOf(J, TODAY);
  const parts = requirementParts(figs);
  assert.deepEqual(parts.map((p) => `${p.key}:${p.value}`), [`implemented:${50 + 40 + 30 + 1}`, `in_progress:${20 + 60 + 5 + 1}`, `not_started:${25 + 90 + 5 + 8}`]);
  assert.equal(parts.reduce((n, p) => n + p.value, 0), figs.reduce((n, f) => n + f.n.applicable, 0), 'adds up to the requirements in scope');
  assert.deepEqual(parts.map((p) => p.color), [STATUS.good, STATUS.progress, STATUS.neutral]);
  assert.ok(parts.every((p) => p.href === '/frameworks'), 'the hub lists journeys, not requirements: every part opens it');
  assert.deepEqual(requirementParts([]), []);
});

test('open work: the requirements still to do over the journeys that are drawn', () => {
  const w = openWork(figuresOf(J, TODAY));
  assert.deepEqual(w, { open: (20 + 25) + (60 + 90) + (5 + 5) + (1 + 8), toStart: 25 + 90 + 5 + 8, inProgress: 20 + 60 + 5 + 1 });
  assert.deepEqual(openWork([]), { open: 0, toStart: 0, inProgress: 0 });
});

test('framework tiles: the most urgent first (the table\'s order), the journey model\'s Ready % in the band\'s colour, Implemented and the stage in the note, no figures is "No figures" and never a ring at 0', () => {
  const rows = journeyRows(J, TODAY);
  const tiles = frameworkTiles(rows);
  assert.deepEqual(tiles.map((t) => t.key), rows.map((r) => String(r.id)), 'the same order as the rows');
  assert.equal(tiles[0].label, 'PCI DSS', 'the one whose target date has passed comes first');
  const pci = tiles.find((t) => t.label === 'PCI DSS')!;
  assert.equal(pci.display, '11%', '20 of 190 requirements in scope = 10.5, said the way the hub says it');
  assert.equal(pci.value, 10.5);
  assert.equal(pci.tone, 'bad', 'below 25 is "just starting": under 50 is early');
  assert.match(pci.note ?? '', /^In progress · Just starting · Implemented 21%$/);
  assert.equal(pci.href, '/frameworks/2');
  const gdpr = tiles.find((t) => t.label === 'GDPR')!;
  assert.deepEqual([gdpr.display, gdpr.tone], ['75%', 'good']);
  assert.equal(tiles.find((t) => t.label === 'ISO 27001')!.tone, 'bad', '40 of 95 in scope = 42%: early');
  const building = frameworkTiles(journeyRows([{ id: 7, name: 'SOC 2', status: 'in_progress', progress: progress(100, 60, 10, 30, 0, 60) }], TODAY));
  assert.deepEqual([building[0].display, building[0].tone], ['60%', 'warn'], '50 to 74 is building');
  const none = tiles.find((t) => t.label === 'No figures yet')!;
  assert.deepEqual([none.value, none.display, none.tone], [null, undefined, 'neutral']);
  assert.equal(none.note, 'In progress');
  assert.deepEqual(frameworkTiles([]), []);
  assert.deepEqual(FRAMEWORK_WORDS, { good: 'Strong', warn: 'Building', bad: 'Early', neutral: 'No figures' });
});

test('journeys due: late or due within 30 days, over the journeys with work in them (a finished journey has no date to meet)', () => {
  const rows = journeyRows(J, TODAY);
  assert.deepEqual(dueCounts(rows), { due: 2, overdue: 1 }, 'PCI is late, ISO within 30 days; NIST is finished');
  assert.deepEqual(dueCounts([]), { due: 0, overdue: 0 });
});

test('the areas as small multiples: weakest first, an area with no score last as "No data" (a ring that is not scored, never 0), the band\'s tone, the weight and what is wrong in the note, the page each opens', () => {
  const rows = sectionRows({
    frameworks: { label: 'Frameworks', weight: 0.2, score: 39.1 }, controls: { label: 'Controls', weight: 0.18, score: null }, effectiveness: { label: 'Control Effectiveness', weight: 0.18, score: 82 },
    evidence: { label: 'Evidence', weight: 0.18, score: 64.4 },
  });
  const tiles = areaTiles(rows, { frameworks: '2 journeys late' });
  assert.deepEqual(tiles.map((t) => t.key), ['frameworks', 'evidence', 'effectiveness', 'controls']);
  assert.deepEqual(tiles.map((t) => t.value), [39.1, 64.4, 82, null]);
  assert.deepEqual(tiles.map((t) => t.tone), ['bad', 'warn', 'good', 'neutral']);
  assert.equal(tiles[0].note, '20% of the score · 2 journeys late');
  assert.equal(tiles[1].note, '18% of the score');
  assert.equal(tiles[0].href, '/frameworks');
  assert.equal(tiles[2].href, '/control-library/assurance');
  assert.deepEqual(AREA_WORDS, { good: 'Strong', warn: 'Fair', bad: 'Weak', neutral: 'No data' });
});

test('the four buckets the band used to count ride on the area tiles: a count of 0, and one the answer did not carry, is no note; lapsed files come from the evidence summary', () => {
  const queue = { controls_without_evidence: 58, overdue_control_tests: 1, regulatory_overdue_tasks: 3, evidence_stale: 0 };
  assert.deepEqual(areaNotes(queue, { lapsed_count: 35, stale_count: 0 }), {
    controls: '58 controls without evidence', effectiveness: '1 overdue test', evidence: '35 lapsed files', regulatory: '3 overdue tasks',
  });
  assert.deepEqual(areaNotes({ controls_without_evidence: 0 }, { lapsed_count: 0 }), {}, 'nothing wrong is no note');
  assert.deepEqual(areaNotes(undefined, undefined), {});
  assert.equal(areaNotes({}, { stale_count: 5 }).evidence, '5 lapsed files', 'an older server sent only the stale count');
});

test('the controls\' three measures are the server\'s own scores (not worked out here), in the colour of their band; a measure with no score is "No data", a section the answer lacks is left out', () => {
  const bars = controlBars({
    controls: { metrics: [{ key: 'evidence_coverage', score: 0, numerator: 0, denominator: 58 }, { key: 'verified', score: 18.1 }, { key: 'applicability', score: 67 }] },
    effectiveness: { metrics: [{ key: 'test_coverage', score: 70.5 }] },
  });
  assert.deepEqual(bars.map((b) => [b.label, b.valueText, b.value, b.href]), [['With evidence', '0%', 0, '/controls'], ['Verified', '18%', 18.1, '/controls'], ['Tested', '71%', 70.5, '/control-library/assurance']]);
  assert.deepEqual(bars.map((b) => b.color), [STATUS.bad, STATUS.bad, STATUS.warn]);
  const lacking = controlBars({ controls: { metrics: [{ key: 'evidence_coverage', score: null }] } });
  assert.deepEqual(lacking.map((b) => [b.valueText, b.value]), [['No data', 0], ['No data', 0]], 'a metric with no score, and one missing from the answer, are both "No data"');
  assert.deepEqual(controlBars(undefined), []);
});

test('the history: under two days is no trend; the tiles\' sparkline and delta are the last two snapshots, up is good', () => {
  assert.deepEqual(trendRows([]), []);
  assert.deepEqual(trendRows([{ label: 'Nov 04', completion: 40, readiness: 30 }]), []);
  assert.deepEqual(trendRows(undefined), []);
  const rows = trendRows([{ label: 'Oct 28', completion: 45.8, readiness: 34.7 }, { label: 'Nov 04', completion: 48.2, readiness: 38.8 }, { label: 'Nov 11', completion: 50.7, readiness: 39.7 }]);
  assert.deepEqual(rows[2], { label: 'Nov 11', implemented: 50.7, ready: 39.7 });
  const ready = sparkOf(rows, 'ready', 'Ready')!;
  assert.deepEqual(ready.values, [34.7, 38.8, 39.7]);
  assert.equal(ready.summary, 'Ready: from 35% on Oct 28 to 40% on Nov 11.');
  assert.deepEqual(ready.delta, { text: 'Up 1 point', direction: 'up', tone: 'good' }, 'between the last two snapshots, in whole points like the figure (39.7 and 38.8 are 40 and 39)');
  assert.equal(sparkOf([], 'ready', 'Ready'), null);
  assert.equal(daysOf('30'), 30);
  assert.equal(daysOf('365'), 365);
  assert.equal(daysOf('nonsense'), 90);
});

test('evidence by status: approved first, the pill colours, a file put away is the quiet grey, every part opens the library at that status; no answer is no parts', () => {
  const parts = evidenceParts({ by_status: { archived: 6, approved: 630, rejected: 14, pending_review: 36, draft: 9, expired: 4, odd_one: 1 } });
  assert.deepEqual(parts.map((p) => p.key), ['approved', 'pending_review', 'draft', 'rejected', 'expired', 'archived', 'odd_one']);
  assert.equal(parts[0].color, STATUS.good);
  assert.equal(parts[1].label, 'Pending review');
  assert.equal(parts[3].color, STATUS.bad);
  assert.equal(parts[0].href, '/evidence?status=approved');
  assert.deepEqual(evidenceParts({}), []);
  assert.deepEqual(evidenceParts(null), []);
});

test('evidence freshness: counts on one scale (every file), overlapping on purpose; a count the answer did not carry is left out and never 0', () => {
  const f = freshnessBars({ total_count: 699, in_force_count: 604, expiring_soon_count: 40, lapsed_count: 35, stale_count: 0, pending_review_count: 36 });
  assert.deepEqual(f.rows.map((r) => `${r.key}:${r.value}`), ['in_date:604', 'expiring:40', 'lapsed:35', 'waiting:36']);
  assert.equal(f.rows[0].label, 'In date');
  assert.equal(f.max, 699);
  assert.equal(f.rows[2].href, '/evidence?fresh=lapsed');
  assert.equal(f.rows[3].href, '/evidence?quick=waiting');
  assert.equal(f.rows[0].href, undefined);
  const old = freshnessBars({ total_count: 10, stale_count: 3 });
  assert.deepEqual(old.rows.map((r) => `${r.key}:${r.value}`), ['lapsed:3'], 'an older server sent only the stale count');
  assert.deepEqual(freshnessBars(undefined).rows, []);
  assert.equal(freshnessBars({}).max, 1);
});

test('evidence flow and the tile: months by name (the first and every January with the year), a month with no count is a gap, the figure is this month so far', () => {
  assert.equal(monthLabel('2026-06'), 'Jun');
  assert.equal(monthLabel('2026-06', true), 'Jun 2026');
  assert.equal(evidenceFlow({ by_month: [{ month: '2026-09', uploaded: 1, approved: 1 }, { month: '2026-10', uploaded: 1, approved: 1 }] })[0].label, 'Sep', 'a window inside one year has no year');
  assert.equal(evidenceFlow({ by_month: [{ month: '2026-12', uploaded: 1, approved: 1 }, { month: '2027-01', uploaded: 1, approved: 1 }] })[0].label, 'Dec 2026', 'a window across a new year says it');
  assert.equal(monthLabel('2027-01'), 'Jan 2027');
  assert.equal(monthLabel('junk'), 'junk');
  const s = { by_month: [{ month: '2026-06', uploaded: 89, approved: 80 }, { month: '2026-07', uploaded: 92, approved: 84 }, { month: '2026-11', uploaded: 95 }] };
  assert.deepEqual(evidenceFlow(s), [{ label: 'Jun', uploaded: 89, approved: 80 }, { label: 'Jul', uploaded: 92, approved: 84 }, { label: 'Nov', uploaded: 95, approved: null }]);
  assert.equal(approvedThisMonth(s), null, 'this month has no approved count: not 0');
  const t = approvedThisMonth({ by_month: [{ month: '2026-10', approved: 167 }, { month: '2026-11', approved: 111 }] })!;
  assert.deepEqual([t.value, t.previous, t.label, t.values], [111, 167, 'Nov', [167, 111]]);
  assert.equal(approvedThisMonth({ by_month: [] }), null);
  assert.equal(approvedThisMonth(undefined), null);
  assert.deepEqual(evidenceFlow(undefined), []);
});

test('colours: a state is a status colour, never a categorical hue; the score tile reads the grade\'s tone', () => {
  assert.equal(toneColor('success'), STATUS.good);
  assert.equal(toneColor('danger'), STATUS.bad);
  assert.equal(toneColor('neutral'), STATUS.neutral);
  assert.ok(!(SERIES as readonly string[]).includes(toneColor('warning')));
  assert.equal(scoreTone('success'), 'success');
  assert.equal(scoreTone('warning'), 'warning');
  assert.equal(scoreTone('danger'), 'danger');
  assert.equal(scoreTone(null), 'default');
});

test('a card is loading, refused, failed, empty or drawn: a failed or refused request is never "empty", and a refresh that fails keeps its answer', () => {
  const q = (over: Partial<{ isPending: boolean; isError: boolean; error: unknown; data: unknown }>) => ({ isPending: false, isError: false, error: null, data: undefined, ...over });
  const refused = { isAxiosError: true, response: { status: 403 } };
  const down = { isAxiosError: true, code: 'ERR_NETWORK' };
  assert.equal(feedState(q({ isPending: true }), false), 'loading');
  assert.equal(feedState(q({ isError: true, error: refused }), false), 'denied');
  assert.equal(feedState(q({ isError: true, error: down }), false), 'error');
  assert.equal(feedState(q({ isError: true, error: { response: { status: 500 } } }), true), 'error', 'a failure with nothing to show is an error even when the model has content');
  assert.equal(feedState(q({ data: [] }), false), 'empty');
  assert.equal(feedState(q({ data: [1] }), true), 'ready');
  assert.equal(feedState(q({ isError: true, error: down, data: [1] }), true), 'ready', 'a refresh that failed keeps the answer the person has');
  assert.equal(feedState(q({ isError: true, error: refused, data: [1] }), true), 'ready');
});
