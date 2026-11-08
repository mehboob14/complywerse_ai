// node --test "src/app/(dashboard)/frameworks/\[id\]/_requirements/artifactModel.test.ts"
// The artifacts of a requirement: the codes asked about, a suggestion for every evidence ask the catalog does not cover, and which made artifact belongs to which item.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { artifactCodes, artifactSummary, handMade, inferArtifactType, madeFor, suggestedArtifacts, type CatalogLike } from './artifactModel.ts';

const item = (over: Partial<CatalogLike> = {}): CatalogLike => ({
  id: 1, artifact_id: 'a1', stage: 'Plan', stage_number: 1, name: 'Information Security Policy', artifact_type: 'Policy', control_ref: 'A.5.1', mandatory: true, description: '',
  format: 'DOCX', owner: '', is_platform_native: false, platform_data_type: null, ...over,
});

test('the codes asked about are the requirement\'s own, then its sub-controls\', each once', () => {
  assert.deepEqual(artifactCodes({ original_control_code: 'M1.1.1', system_control_code: 'M1.1.1', control_code: 'M1.1.1' }, ['M1.1.1.1', 'M1.1.1.2']), ['M1.1.1', 'M1.1.1.1', 'M1.1.1.2']);
  assert.deepEqual(artifactCodes({ original_control_code: 'A.5.1', system_control_code: 'SYS-1', control_code: null }), ['A.5.1', 'SYS-1']);
  assert.deepEqual(artifactCodes({}), []);
});

test('the kind of artifact is read from what is known, the file type last', () => {
  assert.equal(inferArtifactType('', 'Access control policy', 'PDF'), 'Policy');
  assert.equal(inferArtifactType('register', 'Assets', ''), 'Register');
  assert.equal(inferArtifactType('', 'Quarterly review minutes', ''), 'Record/Log');
  assert.equal(inferArtifactType('', 'Something', 'XLSX'), 'Register');
  assert.equal(inferArtifactType('', 'Something', 'PDF'), 'Evidence');
});

test('a suggestion is made for every evidence ask the catalog does not cover, with a negative id; name or title both read', () => {
  const real = [item({ name: 'Information Security Policy', provides: ['Policy Approval Record'] })];
  const made = suggestedArtifacts([
    { name: 'Information Security Policy', filetype: 'PDF' },        // covered by name
    { title: 'Policy Approval Record' },                              // a catalog item provides it
    { name: 'Quarterly review minutes', description: 'Minutes', filetype: 'docx', is_required: true },
    { title: '  ' },                                                  // no name: nothing to suggest
  ], real, 'A.5.1');
  assert.equal(made.length, 1);
  assert.deepEqual([made[0].id, made[0].name, made[0].artifact_type, made[0].format, made[0].mandatory, made[0].control_ref], [-1, 'Quarterly review minutes', 'Record/Log', 'DOCX', true, 'A.5.1']);
  assert.deepEqual(suggestedArtifacts(null, [], null), []);
});

test('the artifact made for an item: by catalog id for a real one, by name and reference for a suggestion; hand-made ones are the rest', () => {
  const artifacts = [
    { id: 10, name: 'ISP', catalog_item_id: 1, control_ref: 'A.5.1' },
    { id: 11, name: 'Quarterly review minutes', catalog_item_id: null, control_ref: 'A.5.1' },
    { id: 12, name: 'Custom register', catalog_item_id: null, control_ref: 'A.5.1' },
  ];
  assert.equal(madeFor(item({ id: 1 }), artifacts)?.id, 10);
  assert.equal(madeFor(item({ id: 2 }), artifacts), undefined);
  assert.equal(madeFor(item({ id: -1, name: ' quarterly REVIEW minutes ', control_ref: 'a.5.1' }), artifacts)?.id, 11);
  assert.deepEqual(handMade(artifacts).map((a) => a.id), [11, 12]);
  assert.equal(artifactSummary(5, 2), '5 suggested, 2 made');
  assert.equal(artifactSummary(3, 0), '3 suggested');
});
