import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  actOf, actOutcome, actionHref, canDeleteTask, closesWhen, dayOf, isDocumentTask, momentDayOf, momentOf, plainDescription, reassignReport, requestLine, taskButtons,
  withCurrent, withoutLocked, type DocumentRequest,
} from './documentTasks.ts';

const req = (over: Partial<DocumentRequest> = {}): DocumentRequest => ({
  request_id: 9, kind: 'acknowledgement', document_id: 3, document_title: 'Acceptable Use Policy', version: '1.2', status: 'pending',
  user_id: 6, due_date: '2026-10-30T08:15:00', done_at: null, overdue: false, open_href: '/governance/documents/3',
  action_href: '/governance/documents/3?act=ack', action_label: 'Acknowledge', ...over,
});
const docTask = { source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation' };

test('the action link opens the right popup, as the server builds it', () => {
  assert.equal(actionHref(3, 'acknowledgement'), '/governance/documents/3?act=ack');
  assert.equal(actionHref(3, 'review'), '/governance/documents/3?act=sign');
  assert.equal(actionHref(3, 'approval'), '/governance/documents/3?act=sign');
  assert.equal(actOf('ack'), 'ack');
  assert.equal(actOf(' SIGN '), 'sign');
  assert.equal(actOf('delete'), null);
  assert.equal(actOf(null), null);
});

test('only the person asked gets the step button; everyone gets the document', () => {
  assert.deepEqual(taskButtons(req(), 6), [
    { label: 'Acknowledge', href: '/governance/documents/3?act=ack', primary: true },
    { label: 'Open document', href: '/governance/documents/3', primary: false },
  ]);
  assert.deepEqual(taskButtons(req(), 7).map((b) => b.label), ['Open document']);           // an administrator looking at it
  assert.deepEqual(taskButtons(req({ status: 'done', action_href: null }), 6).map((b) => b.label), ['Open document']);
  assert.deepEqual(taskButtons(req(), null).map((b) => b.label), ['Open document']);        // who it is not known yet
  assert.deepEqual(taskButtons(null, 6), []);
  assert.equal(taskButtons(req({ kind: 'approval', action_label: 'Approve and sign', action_href: '/governance/documents/3?act=sign' }), 6)[0].label, 'Approve and sign');
});

test('a document task is deleted by an administrator only; other tasks as before', () => {
  assert.equal(isDocumentTask(docTask), true);
  assert.equal(isDocumentTask({ source_module: 'document_lifecycle', source_entity_type: 'Other' }), false);
  assert.equal(isDocumentTask({ source_module: 'committees' }), false);
  assert.equal(isDocumentTask({ ...docTask, document_request: req() }), true);
  assert.equal(isDocumentTask({ ...docTask, document_request: null }), false);          // no request names it: an ordinary task
  assert.equal(canDeleteTask({ ...docTask, document_request: null }, { isAdmin: false, hasDeleteRight: true }), true);
  assert.equal(canDeleteTask(docTask, { isAdmin: false, hasDeleteRight: true }), false);
  assert.equal(canDeleteTask(docTask, { isAdmin: true, hasDeleteRight: false }), true);
  assert.equal(canDeleteTask({ source_module: null }, { isAdmin: false, hasDeleteRight: true }), true);
  assert.equal(canDeleteTask({ source_module: null }, { isAdmin: false, hasDeleteRight: false }), false);
});

test('the edit form never sends who, when or status for a document task', () => {
  const payload = { title: 'x', priority: 'High', assigned_owner_id: 2, due_date: '2026-11-01', source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation' };
  assert.deepEqual(withoutLocked(docTask, payload), { title: 'x', priority: 'High' });
  assert.deepEqual(withoutLocked({ source_module: null }, payload), payload);
});

test('the edit form keeps the task\'s own category and source selectable, not the first choice', () => {
  const cats = ['Remediation', 'Review', 'Other'];
  assert.deepEqual(withCurrent(cats, 'Compliance'), ['Compliance', 'Remediation', 'Review', 'Other']);   // a document task's default
  assert.deepEqual(withCurrent(cats, 'Review'), cats);
  assert.deepEqual(withCurrent(cats, ''), cats);
  assert.deepEqual(withCurrent(cats, undefined), cats);
});

test('an older task drops its "Open it at /path" sentence; the buttons do that now', () => {
  assert.equal(plainDescription('Acknowledge the document "AUP" (version 1.2). Open it at /governance/documents/3. This task closes when you acknowledge it there.'),
    'Acknowledge the document "AUP" (version 1.2). This task closes when you acknowledge it there.');
  assert.equal(plainDescription('Review the document "AUP" (version 1.0). Open it at /governance/documents/3?tab=lifecycle (its Approvals). This task closes when you sign it there.'),
    'Review the document "AUP" (version 1.0). This task closes when you sign it there.');
  assert.equal(plainDescription('Please acknowledge "AUP", version 1.2, by 30 Oct 2026.'), 'Please acknowledge "AUP", version 1.2, by 30 Oct 2026.');
  assert.equal(plainDescription(null), '');
});

test('a due date in the request\'s words reads as the task page writes dates: 2 Nov 2026, not 02 Nov 2026', () => {
  assert.equal(plainDescription('Please review "AUP", version 1.0, by 02 Nov 2026.'), `Please review "AUP", version 1.0, by ${dayOf('2026-11-02')}.`);
  assert.equal(plainDescription('Due 09 May 2027, then 10 May 2027.'), 'Due 9 May 2027, then 10 May 2027.');
});

test('a moment is written as a date is: "2 Nov 2026", the reader\'s own day of the server\'s UTC time', () => {
  const d = new Date(Date.UTC(2026, 10, 2, 22));             // late in the UTC day: another day east of UTC
  const local = `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getFullYear()}`;
  assert.equal(momentDayOf('2026-11-02T22:00:00'), local);
  assert.equal(momentDayOf('2026-11-02T22:00:00.123456'), local);
  assert.equal(momentDayOf('2026-11-02T22:00:00Z'), local);
  assert.equal(momentDayOf(null), null);
  assert.equal(momentDayOf('not a date'), null);
});

test('a moment with its time reads "2 Nov 2026, 09:05" in the reader\'s own time, never the browser\'s numeric format', () => {
  const d = new Date(Date.UTC(2026, 10, 2, 9, 5));
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = `${momentDayOf('2026-11-02T09:05:00')}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  assert.equal(momentOf('2026-11-02T09:05:00'), local);
  assert.equal(momentOf('2026-11-02T09:05:00.5'), local);
  assert.equal(momentOf('2026-11-02T09:05:00+00:00'), local);
  assert.match(momentOf('2026-11-02T09:05:00') ?? '', /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d\d:\d\d$/);
  assert.equal(momentOf(''), null);
});

test('where the request stands, in a line', () => {
  assert.equal(requestLine(req()), 'Acknowledgement of version 1.2 · due 30 Oct 2026');
  assert.equal(requestLine(req({ overdue: true })), 'Acknowledgement of version 1.2 · due 30 Oct 2026 · overdue');
  assert.equal(requestLine(req({ status: 'done', done_at: '2026-10-21T10:00:00' })), 'Acknowledged on 21 Oct 2026');
  assert.equal(requestLine(req({ kind: 'review', version: null, due_date: null })), 'Review');
  assert.equal(requestLine(req({ kind: 'approval', status: 'rejected', done_at: '2026-10-22T00:00:00' })), 'Rejected on 22 Oct 2026');
  assert.equal(closesWhen(req({ kind: 'review' }), true),
    'This task closes by itself when you review and sign it in the document. Who it is for, its due date and its status follow the request.');
  assert.match(closesWhen(req(), false), /^This task closes by itself when the person asked does it in the document\./);
  assert.equal(closesWhen(req({ status: 'done' }), true), 'Done in the document. There is nothing more to do here.');
});

test('Apply Reassignments says how many could not be moved, and why', () => {
  const locked = 'The person on this task is the one asked in the document. To ask someone else, change the document\'s reviewers or approvers.';
  assert.deepEqual(reassignReport([null, null]), { moved: 2, message: null });
  assert.deepEqual(reassignReport([null, locked, locked]),
    { moved: 1, message: '2 tasks could not be reassigned: they follow a document request.' });
  assert.equal(reassignReport([locked]).message, '1 task could not be reassigned: it follows a document request.');
  assert.equal(reassignReport([locked, '', 'Users [9] do not belong to your tenant']).message,
    '1 task could not be reassigned: it follows a document request. 2 tasks could not be reassigned.');
  assert.deepEqual(reassignReport([]), { moved: 0, message: null });
});

test('?act= opens the person\'s step, or says why it cannot', () => {
  assert.deepEqual(actOutcome({ act: 'ack', myAck: true, myRole: null }), { popup: 'ack' });
  assert.deepEqual(actOutcome({ act: 'sign', myAck: true, myRole: 'approver' }), { popup: 'sign' });
  assert.deepEqual(actOutcome({ act: 'ack', myAck: false, myRole: null, doneOn: '2026-10-21T09:00:00' }),
    { title: 'Already acknowledged', message: 'You acknowledged this document on 21 Oct 2026. There is nothing more to do.' });
  assert.equal((actOutcome({ act: 'ack', myAck: false, myRole: 'reviewer' }) as { title: string }).title, 'Nothing to acknowledge');
  assert.equal((actOutcome({ act: 'sign', myAck: false, myRole: null, doneOn: '2026-10-21' }) as { title: string }).title, 'Already signed');
  assert.equal((actOutcome({ act: 'sign', myAck: true, myRole: null }) as { title: string }).title, 'Not your step now');
  // never asked: no talk of a change since; asked in an earlier round: why the step is gone
  assert.deepEqual(actOutcome({ act: 'sign', myAck: false, myRole: null, asked: false }),
    { title: 'Not your step now', message: 'This document is not waiting for your review or approval.' });
  assert.deepEqual(actOutcome({ act: 'sign', myAck: false, myRole: null, asked: true }),
    { title: 'Not your step now', message: 'This document is not waiting for your review or approval: it was signed, sent back or changed since.' });
});

test('changes asked for: the author is sent to Resubmit, and the task says where it stands', () => {
  assert.equal(actionHref(3, 'changes'), '/governance/documents/3?act=changes');
  assert.equal(actOf('changes'), 'changes');
  assert.deepEqual(actOutcome({ act: 'changes', myAck: false, myRole: null, canResubmit: true }), { popup: 'resubmit' });
  assert.equal((actOutcome({ act: 'changes', myAck: false, myRole: null }) as { title: string }).title, 'Nothing to resubmit');
  assert.equal(requestLine(req({ kind: 'changes', status: 'pending', due_date: '2026-10-30' })), 'Changes asked for of version 1.2 · due 30 Oct 2026');
  assert.equal(requestLine(req({ kind: 'review', status: 'held' })), 'Review of version 1.2 · on hold while changes are made');
  assert.equal(requestLine(req({ kind: 'review', status: 'delegated', done_at: '2026-10-21T09:00:00' })), 'Delegated on 21 Oct 2026');
});
