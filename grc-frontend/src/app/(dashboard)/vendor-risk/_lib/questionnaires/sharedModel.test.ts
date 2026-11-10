// node --test "src/app/(dashboard)/vendor-risk/_lib/questionnaires/sharedModel.test.ts"
// The Shared tab's rules: what a row offers, what an import sends or is missing, the file a package is saved as, and the supplier picker that no longer stops at a hundred.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contentsText, importPlan, packageFileName, pickerNote, ratingLabel, ratingWord, sharedActions, sharedHead, supplierText, vendorChoices, type SharedRow, type VendorOption } from './sharedModel.ts';

const row = (over: Partial<SharedRow> = {}): SharedRow => ({
  id: 1, vendor_id: 4, vendor_name: 'Acme Pay', template_name: 'Security basics', residual_rating: 'High', response_count: 40, evidence_count: 1, share_token: 'abc', status: 'active',
  validated_at: '2026-10-01T10:00:00', expires_at: '2027-03-30T10:00:00', ...over,
});

test('a row offers the token and the package to everyone who reaches the page, and Revoke to a person who may edit, while it is still shared', () => {
  assert.deepEqual(sharedActions(row(), { edit: false }), ['copy_token', 'download']);
  assert.deepEqual(sharedActions(row(), { edit: true }), ['copy_token', 'download', 'revoke']);
  assert.deepEqual(sharedActions(row({ status: 'revoked' }), { edit: true }), ['copy_token', 'download'], 'a revoked one cannot be revoked again');
});

test('the rating is said as a rating, an unscored one says so, and the head counts what is shared and what is revoked', () => {
  assert.equal(ratingWord(row({ residual_rating: 'High' })), 'high');
  assert.equal(ratingLabel(row({ residual_rating: 'High' })), 'High');
  assert.equal(ratingLabel(row({ residual_rating: null })), 'Not scored');
  assert.equal(ratingLabel(row({ residual_rating: 'catastrophic' })), 'Not scored', 'a word nobody knows is not guessed');
  assert.equal(sharedHead([row(), row({ id: 2, status: 'revoked' })]), '1 shared · 1 revoked');
  assert.equal(sharedHead([]), '0 shared');
  assert.equal(supplierText(row({ vendor_name: null })), 'A supplier that is no longer listed');
  assert.equal(contentsText(row()), '40 answers · 1 document · shared until 30 Mar 2027');
  assert.equal(contentsText(row({ response_count: 1, evidence_count: 0, expires_at: null })), '1 answer · 0 documents');
});

test('the package file is named after the supplier in words and dashes, never an id', () => {
  assert.equal(packageFileName(row()), 'shared-assessment-Acme-Pay.json');
  assert.equal(packageFileName(row({ vendor_name: '  Ünï & Co. (Pty) Ltd  ' })), 'shared-assessment-n-Co-Pty-Ltd.json');
  assert.equal(packageFileName(row({ vendor_name: null })), 'shared-assessment-supplier.json');
  assert.ok(packageFileName(row({ vendor_name: 'x'.repeat(300) })).length < 90);
});

test('an import needs a supplier and a token or a readable package; a token wins over a pasted package', () => {
  assert.deepEqual(importPlan({ target: null, token: 'abc', pasted: '' }), { ok: false, problem: 'Choose the supplier whose assessment the answers go into.' });
  assert.deepEqual(importPlan({ target: 3, token: '  abc ', pasted: '{"a":1}' }), { ok: true, body: { share_token: 'abc' } });
  assert.deepEqual(importPlan({ target: 3, token: '', pasted: '{"format":"tpra-shared-assessment/v1"}' }), { ok: true, body: { package: { format: 'tpra-shared-assessment/v1' } } });
  for (const pasted of ['', '   ', '{not json', '[1,2]', '42', 'null']) {
    const plan = importPlan({ target: 3, token: '', pasted });
    assert.equal(plan.ok, false, pasted);
    if (!plan.ok) assert.doesNotMatch(plan.problem, /JSON|Unexpected|token at/i, 'no parser message on a screen');
  }
});

test('the supplier picker holds every supplier it is given, names a contact under each, and disables one with nothing to publish from, with the reason', () => {
  const many: VendorOption[] = Array.from({ length: 130 }, (_, i) => ({ id: i + 1, name: `Supplier ${i + 1}`, status: 'active', tier: null, primary_contact_name: null, primary_contact_email: i === 0 ? 'a@s.test' : null, active_assessment_id: i === 5 ? null : 100 + i }));
  const send = vendorChoices(many);
  assert.equal(send.length, 130, 'past the first hundred');
  assert.deepEqual(send[0], { value: '1', label: 'Supplier 1', description: 'a@s.test' });
  assert.deepEqual(send[1], { value: '2', label: 'Supplier 2' });
  const publish = vendorChoices(many, { needAssessment: true });
  assert.deepEqual(publish[5], { value: '6', label: 'Supplier 6', description: 'No active assessment yet', disabled: true });
  assert.equal(publish.filter((o) => o.disabled).length, 1);
  assert.equal(pickerNote(130, 130), null);
  assert.equal(pickerNote(6200, 5000), 'Only the first 5,000 of 6,200 suppliers are listed here.');
});
