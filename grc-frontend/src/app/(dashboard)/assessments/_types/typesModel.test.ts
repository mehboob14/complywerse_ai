// node --test "src/app/(dashboard)/assessments/_types/typesModel.test.ts"
// The Types page: every kind of assessment there is, how it begins, what the table says about it, and which file the upload takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SPECS, WORKBOOKS, countWords, fileProblem, groupRows, isKnownFormat, questionnaireWords, specOf, typeRows } from './typesModel.ts';
import { KINDS } from '../../../../components/assessments/workspace/kinds.ts';
import type { ListRow, Template } from '../_data/types.ts';

const listRow = (id: number, format: string, phase: ListRow['phase'] = 'in_progress'): ListRow => ({
  id, name: `A${id}`, assessment_type: null, assessment_format: format, category: 'Other', source: null, file_name: null, status: 'in_progress', due_date: null, assessor: null, overall_score: null,
  total_items: 1, complied_count: 0, partially_complied_count: 0, not_complied_count: 0, in_progress_count: 1, na_count: 0, scope_model: phase ? 'asset' : null, phase, owner_id: null, owner_name: null,
  primary_asset_id: null, primary_asset_name: null, started_at: null, created_at: '2026-01-01T00:00:00', updated_at: null,
});
const template = (format: string, items: number | null): Template => ({ assessment_format: format, label: format, questionnaire: items === null ? null : { assessment_id: 1, name: 'Questions', items }, scoping: 0, in_progress: 0 });

test('every kind of assessment the platform names is on the page once: the nine made per application, function or system, the NCA workspace, and the workbooks', () => {
  const formats = SPECS.map((s) => s.format);
  assert.equal(new Set(formats).size, formats.length, 'no kind twice');
  assert.equal(SPECS.filter((s) => s.begin === 'start').length, 9);
  assert.deepEqual(SPECS.filter((s) => s.begin === 'open').map((s) => s.format), ['nca_container']);
  for (const f of Object.keys(KINDS)) assert.ok(formats.includes(f), `${f} has a row`);
  assert.ok(SPECS.every((s) => s.label && s.about), 'a label and a sentence for each');
});

test('a workbook kind is uploaded under its own name, so the server refuses another kind of workbook; the generic one accepts any', () => {
  for (const w of WORKBOOKS) assert.equal(w.expectFormat, ['standard', 'nca_cloud_cybersecurity_controls_pdf', 'nca_data_cybersecurity_controls_pdf'].includes(w.format) ? null : w.format, w.format);
  assert.equal(specOf('standard')?.label, 'Other standard or benchmark');
  assert.equal(specOf('asvs_checklist')?.expectFormat, null, 'a scoped kind is never uploaded as an assessment');
  assert.equal(specOf('bogus'), undefined);
  assert.equal(isKnownFormat('asvs_checklist'), true);
  assert.equal(isKnownFormat('x'), false);
  assert.equal(isKnownFormat(null), false);
});

test('rows: the counts per kind from the register\'s list; Start waits for the questionnaire it is made from; NIST kinds start from the library', () => {
  const rows = typeRows([listRow(1, 'asvs_checklist'), listRow(2, 'asvs_checklist', 'scoping'), listRow(3, 'dpia_pia', null)], [template('asvs_checklist', 280), template('owasp_v4_testing_checklist', null)]);
  const asvs = rows.find((r) => r.format === 'asvs_checklist')!;
  assert.deepEqual([asvs.count, asvs.scoping, asvs.inProgress, asvs.canBegin], [2, 1, 1, true]);
  assert.deepEqual(asvs.questionnaire, { state: 'uploaded', name: 'Questions', items: 280 });
  assert.equal(asvs.openHref, '/assessments/register?type=asvs_checklist', 'several: the register on that type');
  assert.equal(asvs.questionnaireHref, '/cyber-security/questionnaires/asvs_checklist');
  const owasp = rows.find((r) => r.format === 'owasp_v4_testing_checklist')!;
  assert.deepEqual([owasp.questionnaire, owasp.canBegin, owasp.openHref], [{ state: 'missing' }, false, null]);
  const nist = rows.find((r) => r.format === 'nist_800_53a')!;
  assert.deepEqual([nist.questionnaire.state, nist.canBegin, nist.questionnaireHref], ['library', true, null]);
  const dpia = rows.find((r) => r.format === 'dpia_pia')!;
  assert.deepEqual([dpia.count, dpia.openHref, dpia.canBegin], [1, '/assessments/a/3', true], 'one: straight to it');
  assert.equal(rows.find((r) => r.format === 'nca_container')?.openHref, '/assessments/a/nca');
  const cold = typeRows(undefined, undefined);
  assert.equal(cold.length, SPECS.length);
  assert.ok(cold.filter((r) => r.begin === 'start' && !r.format.startsWith('nist')).every((r) => !r.canBegin), 'before the questionnaires are known, Start waits');
});

test('groups follow the server\'s categories, empty ones left out', () => {
  const groups = groupRows(typeRows(undefined, undefined));
  assert.deepEqual(groups.map((g) => g.category), ['Cyber Security', 'NCA', 'Digital Operations', 'Privacy & Data', 'Audit', 'Other']);
  assert.equal(groups[0].rows.length, 9);
  assert.deepEqual(groups[1].rows.map((r) => r.format), ['nca_container', 'nca_dcc_tool', 'nca_cloud_cybersecurity_controls_pdf', 'nca_data_cybersecurity_controls_pdf', 'nca_vuln_register', 'nca_audit_register', 'nca_risk_register']);
  assert.deepEqual(groups[5].rows.map((r) => r.format).sort(), ['kpi_report', 'standard']);
  assert.equal(groupRows([]).length, 0);
});

test('the words of a row', () => {
  assert.equal(countWords({ count: 0, scoping: 0 }), 'None yet');
  assert.equal(countWords({ count: 1, scoping: 0 }), '1 assessment');
  assert.equal(countWords({ count: 3, scoping: 2 }), '3 assessments (2 being scoped)');
  assert.equal(questionnaireWords({ state: 'uploaded', name: 'x', items: 1 }), 'Uploaded, 1 question');
  assert.equal(questionnaireWords({ state: 'uploaded', name: 'x', items: 280 }), 'Uploaded, 280 questions');
  assert.equal(questionnaireWords({ state: 'missing' }), 'Not uploaded yet');
  assert.equal(questionnaireWords({ state: 'library' }), 'From the NIST library');
  assert.equal(questionnaireWords({ state: 'none' }), '—');
});

test('a file the upload takes: a workbook, a CSV or a PDF that is not empty', () => {
  assert.match(fileProblem(null), /Choose/);
  assert.equal(fileProblem({ name: 'DCC.XLSX', size: 10 }), '');
  assert.equal(fileProblem({ name: 'a.csv', size: 1 }), '');
  assert.equal(fileProblem({ name: 'a.pdf', size: 1 }), '');
  assert.match(fileProblem({ name: 'a.docx', size: 10 }), /Excel workbook/);
  assert.match(fileProblem({ name: 'a.xlsx', size: 0 }), /empty/);
});
