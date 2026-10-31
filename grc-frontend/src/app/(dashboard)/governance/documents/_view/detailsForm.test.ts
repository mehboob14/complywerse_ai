// Run from this folder: node --test detailsForm.test.ts
// "Save sends only what changed": the request the Details popup makes did not change when it moved onto the kit's fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changes, fromDoc, suggestNext } from './detailsForm.ts';

const doc = {
  id: 7, title: 'Remote Working Policy', doc_type: 'policy', classification: 'Internal', owner_id: 2, department_id: null, review_cycle_months: 12,
  effective_date: '2026-03-25T00:00:00', next_review_date: '2027-03-25T00:00:00', applicable_framework_ids: [3, 1, 2], parent_document_id: null,
  tags: ['bcp', 'hr'], description: 'Sets the rules.',
};

test('the form starts as the document is: lower-case classification, the stored day as ten characters, copies of the lists', () => {
  const f = fromDoc(doc);
  assert.equal(f.classification, 'internal');
  assert.equal(f.effective_date, '2026-03-25');
  assert.equal(f.next_review_date, '2027-03-25');
  assert.notEqual(f.applicable_framework_ids, doc.applicable_framework_ids);          // a copy: editing the form cannot change the document in the cache
  assert.deepEqual(fromDoc({}), {
    title: '', doc_type: '', classification: '', owner_id: null, department_id: null, review_cycle_months: null, effective_date: '', next_review_date: '',
    applicable_framework_ids: [], parent_document_id: null, tags: [], description: '',
  });
});

test('nothing changed, nothing sent', () => {
  const base = fromDoc(doc);
  assert.deepEqual(changes(base, { ...base }), {});
  assert.deepEqual(changes(base, { ...base, title: '  Remote Working Policy  ' }), {});            // only trimming
  assert.deepEqual(changes(base, { ...base, applicable_framework_ids: [1, 2, 3] }), {});           // the same set in another order
  assert.deepEqual(changes(base, { ...base, tags: ['hr', 'bcp'] }), {});
});

test('only the fields that differ are sent, the text trimmed', () => {
  const base = fromDoc(doc);
  assert.deepEqual(changes(base, { ...base, title: '  Remote and Hybrid Working Policy ', owner_id: 5, review_cycle_months: 24 }),
    { title: 'Remote and Hybrid Working Policy', owner_id: 5, review_cycle_months: 24 });
  assert.deepEqual(changes(base, { ...base, applicable_framework_ids: [1, 2] }), { applicable_framework_ids: [1, 2] });
  assert.deepEqual(changes(base, { ...base, tags: [...base.tags, 'cloud'] }), { tags: ['bcp', 'hr', 'cloud'] });
  assert.deepEqual(changes(base, { ...base, department_id: 4, parent_document_id: 9 }), { department_id: 4, parent_document_id: 9 });
});

test('an emptied description or date is sent as null; an emptied title or type is sent as the empty text (the dialog does not let Save through for a title)', () => {
  const base = fromDoc(doc);
  assert.deepEqual(changes(base, { ...base, description: '   ' }), { description: null });
  assert.deepEqual(changes(base, { ...base, effective_date: '', next_review_date: '' }), { effective_date: null, next_review_date: null });
  assert.deepEqual(changes(base, { ...base, title: '' }), { title: '' });
  assert.deepEqual(changes(base, { ...base, doc_type: '' }), { doc_type: '' });
});

test('a date or a number is compared as it is, an owner set to none is sent as null', () => {
  const base = fromDoc(doc);
  assert.deepEqual(changes(base, { ...base, next_review_date: '2027-04-01' }), { next_review_date: '2027-04-01' });
  assert.deepEqual(changes(base, { ...base, owner_id: null }), { owner_id: null });
  assert.deepEqual(changes(base, { ...base, review_cycle_months: null }), { review_cycle_months: null });
});

test('the review date the effective date and the cycle suggest', () => {
  const f = fromDoc(doc);
  assert.equal(suggestNext(f), '2027-03-25');
  assert.equal(suggestNext({ ...f, effective_date: '2026-01-31', review_cycle_months: 1 }), '2026-02-28');       // the end of a shorter month
  assert.equal(suggestNext({ ...f, effective_date: '' }), '');
  assert.equal(suggestNext({ ...f, review_cycle_months: null }), '');
});
