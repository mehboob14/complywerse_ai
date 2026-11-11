// node --test "src/app/(dashboard)/assessments/_overview/visualModel.test.ts"
// What the graphs of the Assessments Overview draw: the server's scores in the server's grade colours and words, the weakest first, a score that is not recorded is "No data" and not a 0, the gap
// parts add up to the gaps (open includes overdue), and a tenant with no gap has no parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STATUS } from '../../../../components/overview/charts/palette.ts';
import { ASSESSMENT_LIMIT, assessmentBars, categoryBars, gapParts, gradeTone } from './visualModel.ts';
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

test('categories as bars: the weakest first, no score last as "No data" (a bar of nothing, not 0), the server\'s grade in words and colour, each opens the register on it', () => {
  const bars = categoryBars(board());
  assert.deepEqual(bars.map((b) => b.key), ['NCA', 'Privacy & Data', 'Cyber Security', 'Audit']);
  assert.deepEqual(bars.map((b) => b.valueText), ['58', '70', '91', 'No data']);
  assert.equal(bars[0].note, 'Fair · 1 assessment · SLA 40');
  assert.equal(bars[2].note, 'Excellent · 3 assessments · SLA 80');
  assert.equal(bars[3].note, 'No score yet · 1 assessment');
  assert.equal(bars[3].value, 0);
  assert.equal(bars[0].color, STATUS.warn, 'fair');
  assert.equal(bars[2].color, STATUS.good, 'excellent');
  assert.equal(bars[1].color, STATUS.progress, 'good');
  assert.equal(bars[0].href, '/assessments/register?category=nca');
  assert.deepEqual(categoryBars(undefined), []);
});

test('assessments as bars: every assessment the board scores, the lowest first, the kind in the note, each opens its workspace; capped and the rest said', () => {
  const { rows, of } = assessmentBars(board());
  assert.equal(of, 6);
  assert.deepEqual(rows.map((r) => r.label), ['NCA DCC', 'PDPL', 'ASVS Web', 'ASVS Payments', 'ASVS Core', 'Internal audit 2026']);
  assert.equal(rows[0].note, 'Fair · NCA DCC assessment · SLA 40');
  assert.equal(rows[1].note, 'Good · Saudi PDPL · SLA 55');
  assert.equal(rows[5].valueText, 'No data');
  assert.equal(rows[5].note, 'Nothing answered yet · Internal audit');
  assert.equal(rows[0].href, '/assessments/a/7');
  const many = board({ categories: [{ category: 'Other', score: 60, sla: null, count: 14, assessments: Array.from({ length: 14 }, (_, i) => entry(100 + i, `A${i}`, 40 + i)) }] });
  const capped = assessmentBars(many);
  assert.equal(capped.rows.length, ASSESSMENT_LIMIT);
  assert.equal(capped.of, 14);
  assert.deepEqual(assessmentBars(undefined), { rows: [], of: 0 });
});

test('gaps: closed, open and within target, overdue; they add up to the gaps because open includes overdue; no gap, no parts', () => {
  const parts = gapParts(board());
  assert.deepEqual(parts.map((p) => [p.key, p.value]), [['closed', 10], ['on_track', 18], ['overdue', 12]]);
  assert.equal(parts.reduce((s, p) => s + p.value, 0), 40);
  assert.equal(parts[2].href, '/assessments/register?quick=overdue');
  assert.equal(parts[2].color, STATUS.bad);
  assert.deepEqual(gapParts(board({ sla: { score: null, gaps: 0, closed: 0, open: 0, overdue: 0 } })), []);
  assert.deepEqual(gapParts(undefined), []);
});

test('the score tile reads the server\'s grade', () => {
  assert.deepEqual(['excellent', 'good', 'fair', 'poor', null].map((g) => gradeTone(g as never)), ['success', 'default', 'warning', 'danger', 'default']);
});

test('the graphs hold to the kit: no hex, no remapped utility, no text under 12px, no request of their own (the page asks, the graphs draw)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { findViolations } = await import('../../../../components/ui/ds/kitRules.ts');
  for (const file of ['Visuals.tsx', 'visualModel.ts']) {
    const text = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
    assert.deepEqual(findViolations(text), [], file);
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${file}: hex lives in palette.ts`);
    assert.doesNotMatch(code, /useQuery|apiClient|axios|(?<![\w.])fetch\(/, `${file}: no request of its own`);
  }
});
