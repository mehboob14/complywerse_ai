// node --test "src/components/compliance/overview/overviewModel.test.ts"
// The Compliance Overview's rules: the four buckets the server adds up as "needs attention" keep their definitions (the Performance Overview reads them; this page draws them on the area tiles, not as a
// band), lapsed evidence comes from the evidence summary and not from the flag nobody sets, the module score keeps the server's grade, and every Ready / Implemented figure of a journey row is the
// journey model's (the same number the journey page and the Frameworks hub show).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { journeyNumbers } from '../../../lib/journeyModel.ts';
import {
  ATTENTION, COMPLIANCE_SOURCES, SECTION_HREF, SECTION_ORDER, STRIP, areaWord, journeyRows, portfolioLine, postureOf, sectionRows, targetOf,
} from './overviewModel.ts';

test('the four buckets the server adds up keep their keys, their pages and their source (lapsed evidence is the evidence summary\'s, not the stored stale flag nobody sets)', () => {
  assert.deepEqual(ATTENTION.map((d) => d.key), ['controls_without_evidence', 'evidence_lapsed', 'overdue_control_tests', 'regulatory_overdue_tasks']);
  assert.deepEqual(ATTENTION.map((d) => d.from), ['scorecard', 'evidence', 'scorecard', 'scorecard']);
  assert.equal(ATTENTION[1].href, '/evidence?fresh=lapsed', 'the Evidence library reads fresh=lapsed');
});

test('the worklist is evidence to approve: the one inbox source Compliance owns', () => {
  assert.deepEqual([...COMPLIANCE_SOURCES], ['assessment.evidence']);
});

test('the score keeps the server\'s grade and rounding; the target is the one it scored against; an unscored area is "no data", not weak', () => {
  assert.deepEqual(postureOf({ score: 73.6, grade: 'GOOD' }), { score: 74, grade: 'good' });
  assert.deepEqual(postureOf({ score: null, grade: null }), { score: null, grade: null });
  assert.deepEqual(postureOf(undefined), { score: null, grade: null });
  assert.equal(postureOf({ score: 40, grade: 'something new' }).grade, null, 'a grade nobody registered is not guessed');
  assert.equal(targetOf({ components: [{ target: null }, { target: 85 }] }), 85);
  assert.equal(targetOf({ components: [] }), null);
  assert.deepEqual([90, 80, 79.9, 60, 59, null].map((s) => areaWord(s)), ['strong', 'strong', 'fair', 'fair', 'weak', 'no_data']);
});

test('the areas come in the order of the score, and every one has a page of its own', () => {
  const rows = sectionRows({
    regulatory: { label: 'Regulatory', weight: 0.12, score: 40 },
    frameworks: { label: 'Frameworks', weight: 0.2, score: 71 },
    evidence: { label: 'Evidence', weight: 0.18, score: 52 },
    controls: { label: 'Controls', weight: 0.18, score: 40 },
    effectiveness: { label: 'Control Effectiveness', weight: 0.18, score: null },
  });
  assert.deepEqual(rows.map((r) => r.key), ['frameworks', 'controls', 'effectiveness', 'evidence', 'regulatory']);
  assert.ok(SECTION_ORDER.every((k) => SECTION_HREF[k]), 'every area has a page');
  assert.notEqual(SECTION_HREF.effectiveness, SECTION_HREF.control_library, 'Effectiveness and Library used to open the same page');
  assert.deepEqual(sectionRows(undefined), []);
});

const journey = (id: number, name: string, status: string, target: string | null, p?: { total: number; impl: number; approved: number; na?: number }) => ({
  id, name, status, target_date: target,
  progress: p ? { total_controls: p.total, implemented_count: p.impl, verified_count: 0, in_progress_count: 0, not_applicable_count: p.na ?? 0, approved_evidence_controls: p.approved } : undefined,
});
const TODAY = new Date(2026, 10, 8);       // 8 Nov 2026 (local)
const LIST = [
  journey(1, 'ISO 27001', 'in_progress', '2027-03-01T00:00:00', { total: 100, impl: 52, approved: 41 }),
  journey(2, 'PCI DSS', 'in_progress', '2026-11-01T00:00:00', { total: 200, impl: 20, approved: 10 }),
  journey(3, 'SOC 2', 'in_progress', '2026-12-01T00:00:00', { total: 80, impl: 60, approved: 60 }),
  journey(4, 'NDMO', 'in_progress', null),
  journey(5, 'Old audit', 'completed', '2026-01-01T00:00:00', { total: 50, impl: 50, approved: 50 }),
];

test('a journey row is the journey model\'s: Ready and Implemented are the numbers the journey page shows, out-of-scope requirements left out', () => {
  const rows = journeyRows([journey(1, 'ISO 27001', 'in_progress', null, { total: 100, impl: 40, approved: 30, na: 20 })], TODAY);
  const n = journeyNumbers(LIST[0].progress)!;
  assert.equal(rows[0].applicable, 80, '100 less 20 out of scope');
  assert.equal(rows[0].ready, 37.5, '30 of the 80 in scope');
  assert.equal(rows[0].implemented, 50, '40 of 80');
  assert.equal(journeyRows([LIST[0]], TODAY)[0].ready, n.readyPct);
  assert.equal(rows[0].href, '/frameworks/1');
});

test('journeys are listed active first, the most urgent on top, a journey with no progress after the others, finished ones last', () => {
  const rows = journeyRows(LIST, TODAY);
  assert.deepEqual(rows.map((r) => r.name), ['PCI DSS', 'SOC 2', 'ISO 27001', 'NDMO', 'Old audit']);
  assert.deepEqual(rows.map((r) => r.target.state), ['overdue', 'soon', 'later', 'none', 'done']);
  const ndmo = rows.find((r) => r.name === 'NDMO')!;
  assert.deepEqual([ndmo.ready, ndmo.implemented, ndmo.band], [null, null, null], 'no progress is not 0%');
  assert.deepEqual(journeyRows(undefined, TODAY), []);
  assert.equal(journeyRows([{ id: 9, name: '  ', status: 'in_progress' }], TODAY)[0].name, 'Untitled journey');
});

test('the portfolio line counts the journeys that still have work in them, weighted by requirements, and says how many are finished', () => {
  const p = portfolioLine(LIST);
  assert.equal(p.journeys, 3, 'the finished one and the one with no progress are not in the figures');
  assert.equal(p.completed, 1);
  assert.equal(p.missing, 1);
  assert.equal(p.ready, 29.2, '(41 + 10 + 60) of (100 + 200 + 80) applicable');
  assert.equal(p.implemented, 34.7, '(52 + 20 + 60) of 380');
});

test('the strip names the Overview and the four pages that had no door of their own', () => {
  assert.deepEqual(STRIP.map((s) => s.href), ['/compliance', '/controls', '/control-library', '/compliance/statements', '/control-library/assurance']);
  assert.equal(new Set(STRIP.map((s) => s.key)).size, STRIP.length);
});
