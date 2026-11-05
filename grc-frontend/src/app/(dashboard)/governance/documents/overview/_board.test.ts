// node --test "src/app/(dashboard)/governance/documents/overview/_board.test.ts"
// The Board as data: the request, the words of a card's flags, and where a column, a card and "show all" open.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PARAM_KEYS } from '../_workspace/libraryModel.ts';
import { WHOLE } from './_fixture.ts';
import { CARDS_BOARD, CARDS_SUMMARY, FLAGS, boardParams, cardHref, cardMeta, columnHref, columnNote, columnTitle, flagWords, showAllHref, type BoardCard, type BoardColumn } from './_board.ts';

const card = (over: Partial<BoardCard> = {}): BoardCard => ({
  id: 4, title: 'Doc 4', code: null, doc_type: 'standard', type_label: 'Standard', status: 'pending_review', version: '1.0', department_id: 12, department: 'Helpdesk', owner: 'Ada', next_review: null, flags: [], ...over,
});
const col = (over: Partial<BoardColumn> = {}): BoardColumn => ({ key: 'status:draft', label: 'Draft', value: 'draft', count: 3, cards: [], more: 0, ...over });

test('the request names the scope when there is one, the grouping and how many cards a column lists', () => {
  assert.deepEqual(boardParams('', 'status', CARDS_BOARD), { group: 'status', per: CARDS_BOARD });
  assert.deepEqual(boardParams(' 12 ', 'type', 3), { department_id: '12', group: 'type', per: 3 });
  assert.ok(CARDS_SUMMARY < CARDS_BOARD);
});

test('a card\'s flags are said in words, in the server\'s order; one this page does not know is shown, never dropped', () => {
  assert.deepEqual(flagWords(card({ flags: ['stuck', 'late_approvals', 'no_owner', 'overdue_review'] })).map((f) => f.label), ['Stuck', 'Late approval', 'No owner', 'Review overdue']);
  assert.equal(flagWords(card({ flags: ['stuck'] }))[0].tone, 'danger');
  assert.deepEqual(flagWords(card({ flags: ['something_new'] })).map((f) => [f.key, f.label, f.tone]), [['something_new', 'something new', 'default']]);
  assert.deepEqual(flagWords(card()), []);
  assert.deepEqual(Object.keys(FLAGS), ['stuck', 'on_hold', 'late_approvals', 'late_acknowledgements', 'no_owner', 'overdue_review']);
});

test('a column\'s title: a status in the interface\'s words, anything else as the server named it', () => {
  assert.equal(columnTitle(col({ value: 'pending_review', label: 'In review' }), 'status'), 'In review');
  assert.equal(columnTitle(col({ value: 'exception_applied', label: 'x' }), 'status'), 'Exception');
  assert.equal(columnTitle(col({ value: 'policy', label: 'Policy' }), 'type'), 'Policy');
  assert.equal(columnTitle(col({ value: '11', label: 'Support' }), 'department'), 'Support');
});

test('where a column opens: the library on its status or type; by department the department\'s own board, and nothing for the scope\'s own documents', () => {
  const whole = { scope: WHOLE.scope };
  const inDept = { scope: { ...WHOLE.scope, value: '10', department_id: 10 } };
  assert.equal(columnHref({ ...whole, group: 'status' }, col({ value: 'published' })), '/governance/documents?status=published');
  assert.equal(columnHref({ ...inDept, group: 'status' }, col({ value: 'published' })), '/governance/documents?dept=10&status=published');
  assert.equal(columnHref({ ...inDept, group: 'type' }, col({ value: 'policy' })), '/governance/documents?dept=10&type=policy');
  assert.equal(columnHref({ ...inDept, group: 'type' }, col({ value: '' })), null);                                          // a document with no type has no address
  assert.equal(columnHref({ ...inDept, group: 'department' }, col({ value: '11', own: false })), '/governance/documents/overview?dept=11&view=board');
  assert.equal(columnHref({ ...inDept, group: 'department' }, col({ value: '10', own: true })), null);
  assert.equal(showAllHref({ ...inDept, group: 'department' }, col({ value: '11', own: false })), '/governance/documents?dept=11');      // everything under it
  assert.equal(showAllHref({ ...inDept, group: 'department' }, col({ value: '10', own: true })), null);
  assert.equal(showAllHref({ ...inDept, group: 'status' }, col({ value: 'draft' })), '/governance/documents?dept=10&status=draft');
  for (const href of ['/governance/documents?dept=10&type=policy', '/governance/documents?dept=11']) {
    for (const key of Array.from(new URL(href, 'http://x').searchParams.keys())) assert.ok(PARAM_KEYS.includes(key), key);
  }
});

test('a card opens its document in the library\'s drawer, says what it is under its title, and a column says how many are listed of how many', () => {
  assert.equal(cardHref(card({ id: 7 })), '/governance/documents?open=7');
  assert.equal(cardMeta(card()), 'Standard · v1.0 · Helpdesk');
  assert.equal(cardMeta(card({ version: null, department: null })), 'Standard');
  assert.equal(cardMeta(card({ type_label: '—', version: '2.0', department: 'Support' })), 'v2.0 · Support');
  assert.equal(cardMeta(card(), 'status'), 'Standard · v1.0 · Helpdesk');
  assert.equal(cardMeta(card(), 'type'), 'v1.0 · Helpdesk', 'the column says what kind it is');
  assert.equal(cardMeta(card(), 'department'), 'Standard · v1.0', 'the column says which department');
  assert.equal(columnNote(col({ count: 1, cards: [card()] })), '1 document');
  assert.equal(columnNote(col({ count: 5, cards: [card({ flags: ['stuck'] }), card()], more: 3 })), '5 documents, 1 or more with something wrong');
  assert.equal(columnNote(col({ count: 2, cards: [card({ flags: ['stuck'] }), card()], more: 0 })), '2 documents, 1 with something wrong');
});
