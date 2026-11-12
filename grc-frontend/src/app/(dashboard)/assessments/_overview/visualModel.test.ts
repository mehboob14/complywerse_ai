// node --test "src/app/(dashboard)/assessments/_overview/visualModel.test.ts"
// What the graphs of the Assessments Overview draw: the server's scores in the server's grade colours and words, the weakest first, a score that is not recorded is "No data" and not a 0, the assessments by
// grade add up to the ones the board scores, the gap parts add up to the gaps (open includes overdue), a tenant with no gap has no parts, and every part opens the register on its own address.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STATUS } from '../../../../components/overview/charts/palette.ts';
import { remediationClock } from '../../../../components/assessments/workspace/clockModel.ts';
import { GRADE_WORDS, LOWEST_LIMIT, agingParts, categoryTiles, gapParts, gradeParts, gradeTone, lowestBars } from './visualModel.ts';
import type { Board } from '../_data/types.ts';

const entry = (id: number, name: string, content: number | null, sla: number | null = null, format = 'nca_dcc_tool') => ({ id, name, format, family: 'x', status: null, n_items: 10, content, sla });
const board = (over: Partial<Board> = {}): Board => ({
  as_of: '2026-11-11T00:00:00', performance: { score: 72.4, grade: 'good', assessments: 6 }, sla: { score: 64, gaps: 40, closed: 10, open: 30, overdue: 12 }, attention: { overdue_gaps: 12, open_gaps: 30, not_started: 4 },
  categories: [
    { category: 'NCA', score: 58, sla: 40, count: 1, assessments: [entry(7, 'NCA DCC', 58, 40)] },
    { category: 'Cyber Security', score: 91, sla: 80, count: 3, assessments: [entry(8, 'ASVS Payments', 91, 80, 'asvs_checklist'), entry(9, 'ASVS Core', 95), entry(10, 'ASVS Web', 88)] },
    { category: 'Audit', score: null, sla: null, count: 1, assessments: [entry(11, 'Internal audit 2026', null, null, 'ubl_audit_master_tracking')] },
    { category: 'Privacy & Data', score: 70, sla: 55, count: 1, assessments: [entry(12, 'PDPL', 70, 55, 'pdpl_assessment_toolkit')] },
  ], ...over,
});

test('categories as small multiples: the weakest first, no score last as "No data" (a ring that is not scored, not 0), the server\'s grade in the tone and the note, each opens the register on it', () => {
  const tiles = categoryTiles(board());
  assert.deepEqual(tiles.map((t) => t.key), ['NCA', 'Privacy & Data', 'Cyber Security', 'Audit']);
  assert.deepEqual(tiles.map((t) => t.value), [58, 70, 91, null]);
  assert.deepEqual(tiles.map((t) => t.tone), ['warn', 'good', 'good', 'neutral'], 'fair, good and excellent (one colour), nothing');
  assert.equal(tiles[0].note, 'Fair · 1 assessment · SLA 40');
  assert.equal(tiles[2].note, 'Excellent · 3 assessments · SLA 80');
  assert.equal(tiles[3].note, '1 assessment');
  assert.equal(tiles[0].href, '/assessments/register?category=nca');
  assert.equal(tiles[3].href, '/assessments/register?category=audit');
  assert.deepEqual(GRADE_WORDS, { good: 'Good or better', warn: 'Fair', bad: 'Poor', neutral: 'No data' });
  assert.deepEqual(categoryTiles(undefined), []);
});

test('assessments by grade: good or better (excellent and good), fair, poor, nothing answered; they add up to the assessments the board scores; each opens the register on that grade', () => {
  const parts = gradeParts(board({ categories: [
    { category: 'A', score: 60, sla: null, count: 5, assessments: [entry(1, 'a', 91), entry(2, 'b', 70), entry(3, 'c', 50), entry(4, 'd', 20), entry(5, 'e', null)] },
    { category: 'B', score: 40, sla: null, count: 1, assessments: [entry(6, 'f', 49.9)] },
  ] }));
  assert.deepEqual(parts.map((p) => [p.key, p.value]), [['good', 2], ['fair', 1], ['poor', 2], ['none', 1]]);
  assert.equal(parts.reduce((n, p) => n + p.value, 0), 6);
  assert.deepEqual(parts.map((p) => p.color), [STATUS.good, STATUS.warn, STATUS.bad, STATUS.neutral]);
  assert.deepEqual(parts.map((p) => p.href), [
    '/assessments/register?grade=excellent,good', '/assessments/register?grade=fair', '/assessments/register?grade=poor', '/assessments/register?grade=none',
  ]);
  assert.deepEqual(gradeParts(board({ categories: [] })), []);
  assert.deepEqual(gradeParts(undefined), []);
});

test('the lowest assessments as bars: the lowest content score first, no score last, at most five, each opens its workspace in the colour of its grade; the true count is said', () => {
  const { rows, of } = lowestBars(board());
  assert.equal(of, 6);
  assert.equal(LOWEST_LIMIT, 5);
  assert.deepEqual(rows.map((r) => r.label), ['NCA DCC', 'PDPL', 'ASVS Web', 'ASVS Payments', 'ASVS Core'], 'five of six: the one with no score is cut, not drawn as 0');
  assert.deepEqual(rows.map((r) => r.valueText), ['58', '70', '88', '91', '95']);
  assert.equal(rows[0].href, '/assessments/a/7');
  assert.deepEqual(rows.slice(0, 2).map((r) => r.color), [STATUS.warn, STATUS.progress], 'fair, good');
  assert.ok(rows.every((r) => r.note === undefined), 'a bar has its name and its figure, nothing under it');
  const few = lowestBars(board(), 6);
  assert.equal(few.rows[5].valueText, 'No data');
  assert.equal(few.rows[5].value, 0);
  assert.deepEqual(lowestBars(undefined), { rows: [], of: 0 });
});

test('gaps: closed, within target, overdue; they add up to the gaps because open includes overdue; no gap, no parts; each opens the register', () => {
  const parts = gapParts(board());
  assert.deepEqual(parts.map((p) => [p.key, p.value]), [['closed', 10], ['on_track', 18], ['overdue', 12]]);
  assert.equal(parts.reduce((s, p) => s + p.value, 0), 40);
  assert.equal(parts[2].href, '/assessments/register?quick=overdue');
  assert.equal(parts[2].color, STATUS.bad);
  assert.ok(parts.every((p) => p.href));
  assert.deepEqual(gapParts(board({ sla: { score: null, gaps: 0, closed: 0, open: 0, overdue: 0 } })), []);
  assert.deepEqual(gapParts(undefined), []);
});

test('the open gaps by due date are the clock\'s buckets in the colour of their tone; overdue opens the overdue list; no open gap is no parts', () => {
  const clock = remediationClock([], undefined, Date.UTC(2026, 10, 8));
  assert.deepEqual(agingParts(clock.aging), [], 'nothing open');
  const parts = agingParts([
    { key: 'overdue', label: 'Overdue', count: 3, tone: 'danger' }, { key: 'd30', label: 'Within 30 days', count: 0, tone: 'warning' }, { key: 'later', label: 'Later', count: 2, tone: 'success' },
  ]);
  assert.deepEqual(parts.map((p) => [p.key, p.value, p.color]), [['overdue', 3, STATUS.bad], ['later', 2, STATUS.good]], 'a bucket with nothing in it is not in the legend');
  assert.equal(parts[0].href, '/assessments/register?quick=overdue');
  assert.equal(parts[1].href, '/assessments/register?sort=gaps:desc');
});

test('the score tile reads the server\'s grade', () => {
  assert.deepEqual(['excellent', 'good', 'fair', 'poor', null].map((g) => gradeTone(g as never)), ['success', 'default', 'warning', 'danger', 'default']);
});

test('the graphs hold to the kit: no hex, no remapped utility, no text under 12px, no request of their own (the page asks, the graphs draw)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { findViolations } = await import('../../../../components/ui/ds/kitRules.ts');
  for (const file of ['Visuals.tsx', 'visualModel.ts', 'OverviewParts.tsx']) {
    const text = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
    assert.deepEqual(findViolations(text), [], file);
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${file}: hex lives in palette.ts`);
    assert.doesNotMatch(code, /useQuery|apiClient|axios|(?<![\w.])fetch\(/, `${file}: no request of its own`);
  }
});

test('the page is the v2 shape: no counters band, tiles and four cards, the slim work card, every card has its Open link, the what-if day and the place a person left are kept (R2, R3, R6, R7)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
  const page = read('../page.tsx');
  const visuals = read('./Visuals.tsx');
  const parts = read('./OverviewParts.tsx');
  assert.doesNotMatch(page, /CounterBand|PostureCard|DoNowCard|ClockBody|Needs attention/, 'no chip wall, no posture card twin of the tiles');
  assert.match(page, /<MyWorkCard\b/);
  assert.match(page, /useReturnToPlace\(!count\.isPending && !board\.isPending && !work\.isPending && !points\.isPending\)/);
  assert.match(page, /const SCHEMA = \{ asof: text\(\) \};/, 'the "what if" day lives in the address');
  assert.equal((visuals.match(/<ChartCard\b/g) ?? []).length, 4, 'four cards');
  assert.equal((visuals.match(/<KpiTile\b/g) ?? []).length, 4, 'four tiles');
  for (const id of ['by-category', 'by-grade', 'lowest', 'gaps']) assert.match(visuals, new RegExp(String.raw`id="${id}"[\s\S]{0,400}?\shref=`), `the "${id}" card has its Open link`);
  assert.match(visuals, /categoryTiles\(board\)/);
  assert.match(visuals, /<AreaTiles\b/);
  assert.match(visuals, /<DonutChart\b/);
  assert.match(parts, /MY_WORK_ROWS/, 'three rows, the kit\'s number');
  assert.match(parts, /All caught up/);
  assert.match(parts, /canTune && <Button/, 'Tune SLA is for the people the page gives it to');
});
