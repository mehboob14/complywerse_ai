import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { docLine, humanize, pickable, templateMeta, templateName, workAction, type PickDoc } from './homeLists.ts';

test('Edit from the library asks the server for the documents the person may edit, not the newest they read', () => {
  const page = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../../../../../../lib/studio/api.ts', import.meta.url), 'utf8');
  assert.ok(page.includes('studioApi.documents(q, 12, editable)') && page.includes('<DocList focus editable'));
  assert.ok(api.includes("get<{ items: LibraryDoc[] }>('/documents', { q, limit, editable: editable || undefined })"));
});

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

test('a template row reads "Policy", "15 sections": the type only when the name does not already say it', () => {
  const T = { policy: 'Policy', standard: 'Standard' };
  assert.equal(templateName('Policy (standard structure)'), 'Policy');
  assert.equal(templateName('Acme policy (draft)'), 'Acme policy (draft)');
  assert.equal(templateMeta({ name: 'Policy (standard structure)', doc_type: 'policy', sections: 15 }, T), '15 sections');
  assert.equal(templateMeta({ name: 'Information Security Policy', doc_type: 'policy', sections: 1 }, T), '1 section');
  assert.equal(templateMeta({ name: 'Vendor onboarding', doc_type: 'standard', sections: 12 }, T), 'Standard · 12 sections');
  assert.equal(templateMeta({ name: 'Playbook', doc_type: 'incident_plan', sections: 0 }, T), 'Incident plan · free structure');
});

test('a draft is discarded, a reader’s comparison removed, the person’s own library work kept', () => {
  assert.equal(workAction({ document_id: null }), 'discard');
  assert.equal(workAction({ document_id: 10, may_save: false }), 'remove');
  assert.equal(workAction({ document_id: 10, may_save: true }), null);
  assert.equal(workAction({ document_id: 10 }), null);
});
