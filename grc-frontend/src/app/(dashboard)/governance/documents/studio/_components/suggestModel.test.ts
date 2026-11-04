import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countByType, createBody, detailsOfSession, hrefOf, leftOut, shown, sortSuggestions, statusWords, SUGGEST_TYPES, WRITABLE_TYPES } from './suggestModel.ts';

const S = (title: string, doc_type: string, priority: 'high' | 'medium' | 'low', controls: string[] = [], description = '') =>
  ({ title, doc_type, priority, description, relevant_controls: controls });

const ITEMS = [
  S('Clear Desk Policy', 'policy', 'low', ['A.7.7'], 'Keeping information out of sight'),
  S('Encryption Standard', 'standard', 'high', ['A.8.24'], 'How data is protected with cryptography'),
  S('Access Policy', 'policy', 'high', ['A.5.15', 'A.5.16'], 'Who may reach the systems'),
  S('Backup Procedure', 'procedure', 'medium', ['A.8.13']),
  S('   ', 'policy', 'high'),
];

test('every type the studio writes in full can be asked for, and the create form offers the same without "All"', () => {
  assert.deepEqual(SUGGEST_TYPES.map((t) => t.value), ['', 'policy', 'standard', 'procedure', 'guideline', 'charter']);
  assert.deepEqual(WRITABLE_TYPES.map(([v]) => v), ['policy', 'standard', 'procedure', 'guideline', 'charter']);
});

test('the list puts what matters most first, then by title, and drops a suggestion without a title', () => {
  assert.deepEqual(sortSuggestions(ITEMS).map((s) => s.title), ['Access Policy', 'Encryption Standard', 'Backup Procedure', 'Clear Desk Policy']);
});

test('the filter takes the type and every word typed, in the title, the description or a control reference', () => {
  const list = sortSuggestions(ITEMS);
  assert.deepEqual(shown(list, 'policy', '').map((s) => s.title), ['Access Policy', 'Clear Desk Policy']);
  assert.deepEqual(shown(list, '', 'a.8').map((s) => s.title), ['Encryption Standard', 'Backup Procedure']);          // a control reference
  assert.deepEqual(shown(list, '', 'cryptography data').map((s) => s.title), ['Encryption Standard']);                 // every word, anywhere
  assert.deepEqual(shown(list, 'procedure', 'access'), []);
  assert.deepEqual(countByType(list), { '': 4, policy: 2, standard: 1, procedure: 1 });
});

test('what was left out says which document justified it and where it is, and a studio draft is found in the studio', () => {
  assert.equal(hrefOf({ matched_existing_id: 5 }), '/governance/documents/5');
  assert.equal(hrefOf({ matched_existing_id: null, matched_session_id: 9 }), '/governance/documents/studio/9');
  assert.equal(hrefOf({ id: null, session_id: 3 }), '/governance/documents/studio/3');
  assert.equal(hrefOf({}), null);
  assert.equal(statusWords('studio_draft'), 'Being written in the studio');
  assert.equal(statusWords('pending_review'), 'In review');
  const out = leftOut({
    skipped_matches: [
      { suggested_title: 'Access Policy', matched_existing_id: 5, matched_existing_title: 'Access policy', matched_existing_status: 'approved', reason: 'x', match_type: 'exact_normalized' },
      { suggested_title: 'Encryption Policy', matched_existing_id: null, matched_session_id: 9, matched_existing_title: 'Encryption', matched_existing_status: 'studio_draft', reason: 'y', match_type: 'semantic' },
      { suggested_title: 'No pin', matched_existing_id: null, matched_existing_title: null, reason: 'z', match_type: 'semantic' },
    ],
    already_covered: [{ id: 5, title: 'Access policy', doc_type: 'policy', status: 'approved' }, { id: 6, title: 'Backup policy', doc_type: 'policy', status: 'draft' }],
  });
  assert.deepEqual(out.map((c) => [c.suggested, c.title, c.status, c.href, c.how]), [
    ['Access Policy', 'Access policy', 'Approved', '/governance/documents/5', 'Same title'],
    ['Encryption Policy', 'Encryption', 'Being written in the studio', '/governance/documents/studio/9', 'Same subject'],
    [null, 'Backup policy', 'Draft', '/governance/documents/6', 'Already there'],            // a document already shown as a skip is not listed twice
  ]);
  assert.deepEqual(leftOut(null), []);
});

test('the body that makes the document keeps what the person confirmed and only what they gave', () => {
  const form = { title: '  Access Control Policy ', doc_type: 'policy', description: ' Who may reach the systems. ', owner_id: 4, department_id: null, parent_document_id: null,
    classification: 'confidential', review_cycle_months: 24, effective_date: '2026-12-01', next_review_date: '' };
  const signoff = { reviewers: [{ target_type: 'user', target_id: 2, display: 'Sara' }], approvers: [] };
  assert.deepEqual(createBody(form, S('x', 'policy', 'high', ['A.5.15', '', 'A.5.16']), [1, 2, 1], signoff), {
    title: 'Access Control Policy', doc_type: 'policy', description: 'Who may reach the systems.', framework_ids: [1, 2], controls: ['A.5.15', 'A.5.16'],
    details: { owner_id: 4, classification: 'confidential', review_cycle_months: 24, effective_date: '2026-12-01' }, signoff,
  });
  assert.equal('signoff' in createBody(form, S('x', 'policy', 'high'), [1], { reviewers: [], approvers: [] }), false);
  assert.equal('parent_document_id' in createBody(form, S('x', 'policy', 'high'), [1]), false);
  assert.equal(createBody({ ...form, parent_document_id: 12 }, S('x', 'policy', 'high'), [1]).parent_document_id, 12);          // the document it sits under
});

test('the library document starts with the details typed when the document was made from a suggestion', () => {
  assert.deepEqual(detailsOfSession({ details: { owner_id: 4, department_id: 7, classification: 'confidential', review_cycle_months: 24, effective_date: '2026-12-01', owner_name: 'x' } }),
    { owner_id: 4, department_id: 7, classification: 'confidential', review_cycle_months: 24, effective_date: '2026-12-01' });
  assert.deepEqual(detailsOfSession({}), {});
  assert.deepEqual(detailsOfSession(null), {});
  assert.deepEqual(detailsOfSession({ details: { owner_id: '4', review_cycle_months: null } }), {});                  // wrong shapes are ignored
});
