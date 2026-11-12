import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exitPlanReady, lossEventProblem, materialityChanges, materialityWord, needsMeeting, netLoss, noticeReady, openRows, outsourcingRows,
  reasonReady,
} from './outsourcingModel.ts';

const values = (o: Parameters<typeof outsourcingRows>[0]) => outsourcingRows(o).map((r) => [r.key, r.value, r.open]);

test('an unclassified scope asks for its materiality and nothing else', () => {
  assert.equal(materialityWord(null), 'Not classified');
  assert.deepEqual(values({ critical_important: null }), [
    ['materiality', 'Not classified', true], ['exit_plan', 'Depends on materiality', false],
    ['sub_outsourcing', 'Depends on materiality', false], ['regulator', 'Depends on materiality', false]]);
  assert.deepEqual(values({ critical_important: false }).slice(1).map((r) => r[1]), ['Not required', 'Not required', 'Not required']);
  assert.equal(openRows({ critical_important: false }), 0);
});

test('a critical or important scope shows what is still owed', () => {
  assert.deepEqual(values({ critical_important: true, sub_outsourcers: [] }), [
    ['materiality', 'Critical or important', false], ['exit_plan', 'None yet', true],
    ['sub_outsourcing', 'None listed', false], ['regulator', 'Not decided', true]]);
  const ready = {
    critical_important: true, exit_plan: { status: 'tested' }, regulator: { required: true, sent_on: '2026-11-02' },
    sub_outsourcers: [{ id: 1, name: 'AWS', approval_status: 'approved' as const }],
  };
  assert.deepEqual(values(ready).slice(1), [['exit_plan', 'Tested', false], ['sub_outsourcing', '1 approved', false],
    ['regulator', 'Sent 2026-11-02', false]]);
  assert.equal(openRows(ready), 0);
  const subs = [{ id: 1, name: 'AWS', approval_status: 'pending' as const }, { id: 2, name: 'Old host', approval_status: 'rejected' as const }];
  assert.deepEqual(values({ critical_important: true, sub_outsourcers: subs, exit_plan: { status: 'draft' }, regulator: { required: true } }).slice(1),
    [['exit_plan', 'Draft', true], ['sub_outsourcing', '1 rejected', true], ['regulator', 'Due before go-live', true]]);
});

test('the forms take what the server takes', () => {
  assert.equal(reasonReady('too short'), false);
  assert.equal(reasonReady('Runs card authorisation'), true);
  assert.equal(exitPlanReady('approved', '', ''), false);
  assert.equal(exitPlanReady('approved', '', 'https://dms/exit-plan'), true);
  assert.equal(exitPlanReady('draft', '', ''), true);
  assert.equal(exitPlanReady('draft', '', 'not a link'), false);
  assert.equal(noticeReady(null, '', '2026-11-11'), false);
  assert.equal(noticeReady(true, '2026-11-12', '2026-11-11'), false);
  assert.equal(noticeReady(true, '2026-11-11', '2026-11-11'), true);
  assert.equal(noticeReady(false, '', '2026-11-11'), true);
  assert.equal(needsMeeting(true, 'approve_with_conditions'), true);
  assert.equal(needsMeeting(true, 'defer'), false);
  assert.equal(needsMeeting(null, 'approve'), false);
});

test('a changed materiality is the one that reopens an approval, as on the server', () => {
  assert.equal(materialityChanges(false, true), true);
  assert.equal(materialityChanges(true, false), true);
  assert.equal(materialityChanges(null, true), false);        // a first answer is not a change
  assert.equal(materialityChanges(undefined, true), false);
  assert.equal(materialityChanges(null, false), false);
  assert.equal(materialityChanges(true, true), false);
  assert.equal(materialityChanges(false, null), false);
});

test('a loss event nets recoveries off the gross and needs a currency for money', () => {
  assert.equal(netLoss('120000', '20000'), 100000);
  assert.equal(netLoss('100', '250'), 0);
  assert.equal(netLoss('', '5'), null);
  assert.equal(lossEventProblem('100', '', ''), 'Give the currency, such as USD.');
  assert.equal(lossEventProblem('-1', '', 'USD'), 'Amounts are numbers, zero or more.');
  assert.equal(lossEventProblem('abc', '', 'USD'), 'Amounts are numbers, zero or more.');
  assert.equal(lossEventProblem('100', '10', 'pkr'), null);
  assert.equal(lossEventProblem('', '', ''), null);
});
