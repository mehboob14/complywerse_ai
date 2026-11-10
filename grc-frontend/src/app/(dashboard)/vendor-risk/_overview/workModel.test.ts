// node --test "src/app/(dashboard)/vendor-risk/_overview/workModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { actionWork, buildWork, lateCount, queueWork, requestWork } from './workModel.ts';
import type { QueueItem } from '../_lib/attentionModel.ts';

const item = (over: Partial<QueueItem>): QueueItem => ({
  key: 'a:vendor:1', condition: 'reassessment_overdue', label: 'Reassessment overdue', record_type: 'vendor', record_id: 1, vendor_id: 1, vendor_name: 'Acme', vendor_tier: 'high',
  owner_name: 'Dana', assignee_id: null, assignee_name: null, title: 'Reassessment of Acme was due on 01 Nov 2026', badge: 'Due 7 days ago', tone: 'red', since: '2026-11-01',
  link: '/vendor-risk/vendors/1?stage=reassessment', snoozed_until: null, snooze_reason: null, state: 'open', ...over,
});

test('a queue item is one row that opens where the queue sends it; red is late', () => {
  const row = queueWork(item({ assignee_name: 'Sam' }));
  assert.deepEqual([row.kind, row.late, row.rank], [{ label: 'Vendor', tone: 'danger' }, true, 0]);
  assert.equal(row.context, 'Reassessment overdue · Due 7 days ago · High tier · Assigned to Sam · since 1 Nov 2026');
  assert.deepEqual(row.action, { label: 'Open', href: '/vendor-risk/vendors/1?stage=reassessment' });
  const amber = queueWork(item({ key: 'b', tone: 'amber', vendor_tier: null, badge: '', since: '' }));
  assert.deepEqual([amber.kind.tone, amber.late, amber.rank, amber.context], ['warning', false, 3, 'Reassessment overdue']);
  assert.equal(queueWork(item({ record_type: 'finding' })).kind.label, 'Finding');
  assert.equal(queueWork(item({ record_type: 'something_new' })).kind.label, 'Vendor');
});

test('a request is a row for the person to decide, with who asked and the warning when it may be a duplicate', () => {
  const row = requestWork({ id: 4, name: 'Zeta Ltd', requested_by: 'Mo Ali', submitted_at: '2026-11-05T09:00:00', duplicate: true });
  assert.equal(row.href, '/vendor-risk/intake/4');
  assert.deepEqual(row.requester, { name: 'Mo Ali', role: 'Asked by' });
  assert.match(row.context, /May be a duplicate/);
  assert.equal(requestWork({ id: 5, name: 'Y', requested_by: null, submitted_at: null, duplicate: false }).requester, undefined);
});

test('a planned action keeps its own day, is late only when it is past that day, and opens the vendor\'s action plan', () => {
  const base = { id: 7, vendor: { id: 3, name: 'Beta' }, kind_label: 'To-do', title: 'Chase the SOC 2', due_on: '2026-11-08', overdue_days: 0 };
  const today = actionWork(base);
  assert.deepEqual([today.late, today.overdue, today.due, today.rank], [false, false, '2026-11-08', 2]);
  assert.equal(today.href, '/vendor-risk/vendors/3?tab=actions');
  assert.equal(actionWork({ ...base, overdue_days: 2 }).rank, 0);
  assert.equal(actionWork({ ...base, vendor: { id: 3, name: null }, engagement: { name: 'Payments' } }).context, 'A vendor · Payments');
});

test('the list puts late work first, then requests, then actions due, then the rest of the queue; the oldest first inside each; ties never shuffle', () => {
  const rows = buildWork({
    queue: [item({ key: 'q1', title: 'Late queue, newer', since: '2026-11-04' }), item({ key: 'q2', title: 'Late queue, older', since: '2026-10-20' }), item({ key: 'q3', title: 'Quiet', tone: 'amber', since: '2026-09-01' })],
    requests: [{ id: 9, name: 'Zeta', requested_by: 'A', submitted_at: '2026-11-02', duplicate: false }, { id: 8, name: 'Alpha', requested_by: 'A', submitted_at: '2026-11-01', duplicate: false }],
    actions: [{ id: 1, vendor: { id: 1, name: 'V' }, kind_label: 'To-do', title: 'Due today', due_on: '2026-11-08', overdue_days: 0 }, { id: 2, vendor: { id: 1, name: 'V' }, kind_label: 'To-do', title: 'Past', due_on: '2026-11-06', overdue_days: 2 }],
  });
  assert.deepEqual(rows.map((r) => r.key), ['queue:q2', 'queue:q1', 'action:2', 'request:8', 'request:9', 'action:1', 'queue:q3']);
  assert.equal(lateCount(rows), 3);
  assert.deepEqual(buildWork({}), []);
  const again = buildWork({ requests: [{ id: 2, name: 'Same', requested_by: null, submitted_at: '2026-11-01', duplicate: false }, { id: 1, name: 'Same', requested_by: null, submitted_at: '2026-11-01', duplicate: false }] });
  assert.deepEqual(again.map((r) => r.key), ['request:1', 'request:2']);
});

test('a planned action that is due is one row, not two: the queue item that mirrors it is dropped; a failed one and a different action stay', () => {
  const action = { id: 7, vendor: { id: 3, name: 'Beta' }, kind_label: 'To-do', title: 'Chase the SOC 2', due_on: '2026-11-08', overdue_days: 0 };
  const rows = buildWork({
    queue: [item({ key: 'action_due:action:7', condition: 'action_due', record_type: 'action', record_id: 7 }), item({ key: 'action_failed:action:7', condition: 'action_failed', record_type: 'action', record_id: 7 }),
      item({ key: 'action_due:action:8', condition: 'action_due', record_type: 'action', record_id: 8 }), item({ key: 'finding:finding:7', condition: 'critical_finding_past_sla', record_type: 'finding', record_id: 7 })],
    actions: [action],
  });
  assert.deepEqual(rows.map((r) => r.key).sort(), ['action:7', 'queue:action_due:action:8', 'queue:action_failed:action:7', 'queue:finding:finding:7']);
});
