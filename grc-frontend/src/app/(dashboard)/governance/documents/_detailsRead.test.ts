import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_DETAILS, applyRead, change, detailsPayload, type ReadResult } from './_detailsRead.ts';

const read: ReadResult = {
  ai: 'used',
  fields: {
    title: { value: 'Acceptable Use Policy', from: 'file' },
    doc_type: { value: 'policy', from: 'ai' },
    description: { value: null, from: 'default' },
    classification: { value: 'internal', from: 'default' },
    owner_id: { value: null, from: 'default', stated: 'Chief Information Security Officer (CISO)' },
    review_cycle_months: { value: 24, from: 'file', stated: 'Every two years' },
    effective_date: { value: '2026-09-24', from: 'file' },
    next_review_date: { value: null, from: 'default' },
  },
};

test('the file fills only what the person has not touched, and says where each value came from', () => {
  const initial = { ...EMPTY_DETAILS, owner_id: 1 };
  const typed = change(initial, { title: 'My own title' });
  const { form, from, ownerStated } = applyRead(initial, typed, new Set(['title']), read);
  assert.equal(form.title, 'My own title');                                     // typed: kept
  assert.deepEqual([form.doc_type, form.review_cycle_months, form.effective_date], ['policy', 24, '2026-09-24']);
  assert.equal(form.next_review_date, '2028-09-24');                            // effective + the file's cycle
  assert.equal(form.owner_id, 1);                                               // the file's owner matched nobody: still the person
  assert.equal(ownerStated, 'Chief Information Security Officer (CISO)');
  assert.deepEqual(from, { doc_type: 'ai', review_cycle_months: 'file', effective_date: 'file' });
});

test('a second file starts the untouched fields again; a changed cycle moves a suggested next review', () => {
  const initial = { ...EMPTY_DETAILS, owner_id: 1 };
  const first = applyRead(initial, initial, new Set(), read).form;
  const second = applyRead(initial, first, new Set(), { ai: 'not_needed', fields: { title: { value: 'Other', from: 'file' } } }).form;
  assert.deepEqual([second.title, second.review_cycle_months, second.effective_date, second.next_review_date], ['Other', 12, '', '']);
  const moved = change(first, { review_cycle_months: 6 });
  assert.equal(moved.next_review_date, '2027-03-24');
  const own = change(change(first, { next_review_date: '2027-01-01' }), { review_cycle_months: 36 });
  assert.equal(own.next_review_date, '2027-01-01');                            // a date the person chose stays
  assert.deepEqual(detailsPayload({ ...first, description: '  ' }),
    { title: 'Acceptable Use Policy', doc_type: 'policy', classification: 'internal', owner_id: 1, review_cycle_months: 24,
      effective_date: '2026-09-24', next_review_date: '2028-09-24' });
});

test('a chosen parent is sent and survives reading another file; none is left out', () => {
  const initial = { ...EMPTY_DETAILS, owner_id: 1, parent_document_id: 7 };          // e.g. the studio session's parent reference
  const read1 = applyRead(initial, initial, new Set(), read).form;
  assert.equal(read1.parent_document_id, 7);
  const picked = change(read1, { parent_document_id: 12 });
  assert.equal(applyRead(initial, picked, new Set(['parent_document_id']), read).form.parent_document_id, 12);
  assert.equal(detailsPayload(picked).parent_document_id, 12);
  assert.equal('parent_document_id' in detailsPayload({ ...picked, parent_document_id: null }), false);
});
