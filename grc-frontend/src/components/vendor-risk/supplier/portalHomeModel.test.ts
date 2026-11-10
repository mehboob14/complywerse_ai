// node --test "src/components/vendor-risk/supplier/portalHomeModel.test.ts"
// The supplier's home: ONE "To do" list of questionnaires and requests in the order of their due day, the "Done" list, the numbers beside the tabs, the deep link,
// and the name a download is saved under. Moments are used at midday UTC so the viewer's own day is the same one in every zone from UTC-11 to UTC+11.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deepLink, doneRows, downloadName, dayOf, isLate, tabCounts, todoRows,
  type PortalHome, type PortalQuestionnaire, type PortalRequest,
} from './portalHomeModel.ts';

const NOW = new Date(2026, 10, 12, 10, 0, 0);                    // 12 Nov 2026, the viewer's morning

const q = (id: number, o: Partial<PortalQuestionnaire> = {}): PortalQuestionnaire => ({
  id, title: `Questionnaire ${id}`, status: 'pending', due_date: null, sent_at: null, expires_at: null, submitted_at: null,
  progress: { answered: 0, total: 10 }, returned_questions: 0, open: true, unread: 0, ...o,
});
const r = (id: number, o: Partial<PortalRequest> = {}): PortalRequest => ({
  id, kind: 'document', title: `Request ${id}`, detail: null, evidence_label: null, due_date: null, overdue: false, status: 'open', open: true,
  requested_at: '2026-11-01T09:00:00', responded_at: null, review_note: null, file_count: 0, unread: 0, ...o,
});
const home = (questionnaires: PortalQuestionnaire[], requests: PortalRequest[], unread = 0): PortalHome => ({
  organisation: { name: 'Org' }, supplier: { name: 'Acme' }, contact: { name: 'Sam', email: 's@acme.test' }, expires_at: '2026-12-20T00:00:00',
  questionnaires, requests, messages: { unread, latest: [] },
});

test('a due day is the day as written, or the viewer\'s own day for a moment; nothing is late that has no due day or is due today', () => {
  assert.equal(dayOf('2026-11-30'), '2026-11-30');
  assert.equal(dayOf('2026-11-30T12:00:00'), '2026-11-30');
  assert.equal(dayOf(null), null);
  assert.equal(dayOf('not a date'), null);
  assert.equal(isLate('2026-11-11', NOW), true);
  assert.equal(isLate('2026-11-12', NOW), false);
  assert.equal(isLate('2026-11-12T12:00:00', NOW), false);
  assert.equal(isLate(null, NOW), false);
});

test('questionnaires and requests are one list, soonest due day first, those with no due day last', () => {
  const rows = todoRows(home(
    [q(1, { due_date: '2026-12-05T12:00:00' }), q(2, { due_date: '2026-11-20T12:00:00' })],
    [r(10, { due_date: '2026-11-10', overdue: true }), r(11, { due_date: '2026-11-25' }), r(12)],
  ), NOW);
  assert.deepEqual(rows.map((x) => x.key), ['r-10', 'q-2', 'r-11', 'q-1', 'r-12']);
});

test('on the same day a questionnaire comes before a request, and the server\'s order is kept after that', () => {
  const rows = todoRows(home(
    [q(1, { due_date: '2026-11-20T12:00:00' })],
    [r(10, { kind: 'finding', due_date: '2026-11-20' }), r(11, { kind: 'information', due_date: '2026-11-20' }), r(12, { kind: 'document', due_date: '2026-11-20' })],
  ), NOW);
  assert.deepEqual(rows.map((x) => x.key), ['q-1', 'r-12', 'r-11', 'r-10'], 'questionnaire, then document, information, finding');
  const same = todoRows(home([], [r(5, { due_date: '2026-11-20' }), r(4, { due_date: '2026-11-20' })]), NOW);
  assert.deepEqual(same.map((x) => x.key), ['r-5', 'r-4'], 'the same kind keeps the server\'s order');
});

test('late: a request says so from the server, a questionnaire from its due day', () => {
  const rows = todoRows(home([q(1, { due_date: '2026-11-01T12:00:00' }), q(2, { due_date: '2026-11-12T12:00:00' })], [r(10, { overdue: true, due_date: '2026-11-05' })]), NOW);
  assert.deepEqual(Object.fromEntries(rows.map((x) => [x.key, x.late])), { 'r-10': true, 'q-1': true, 'q-2': false });
});

test('the one action says what the supplier does next', () => {
  const rows = todoRows(home(
    [q(1, { status: 'pending' }), q(2, { status: 'in_progress' }), q(3, { status: 'returned', returned_questions: 3 })],
    [r(10, { kind: 'document' }), r(11, { kind: 'information' }), r(12, { kind: 'finding' })],
  ), NOW);
  const action = Object.fromEntries(rows.map((x) => [x.key, x.action]));
  assert.deepEqual(action, { 'q-1': 'Start', 'q-2': 'Continue', 'q-3': 'Answer', 'r-10': 'Upload', 'r-11': 'Answer', 'r-12': 'Send your plan' });
});

test('a row carries progress (questionnaires with questions), the note the word does not say, and the unread count', () => {
  const [a, b, c] = todoRows(home(
    [q(1, { status: 'returned', returned_questions: 1, progress: { answered: 4, total: 9 }, unread: 2 }), q(2, { progress: { answered: 0, total: 0 } })],
    [r(10, { file_count: 2, unread: 1 })],
  ), NOW);
  assert.deepEqual(a.progress, { answered: 4, total: 9 });
  assert.equal(a.note, '1 question to look at');
  assert.equal(a.unread, 2);
  assert.equal(b.progress, null, 'no questions, no bar');
  assert.equal(c.note, '2 files attached, not sent yet');
  assert.equal(c.unread, 1);
  assert.equal(todoRows(home([], [r(1, { file_count: 1 })]), NOW)[0].note, '1 file attached, not sent yet');
  assert.equal(todoRows(home([], [r(1)]), NOW)[0].note, null);
});

test('only what waits on the supplier and can still be answered is to do; the rest is Done', () => {
  const h = home(
    [q(1), q(2, { status: 'submitted', submitted_at: '2026-11-03T12:00:00', open: false }), q(3, { status: 'accepted', submitted_at: '2026-11-08T12:00:00', open: false }),
      q(4, { status: 'pending', open: false }), q(5, { status: 'under_review', open: false })],
    [r(10), r(11, { status: 'submitted', open: false, responded_at: '2026-11-09T12:00:00' }), r(12, { status: 'cancelled', open: false })],
  );
  assert.deepEqual(todoRows(h, NOW).map((x) => x.key), ['q-1', 'r-10']);
  const done = doneRows(h);
  assert.deepEqual(done.map((x) => x.key), ['r-11', 'q-3', 'q-2', 'q-4', 'q-5', 'r-12'], 'newest first; what has no date keeps the server\'s order, after those that have');
  assert.equal(done.find((x) => x.key === 'q-4')!.word, 'closed', 'waiting but its link has run out');
  assert.equal(done.find((x) => x.key === 'q-5')!.word, 'under_review');
  assert.equal(done.find((x) => x.key === 'r-12')!.word, 'cancelled');
});

test('every item is in exactly one of the two lists', () => {
  const h = home([q(1), q(2, { status: 'returned' }), q(3, { status: 'submitted', open: false }), q(4, { open: false })], [r(1), r(2, { open: false, status: 'accepted' }), r(3, { status: 'returned' })]);
  const all = [...todoRows(h, NOW).map((x) => x.key), ...doneRows(h).map((x) => x.key)].sort();
  assert.deepEqual(all, ['q-1', 'q-2', 'q-3', 'q-4', 'r-1', 'r-2', 'r-3']);
});

test('the numbers beside the tabs: things to do, new messages, things done', () => {
  const h = home([q(1), q(2, { status: 'submitted', open: false })], [r(1), r(2, { open: false, status: 'accepted' })], 3);
  assert.deepEqual(tabCounts(h, NOW), { todo: 2, messages: 3, done: 2 });
});

test('the deep link goes to an open questionnaire or one already sent, never to a closed or unknown one', () => {
  const h = home([q(1), q(2, { status: 'submitted', open: false }), q(3, { status: 'pending', open: false })], []);
  assert.equal(deepLink(h, 1), 1);
  assert.equal(deepLink(h, 2), 2);
  assert.equal(deepLink(h, 3), null);
  assert.equal(deepLink(h, 99), null);
  assert.equal(deepLink(h, 0), null);
  assert.equal(deepLink(h, NaN), null);
});

test('a download is named after the questionnaire, never its id', () => {
  assert.equal(downloadName('Security questionnaire', 'xlsx'), 'Security-questionnaire.xlsx');
  assert.equal(downloadName('Due diligence: 2026 / v2', 'pdf'), 'Due-diligence-2026-v2.pdf');
  assert.equal(downloadName('Sécurité des données', 'pdf'), 'Securite-des-donnees.pdf');
  assert.equal(downloadName(null, 'xlsx'), 'Questionnaire.xlsx');
  assert.equal(downloadName('   ', 'pdf'), 'Questionnaire.pdf');
  assert.equal(downloadName('البيانات', 'xlsx'), 'Questionnaire.xlsx');
  assert.ok(downloadName('x'.repeat(300), 'pdf').length <= 64);
  assert.equal(downloadName('[UXSEED] Annual third-party security, privacy and resilience due diligence questionnaire', 'xlsx'), 'UXSEED-Annual-third-party-security-privacy-and-resilience.xlsx', 'cut at a word');
  assert.doesNotMatch(downloadName('Anything', 'pdf'), /\d/);
});
