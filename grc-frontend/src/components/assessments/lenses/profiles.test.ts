// node --test "src/components/assessments/lenses/profiles.test.ts"
// What each type's lens counts and says: the figures of the older tabs, per profile, on small data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASVS, DCC, MASVS, MATURITY, OWASP, PDPL, profileFor, type Ctx } from './profiles.ts';
import { toLensItem, type LensItem, type LensRaw } from './lensData.ts';

const it = (id: number, status: string, over: Partial<LensRaw> = {}): LensItem => toLensItem({ id, item_number: `R${id}`, area_domain: 'Dom', control_description: `text ${id}`, compliance_status: status, ...over });
const ctx: Ctx = { assetId: null, targetLevel: null, partition: '' };
const tile = (tiles: ReturnType<typeof ASVS.tiles>, label: string) => tiles.find((t) => t.label === label)!;

test('every format that has a requirements lens has one profile, and the others have none', () => {
  assert.equal(profileFor('asvs_checklist'), ASVS);
  assert.equal(profileFor('owasp_v4_testing_checklist'), OWASP);
  assert.equal(profileFor('mobile_app_security'), MASVS);
  for (const f of ['csir_maturity', 'cti_maturity', 'incident_maturity', 'itsecops_maturity', 'digital_ops_maturity']) assert.equal(profileFor(f), MATURITY);
  assert.equal(profileFor('nca_dcc_tool'), DCC);
  assert.equal(profileFor('pdpl_assessment_toolkit'), PDPL);
  for (const f of ['dpia_pia', 'kpi_report', 'nca_vuln_register', 'xlsx_maturity', 'standard', '', null, undefined]) assert.equal(profileFor(f as string), null);
});

test('ASVS: met share, level reached, and the requirements above the application\'s target do not count', () => {
  const rows = [it(1, 'complied', { remarks: 'ASVS Level: 1' }), it(2, 'complied', { remarks: 'ASVS Level: 1' }), it(3, 'not_complied', { remarks: 'ASVS Level: 2' }), it(4, 'na', { remarks: 'ASVS Level: 2' })];
  const t = ASVS.tiles(rows, ctx);
  assert.equal(tile(t, 'Requirements met').value, '2');
  assert.equal(tile(t, 'Requirements met').unit, 'of 3');
  assert.equal(tile(t, 'Requirements met').progress, 67);
  assert.equal(tile(t, 'Level reached').value, 'Level 1');
  assert.equal(tile(t, 'Not complied').value, '1');
  assert.equal(ASVS.inScope!(rows[2], { ...ctx, targetLevel: 1 }), false);
  assert.equal(ASVS.inScope!(rows[0], { ...ctx, targetLevel: 1 }), true);
  assert.equal(ASVS.meter(rows, ctx).text, '2 of 3 met');
  assert.equal(ASVS.facet!.match(rows[2], ['2']), true);
  assert.equal(ASVS.facet!.match(rows[0], ['2', '3']), false);
  assert.equal(ASVS.passOnEvidence, true);
});

test('ASVS answers are the application\'s own when one is chosen', () => {
  const one = toLensItem({ id: 1, compliance_status: 'not_complied', remarks: 'ASVS Level: 1', asset_status: { '9': 'complied' } });
  assert.equal(tile(ASVS.tiles([one], { ...ctx, assetId: 9 }), 'Requirements met').value, '1');
  assert.equal(tile(ASVS.tiles([one], ctx), 'Requirements met').value, '0');
});

test('OWASP: coverage is the tested share, issues are the not complied', () => {
  const rows = [it(1, 'complied'), it(2, 'not_complied'), it(3, 'in_progress'), it(4, 'na')];
  const t = OWASP.tiles(rows, ctx);
  assert.equal(tile(t, 'Tested').value, '3');
  assert.equal(tile(t, 'Tested').progress, 75);
  assert.equal(tile(t, 'Issues found').value, '1');
  assert.equal(OWASP.meter(rows, ctx).text, '3 of 4 tested');
  assert.deepEqual(OWASP.chips(it(1, 'complied', { remarks: 'Tools: Burp | Desc: x' })), ['Burp']);
});

test('MASVS: the platform splits the workbook, the level reached is L1 then L2', () => {
  const rows = [it(1, 'complied', { remarks: 'Platform: iOS | MASVS: L1' }), it(2, 'complied', { remarks: 'Platform: Android | MASVS: L1' })];
  assert.deepEqual(MASVS.partition!.values(rows), ['Android', 'iOS']);
  assert.equal(MASVS.partition!.of(rows[0]), 'iOS');
  assert.equal(tile(MASVS.tiles(rows, ctx), 'Level reached').value, 'L1');
  assert.deepEqual(MASVS.chips(it(1, 'complied', { remarks: 'MASVS: L1,L2' })), ['L1', 'L2']);
});

test('maturity: the scale is 1 to 5, the select makes the answer, the target gap reads against the average', () => {
  assert.deepEqual(MATURITY.scale, { from: 1, to: 5 });
  const rows = [it(1, 'complied', { maturity_score: 4, remarks: 'Target: 5' }), it(2, 'partially_complied', { maturity_score: 2, remarks: 'Target: 3' })];
  const t = MATURITY.tiles(rows, ctx);
  assert.equal(tile(t, 'Average maturity').value, '3.0');
  assert.equal(tile(t, 'Target').value, '4.0');
  assert.equal(tile(t, 'Target').note, 'Gap 1.0');
  assert.equal(tile(t, 'Maturity band').value, 'L3');
  assert.equal(tile(MATURITY.tiles([it(1, 'in_progress')], ctx), 'Answered').value, '0', 'no target: the answered count takes its place');
  assert.equal(MATURITY.passOnEvidence, false);
});

test('DCC: a partial counts half, Essential and sub-controls are told apart', () => {
  const rows = [it(1, 'complied', { priority: 'high' }), it(2, 'partially_complied'), it(3, 'not_complied'), it(4, 'na')];
  const t = DCC.tiles(rows, ctx);
  assert.equal(tile(t, 'Compliance').value, '50%');
  assert.equal(tile(t, 'Essential and sub-controls').value, '1 / 3');
  assert.deepEqual(DCC.chips(rows[0]), ['Essential']);
  assert.deepEqual(DCC.chips(rows[1]), ['Sub-control']);
  assert.equal(DCC.groupName!(it(1, 'complied', { area_domain: '1- الحوكمة (Governance)' })), '1 · Governance');
});

test('PDPL: the scale is 0 to 5, compliance counts a partial half among the assessed, gaps are below 3', () => {
  assert.deepEqual(PDPL.scale, { from: 0, to: 5 });
  const rows = [it(1, 'complied', { maturity_score: 4 }), it(2, 'partially_complied', { maturity_score: 2 }), it(3, 'not_complied', { maturity_score: 0 }), it(4, 'in_progress')];
  const t = PDPL.tiles(rows, ctx);
  assert.equal(tile(t, 'Compliance').value, '50%');
  assert.equal(tile(t, 'Gaps').value, '2');
  assert.equal(tile(t, 'Average maturity').value, '2.0');
  assert.equal(tile(t, 'Not assessed').value, '1');
  assert.equal(tile(PDPL.tiles([it(1, 'in_progress')], ctx), 'Compliance').value, '—', 'nothing assessed: no percent is made up');
});
