// node --test "src/components/assessments/lenses/lensData.test.ts"
// The numbers the older tabs drew, kept exactly, and the readers of the remarks the workbooks write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerFor, answerFromMaturity, answerWord, asvsFacts, asvsInScope, asvsLevels, byLeadingNumber, coverageShare, dccType, englishLabel, evidenceAsked, groupOf, isGapScore, masvsFacts, masvsLevels, masvsPlatforms,
  maturityBand, maturityFacts, maturityStats, matchesText, metShare, owaspFacts, pdplFacts, splitBilingual, tally, toLensItem, weightedShare, type LensItem, type LensRaw,
} from './lensData.ts';

const item = (id: number, status: string, over: Partial<LensRaw> = {}): LensItem => toLensItem({ id, item_number: `R${id}`, area_domain: 'Auth', control_description: `req ${id}`, compliance_status: status, ...over });

test('a control keeps the workspace fields and adds its sub-heading and per-application answers', () => {
  const it = toLensItem({ id: 1, compliance_status: 'Complied', subdomain_name: ' Passwords ', asset_status: { '7': 'Not Complied', '8': 'weird' } });
  assert.equal(it.status, 'complied');
  assert.equal(it.sub, 'Passwords');
  assert.deepEqual(it.assetStatus, { '7': 'not_complied', '8': 'in_progress' });
  assert.equal(answerFor(it, null), 'complied');
  assert.equal(answerFor(it, 7), 'not_complied');
  assert.equal(answerFor(it, 99), 'in_progress', 'an application with no answer has not answered');
});

test('ASVS remarks: level, CWE and NIST; no level reads as 1 where the lens counts', () => {
  assert.deepEqual(asvsFacts('ASVS Level: 2 | CWE: 285 | NIST: 5.1.1.2'), { level: 2, cwe: '285', nist: '5.1.1.2' });
  assert.deepEqual(asvsFacts(null), { level: null, cwe: '', nist: '' });
  assert.equal(asvsInScope(item(1, 'complied', { remarks: 'ASVS Level: 3' }), 2), false);
  assert.equal(asvsInScope(item(1, 'complied', { remarks: 'ASVS Level: 2' }), 2), true);
  assert.equal(asvsInScope(item(1, 'complied', { remarks: 'ASVS Level: 3' }), null), true, 'no target: everything applies');
  assert.equal(asvsInScope(item(1, 'complied', { remarks: '' }), 1), true, 'no level reads as level 1');
});

test('met share is complied over applicable, and a group with nothing is 0', () => {
  const t = tally([item(1, 'complied'), item(2, 'complied'), item(3, 'not_complied'), item(4, 'na'), item(5, 'in_progress')]);
  assert.deepEqual(t, { total: 5, complied: 2, partial: 0, notComplied: 1, na: 1, open: 1, answered: 4 });
  assert.equal(metShare(t), Math.round((2 / 4) * 100));
  assert.equal(metShare(tally([])), 0);
  assert.equal(metShare(tally([item(1, 'na')])), 0, 'all not applicable: nothing met, no division by zero');
  assert.equal(coverageShare(t), 80);
});

test('the DCC share gives a partial answer half', () => {
  const t = tally([item(1, 'complied'), item(2, 'partially_complied'), item(3, 'not_complied'), item(4, 'na')]);
  assert.equal(weightedShare(t), Math.round(((1 + 0.5) / 3) * 100));
});

test('ASVS level achieved climbs while every requirement of the level passes', () => {
  const rows = [item(1, 'complied', { remarks: 'ASVS Level: 1' }), item(2, 'complied', { remarks: 'ASVS Level: 1' }), item(3, 'not_complied', { remarks: 'ASVS Level: 2' }), item(4, 'complied', { remarks: 'ASVS Level: 3' })];
  const r = asvsLevels(rows);
  assert.equal(r.achieved, 1);
  assert.deepEqual(r.levels[1], { total: 2, valid: 2 });
  assert.deepEqual(r.levels[2], { total: 1, valid: 0 });
  assert.equal(asvsLevels([item(1, 'complied', { remarks: 'ASVS Level: 2' })]).achieved, 0, 'a level with no requirement stops the climb');
  assert.equal(asvsLevels([]).achieved, 0);
  // the answer of one application
  const per = [toLensItem({ id: 1, compliance_status: 'not_complied', remarks: 'ASVS Level: 1', asset_status: { '5': 'complied' } })];
  assert.equal(asvsLevels(per, (i) => answerFor(i, 5)).achieved, 1);
  assert.equal(asvsLevels(per).achieved, 0);
});

test('OWASP remarks: tools, note and a description that may hold bars', () => {
  assert.deepEqual(owaspFacts('Tools: Burp, ZAP | Note: check headers | Desc: first | second'), { tools: 'Burp, ZAP', note: 'check headers', desc: 'first | second' });
  assert.deepEqual(owaspFacts('Desc: only'), { tools: '', note: '', desc: 'only' });
});

test('MASVS remarks, platforms (Android first) and level achieved', () => {
  assert.deepEqual(masvsFacts('Platform: iOS | MASVS: L1, L2 | MSTG: MSTG-ARCH-1 | Testing: do it'), { platform: 'iOS', levels: ['L1', 'L2'], mstg: 'MSTG-ARCH-1', testing: 'do it' });
  const rows = [item(1, 'complied', { remarks: 'Platform: iOS | MASVS: L1' }), item(2, 'complied', { remarks: 'Platform: Android | MASVS: L1,L2' }), item(3, 'na', { remarks: 'MASVS: L2' }), item(4, 'in_progress', { remarks: 'MASVS: R' })];
  assert.deepEqual(masvsPlatforms(rows), ['Android', 'iOS']);
  const r = masvsLevels(rows);
  assert.equal(r.achieved, 'L2', 'not applicable requirements are left out of a level');
  assert.deepEqual(r.levels.R, { total: 1, valid: 0 });
  assert.equal(masvsLevels([item(1, 'not_complied', { remarks: 'MASVS: L1' })]).achieved, '');
});

test('maturity: only scores of 1 or more count, the target is its own average, the band is the rounded level', () => {
  const rows = [item(1, 'complied', { maturity_score: 4, remarks: 'Target: 5' }), item(2, 'partially_complied', { maturity_score: 2, remarks: 'Target: 3' }), item(3, 'in_progress', { maturity_score: 0 }), item(4, 'in_progress')];
  const s = maturityStats(rows);
  assert.equal(s.avg, 3);
  assert.equal(s.target, 4);
  assert.equal(s.hasTarget, true);
  assert.equal(s.answered, 2);
  assert.equal(s.total, 4);
  assert.equal(maturityStats([]).avg, 0);
  assert.equal(maturityStats([item(1, 'in_progress')]).hasTarget, false);
  assert.equal(maturityBand(3.4), 'L3 · Business enabling');
  assert.equal(maturityBand(0.4), '—');
  assert.deepEqual(maturityFacts('Weighting: 20% | Target: 3 | Dimension: People'), { weight: '20%', target: 3, dimension: 'People' });
});

test('PDPL: the maturity score derives the answer, as the server does', () => {
  assert.equal(answerFromMaturity(null), 'in_progress');
  assert.equal(answerFromMaturity(-1), 'in_progress');
  assert.equal(answerFromMaturity(0), 'not_complied');
  assert.equal(answerFromMaturity(2), 'partially_complied');
  assert.equal(answerFromMaturity(3), 'complied');
  assert.equal(answerFromMaturity(5), 'complied');
  assert.equal(isGapScore(2), true);
  assert.equal(isGapScore(3), false);
  assert.equal(isGapScore(null), false);
  assert.deepEqual(pdplFacts('PDPL Ref: Art. 5 | Risk: High | Q: Is there a notice?'), { ref: 'Art. 5', risk: 'High', question: 'Is there a notice?' });
  assert.deepEqual(evidenceAsked('Policy; Register\nNotice;'), ['Policy', 'Register', 'Notice']);
});

test('DCC: the Arabic sentence goes second, the domain reads in English, Essential is priority high', () => {
  assert.deepEqual(splitBilingual('Plain English'), { en: 'Plain English', ar: '' });
  const mixed = splitBilingual('يجب حماية البيانات. Data must be protected.');
  assert.equal(mixed.en, 'Data must be protected.');
  assert.ok(mixed.ar.startsWith('يجب'));
  assert.deepEqual(splitBilingual('نص عربي فقط'), { en: 'نص عربي فقط', ar: '' }, 'Arabic only stays visible');
  assert.equal(englishLabel('1- الحوكمة (Governance)'), '1 · Governance');
  assert.equal(englishLabel('Plain domain'), 'Plain domain');
  assert.equal(dccType(item(1, 'complied', { priority: 'high' })), 'essential');
  assert.equal(dccType(item(1, 'complied', { priority: 'medium' })), 'sub');
  assert.equal(dccType(item(1, 'complied', { priority: '' })), 'sub');
  assert.equal(dccType(toLensItem({ id: 1, control_type: 'basic' })), 'essential', 'the NCA container says basic');
  assert.equal(dccType(toLensItem({ id: 1, control_type: 'sub' })), 'sub');
});

test('grouping keeps the workbook order or sorts by the leading number; search is plain text', () => {
  const rows = [item(1, 'complied', { area_domain: '10 Risk' }), item(2, 'complied', { area_domain: '2 Gov' }), item(3, 'complied', { area_domain: '10 Risk' }), item(4, 'complied', { area_domain: 'Other' })];
  assert.deepEqual(groupOf(rows).map((g) => [g.name, g.items.length]), [['10 Risk', 2], ['2 Gov', 1], ['Other', 1]]);
  assert.deepEqual(groupOf(rows, byLeadingNumber).map((g) => g.name), ['2 Gov', '10 Risk', 'Other']);
  assert.equal(matchesText('Reset the PASSWORD', ' password '), true);
  assert.equal(matchesText('abc', ''), true);
  assert.equal(matchesText('abc', 'xyz'), false);
});

test('Not answered is sent as a word the server reads as Not answered (it reads "in_progress" as Partially complied)', () => {
  assert.equal(answerWord('in_progress'), 'pending');
  for (const s of ['complied', 'partially_complied', 'not_complied', 'na']) assert.equal(answerWord(s), s);
});
