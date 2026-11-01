// node --test "src/app/(dashboard)/evidence/uploadModel.test.ts"
// The Upload evidence form's rules. The old form's logic is compared with a frozen copy of the old code (handleSubmit's field list, the validity rule, the name from a
// file) on the same inputs, so "what it sends is unchanged" is a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ACCEPT, DEFAULT_VALIDITY, NAME_MAX, VALIDITY_PRESETS, fileProblem, fileSize, nameFromFile, sourceSystemLabel, uploadFields, validityDays, type UploadInput } from './uploadModel.ts';

// ── the old code, verbatim (page.tsx UploadModal) ─────────────────────────────────────────────────────────────────────────────────────────
function oldResolved(validityPreset: string, validityCustomDays: string) {
  if (validityPreset === 'custom') { const n = parseInt(validityCustomDays, 10); return Number.isFinite(n) && n > 0 ? n : null; }
  if (validityPreset === '') return null;
  const n = parseInt(validityPreset, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function oldFields(i: UploadInput): Array<[string, string]> {
  const fd: Array<[string, string]> = [];
  const append = (k: string, v: string) => fd.push([k, v]);
  const resolved = oldResolved(i.validityPreset, i.validityCustomDays);
  const source = !i.linkedAssetIds.length ? '' : i.linkedAssetIds.map((id) => i.assets.find((a) => a.id === id)?.name).filter(Boolean).join(', ');
  append('name', i.name);
  if (i.description) append('description', i.description);
  if (i.evidenceType) append('evidence_type', i.evidenceType);
  if (i.collectionDate) append('collection_date', i.collectionDate);
  if (resolved) append('validity_period_days', String(resolved));
  if (source) append('source_system', source);
  if (i.ownerId) append('owner_id', String(i.ownerId));
  if (i.custom) append('custom_values', JSON.stringify(i.custom));
  return fd;
}

const assets = [{ id: 1, name: 'Splunk' }, { id: 2, name: 'Azure AD' }, { id: 3, name: 'Qualys' }];
const base: UploadInput = { name: 'Access policy', description: '', evidenceType: '', collectionDate: '', validityPreset: DEFAULT_VALIDITY, validityCustomDays: '', ownerId: null, linkedAssetIds: [], assets };

test('the fields sent are exactly the ones the old form appended, in the same order, for every combination of the optional inputs', () => {
  const variants: Array<Partial<UploadInput>> = [
    {}, { description: 'About it' }, { evidenceType: 'policy' }, { collectionDate: '2026-11-12' }, { validityPreset: '90' }, { validityPreset: '' }, { validityPreset: 'custom', validityCustomDays: '45' },
    { validityPreset: 'custom', validityCustomDays: '' }, { validityPreset: 'custom', validityCustomDays: '-3' }, { validityPreset: 'custom', validityCustomDays: '12abc' },
    { ownerId: 7 }, { ownerId: null }, { linkedAssetIds: [1, 3] }, { linkedAssetIds: [9] }, { custom: { region: 'EMEA' } }, { custom: null },
    { description: 'D', evidenceType: 'log', collectionDate: '2026-01-02', validityPreset: '730', ownerId: 3, linkedAssetIds: [2, 1], custom: { a: 1 } },
  ];
  for (const v of variants) {
    const input = { ...base, ...v };
    assert.deepEqual(uploadFields(input), oldFields(input), JSON.stringify(v));
  }
});

test('a validity with no collection date sends a validity and no date (the server then gives the file no expiry: the form says so)', () => {
  const sent = Object.fromEntries(uploadFields({ ...base }));
  assert.equal(sent.validity_period_days, '365');
  assert.equal(sent.collection_date, undefined);
});

test('validity: a preset is its days, custom is a positive whole number, anything else is none', () => {
  for (const [preset, custom] of [['90', ''], ['365', ''], ['custom', '45'], ['custom', ''], ['custom', '0'], ['custom', ' 12 '], ['', ''], ['x', '']] as const) {
    assert.equal(validityDays(preset, custom), oldResolved(preset, custom), `${preset}/${custom}`);
  }
  assert.deepEqual(VALIDITY_PRESETS.map((p) => p.value), ['90', '180', '365', '730', 'custom']);
  assert.equal(DEFAULT_VALIDITY, '365', 'the form starts at one year');
});

test('a file: an executable is refused (also when dropped), the name starts as the file name without its extension, the chooser offers the documented types', () => {
  assert.equal(fileProblem('setup.exe'), 'Executable files (.exe) are not allowed.');
  assert.equal(fileProblem('SETUP.EXE'), 'Executable files (.exe) are not allowed.');
  assert.equal(fileProblem('policy.pdf'), null);
  assert.equal(fileProblem('no-extension'), null);
  assert.equal(nameFromFile('Access Control Policy v2.3.docx'), 'Access Control Policy v2.3');
  assert.equal(nameFromFile('archive.tar.gz'), 'archive.tar');
  assert.equal(nameFromFile('plain'), 'plain');
  assert.equal(ACCEPT, '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg');
  assert.equal(NAME_MAX, 255, 'the longest name the server stores');
});

test('the source system is the chosen assets\' names; the size is said as a person reads it', () => {
  assert.equal(sourceSystemLabel([], assets), '');
  assert.equal(sourceSystemLabel([2, 1], assets), 'Azure AD, Splunk');
  assert.equal(sourceSystemLabel([9, 3], assets), 'Qualys', 'an asset that is no longer listed is left out');
  assert.deepEqual([0, 500, 2048, 340 * 1024, 2.4 * 1024 * 1024].map(fileSize), ['0 B', '500 B', '2 KB', '340 KB', '2.40 MB']);
  assert.equal(fileSize(-1), '');
});
