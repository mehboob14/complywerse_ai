// node --test "src/components/compliance/artifactsModel.test.ts"
// The Artifacts tab's pure rules: the catalogue by stage and search, the groups, the suggested shortlist, the download formats and file names.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createdByCatalogId, dataTypeWords, filterCatalog, firstLine, formatsForArtifact, formatsForMode, groupByStage, liveExportName, mandatoryNote, stageCounts, stageName,
  suggestedFor, type CatalogItemLite,
} from './artifactsModel.ts';

const item = (id: number, name: string, stage: string, over: Partial<CatalogItemLite> = {}): CatalogItemLite => ({
  id, name, stage, artifact_type: 'Policy', control_ref: null, description: null, is_platform_native: false, ...over,
});
const S1 = 'Stage 1: Initiation & Scoping';
const S2 = 'Stage 2: Gap Assessment';
const ITEMS = [
  item(1, 'ISMS Project Charter', S1, { description: 'Mandate, sponsor, scope' }),
  item(2, 'ISMS Scope Statement', S1),
  item(3, 'Gap Analysis Report', S2, { description: 'Clause by clause readiness' }),
  item(4, 'Risk Register', 'Stage 9: Surprise', { is_platform_native: true }),
];

test('a stage name drops its number, and the catalogue is narrowed by stage and by a search over name and description', () => {
  assert.equal(stageName(S1), 'Initiation & Scoping');
  assert.equal(stageName(null), '');
  assert.deepEqual(filterCatalog(ITEMS, 'all', '').map((i) => i.id), [1, 2, 3, 4]);
  assert.deepEqual(filterCatalog(ITEMS, S1, '').map((i) => i.id), [1, 2]);
  assert.deepEqual(filterCatalog(ITEMS, 'all', ' SPONSOR ').map((i) => i.id), [1], 'the description counts, case does not');
  assert.deepEqual(filterCatalog(ITEMS, S2, 'scope'), [], 'both must hold');
  assert.deepEqual(filterCatalog(ITEMS, 'all', 'zzz'), []);
});

test('the groups follow the order of the stages the server lists, a stage it did not list comes last, and an empty stage has no group', () => {
  const groups = groupByStage(ITEMS, [S2, S1, 'Stage 5: Nothing here']);
  assert.deepEqual(groups.map((g) => g.stage), [S2, S1, 'Stage 9: Surprise']);
  assert.deepEqual(groups[1].items.map((i) => i.id), [1, 2]);
  assert.deepEqual(groupByStage([], [S1]), []);
  assert.deepEqual(stageCounts(ITEMS), { [S1]: 2, [S2]: 1, 'Stage 9: Surprise': 1 });
});

test('a written copy is found by the catalogue entry it was made from', () => {
  const m = createdByCatalogId([{ catalog_item_id: 2, id: 10 }, { catalog_item_id: null, id: 11 }, { catalog_item_id: 0, id: 12 }]);
  assert.equal(m.get(2)?.id, 10);
  assert.equal(m.size, 1);
});

test('"suggested for this control" ranks by the meaningful words shared, at most three, and says nothing without any', () => {
  const items = [
    item(1, 'Incident Response Plan', S1, { description: 'How the organisation responds to a breach incident' }),
    item(2, 'Breach Notification Procedure', S1, { description: 'Notify the regulator after a breach incident' }),
    item(3, 'Backup Policy', S1),
    item(4, 'Data Retention Schedule', S1),
    item(5, 'Breach Log', S1, { control_ref: 'breach incident' }),
  ];
  const out = suggestedFor(items, 'The organisation shall notify a breach incident to the regulator');
  assert.equal(out.length, 3);
  assert.equal(out[0].id, 2, 'the entry with the most words in common first');
  assert.deepEqual(suggestedFor(items, ''), []);
  assert.deepEqual(suggestedFor(items, undefined), []);
  assert.deepEqual(suggestedFor(items, 'data personal controls records'), [], 'stop words say nothing');
  assert.deepEqual(suggestedFor(items, 'zebra quartz'), []);
  assert.equal(suggestedFor(items, 'breach incident', 1).length, 1);
});

test('a table is downloaded as a spreadsheet, a document as Word; a live artifact is a spreadsheet named safely', () => {
  assert.deepEqual(formatsForMode('table'), ['xlsx', 'csv', 'pdf', 'md']);
  assert.deepEqual(formatsForMode('markdown'), ['docx', 'pdf', 'md']);
  assert.deepEqual(formatsForMode(null), ['docx', 'pdf', 'md']);
  assert.deepEqual(formatsForArtifact('XLSX / CSV'), ['xlsx', 'csv', 'pdf', 'md']);
  assert.deepEqual(formatsForArtifact('csv'), ['xlsx', 'csv', 'pdf', 'md']);
  assert.deepEqual(formatsForArtifact('DOCX'), ['docx', 'pdf', 'md']);
  assert.deepEqual(formatsForArtifact(undefined), ['docx', 'pdf', 'md']);
  assert.equal(liveExportName('Risk Register (live)'), 'Risk_Register_live_.xlsx');
  assert.equal(liveExportName(null), 'artifact.xlsx');
  assert.equal(liveExportName('x'.repeat(200)).length, 80 + '.xlsx'.length);
});

test('small words: the mandatory note, a preview line, a data type', () => {
  assert.match(mandatoryNote('uae_ia') || '', /always applies/);
  assert.equal(mandatoryNote('iso_27001'), undefined);
  assert.equal(firstLine('\n  \n# Title\nbody'), '# Title');
  assert.equal(firstLine(null), '');
  assert.equal(dataTypeWords('risk_register'), 'risk register');
  assert.equal(dataTypeWords(null), '');
});
