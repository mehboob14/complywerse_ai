// node --test "src/components/compliance/overview/graphModel.test.ts"
// What the graphs of the Compliance Overview draw: every Ready / Implemented figure is the journey model's (no percentage of its own), an area with no score is "No data" and not a bar of 0,
// a status mix is counts with out-of-scope requirements left out, the history is "no trend" under two days, evidence figures a missing key is left out and never 0, and the stacked bars
// of the journeys agree with the table's order (the most urgent first).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { journeyNumbers } from '../../../lib/journeyModel.ts';
import { SERIES, STATUS } from '../../overview/charts/palette.ts';
import {
  DOMAIN_LIMIT, LEFT_OUT, feedState, STACK_LIMIT, approvedThisMonth, areaBars, daysOf, domainBars, dueCounts, dueParts, evidenceFlow, evidenceParts, figuresOf, freshnessBars, measureGroups, monthLabel,
  openWork, readyBars, requirementStack, scoreTone, sparkOf, stageParts, toneColor, trendRows,
} from './graphModel.ts';
import { journeyRows, sectionRows, type JourneyListItem } from './overviewModel.ts';

const TODAY = new Date(2026, 10, 11);

// a journey's `progress` as the journey function sends it (calculate_progress_summary): implemented includes verified; applicable = total - not applicable
const progress = (total: number, impl: number, inProg: number, toStart: number, na: number, approved: number, by_domain?: Array<Record<string, unknown>>) => ({
  total_controls: total, implemented_count: impl, verified_count: Math.floor(impl / 3), in_progress_count: inProg, not_started_count: toStart, not_applicable_count: na,
  approved_evidence_controls: approved, by_domain,
});
const J: JourneyListItem[] = [
  { id: 1, name: 'ISO 27001', status: 'in_progress', target_date: '2026-11-20T00:00:00', progress: progress(100, 50, 20, 25, 5, 40, [{ domain_name: 'Access control', total: 30, completed: 10, in_progress: 8, not_started: 12 }, { domain_name: 'Assets', total: 10, completed: 10, in_progress: 0, not_started: 0 }]) },
  { id: 2, name: 'PCI DSS', status: 'in_progress', target_date: '2026-11-01T00:00:00', progress: progress(200, 40, 60, 90, 10, 20, [{ domain_name: 'Network', total: 80, completed: 5, in_progress: 40, not_started: 35 }]) },
  { id: 3, name: 'GDPR', status: 'in_progress', target_date: null, progress: progress(40, 30, 5, 5, 0, 30) },
  { id: 4, name: 'NIST CSF', status: 'completed', target_date: '2026-09-01T00:00:00', progress: progress(100, 95, 0, 0, 5, 95) },
  { id: 5, name: 'No figures yet', status: 'in_progress', target_date: '2027-06-01T00:00:00', progress: null },
  { id: 6, name: 'On hold one', status: 'on_hold', target_date: '2027-06-01T00:00:00', progress: progress(10, 1, 1, 8, 0, 0) },
];

test('the figures are the active journeys that have progress, in the order of the table (late first, then the lowest Ready), and only the journey model\'s numbers', () => {
  const figs = figuresOf(J, TODAY);
  assert.deepEqual(figs.map((f) => f.row.name), ['PCI DSS', 'ISO 27001', 'On hold one', 'GDPR'].slice(0, 2).concat(figs.slice(2).map((f) => f.row.name)));
  assert.equal(figs[0].row.name, 'PCI DSS', 'overdue first');
  assert.ok(!figs.some((f) => f.row.name === 'NIST CSF'), 'a finished journey is not drawn');
  assert.ok(!figs.some((f) => f.row.name === 'No figures yet'), 'a journey with no progress is not drawn as zeros');
  const iso = figs.find((f) => f.row.name === 'ISO 27001')!;
  assert.deepEqual(iso.n, journeyNumbers(J[0].progress)!);
  assert.equal(iso.n.applicable, 95, '100 requirements, 5 out of scope');
  assert.deepEqual(figs.map((f) => f.row.id), journeyRows(J, TODAY).filter((r) => r.active && r.ready !== null).map((r) => r.id));
});

test('requirements by status per journey: implemented (verified counted once), in progress, not started, out-of-scope left out; capped at eight, the rest said', () => {
  const figs = figuresOf(J, TODAY);
  const s = requirementStack(figs);
  const iso = s.categories.find((c) => c.label === 'ISO 27001')!;
  assert.deepEqual(iso.cells, { implemented: 50, inProgress: 20, toStart: 25 });
  assert.equal(iso.cells.implemented + iso.cells.inProgress + iso.cells.toStart, 95, 'adds up to the requirements in scope');
  assert.equal(iso.href, '/frameworks/1');
  assert.equal(s.of, figs.length);
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, name: `F${i}`, status: 'in_progress', progress: progress(10, 1, 1, 8, 0, 0) }));
  const big = requirementStack(figuresOf(many, TODAY));
  assert.equal(big.shown, STACK_LIMIT);
  assert.equal(big.of, 12);
});

test('open work: the requirements still to do over the journeys that are drawn', () => {
  const w = openWork(figuresOf(J, TODAY));
  assert.deepEqual(w, { open: (20 + 25) + (60 + 90) + (5 + 5) + (1 + 8), toStart: 25 + 90 + 5 + 8, inProgress: 20 + 60 + 5 + 1 });
  assert.deepEqual(openWork([]), { open: 0, toStart: 0, inProgress: 0 });
});

test('Ready by journey: the lowest first, the journey model\'s percentage with the word of its band (75 / 50 / 25), Implemented in the note', () => {
  const bars = readyBars(figuresOf(J, TODAY));
  const values = bars.map((b) => b.value);
  assert.deepEqual(values, values.slice().sort((a, b) => a - b));
  const pci = bars.find((b) => b.label === 'PCI DSS')!;
  assert.equal(pci.valueText, '11%', '20 of 190 requirements in scope = 10.5, said the way the hub says it (one decimal only below 10)');
  assert.equal(pci.value, 10.5);
  assert.match(pci.note ?? '', /^Just starting · Implemented 21%$/);
  assert.equal(pci.color, STATUS.neutral);
  const gdpr = bars.find((b) => b.label === 'GDPR')!;
  assert.equal(gdpr.valueText, '75%');
  assert.match(gdpr.note ?? '', /^Strong/);
  assert.equal(gdpr.color, STATUS.good);
});

test('where the open work is: domains with the most requirements still to do, the journey named when there are several, capped, zero-open domains left out', () => {
  const d = domainBars(figuresOf(J, TODAY));
  assert.deepEqual(d.rows.map((r) => r.label), ['Network', 'Access control']);
  assert.equal(d.rows[0].valueText, '75 open');
  assert.equal(d.rows[0].note, 'PCI DSS · 40 in progress · 35 not started');
  assert.equal(d.of, 2, 'Assets has nothing left: it is not a row');
  const one = domainBars(figuresOf([J[0]], TODAY));
  assert.equal(one.rows[0].note, '8 in progress · 12 not started', 'one journey: its name is not repeated');
  const lots = domainBars([{ ...figuresOf(J, TODAY)[0], domains: Array.from({ length: 20 }, (_, i) => ({ name: `D${i}`, total: 5, inProgress: 1, notStarted: i + 1 })) }]);
  assert.equal(lots.rows.length, DOMAIN_LIMIT);
  assert.equal(lots.of, 20);
  assert.deepEqual(domainBars([]), { rows: [], of: 0 });
});

test('journeys by stage in the order they go through, a stage nobody is in left out; by target date over the journeys with work in them', () => {
  const stages = stageParts(J);
  assert.deepEqual(stages.map((s) => `${s.key}:${s.value}`), ['in_progress:4', 'on_hold:1', 'completed:1']);
  assert.equal(stages[0].color, STATUS.progress);
  assert.equal(stages[1].color, STATUS.warn);
  assert.equal(stages[2].color, STATUS.good);
  assert.deepEqual(stageParts([]), []);
  assert.deepEqual(stageParts([{ id: 1, status: 'cancelled' }, { id: 2, status: 'Not_Started' }]).map((s) => s.key), ['not_started', 'cancelled']);

  const rows = journeyRows(J, TODAY);
  const due = dueParts(rows);
  assert.deepEqual(due.map((p) => `${p.key}:${p.value}`), ['overdue:1', 'soon:1', 'later:2', 'none:1'], 'PCI is late, ISO within 30 days, two later, GDPR has no date; NIST is finished and not counted');
  assert.deepEqual(dueCounts(rows), { due: 2, overdue: 1 });
  assert.equal(due[0].href, '/frameworks?quick=attention');
  assert.deepEqual(dueCounts([]), { due: 0, overdue: 0 });
});

test('the areas as bars: weakest first, an area with no score last as "No data" (not a 0), the band in words and the weight in the note', () => {
  const rows = sectionRows({
    frameworks: { label: 'Frameworks', weight: 0.2, score: 39.1 }, controls: { label: 'Controls', weight: 0.18, score: null }, effectiveness: { label: 'Control Effectiveness', weight: 0.18, score: 82 },
    evidence: { label: 'Evidence', weight: 0.18, score: 64.4 },
  });
  const bars = areaBars(rows);
  assert.deepEqual(bars.map((b) => b.key), ['frameworks', 'evidence', 'effectiveness', 'controls']);
  assert.deepEqual(bars.map((b) => b.valueText), ['39', '64', '82', 'No data']);
  assert.equal(bars[0].note, 'Weak · 20% of the score');
  assert.equal(bars[1].note, 'Fair · 18% of the score');
  assert.equal(bars[2].note, 'Strong · 18% of the score');
  assert.equal(bars[3].value, 0);
  assert.equal(bars[3].note, 'No data · 18% of the score');
  assert.deepEqual(bars.map((b) => b.color), [STATUS.bad, STATUS.warn, STATUS.good, STATUS.neutral]);
  assert.equal(bars[0].href, '/frameworks');
});

test('the measures behind the score: the server\'s own scores and counts; no score is "No data"; an opposite measure has no "x of y"; the stale-flag measure is not drawn', () => {
  const groups = measureGroups({
    evidence: { key: 'evidence', label: 'Evidence', score: 72, metrics: [
      { key: 'approval_rate', label: 'Approved', score: 90.1, numerator: 630, denominator: 699 },
      { key: 'freshness', label: 'Fresh (not stale)', score: 100, numerator: 0, denominator: 699, inverse: true },
      { key: 'linked', label: 'Linked to controls', score: 0, numerator: 0, denominator: 699 },
    ] },
    frameworks: { key: 'frameworks', label: 'Frameworks', score: 39, metrics: [
      { key: 'implementation', label: 'Controls implemented', score: 50.8, numerator: 272, denominator: 535 },
      { key: 'criteria_completion', label: 'Criteria met', score: null, numerator: 0, denominator: 0 },
    ] },
    regulatory: { key: 'regulatory', label: 'Regulatory', score: 38, metrics: [{ key: 'task_health', label: 'Task health', score: 80, numerator: 3, denominator: 15, inverse: true }] },
  });
  assert.deepEqual(groups.map((g) => g.key), ['frameworks', 'evidence', 'regulatory'], 'the order the score lists the areas');
  const fw = groups[0];
  assert.deepEqual(fw.rows.map((r) => [r.valueText, r.note, r.value]), [['51%', '272 of 535', 50.8], ['No data', undefined, 0]]);
  const ev = groups[1];
  assert.deepEqual(ev.rows.map((r) => r.label), ['Approved', 'Linked to controls'], 'Fresh (not stale) is left out');
  assert.ok(LEFT_OUT.has('evidence:freshness'));
  assert.equal(ev.rows[1].valueText, '0%', 'a measure that scored 0 is a 0');
  assert.equal(groups[2].rows[0].note, undefined);
  assert.equal(groups[2].rows[0].valueText, '80%');
  assert.equal(groups[0].href, '/frameworks');
  assert.deepEqual(measureGroups(undefined), []);
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
  assert.deepEqual(f.rows.map((r) => `${r.key}:${r.value}`), ['in_force:604', 'expiring:40', 'lapsed:35', 'waiting:36']);
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
