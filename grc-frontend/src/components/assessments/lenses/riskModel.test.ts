// node --test "src/components/assessments/lenses/riskModel.test.ts"
// The DPIA scale and screening, the heat grid and the NCA registers, as the older tabs counted them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerOfScreening, bandOfScore, entriesOf, fieldOf, heatGrid, namedBand, parseRow, pick, REGISTERS, registerKindOf, registerKpis, riskKpis, screeningVerdict, sectionOf, toNum, toRisk, withField,
} from './riskModel.ts';
import { toLensItem, type LensRaw } from './lensData.ts';

const item = (id: number, remarks: string, over: Partial<LensRaw> = {}) => toLensItem({ id, item_number: `R${id}`, area_domain: 'Security', control_description: `text ${id}`, compliance_status: 'in_progress', remarks, ...over });

test('the DPIA bands are 15, 10, 5 (not the risk register scale of 20, 12, 6)', () => {
  assert.equal(bandOfScore(25), 'critical');
  assert.equal(bandOfScore(15), 'critical');
  assert.equal(bandOfScore(14), 'high');
  assert.equal(bandOfScore(10), 'high');
  assert.equal(bandOfScore(9), 'medium');
  assert.equal(bandOfScore(5), 'medium');
  assert.equal(bandOfScore(4), 'low');
  assert.equal(bandOfScore(1), 'low');
  assert.equal(bandOfScore(0), 'none');
});

test('the heat grid has likelihood 5 on top, impact 1 to 5 across, and a risk in its own cell', () => {
  const g = heatGrid([{ l: 5, i: 1, id: 'a' }, { l: 5, i: 1, id: 'b' }, { l: 1, i: 5, id: 'c' }, { l: 9, i: 9, id: 'off the grid' }]);
  assert.equal(g.length, 5);
  assert.equal(g[0][0].l, 5);
  assert.equal(g[0][0].i, 1);
  assert.deepEqual(g[0][0].ids, ['a', 'b']);
  assert.equal(g[0][0].band, 'medium', '5 x 1 = 5');
  assert.deepEqual(g[4][4].ids, ['c']);
  assert.equal(g.flat().reduce((n, c) => n + c.ids.length, 0), 3);
  assert.equal(g[0][4].band, 'critical');
});

test('remarks fields are read and replaced without touching the others', () => {
  const r = 'Section: screening | Answer: Yes | Guidance: be sure';
  assert.equal(sectionOf(r), 'screening');
  assert.equal(fieldOf(r, 'Answer'), 'Yes');
  assert.equal(fieldOf(r, 'Missing'), '');
  const next = withField(r, 'Answer', 'No');
  assert.equal(fieldOf(next, 'Answer'), 'No');
  assert.equal(fieldOf(next, 'Guidance'), 'be sure');
  assert.equal(fieldOf(withField(null, 'Answer', 'Yes'), 'Answer'), 'Yes');
  assert.equal(sectionOf(withField(null, 'Answer', 'Yes')), 'screening');
  assert.equal(fieldOf(withField('Section: screening', 'Answer', 'Yes'), 'Answer'), 'Yes', 'a missing field is appended');
});

test('screening: one Yes means a full DPIA, and unanswered rows are counted apart', () => {
  const rows = [item(1, 'Section: screening | Answer: Yes'), item(2, 'Section: screening | Answer: No'), item(3, 'Section: screening'), item(4, 'Section: risk | L: 1')];
  assert.deepEqual(screeningVerdict(rows), { yes: 1, answered: 2, total: 3, required: true });
  assert.deepEqual(screeningVerdict([item(1, 'Section: screening | Answer: No')]), { yes: 0, answered: 1, total: 1, required: false });
  assert.equal(answerOfScreening(rows[0]), 'yes');
  assert.equal(answerOfScreening(rows[2]), '');
});

test('a risk reads its likelihood, impact and residual; the score is the stored one or likelihood x impact', () => {
  const r = toRisk(item(1, 'Section: risk | L: 4 | I: 3 | Inherent: 12 | ResL: 2 | ResI: 2 | Owner: Dana | Target: Q3'));
  assert.equal(r.score, 12);
  assert.equal(r.resScore, 4, 'no stored residual: 2 x 2');
  assert.equal(r.owner, 'Dana');
  assert.equal(toRisk(item(2, 'Section: risk | L: 5 | I: 5')).score, 25);
  const k = riskKpis([r, toRisk(item(2, 'Section: risk | L: 5 | I: 5')), toRisk(item(3, 'Section: risk | L: 1 | I: 2'))]);
  assert.equal(k.total, 3);
  assert.equal(k.critical, 1);
  assert.equal(k.high, 1);
  assert.equal(Math.round(k.avgInherent * 10) / 10, 13);
  assert.deepEqual(riskKpis([]), { total: 0, critical: 0, high: 0, avgInherent: 0, avgResidual: 0 });
});

test('an NCA register row is the JSON the parser stored; a column is found by the words in its header', () => {
  const row = parseRow('{"Risk Level":"High","Risk Likelihood":"4","CVE Number":"CVE-1"}');
  assert.equal(pick(row, ['risk level']), 'High');
  assert.equal(pick(row, ['cve', 'number']), 'CVE-1');
  assert.equal(pick(row, ['nothing']), '');
  assert.deepEqual(parseRow('not json'), {});
  assert.deepEqual(parseRow('[1,2]'), {});
  assert.equal(toNum('L4 (likely)'), 4);
  assert.equal(toNum(''), 0);
  assert.equal(namedBand('Very Low'), 'Very Low');
  assert.equal(namedBand('HIGH risk'), 'High');
  assert.equal(namedBand(''), '');
  assert.equal(registerKindOf('nca_risk_register'), 'risk');
  assert.equal(registerKindOf('asvs_checklist'), null);
});

test('register figures: open and resolved by answer, critical or high by rating, the heat points need both numbers', () => {
  const vuln = REGISTERS.vuln;
  const rows = [
    item(1, JSON.stringify({ 'Risk Level': 'Critical', 'Risk Likelihood': '5', 'Risk Severity': '4' }), { compliance_status: 'in_progress' }),
    item(2, JSON.stringify({ 'Risk Level': 'Low', 'Risk Likelihood': '1', 'Risk Severity': '1' }), { compliance_status: 'complied' }),
    item(3, JSON.stringify({ 'Risk Level': 'Medium' }), { compliance_status: 'in_progress' }),
  ];
  const k = registerKpis(entriesOf(rows, vuln), vuln);
  assert.equal(k.total, 3);
  assert.equal(k.open, 2);
  assert.equal(k.resolved, 1);
  assert.equal(k.critHigh, 1);
  assert.deepEqual(k.distribution, { Critical: 1, Low: 1, Medium: 1 });
  assert.equal(k.inherent.length, 2);
  assert.deepEqual(k.residual, []);
  const risk = REGISTERS.risk;
  const rk = registerKpis(entriesOf([item(1, JSON.stringify({ 'Inherent Rating': 'High', 'Inherent Likelihood': '3', 'Inherent Magnitude': '3', 'Resid Rating': 'Low', 'Resid Likelihood': '1', 'Resid Magnitude': '2' }))], risk), risk);
  assert.deepEqual(rk.residual, [{ l: 1, i: 2, id: 'R1' }]);
});
