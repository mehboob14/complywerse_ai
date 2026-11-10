// node --test "src/components/vendor-risk/supplier/requestModel.test.ts"
// The supplier's request page: what is missing before it can be sent (the server's own rules), the file picked, the dates asked for after it, and the draft of the answer
// that is kept on the device without ever holding the link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ACCEPT, ALLOWED_EXT, EMPTY_ANSWER, MAX_BYTES, NO_DATES, answerOf, datesProblem, draftKey, fileProblem, isDirty, packDraft, readDraft, sendGate, sizeWords,
  type Answer,
} from './requestModel.ts';

const BACKEND = fileURLToPath(new URL('../../../../../backend/grc/modules/vendor_risk/', import.meta.url));
const a = (o: Partial<Answer> = {}): Answer => ({ ...EMPTY_ANSWER, ...o });

test('what is missing is said in the server\'s own words, and nothing is missing once the rule holds', () => {
  assert.equal(sendGate('document', 0, a()), 'Attach the document first.');
  assert.equal(sendGate('document', 1, a()), null);
  assert.equal(sendGate('information', 0, a({ response_text: '  ' })), 'Write your answer or attach a file.');
  assert.equal(sendGate('information', 0, a({ response_text: 'Yes' })), null);
  assert.equal(sendGate('information', 2, a()), null);
  assert.equal(sendGate('finding', 0, a({ plan_text: 'Patch it' })), 'Say how you will fix it and by when.');
  assert.equal(sendGate('finding', 0, a({ target_date: '2026-12-01' })), 'Say how you will fix it and by when.');
  assert.equal(sendGate('finding', 0, a({ plan_text: 'Patch it', target_date: '2026-12-01' })), null);
});

test('the sentences are the ones the server sends', () => {
  const server = readFileSync(`${BACKEND}tpra/supplier_requests.py`, 'utf8');
  for (const words of ['Attach the document first', 'Write your answer or attach a file', 'Say how you will fix it and by when']) {
    assert.ok(server.includes(words), words);
    assert.ok([sendGate('document', 0, a()), sendGate('information', 0, a()), sendGate('finding', 0, a())].some((s) => s?.startsWith(words)), `the page says: ${words}`);
  }
});

test('the allowed file types and the size limit are the server\'s', () => {
  const server = readFileSync(`${BACKEND}routers/questionnaires.py`, 'utf8');
  const listed = /_ALLOWED_EVIDENCE_EXT = \{([^}]*)\}/.exec(server)![1].match(/"\.\w+"/g)!.map((s) => s.replace(/"/g, ''));
  assert.deepEqual([...ALLOWED_EXT].sort(), listed.sort());
  assert.equal(ACCEPT, ALLOWED_EXT.join(','));
  assert.match(server, /_MAX_EVIDENCE_BYTES = 25 \* 1024 \* 1024/);
  assert.equal(MAX_BYTES, 25 * 1024 * 1024);
});

test('a picked file is checked for type, emptiness and size before it travels', () => {
  assert.equal(fileProblem('soc2.PDF', 1000), null);
  assert.equal(fileProblem('report.docx', MAX_BYTES), null);
  assert.match(fileProblem('virus.exe', 10)!, /not accepted/);
  assert.match(fileProblem('noextension', 10)!, /not accepted/);
  assert.equal(fileProblem('a.pdf', 0), 'That file is empty.');
  assert.equal(fileProblem('a.pdf', MAX_BYTES + 1), 'That file is larger than 25 MB.');
});

test('sizes read in plain units', () => {
  assert.equal(sizeWords(null), '');
  assert.equal(sizeWords(512), '512 B');
  assert.equal(sizeWords(340 * 1024), '340 KB');
  assert.equal(sizeWords(1.5 * 1024 * 1024), '1.5 MB');
  assert.equal(sizeWords(2 * 1024 * 1024), '2 MB');
});

test('the dates after a file: all optional, but the period cannot end before it starts', () => {
  assert.equal(datesProblem(NO_DATES), null);
  assert.equal(datesProblem({ ...NO_DATES, coverage_from: '2026-01-01' }), null);
  assert.equal(datesProblem({ ...NO_DATES, expires_on: '2025-01-01' }), null);
  assert.equal(datesProblem({ coverage_from: '2026-06-30', coverage_to: '2026-01-01', expires_on: '' }), 'The period it covers ends before it starts.');
  assert.equal(datesProblem({ coverage_from: '2026-01-01', coverage_to: '2026-01-01', expires_on: '' }), null);
});

test('unsent words are told from the answer the server holds; spaces at the ends are not words', () => {
  assert.equal(isDirty(a({ response_text: 'x ' }), a({ response_text: 'x' })), false);
  assert.equal(isDirty(a({ response_text: 'x!' }), a({ response_text: 'x' })), true);
  assert.equal(isDirty(a({ target_date: '2026-12-01' }), a()), true);
  assert.deepEqual(answerOf({ response_text: null, plan_text: 'p', target_date: null }), a({ plan_text: 'p' }));
});

test('the draft key is not the link and is the same for the same page', () => {
  const link = '/vendor-risk/portal/SECRET-TOKEN-VALUE/requests/12';
  const key = draftKey(link);
  assert.match(key, /^supplier-draft-[0-9a-f]{8}$/);
  assert.equal(draftKey(link), key);
  assert.notEqual(draftKey('/vendor-risk/portal/SECRET-TOKEN-VALUE/requests/13'), key);
  assert.doesNotMatch(key, /SECRET|portal|requests/i);
});

test('a draft comes back only when it was made on top of the answer the server holds now, and says something new', () => {
  const sent = a({ response_text: 'first answer' });
  const typed = a({ response_text: 'first answer, and more' });
  assert.deepEqual(readDraft(packDraft(sent, typed), sent), typed);
  assert.equal(readDraft(packDraft(sent, typed), a({ response_text: 'returned with other words' })), null, 'the request moved on: the old draft is dropped');
  assert.equal(readDraft(packDraft(sent, sent), sent), null, 'nothing new in it');
  assert.equal(readDraft(null, sent), null);
  assert.equal(readDraft('', sent), null);
  assert.equal(readDraft('{not json', sent), null);
  assert.equal(readDraft(JSON.stringify({ sent, typed: { response_text: 5 } }), sent), null);
  assert.deepEqual(readDraft(JSON.stringify({ typed: { response_text: 'only text' } }), EMPTY_ANSWER), a({ response_text: 'only text' }), 'missing parts read as empty');
});
