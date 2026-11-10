// node --test "src/lib/auditRegister/queuesModel.test.ts"
// The Issue Register's Queues on synthetic rows: validation (longest waiting first), extension requests (oldest first, then those whose regulator must be told), owner names to map
// (most findings first), and the badge that adds them up from the same lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RegisterRow } from './registerDef.ts';
import { extensionQueue, ownersToMap, queueCounts, validationQueue, waitedWords, type ExtensionLine } from './queuesModel.ts';

let next = 1;
const row = (over: Partial<RegisterRow> = {}): RegisterRow => ({
  issue_id: next++, code: null, source: 'regulator', record_type: 'issue', regulator: 'OCC', report: 'Report', report_key: 'r1', report_prefill: {}, added_in_platform: false, reference: `MRA-${next}`,
  title: 'Synthetic', risk_rating: 'High', lob: null, owner: 'Rivera, P', owner_id: 7, owner_name: 'Pat Rivera', affected_hosts: null, edited: false, target_date: '2026-03-31', revised_target_date: null,
  ia_status: 'IP', remediation_status: null, validation_status: null, validation_pass_fail: null, aged_status: null, days_past_due: null, status: 'IP', workflow_state: 'in_progress', ...over,
});
const ext = (over: Partial<ExtensionLine> = {}): ExtensionLine => ({
  id: next++, issue_id: 1, status: 'requested', reference: 'MRA-1', title: 'T', source: 'regulator', previous_date: '2026-03-31', requested_date: '2026-06-30', reason: 'More time', decision_notes: null,
  decided_on: null, regulator_notified_on: null, needs_regulator_notice: false, requested_by: 'Pat', created_at: '2026-05-01T10:00:00', meeting: null, ...over,
});

const TODAY = new Date(2026, 10, 10, 12, 0);

test('validation: the longest waiting first; a finding with no date after those that have one; closed ones never', () => {
  const rows = [
    row({ awaiting_validation: true, waiting_since: '2026-11-08', reference: 'A-2' }),
    row({ awaiting_validation: true, waiting_since: '2026-10-01', reference: 'A-1' }),
    row({ awaiting_validation: true, waiting_since: null, reference: 'A-3' }),
    row({ awaiting_validation: true, waiting_since: '2026-10-01', status: 'CD' }),
    row({ awaiting_validation: false }),
  ];
  const queue = validationQueue(rows, TODAY);
  assert.deepEqual(queue.map((q) => q.row.reference), ['A-1', 'A-2', 'A-3']);
  assert.deepEqual(queue.map((q) => q.waitedDays), [40, 2, null]);
});

test('extension requests: waiting ones oldest first, the ones whose regulator must be told next, the rest newest first', () => {
  const lines = [
    ext({ id: 1, created_at: '2026-05-03T10:00:00' }),
    ext({ id: 2, created_at: '2026-05-01T10:00:00' }),
    ext({ id: 3, status: 'approved', needs_regulator_notice: true, created_at: '2026-04-01T10:00:00' }),
    ext({ id: 4, status: 'approved', created_at: '2026-03-01T10:00:00' }),
    ext({ id: 5, status: 'rejected', created_at: '2026-03-15T10:00:00' }),
  ];
  const q = extensionQueue(lines);
  assert.deepEqual(q.waiting.map((x) => x.id), [2, 1]);
  assert.deepEqual(q.toNotify.map((x) => x.id), [3]);
  assert.deepEqual(q.decided.map((x) => x.id), [5, 4]);
  assert.equal(q.waiting.length + q.toNotify.length + q.decided.length, lines.length);
});

test('owner names to map: the most findings first, a name counted once however it is spelled in spaces, matched owners never', () => {
  const rows = [
    row({ owner: 'Nobody Here', owner_id: null }),
    row({ owner: ' Nobody Here ', owner_id: null }),
    row({ owner: 'Zed', owner_id: null }),
    row({ owner: 'Ann', owner_id: null }),
    row({ owner: 'Rivera, P', owner_id: 7 }),
    row({ owner: null, owner_id: null }),
  ];
  assert.deepEqual(ownersToMap(rows), [{ name: 'Nobody Here', findings: 2 }, { name: 'Ann', findings: 1 }, { name: 'Zed', findings: 1 }]);
});

test('the badge adds the three queues, from the requests when they are read and from the rows before', () => {
  const rows = [
    row({ awaiting_validation: true }), row({ awaiting_validation: true }),
    row({ extension_requested: true }),
    row({ owner: 'Nobody', owner_id: null }),
  ];
  assert.deepEqual(queueCounts(rows), { validation: 2, extensions: 1, owners: 1, total: 4 });
  assert.deepEqual(queueCounts(rows, [ext({ id: 1 }), ext({ id: 2 }), ext({ id: 3, status: 'approved' })]), { validation: 2, extensions: 2, owners: 1, total: 5 });
  assert.deepEqual(queueCounts([]), { validation: 0, extensions: 0, owners: 0, total: 0 });
});

test('how long a finding has waited is said in days, and not at all when the server has no date', () => {
  assert.equal(waitedWords(0), 'submitted today');
  assert.equal(waitedWords(1), 'waiting 1 day');
  assert.equal(waitedWords(40), 'waiting 40 days');
  assert.equal(waitedWords(null), null);
});
