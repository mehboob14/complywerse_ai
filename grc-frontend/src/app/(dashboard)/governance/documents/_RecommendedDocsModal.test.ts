import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./_RecommendedDocsModal.tsx', import.meta.url), 'utf8');

test('the Document Templates popup and each preview in it are labelled modal dialogs that Escape closes', () => {
  for (const kept of ["role: 'dialog'", "'aria-modal': true", "'aria-labelledby': titleId", "e.key !== 'Escape'", 'opener?.focus?.()']) {
    assert.ok(src.includes(kept), `missing from _RecommendedDocsModal.tsx: ${kept}`);
  }
  assert.equal(src.split('{...dialog.props}').length - 1, 4);          // the popup, the NCA and law previews, the artifact details
  assert.equal(src.split('id={dialog.titleId}').length - 1, 4);
});

test('NCA templates are listed under their cleaned names', () => {
  assert.ok(src.includes('title: ncaName(t.title)'));
});

test('a template shows its kind of file, not its raw file name, and the search names NCA as NCA', () => {
  assert.ok(!src.includes('{t.filename}') && !src.includes('{template.filename}'));
  assert.equal(src.split('fileKind(').length - 1, 2);                      // the list row and the preview header
  assert.ok(!src.includes('activeLabel.toLowerCase()'));
});

test('Compare with another document (Gap analysis) is a dialog that Escape closes, with the templates under their names', () => {
  const compare = readFileSync(new URL('../../../../components/governance/NcaCompareModal.tsx', import.meta.url), 'utf8');
  for (const kept of ['role="dialog"', 'aria-modal="true"', 'aria-labelledby={titleId}', "e.key !== 'Escape'", 'opener?.focus?.()',
    '>Compare with another document<', '{ncaName(t.title)}']) {
    assert.ok(compare.includes(kept), `missing from NcaCompareModal.tsx: ${kept}`);
  }
});
