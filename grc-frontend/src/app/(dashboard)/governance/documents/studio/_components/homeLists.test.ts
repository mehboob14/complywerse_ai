import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docLine, humanize, pickable, workAction, type PickDoc } from './homeLists.ts';

const TYPES = { policy: 'Policy', standard: 'Standard' };
const STATUSES = { pending_review: { label: 'In review' }, draft: { label: 'Draft' } };
const doc = (over: Partial<PickDoc> = {}): PickDoc => ({ id: 1, code: null, doc_type: 'policy', status: 'pending_review', version: '1.0', has_file: false, has_text: true, ...over });

test('a picked document reads with the app’s type and status labels, never raw values', () => {
  assert.equal(docLine(doc(), TYPES, STATUSES), 'Policy · v1.0 · In review');
  assert.equal(docLine(doc({ code: 'POL-7', doc_type: 'standard', status: 'draft', version: '3.0' }), TYPES, STATUSES), 'POL-7 · Standard · v3.0 · Draft');
  assert.equal(docLine(doc({ doc_type: 'risk_register', status: 'review_required' }), TYPES, STATUSES), 'Risk register · v1.0 · Review required');
  assert.equal(humanize(null), '');
});

test('Edit from the library offers only documents the person may edit; the other pickers every one they read', () => {
  const rows = [doc({ id: 1, may_edit: true }), doc({ id: 2, may_edit: false }), doc({ id: 3, has_text: false }), doc({ id: 4, may_edit: true })];
  assert.deepEqual(pickable(rows, { editable: true }).map((d) => d.id), [1, 4]);
  assert.deepEqual(pickable(rows).map((d) => d.id), [1, 2, 4]);
  assert.deepEqual(pickable(rows, { exclude: [1] }).map((d) => d.id), [2, 4]);
});

test('a draft is discarded, a reader’s comparison removed, the person’s own library work kept', () => {
  assert.equal(workAction({ document_id: null }), 'discard');
  assert.equal(workAction({ document_id: 10, may_save: false }), 'remove');
  assert.equal(workAction({ document_id: 10, may_save: true }), null);
  assert.equal(workAction({ document_id: 10 }), null);
});
