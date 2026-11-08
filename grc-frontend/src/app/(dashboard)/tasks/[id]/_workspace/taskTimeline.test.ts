// node --test "src/app/(dashboard)/tasks/[id]/_workspace/taskTimeline.test.ts"
// A task's Activity: the comments and the history in ONE feed, newest first, every history row said in words, no field name, id or Python text on a screen (rule U1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { feedCounts, feedOf, historyWords } from './taskTimeline.ts';
import type { HistoryRow } from './taskPageModel.ts';

const user = (id: number, name: string) => ({ id, display_name: name, username: name.toLowerCase(), email: `${name.toLowerCase()}@x.test` });
let n = 0;
const row = (h: Partial<HistoryRow> & { action: string }): HistoryRow => ({ id: ++n, field_changed: null, old_value: null, new_value: null, old_label: null, new_label: null, user: user(1, 'Rana'), created_at: '2026-11-03T09:00:00', ...h });

test('people are named by the server\'s labels: owners changed, a reviewer set, a reviewer removed', () => {
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'assigned_user_ids', old_value: '[4]', new_value: '[4, 7]', old_label: 'Omar Khan', new_label: 'Omar Khan, Hina Shah' })), 'changed the owners from Omar Khan to Omar Khan, Hina Shah');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'reviewer_id', old_value: null, new_value: '7', old_label: 'Nobody', new_label: 'Hina Shah' })), 'set the reviewer to Hina Shah');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'reviewer_id', old_value: '7', new_value: null, old_label: 'Hina Shah', new_label: 'Nobody' })), 'removed the reviewer (it was Hina Shah)');
  assert.equal(historyWords(row({ action: 'Bulk Assign', field_changed: 'assigned_owner_id', old_value: '4', new_value: '9', old_label: 'Omar Khan', new_label: 'Sara Lee' })), 'changed the owners from Omar Khan to Sara Lee');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'assigned_owner_id', old_value: '4', new_value: '9' })), 'changed the owners', 'without the server\'s labels no id is shown');
});

test('a due date is written as the platform writes a date; a status is the registry\'s word; a priority is as stored', () => {
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'due_date', old_value: '2026-11-03 00:00:00', new_value: '2026-11-12 00:00:00' })), 'changed the due date from 3 Nov 2026 to 12 Nov 2026');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'due_date', old_value: null, new_value: '2026-11-12 00:00:00' })), 'set the due date to 12 Nov 2026');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'due_date', old_value: '2026-11-12 00:00:00', new_value: 'None' })), 'removed the due date (it was 12 Nov 2026)');
  assert.equal(historyWords(row({ action: 'Status Changed', field_changed: 'status', old_value: 'In Progress', new_value: 'Under Review' })), 'moved the task from In progress to Under review');
  assert.equal(historyWords(row({ action: 'Bulk Status Change', field_changed: 'status', old_value: 'Open', new_value: 'In Progress' })), 'moved the task from Open to In progress');
  assert.equal(historyWords(row({ action: 'Bulk Update', field_changed: 'priority', old_value: 'Medium', new_value: 'High' })), 'changed the priority from Medium to High');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'sla_days', old_value: '30', new_value: '14' })), 'changed the SLA days from 30 days to 14 days');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'approval_required', old_value: 'False', new_value: 'True' })), 'changed the approval requirement from not required to required');
});

test('long text is not quoted: a title is, cut; a description, notes and custom fields only say they changed; a link says it was set, removed or swapped, never an id', () => {
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'title', old_value: 'Old', new_value: 'New' })), 'renamed the task from “Old” to “New”');
  assert.match(historyWords(row({ action: 'Updated', field_changed: 'title', old_value: 'x'.repeat(300), new_value: 'y' })) as string, /^renamed the task from “x{79}…” to “y”$/);
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'description', old_value: 'long long', new_value: 'longer' })), 'edited the description');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'evidence_notes', old_value: 'a', new_value: 'b' })), 'edited the notes');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'custom_values', old_value: "{'a': 1}", new_value: "{'a': 2}" })), 'changed the custom fields');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'linked_risk_id', old_value: null, new_value: '12' })), 'linked a risk');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'linked_control_id', old_value: '12', new_value: 'None' })), 'removed the linked control');
  assert.equal(historyWords(row({ action: 'Updated', field_changed: 'linked_vulnerability_id', old_value: '12', new_value: '13' })), 'changed the linked vulnerability');
});

test('the actions the platform writes itself: created, from a template or a module, sub-task, approval, escalation, a repeat, a document request, a sync', () => {
  assert.equal(historyWords(row({ action: 'Created', new_value: 'Patch ACME' })), 'created the task');
  assert.equal(historyWords(row({ action: 'Created from Template', new_value: 'Policy Review' })), 'created the task from the template “Policy Review”');
  assert.equal(historyWords(row({ action: 'Created from Template', new_value: 'custom' })), 'created the task from a template');
  assert.equal(historyWords(row({ action: 'Created from governance documents', field_changed: 'source_entity', new_value: 'Document #9' })), 'created the task from a document request');
  assert.equal(historyWords(row({ action: 'Created from committees', field_changed: 'source_entity', new_value: 'OversightAction #12' })), 'created the task from a committee action');
  assert.equal(historyWords(row({ action: 'Created from regulatory_changes', field_changed: 'source_entity', new_value: 'RegulatoryImplementationTask #3' })), 'created the task from a regulatory change');
  assert.equal(historyWords(row({ action: 'Created from Risk Register', field_changed: 'source_entity', new_value: 'Risk #3' })), 'created the task from the risk register');
  assert.equal(historyWords(row({ action: 'Sub-task Added', new_value: 'Collect logs' })), 'added the sub-task “Collect logs”');
  assert.equal(historyWords(row({ action: 'Approval Requested', field_changed: 'approval_status', new_value: 'Pending' })), 'asked for approval');
  assert.equal(historyWords(row({ action: 'Approved', field_changed: 'approval_status', old_value: 'Pending', new_value: 'Approved' })), 'approved the task');
  assert.equal(historyWords(row({ action: 'Rejected', field_changed: 'approval_status', old_value: 'Pending', new_value: 'Rejected' })), 'refused the approval');
  assert.equal(historyWords(row({ action: 'Auto-Escalated', field_changed: 'escalation_level', old_value: '1', new_value: '2', user: null })), 'raised the escalation to level 2');
  assert.equal(historyWords(row({ action: 'Auto-Created', field_changed: 'recurrence', new_value: 'Repeated from “Weekly review”' })), 'created this task because “Weekly review” repeats');
  assert.equal(historyWords(row({ action: 'Completed in the document', field_changed: 'status', old_value: 'Open', new_value: 'Completed' })), 'completed the request in the document');
  assert.equal(historyWords(row({ action: 'Reopened: complete this in the document', field_changed: 'status', old_value: 'Completed', new_value: 'Open' })), 'reopened the request: it is completed in the document');
  assert.equal(historyWords(row({ action: 'Synced from Committees', field_changed: 'priority', old_value: 'Low', new_value: 'High' })), 'changed the priority from Low to High (from a committee action)');
  assert.equal(historyWords(row({ action: 'Synced from Committees', field_changed: 'assigned_user_ids', old_value: '[1]', new_value: '[1, 2]', old_label: 'Rana', new_label: 'Rana, Omar' })), 'changed the owners from Rana to Rana, Omar (from a committee action)');
  assert.equal(historyWords(row({ action: 'Synced from Regulatory Changes', field_changed: 'status', old_value: 'Open', new_value: 'In Progress' })), 'moved the task from Open to In progress (from a regulatory change)');
});

test('a comment is its own row: the "Comment Added" change is left out; an action nobody listed still reads as a sentence', () => {
  assert.equal(historyWords(row({ action: 'Comment Added' })), null);
  assert.equal(historyWords(row({ action: 'Something New' })), 'something New');
  assert.equal(historyWords(row({ action: 'Something New', field_changed: 'priority', old_value: 'Low', new_value: 'High' })), 'changed the priority from Low to High');
});

test('no sentence shows a field name, an id, a Python value or an empty quote', () => {
  const rows: HistoryRow[] = [
    row({ action: 'Updated', field_changed: 'assigned_owner_id', old_value: '4', new_value: '7', old_label: 'Omar', new_label: 'Sara' }),
    row({ action: 'Updated', field_changed: 'reviewer_id', old_value: 'None', new_value: '7' }),
    row({ action: 'Updated', field_changed: 'source_entity_id', old_value: '3', new_value: '4' }),
    row({ action: 'Updated', field_changed: 'source_module', old_value: 'Manual', new_value: 'Risk Register' }),
    row({ action: 'Updated', field_changed: 'approval_required', old_value: 'True', new_value: 'False' }),
    row({ action: 'Updated', field_changed: 'recurrence_interval', old_value: '1', new_value: '2' }),
    row({ action: 'Updated', field_changed: 'linked_framework_id', old_value: null, new_value: '4' }),
    row({ action: 'Updated', field_changed: 'some_future_field_id', old_value: '4', new_value: '5' }),
  ];
  for (const r of rows) {
    const words = historyWords(r) as string;
    assert.ok(words.length > 0, r.field_changed ?? '');
    assert.doesNotMatch(words, /_id\b|_value|#\d|\bNone\b|\bTrue\b|\bFalse\b|\[\d|“”/, `${r.field_changed}: ${words}`);
  }
});

test('the feed merges comments and history, newest first; Comments shows the comments alone; the counts are the rows each filter holds', () => {
  const task = {
    comments: [
      { id: 1, content: 'Please attach the logs', user: user(2, 'Omar'), created_at: '2026-11-04T10:00:00' },
      { id: 2, content: 'Done', user: user(3, 'Hina'), created_at: '2026-11-06T08:30:00' },
    ],
    history: [
      row({ id: 10, action: 'Created', created_at: '2026-11-03T09:00:00' }),
      row({ id: 11, action: 'Comment Added', created_at: '2026-11-04T10:00:00' }),
      row({ id: 12, action: 'Comment Added', created_at: '2026-11-06T08:30:00' }),
      row({ id: 13, action: 'Status Changed', field_changed: 'status', old_value: 'Open', new_value: 'In Progress', created_at: '2026-11-05T12:00:00' }),
    ],
  };
  const all = feedOf(task, 'all');
  assert.deepEqual(all.map((r) => r.key), ['c2', 'h13', 'c1', 'h10']);
  assert.deepEqual(all.map((r) => r.kind), ['comment', 'event', 'comment', 'event']);
  assert.equal(all[0].text, 'Done');
  assert.equal(all[0].who, 'Hina');
  assert.deepEqual(feedOf(task, 'comments').map((r) => r.key), ['c2', 'c1']);
  assert.deepEqual(feedCounts(task), { comments: 2, all: 4 });
  assert.deepEqual(feedOf({ comments: null, history: undefined }, 'all'), []);
});

test('a row with no time sorts last; two rows at the same moment keep the later id first; the platform has no name', () => {
  const feed = feedOf({
    comments: [],
    history: [
      row({ id: 1, action: 'Created', created_at: null }),
      row({ id: 2, action: 'Approval Requested', created_at: '2026-11-03T09:00:00' }),
      row({ id: 3, action: 'Auto-Escalated', field_changed: 'escalation_level', old_value: '0', new_value: '1', created_at: '2026-11-03T09:00:00', user: null }),
    ],
  }, 'all');
  assert.deepEqual(feed.map((r) => r.key), ['h3', 'h2', 'h1']);
  assert.equal(feed[0].who, null);
});

// ── every action the server writes has words ───────────────────────────────────────────────────────────────────────────────────────────────
const LISTED = [
  'Created', 'Created from Template', 'Created from ', 'Updated', 'Status Changed', 'Sub-task Added', 'Comment Added', 'Auto-Escalated', 'Auto-Created', 'Approval Requested', 'Approved', 'Rejected',
  'Bulk Update', 'Bulk Status Change', 'Bulk Assign', 'Completed in the document', 'Reopened: complete this in the document', 'Synced from ',
];
test('every action the platform writes into a task\'s history is one this file words (the backend files are re-read)', () => {
  const found = new Set<string>();
  for (const file of ['routers/critical_tasks_router.py', 'modules/governance/doc_lifecycle.py', 'modules/governance/regulatory_tasks.py', 'modules/governance/committee_tasks.py']) {
    const src = readFileSync(`../backend/grc/${file}`, 'utf8');
    for (const m of Array.from(src.matchAll(/_(?:add_)?history\(\s*db,\s*[^,]+,\s*[^,]+,\s*(f?)"([^"]+)"/g))) found.add(m[1] ? m[2].replace(/\{[^}]*\}.*$/, '') : m[2]);
    for (const m of Array.from(src.matchAll(/CriticalTaskHistory\([^)]*?action="([^"]+)"/g))) found.add(m[1]);
  }
  // "Created from <a module>" and "Synced from <a module>" are one family each: the module's name is the part that varies
  for (const action of Array.from(found)) {
    if (/^Created from (?!Template$)/.test(action)) { found.delete(action); found.add('Created from '); }
    if (/^Synced from /.test(action)) { found.delete(action); found.add('Synced from '); }
  }
  assert.ok(found.size >= 12, `${found.size} actions found`);
  for (const action of Array.from(found)) assert.ok(LISTED.includes(action), `"${action}" is written by the platform and taskTimeline.ts has no words for it`);
  for (const action of LISTED) {
    const words = historyWords(row({ action: action.endsWith(' ') ? `${action}committees` : action, field_changed: action === 'Updated' ? 'priority' : null, old_value: 'a', new_value: 'b' }));
    if (action === 'Comment Added') assert.equal(words, null);
    else assert.ok(words && words.length > 3, action);
  }
});
