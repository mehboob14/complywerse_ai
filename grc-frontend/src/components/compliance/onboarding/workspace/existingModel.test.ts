// node --test "src/components/compliance/onboarding/workspace/existingModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyForm, formChanged, formOf, formProblem, payloadOf, recordFacts, reviewsOf } from './existingModel.ts';
import type { ExistingRecord } from '@/lib/frameworkOnboarding';

const TYPES = ['External certification', 'Statement of Applicability (SoA)'];
const record = (extra: Partial<ExistingRecord> = {}): ExistingRecord => ({
  id: 1, assessment_type: 'External certification', framework_version: null, assessment_date: null, valid_until: null, period_start: null, period_end: null,
  assessor_or_issuer: null, scope_coverage: null, scope_note: null, files: [], verification_status: 'declared', verified_by: null, verified_at: null, note: null,
  expired: false, created_by: null, updated_at: null, ...extra,
});

test('only the kind is needed; it must be one of the framework\'s own, and dates must make sense', () => {
  assert.equal(formProblem(emptyForm(), TYPES), 'Choose what exists.');
  assert.equal(formProblem({ ...emptyForm(), type: 'Type II report' }, TYPES), 'Choose what exists.');
  assert.equal(formProblem({ ...emptyForm(), type: TYPES[0] }, TYPES), null);
  assert.match(formProblem({ ...emptyForm(), type: TYPES[0], date: '2026-03-01', validUntil: '2025-03-01' }, TYPES) ?? '', /expiry/);
  assert.match(formProblem({ ...emptyForm(), type: TYPES[0], from: '2026-03-01', to: '2026-01-01' }, TYPES) ?? '', /period/);
});

test('a blank box is "not given", and the files are sent as ids', () => {
  const sent = payloadOf({ ...emptyForm(), type: TYPES[0], date: '2026-03-01', issuer: '  NQA ', files: [{ id: 7, name: 'cert.pdf' }] });
  assert.deepEqual(sent, {
    assessment_type: TYPES[0], assessment_date: '2026-03-01', valid_until: null, assessor_or_issuer: 'NQA', framework_version: null,
    period_start: null, period_end: null, scope_coverage: null, note: null, evidence_ids: [7],
  });
});

test('a saved item becomes the form and back, and a change is noticed', () => {
  const r = record({ assessment_date: '2026-03-01', assessor_or_issuer: 'BSI', scope_coverage: 'Partially', files: [{ id: 3, name: 'a.pdf' }] });
  const f = formOf(r);
  assert.equal(f.coverage, 'Partially');
  assert.equal(formChanged(f, formOf(r)), false);
  assert.equal(formChanged({ ...f, issuer: 'NQA' }, formOf(r)), true);
  assert.equal(formChanged({ ...f, files: [] }, formOf(r)), true);
});

test('the facts line says what was given, in reading order, and calls a lapsed certificate expired', () => {
  const fmt = (iso: string) => iso;
  assert.equal(recordFacts(record(), fmt), '');
  assert.equal(recordFacts(record({ assessment_date: '2026-03-01', valid_until: '2027-03-01', assessor_or_issuer: 'NQA', framework_version: '2022' }), fmt),
    'Assessed 2026-03-01 · Valid until 2027-03-01 · NQA · Version 2022');
  assert.equal(recordFacts(record({ valid_until: '2024-01-01', expired: true }), fmt), 'Expired 2024-01-01');
  assert.equal(recordFacts(record({ period_start: '2025-01-01' }), fmt), 'Covers 2025-01-01 to …');
});

test('a review is offered only for an item with a document, and never the one it already holds', () => {
  assert.deepEqual(reviewsOf(record()), []);
  assert.deepEqual(reviewsOf(record({ files: [{ id: 1, name: 'a.pdf' }], verification_status: 'evidence_received' })), ['reviewed', 'verified']);
  assert.deepEqual(reviewsOf(record({ files: [{ id: 1, name: 'a.pdf' }], verification_status: 'reviewed' })), ['verified']);
  assert.deepEqual(reviewsOf(record({ files: [{ id: 1, name: 'a.pdf' }], verification_status: 'verified' })), ['reviewed']);
});
