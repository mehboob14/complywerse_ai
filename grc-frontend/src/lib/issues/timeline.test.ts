// node --test "src/lib/issues/timeline.test.ts"
// The timeline of an issue: every kind of row the server writes says something in words, an older row that knows less says less (never a guess), nothing technical (a field name, an id, JSON)
// reaches a line, a quote carries what a person wrote, and rows group by the viewer's day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { FIELD_WORDS, changeLines, dayLabel, describe, latestItems, timelineDays, type ActivityRow } from './timeline.ts';

const BACKEND = fileURLToPath(new URL('../../../../backend/grc/modules/', import.meta.url));
const row = (type: string, payload: Record<string, unknown> | null = null, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 1, type, payload, user: { display_name: 'Olivia Owner' }, created_at: '2026-11-08T12:00:00', ...over,
});
const TECHNICAL = /[_{}\[\]]|\bid\b|\bnull\b|undefined/;

test('a move names where the issue went and what the person said', () => {
  const said = describe(row('status_change', { from: 'in_progress', to: 'closure_review', notes: 'Ready for sign-off' }));
  assert.deepEqual([said.kind, said.line, said.details, said.quote], ['move', 'Moved to Closure review', ['In progress → Closure review'], 'Ready for sign-off']);
  const bare = describe(row('status_change', { from: 'new', to: 'triage', notes: null }));
  assert.deepEqual([bare.line, bare.details, bare.quote], ['Moved to Triage', ['New → Triage'], null]);
  assert.deepEqual(describe(row('status_change', {})).details, [], 'an older row without the states says no more than it knows');
});

test('closing, reopening and cancelling carry the words that were written', () => {
  assert.deepEqual([describe(row('approved', { closure_notes: 'Patched and verified' })).line, describe(row('approved', { closure_notes: 'Patched and verified' })).quote], ['Approved the closure', 'Patched and verified']);
  assert.deepEqual([describe(row('reopened', { reason: 'It came back' })).kind, describe(row('reopened', { reason: 'It came back' })).quote], ['reopen', 'It came back']);
  assert.equal(describe(row('cancelled', {})).line, 'Cancelled the issue');
});

test('an edit says what changed, from what to what, in the words the screen uses', () => {
  const diff = {
    assignee_id: { old: 'Olivia Owner', new: 'Lina Khan' }, due_date: { old: null, new: '2026-12-01' }, issue_type: { old: 'incident', new: 'non_conformance' },
    impact: { old: 'medium', new: 'high' }, severity: { old: 'medium', new: 'high' }, description: { old: 'a', new: 'b' },
  };
  const lines = changeLines({ diff });
  assert.deepEqual(lines, [
    'Assigned to: Olivia Owner → Lina Khan', 'Due date: Not set → 1 Dec 2026', 'Type: Incident → Non-conformance', 'Impact: Medium → High', 'Severity: Medium → High', 'What happened was edited',
  ]);
  lines.forEach((l) => assert.doesNotMatch(l, TECHNICAL, l));
  assert.equal(describe(row('severity_change', { diff })).line, 'Changed the severity');
  assert.equal(describe(row('updated', { diff })).line, 'Edited the details');
});

test('an older edit (no diff) names the fields and never prints the stored text of the change', () => {
  const stored = { changes: { assignee_id: "{'old': 1, 'new': 2}", title: "{'old': 'a', 'new': 'b'}", severity: "{'computed': 'high', 'final': 'high'}" } };
  assert.deepEqual(changeLines(stored), ['Changed: Assigned to, Title, Severity']);
  assert.deepEqual(changeLines({ changes: { not_a_field: 'x' } }), []);
  assert.deepEqual(changeLines(null), []);
});

test('a link names its kind and, when the row has it, the record; a control removed by its link still reads as a control', () => {
  assert.deepEqual([describe(row('linked', { target_type: 'risk', target_id: 5, name: 'Payments outage' })).line, describe(row('linked', { target_type: 'risk', target_id: 5, name: 'Payments outage' })).details], ['Linked a risk', ['Payments outage']]);
  assert.equal(describe(row('unlinked', { target_type: 'control', target_id: 9 })).line, 'Unlinked a control');
  assert.equal(describe(row('linked', { target_type: 'control_internal', target_id: 9, name: 'Patching' })).line, 'Linked a control');
  assert.equal(describe(row('unlinked', { target_type: 'is_project', target_id: 2 })).line, 'Unlinked a project');
  assert.equal(describe(row('linked', { target_type: 'something_new', target_id: 2 })).line, 'Linked a record', 'a kind nobody listed is still a sentence');
  assert.deepEqual(describe(row('linked_on_create', { risks: 1, assets: 2, controls_internal: 1, tasks: 3 })).details, ['1 risk, 2 assets, 3 tasks, 1 control'].map((s) => s));
});

test('actions: the title, the status they moved between, the notes of a verification', () => {
  assert.deepEqual(describe(row('action_added', { action_id: 4, action_type: 'preventive', title: 'Add a patch window' })).details, ['Add a patch window', 'Preventive action']);
  assert.deepEqual(describe(row('action_status_changed', { title: 'Add a patch window', from: 'planned', to: 'in_progress' })).details, ['Add a patch window', 'Planned → In progress']);
  const verified = describe(row('action_verified', { title: 'Add a patch window', notes: 'Checked on the test host' }));
  assert.deepEqual([verified.line, verified.quote], ['Verified a corrective action', 'Checked on the test host']);
  assert.deepEqual(describe(row('action_promoted_to_task', { action_id: 4, task_id: 11, task_title: '[CAPA] Add a patch window' })).details, ['[CAPA] Add a patch window']);
  assert.equal(describe(row('action_deleted', { title: 'Old step' })).kind, 'action');
});

test('a comment shows its preview as a quote; the audit register rows keep their words', () => {
  assert.deepEqual([describe(row('commented', { comment_preview: 'Waiting on the vendor' })).kind, describe(row('commented', { comment_preview: 'Waiting on the vendor' })).quote], ['comment', 'Waiting on the vendor']);
  assert.deepEqual(describe(row('register_created', { fields: ['a', 'b', 'c'], ai_fields: ['a'] })).details, ['3 columns filled in']);
  assert.equal(describe(row('validation_decision', {})).kind, 'register');
  assert.equal(describe(row('created', { computed_severity: 'high', override: 'critical' })).details[0], 'Severity chosen: Critical');
  assert.deepEqual(describe(row('created', { computed_severity: 'high', override: null })).details, []);
});

test('every type of row the backend writes has a kind and a plain line, and no line carries a key, an id or JSON', () => {
  const written = new Set<string>();
  const files = ['issue_management/routers', 'issue_management/services', 'issue_management/audit_register'];
  for (const dir of files) {
    for (const f of readdirSync(`${BACKEND}${dir}`).filter((n) => n.endsWith('.py'))) {
      const text = readFileSync(`${BACKEND}${dir}/${f}`, 'utf8');
      // _log_activity(db, id, user, "type", {...}) and IssueActivity(... type="x" ...) and kind literals passed to _log_link
      for (const m of Array.from(text.matchAll(/_log_activity\([^"']*?,\s*"([a-z_]+)"/g))) written.add(m[1]);
      for (const m of Array.from(text.matchAll(/IssueActivity\([\s\S]{0,160}?type=["']([a-z_]+)["']/g))) written.add(m[1]);
      for (const m of Array.from(text.matchAll(/_log_link\([^)]*?"(linked|unlinked)"/g))) written.add(m[1]);
    }
  }
  written.add('linked_on_create'); // passed through a variable in issues.py
  assert.ok(written.size > 12, `found ${written.size} types`);
  for (const type of Array.from(written)) {
    const said = describe(row(type, {}));
    assert.ok(said.line.length > 3, type);
    assert.doesNotMatch(said.line, TECHNICAL, `${type}: "${said.line}"`);
    assert.notEqual(said.line, type, `${type} has a sentence of its own`);
  }
  const odd = describe(row('some_new_type', { anything: 1 }));
  assert.equal(odd.line, 'Some new type');
  assert.equal(odd.kind, 'other');
});

test('rows group by the viewer\'s day, newest first, with a time on each and a name for the platform', () => {
  const now = new Date('2026-11-08T12:30:00Z');
  const days = timelineDays([
    row('commented', { comment_preview: 'a' }, { id: 3, created_at: '2026-11-08T12:10:00' }),
    row('status_change', { from: 'new', to: 'triage' }, { id: 2, created_at: '2026-11-08T12:00:00', user: null }),
    row('created', {}, { id: 1, created_at: '2026-11-07T12:00:00' }),
    row('created', {}, { id: 0, created_at: '2026-10-01T12:00:00' }),
    row('created', {}, { id: -1, created_at: 'garbled' }),
  ], now);
  assert.deepEqual(days.map((d) => [d.label, d.items.map((i) => i.id)]), [['Today', [3, 2]], ['Yesterday', [1]], ['1 Oct 2026', [0]], ['Earlier', [-1]]]);
  assert.equal(days[0].items[1].who, 'The platform');
  assert.match(days[0].items[0].time, /^\d{2}:\d{2}$/);
  assert.equal(days[3].items[0].time, '');
  assert.equal(dayLabel(new Date(2026, 10, 8), new Date(2026, 10, 8)), 'Today');
});

test('the Overview shows the newest three', () => {
  const rows = [5, 4, 3, 2, 1].map((id) => row('commented', { comment_preview: String(id) }, { id }));
  assert.deepEqual(latestItems(rows).map((i) => i.id), [5, 4, 3]);
  assert.deepEqual(latestItems([]), []);
  assert.ok(Object.keys(FIELD_WORDS).every((k) => /^[A-Z]/.test(FIELD_WORDS[k])), 'a field is named with a capital');
});
