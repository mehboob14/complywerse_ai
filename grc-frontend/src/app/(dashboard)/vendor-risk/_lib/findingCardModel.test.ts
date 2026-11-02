// node --test "src/app/(dashboard)/vendor-risk/_lib/findingCardModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  acceptNeedsDate, blockingLine, closeNeeds, dueOf, isOpen, isoDay, isSettled, noteRequired, signalStatus, sourceLabel, treatmentLabel,
  signalTypeLabel, waitingLine,
} from './findingCardModel.ts';

const today = new Date(2026, 9, 29, 15, 0);            // 29 Oct 2026, the viewer's afternoon

test('open means still work: raised or being fixed. Accepted and closed are settled', () => {
  assert.deepEqual(['open', 'in_remediation', 'accepted', 'closed'].map(isOpen), [true, true, false, false]);
  assert.deepEqual(['open', 'in_remediation', 'accepted', 'closed'].map(isSettled), [false, false, true, true]);
  assert.equal(isOpen(undefined), false);
});

test('a critical or blocking finding is closed with a note; any other needs one only while no fix is on record', () => {
  assert.equal(noteRequired({ severity: 'critical' }), true);
  assert.equal(noteRequired({ severity: 'medium', is_blocking: true }), true);
  assert.equal(noteRequired({ severity: 'low', is_critical_control_fail: true }), true);
  assert.equal(noteRequired({ severity: 'high' }), false);
  assert.match(closeNeeds({ severity: 'critical', fix_done: true }) ?? '', /critical or blocking/);
  assert.match(closeNeeds({ severity: 'high', fix_done: false }) ?? '', /no fix is recorded/);
  assert.equal(closeNeeds({ severity: 'high', fix_done: true }), null);
});

test('accepting a critical or high finding runs to a date; the others may stay open-ended', () => {
  assert.deepEqual(['critical', 'high', 'medium', 'low', undefined].map(acceptNeedsDate), [true, true, false, false, false]);
});

test('the fix is due on its own date, else when the policy window ends, and late only while open', () => {
  assert.deepEqual(dueOf({ status: 'open', due_date: '2026-11-07T10:00:00', sla_due: '2026-10-01T00:00:00' }, today),
    { date: '2026-11-07T10:00:00', text: 'due in 9 days', overdue: false });
  assert.deepEqual(dueOf({ status: 'in_remediation', sla_due: '2026-10-17T09:00:00' }, today),
    { date: '2026-10-17T09:00:00', text: 'due 12 days ago', overdue: true });
  assert.deepEqual(dueOf({ status: 'open', sla_due: '2026-10-29T08:00:00' }, today), { date: '2026-10-29T08:00:00', text: 'due today', overdue: false });
  assert.deepEqual(dueOf({ status: 'closed', sla_due: '2026-10-17T09:00:00' }, today), { date: null, text: '', overdue: false });
  assert.deepEqual(dueOf({ status: 'accepted', due_date: '2026-10-17T09:00:00' }, today), { date: null, text: '', overdue: false });
  assert.deepEqual(dueOf({ status: 'open' }, today), { date: null, text: '', overdue: false });
});

test('the line over the findings counts the open ones that hold the gate, or the server\'s own total', () => {
  const items = [
    { status: 'open', is_blocking: true }, { status: 'in_remediation', is_blocking: true },
    { status: 'closed', is_blocking: true }, { status: 'open', is_blocking: false },
  ];
  assert.equal(blockingLine(items), '2 blocking the approval gate');
  assert.equal(blockingLine(items, 7), '7 blocking the approval gate');
  assert.equal(blockingLine([{ status: 'open' }]), null);
  assert.equal(blockingLine([], 0), null);
});

test('words for where a finding came from and what is done about it', () => {
  assert.deepEqual(['assessment', 'manual', 'sla_breach', 'signal', 'document_review', 'offboarding'].map(sourceLabel),
    ['Assessment', 'Manual', 'Service level', 'Signal', 'Document review', 'Offboarding']);
  assert.equal(sourceLabel('something_new'), 'Something new');
  assert.deepEqual(['remediate', 'mitigate', 'transfer', 'accept'].map(treatmentLabel), ['Remediate', 'Mitigate', 'Transfer', 'Accept']);
});

test('a date field takes the viewer\'s own day, a number of days on', () => {
  assert.equal(isoDay(0, today), '2026-10-29');
  assert.equal(isoDay(1, today), '2026-10-30');
  assert.equal(isoDay(30, today), '2026-11-28');
  assert.equal(isoDay(3, new Date(2026, 11, 30)), '2027-01-02');
});

test('a signal is new until someone decides, and the panel counts the ones still waiting', () => {
  assert.equal(signalStatus({ status: 'dismissed', acknowledged: true }), 'dismissed');
  assert.equal(signalStatus({ status: 'acknowledged' }), 'acknowledged');
  assert.equal(signalStatus({ acknowledged: true }), 'acknowledged');          // a server without the status field
  assert.equal(signalStatus({ acknowledged: false }), 'new');
  assert.equal(waitingLine([{ status: 'new' }, { status: 'new' }, { status: 'dismissed' }]), '2 waiting on a decision');
  assert.equal(waitingLine([{ status: 'acknowledged' }]), null);
});

test('words for the kind of signal', () => {
  assert.deepEqual(['breach', 'adverse_media', 'security_rating', 'financial', 'sla', 'cert_expiry'].map(signalTypeLabel),
    ['Breach', 'Adverse news', 'Rating change', 'Financial', 'Service level', 'Certificate lapsed']);
  assert.equal(signalTypeLabel('new_kind'), 'New kind');
});
