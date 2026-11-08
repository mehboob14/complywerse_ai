// node --test "src/components/issue-management/embedModel.test.ts"
// What the shared "Issues on a record" card, "Create issue" button + drawer and the "N open" badge decide: which records can raise an issue, what the form starts with, what it sends, what it
// checks, what it announces, which rows the card draws and how late they are, where "View all" goes, what the badge says.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LINK_FAMILIES, NO_LINKS, PANEL_ROWS, badgeView, canCreateFrom, createBody, createdMessage, draftErrors, hoursWords, initialDraft, isDirty, lateWords, linkCount, panelView,
  severityPreview, sourceDefaults, sourceNoun, viewAllHref, type BySourcePayload, type IssueRow, type MatrixCell,
} from './embedModel.ts';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const row = (over: Partial<IssueRow> = {}): IssueRow => ({ id: 1, code: 'ISS-0001', title: 'Weak TLS', severity: 'high', workflow_state: 'in_progress', target_closure_date: null, ...over });

test('evidence, vendors and projects list issues but cannot raise one; every other record can', () => {
  for (const s of ['evidence', 'vendor', 'is_project']) assert.equal(canCreateFrom(s), false, s);
  for (const s of ['vulnerability', 'risk', 'asset', 'control_internal', 'control_framework', 'governance_document', 'policy_statement', 'risk_incident']) assert.equal(canCreateFrom(s), true, s);
});

test('the form starts with the page\'s presets, else the source\'s defaults, else what the Issues page has always started with', () => {
  assert.deepEqual([sourceDefaults('risk'), sourceDefaults('asset'), sourceDefaults(null)], [
    { issue_type: 'non_conformance', category: 'operations' }, { issue_type: 'incident', category: 'operations' }, { issue_type: 'incident', category: 'security' },
  ]);
  assert.deepEqual(sourceDefaults('control_internal'), { issue_type: 'non_conformance', category: 'regulatory' });
  assert.deepEqual(sourceDefaults('is_project'), { issue_type: 'process_gap', category: 'operations' });
  const risk = initialDraft('risk', { title: 'Payments outage', category: 'operations', issue_type: 'audit_finding' });
  assert.deepEqual([risk.title, risk.issue_type, risk.category, risk.impact, risk.urgency], ['Payments outage', 'audit_finding', 'operations', 'medium', 'medium'], 'the page\'s preset wins');
  const bare = initialDraft('risk');
  assert.deepEqual([bare.title, bare.issue_type, bare.category], ['', 'non_conformance', 'operations']);
  assert.equal(linkCount(bare.links), 0);
  assert.deepEqual(Object.keys(NO_LINKS()), LINK_FAMILIES.map((f) => f.key));
});

test('the noun of a record reads in a sentence ("Linked to this risk"), and an unknown type reads "record"', () => {
  assert.deepEqual(['risk', 'control_parsed', 'governance_document', 'is_project', 'risk_incident', 'spaceship'].map(sourceNoun), ['risk', 'control', 'document', 'project', 'incident', 'record']);
});

test('the title is required and fits the column; a changed severity needs its reason; nothing else blocks the save', () => {
  const d = initialDraft('risk');
  assert.deepEqual(draftErrors(d), { title: 'Enter a title.' });
  assert.deepEqual(draftErrors({ ...d, title: '   ' }), { title: 'Enter a title.' });
  assert.deepEqual(draftErrors({ ...d, title: 'x'.repeat(256) }), { title: 'Keep the title under 255 characters.' });
  assert.deepEqual(draftErrors({ ...d, title: 'x'.repeat(255) }), {});
  assert.deepEqual(draftErrors({ ...d, title: 'A', override: 'critical' }), { overrideReason: 'Say why the severity is changed.' });
  assert.deepEqual(draftErrors({ ...d, title: 'A', override: 'critical', overrideReason: 'Board decision' }), {});
});

test('the body carries what the server reads, leaves out what is empty, and sends the picks as numbers', () => {
  const d = { ...initialDraft('risk', { title: ' Payments outage ' }), description: 'Down for 2 hours', impact: 'high', urgency: 'low' };
  assert.deepEqual(createBody(d), { title: 'Payments outage', description: 'Down for 2 hours', impact: 'high', urgency: 'low', issue_type: 'non_conformance', category: 'operations' });
  const full = createBody({ ...d, override: 'critical', overrideReason: ' Board decision ', assignee: '7', due: '2026-12-01', links: { ...NO_LINKS(), linked_asset_ids: ['3', '4'], linked_task_ids: ['9'] } });
  assert.equal(full.severity_override, 'critical');
  assert.equal(full.severity_override_reason, 'Board decision');
  assert.equal(full.assignee_id, 7);
  assert.equal(full.due_date, '2026-12-01');
  assert.deepEqual(full.linked_asset_ids, [3, 4]);
  assert.deepEqual(full.linked_task_ids, [9]);
  assert.ok(!('linked_risk_ids' in full) && !('linked_vendor_ids' in createBody(d)), 'an empty list is not sent');
  assert.ok(!('severity_override' in createBody(d)) && !('assignee_id' in createBody(d)) && !('due_date' in createBody(d)));
});

test('every link family is a key the server reads, once', () => {
  const keys = LINK_FAMILIES.map((f) => f.key);
  assert.equal(new Set(keys).size, 10);
  assert.deepEqual([...keys].sort(), [
    'linked_asset_ids', 'linked_evidence_ids', 'linked_governance_document_ids', 'linked_internal_control_ids', 'linked_is_project_ids', 'linked_policy_statement_ids',
    'linked_risk_ids', 'linked_task_ids', 'linked_vendor_ids', 'linked_vulnerability_ids',
  ]);
});

test('the form is dirty once something was typed or chosen, and clean again when it is put back', () => {
  const opened = initialDraft('risk', { title: 'Payments outage' });
  assert.equal(isDirty(opened, initialDraft('risk', { title: 'Payments outage' })), false);
  assert.equal(isDirty(opened, { ...opened, description: 'x' }), true);
  assert.equal(isDirty(opened, { ...opened, assignee: '3' }), true);
  assert.equal(isDirty(opened, { ...opened, links: { ...NO_LINKS(), linked_risk_ids: ['1'] } }), true);
  assert.equal(isDirty({ ...opened, description: 'x' }, { ...opened, description: 'x' }), false);
});

test('the severity the form announces is the tenant\'s matrix cell; unread means no announcement', () => {
  const cells: MatrixCell[] = [
    { impact: 'high', urgency: 'high', severity: 'critical', sla_resolve_hours: 24 },
    { impact: 'medium', urgency: 'medium', severity: 'medium', sla_resolve_hours: 168 },
  ];
  assert.deepEqual(severityPreview(cells, 'high', 'high'), { severity: 'critical', hours: 24 });
  assert.equal(severityPreview(cells, 'low', 'low'), null);
  assert.equal(severityPreview(undefined, 'high', 'high'), null);
  assert.equal(severityPreview(null, 'high', 'high'), null);
});

test('time is said the way a person plans it', () => {
  assert.deepEqual([1, 24, 47, 48, 72, 168, 335, 336, 504, 1440].map(hoursWords), ['1 hour', '24 hours', '47 hours', '2 days', '3 days', '7 days', '14 days', '2 weeks', '3 weeks', '9 weeks']);
  assert.equal(hoursWords(0), '1 hour');
});

test('late: the server\'s live "overdue" wins over the stored flag; days are whole; nothing says late for a closed or timely issue', () => {
  const three = '2026-11-05T11:00:00';                                                  // naive UTC, 3 days and 1 hour before NOW
  assert.equal(lateWords(row({ overdue: true, target_closure_date: three }), NOW), 'Overdue 3 d');
  assert.equal(lateWords(row({ overdue: true, target_closure_date: '2026-11-08T08:00:00' }), NOW), 'Overdue', 'passed today');
  assert.equal(lateWords(row({ overdue: true, target_closure_date: null }), NOW), 'Overdue');
  assert.equal(lateWords(row({ overdue: false, sla_breached: true, target_closure_date: three }), NOW), null, 'the flag is a stale record of an old save');
  assert.equal(lateWords(row({ sla_breached: true, target_closure_date: three }), NOW), 'Overdue 3 d', 'an older server sends only the flag');
  assert.equal(lateWords(row({ target_closure_date: three }), NOW), null);
});

test('the card draws the first five open issues and the server\'s true totals, and says how many it does not draw', () => {
  const open = Array.from({ length: 8 }, (_, i) => row({ id: i + 1, code: `ISS-000${i + 1}`, assignee_name: i === 0 ? ' B. Ali ' : null }));
  const payload: BySourcePayload = { open, closed: [row({ id: 90, workflow_state: 'closed' })], total_open: 340, total_closed: 12, critical_open: 4 };
  const v = panelView(payload, NOW);
  assert.equal(v.rows.length, PANEL_ROWS);
  assert.deepEqual([v.totalOpen, v.criticalOpen, v.totalClosed, v.hidden], [340, 4, 12, 335], 'counts are the server\'s, not the length of the list it sent');
  assert.equal(v.rows[0].assignee, 'B. Ali');
  assert.equal(v.rows[1].assignee, null, 'Unassigned is drawn by the person chip, not stored as a word');
  assert.equal(v.closedRows.length, 1);
  assert.equal(panelView({ open: [], closed: [], total_open: 0, total_closed: 0, critical_open: 0 }, NOW).hidden, 0);
  assert.equal(panelView({ open: [row({ workflow_state: undefined as unknown as string })], closed: [], total_open: 1, total_closed: 0, critical_open: 0 }, NOW).rows[0].state, 'new', 'an old row with no state is a new one');
});

test('"View all" opens the register filtered to this record', () => {
  assert.equal(viewAllHref('risk', 7), '/issues/register?linked=risk:7');
  assert.equal(viewAllHref('control_internal', 12), '/issues/register?linked=control_internal:12');
});

test('the badge: hidden at zero, red with a critical issue, amber otherwise, and named in words', () => {
  assert.equal(badgeView({ total_open: 0, critical_open: 0, total_closed: 3 }), null);
  assert.deepEqual(badgeView({ total_open: 0, critical_open: 0, total_closed: 3 }, false), { label: '0 open', tone: 'neutral', name: '0 open issues' });
  assert.deepEqual(badgeView({ total_open: 1, critical_open: 0, total_closed: 0 }), { label: '1 open', tone: 'warning', name: '1 open issue' });
  assert.deepEqual(badgeView({ total_open: 4, critical_open: 2, total_closed: 0 }), { label: '4 open', tone: 'danger', name: '4 open issues, 2 critical' });
});

test('the confirmation names the issue by its code when it has one', () => {
  assert.equal(createdMessage('ISS-0042'), 'Issue ISS-0042 created');
  assert.equal(createdMessage(null), 'Issue created');
});
