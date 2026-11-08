// node --test "src/components/assessments/workspace/itemModel.test.ts"
// The controls of the workspace: normalising what the server sends, the gap and due-date rules of the server, the patch of an edit, filters, order and groups.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activeFilterCount, domainsOf, draftOf, draftProblem, dueMs, filterItems, groupByDomain, hasChanges, isGap, isOpenGap, neighbours, normaliseItem, NO_FILTERS, patchOf, sortItems,
  statusCounts, type RawItem, type WorkItem,
} from './itemModel.ts';

const raw = (id: number, over: Partial<RawItem> = {}): RawItem => ({
  id, item_number: `C-${id}`, area_domain: 'Access', control_description: `Control ${id}`, compliance_status: 'not_complied', priority: 'high', created_at: '2026-01-01T00:00:00', evidence_count: 0, assignees: [], ...over,
});
const item = (id: number, over: Partial<RawItem> = {}): WorkItem => normaliseItem(raw(id, over));
const NOW = Date.parse('2026-03-01T00:00:00Z');

test('normaliseItem: statuses read in any case, an unanswered or unknown answer is "not answered", an empty domain is Uncategorized', () => {
  assert.equal(item(1, { compliance_status: 'Partially Complied' }).status, 'partially_complied');
  assert.equal(item(1, { compliance_status: 'COMPLIED' }).status, 'complied');
  assert.equal(item(1, { compliance_status: 'in_progress' }).status, 'in_progress');
  assert.equal(item(1, { compliance_status: 'weird' }).status, 'in_progress');
  assert.equal(item(1, { compliance_status: null }).status, 'in_progress');
  assert.equal(item(1, { remediation_status: 'In Progress' }).remediation, 'in_progress');
  assert.equal(item(1, { remediation_status: 'Closed' }).remediation, 'closed');
  assert.equal(item(1, { remediation_status: 'whatever' }).remediation, '');
  assert.equal(item(1, { priority: 'HIGH' }).priority, 'high');
  assert.equal(item(1, { priority: 'urgent' }).priority, '');
  assert.equal(item(1, { area_domain: '  ' }).domain, 'Uncategorized');
  assert.equal(item(1, { evidence_count: undefined }).evidenceCount, 0);
});

test('a gap is a control somebody recorded remediation on or that is not complied; it is open until it has a closed date (the server\'s checklist rule)', () => {
  assert.ok(isGap(item(1, { compliance_status: 'not_complied' })));
  assert.ok(isGap(item(1, { compliance_status: 'partially_complied', remediation_status: 'open' })));
  assert.ok(!isGap(item(1, { compliance_status: 'partially_complied' })), 'partial with no remediation recorded is not a gap');
  assert.ok(!isGap(item(1, { compliance_status: 'complied' })));
  assert.ok(isOpenGap(item(1)));
  assert.ok(!isOpenGap(item(1, { remediation_status: 'closed', closed_at: '2026-02-01T00:00:00' })));
});

test('dueMs is the server\'s _target_date: the control\'s own date, else raised plus the days of its priority (medium when none)', () => {
  const day = 86_400_000;
  const raised = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(dueMs(item(1, { priority: 'critical' })), raised + 30 * day);
  assert.equal(dueMs(item(1, { priority: 'high' })), raised + 60 * day);
  assert.equal(dueMs(item(1, { priority: 'low' })), raised + 180 * day);
  assert.equal(dueMs(item(1, { priority: null })), raised + 90 * day, 'no priority reads as medium');
  assert.equal(dueMs(item(1, { target_date: '2026-06-30T00:00:00' })), Date.parse('2026-06-30T00:00:00Z'));
  assert.equal(dueMs(item(1, { target_date: '2026-06-30' })), Date.parse('2026-06-30T00:00:00Z'), 'a day alone');
  assert.equal(dueMs(item(1, { created_at: null })), null);
  assert.equal(dueMs(item(1, { priority: 'high' }), { critical_days: 1, high_days: 10, medium_days: 20, low_days: 30, due_soon_days: 5 }), raised + 10 * day, 'the tenant\'s own days');
});

test('patchOf sends only what changed: an empty string clears text, null clears the date and remediation, remarks stay out for a format that keeps data there', () => {
  const it = item(1, { gaps_identified: 'No MFA', remediation_status: 'open', target_date: '2026-06-30T00:00:00', remarks: 'ASVS Level: 2', maturity_score: 2 });
  const d = draftOf(it);
  assert.deepEqual(patchOf(it, d), {}, 'untouched draft = no patch');
  assert.ok(!hasChanges(patchOf(it, d)));
  assert.deepEqual(patchOf(it, { ...d, status: 'complied', remediation: 'closed' }), { compliance_status: 'complied', remediation_status: 'closed' });
  assert.deepEqual(patchOf(it, { ...d, remediation: '', targetDate: '' }), { remediation_status: null, target_date: null });
  assert.deepEqual(patchOf(it, { ...d, targetDate: '2026-12-31' }), { target_date: '2026-12-31' });
  assert.deepEqual(patchOf(it, { ...d, gap: '  ' }), { gaps_identified: '' }, 'cleared');
  assert.deepEqual(patchOf(it, { ...d, gap: 'No MFA   ' }), {}, 'trailing blanks are not a change');
  assert.deepEqual(patchOf(it, { ...d, priority: '' }), { priority: '' });
  assert.deepEqual(patchOf(it, { ...d, domain: '' }), { area_domain: 'Uncategorized' });
  assert.deepEqual(patchOf(it, { ...d, maturity: '' }), { maturity_score: null });
  assert.deepEqual(patchOf(it, { ...d, maturity: '4' }), { maturity_score: 4 });
  assert.deepEqual(patchOf(it, { ...d, remarks: 'ASVS Level: 3' }), { remarks: 'ASVS Level: 3' });
  assert.deepEqual(patchOf(it, { ...d, remarks: 'ASVS Level: 3' }, { structuredRemarks: true }), {}, 'a score reads remarks on this format: never sent from the generic editor');
  assert.equal(draftOf(item(1, { area_domain: null })).domain, '', 'Uncategorized is not typed into the field');
});

test('draftProblem: a control needs a description, maturity is 0 to 5', () => {
  const d = draftOf(item(1));
  assert.equal(draftProblem(d), '');
  assert.match(draftProblem({ ...d, description: '  ' }), /description/);
  assert.match(draftProblem({ ...d, maturity: '7' }), /0 to 5/);
  assert.equal(draftProblem({ ...d, maturity: '0' }), '');
});

const LIST = [
  item(1, { item_number: 'A.10', area_domain: 'Access', compliance_status: 'complied', evidence_count: 2, assignees: [{ type: 'user', id: 5, name: 'Dana Khan' }], priority: 'low' }),
  item(2, { item_number: 'A.2', area_domain: 'Access', compliance_status: 'not_complied', priority: 'critical' }),
  item(3, { item_number: 'B.1', area_domain: 'Logging', compliance_status: 'in_progress', responsible_party: 'Ops', priority: null }),
  item(4, { item_number: 'B.2', area_domain: 'Logging', compliance_status: 'na', remediation_status: 'closed', closed_at: '2026-02-01T00:00:00', priority: null }),
];

test('filterItems: text, status, priority (including none), domain, evidence, unassigned, open gaps; they combine', () => {
  assert.deepEqual(filterItems(LIST, NO_FILTERS).map((i) => i.id), [1, 2, 3, 4]);
  assert.deepEqual(filterItems(LIST, { ...NO_FILTERS, q: 'dana' }).map((i) => i.id), [1], 'an assignee\'s name is searched');
  assert.deepEqual(filterItems(LIST, { ...NO_FILTERS, q: ' b.1 ' }).map((i) => i.id), [3]);
  assert.deepEqual(filterItems(LIST, { ...NO_FILTERS, status: ['complied', 'na'] }).map((i) => i.id), [1, 4]);
  assert.deepEqual(filterItems(LIST, { ...NO_FILTERS, priority: ['none'] }).map((i) => i.id), [3, 4]);
  assert.deepEqual(filterItems(LIST, { ...NO_FILTERS, domain: ['Logging'] }).map((i) => i.id), [3, 4]);
  assert.deepEqual(filterItems(LIST, { ...NO_FILTERS, evidence: 'with' }).map((i) => i.id), [1]);
  assert.deepEqual(filterItems(LIST, { ...NO_FILTERS, evidence: 'without' }).map((i) => i.id), [2, 3, 4]);
  assert.deepEqual(filterItems(LIST, { ...NO_FILTERS, owner: 'unassigned' }).map((i) => i.id), [2, 4], 'the workbook\'s free-text owner counts as an owner');
  assert.deepEqual(filterItems(LIST, { ...NO_FILTERS, gaps: true }).map((i) => i.id), [2]);
  assert.deepEqual(filterItems(LIST, { ...NO_FILTERS, domain: ['Access'], status: ['not_complied'] }).map((i) => i.id), [2]);
  assert.equal(activeFilterCount(NO_FILTERS), 0);
  assert.equal(activeFilterCount({ ...NO_FILTERS, q: 'x', status: ['na'], gaps: true }), 3);
});

test('sortItems: numbers in natural order (A.2 before A.10), by status worst first, open gaps by due date, ties keep the workbook order', () => {
  assert.deepEqual(sortItems(LIST, { key: 'number', dir: 'asc' }).map((i) => i.number), ['A.2', 'A.10', 'B.1', 'B.2']);
  assert.deepEqual(sortItems(LIST, { key: 'number', dir: 'desc' }).map((i) => i.number), ['B.2', 'B.1', 'A.10', 'A.2']);
  assert.deepEqual(sortItems(LIST, { key: 'status', dir: 'asc' }).map((i) => i.id), [2, 3, 1, 4]);
  assert.deepEqual(sortItems(LIST, { key: 'priority', dir: 'asc' }).map((i) => i.id), [2, 1, 3, 4]);
  assert.deepEqual(sortItems(LIST, { key: 'due', dir: 'asc' }).map((i) => i.id), [2, 1, 3, 4], 'the one open gap first, the rest in workbook order');
  assert.deepEqual(sortItems(LIST, { key: 'evidence', dir: 'desc' }).map((i) => i.id), [1, 2, 3, 4]);
  const before = LIST.map((i) => i.id);
  sortItems(LIST, { key: 'status', dir: 'desc' });
  assert.deepEqual(LIST.map((i) => i.id), before, 'the input is not reordered');
});

test('groupByDomain keeps the workbook order of domains and counts what was answered and complied; statusCounts and neighbours', () => {
  const g = groupByDomain(LIST);
  assert.deepEqual(g.map((x) => [x.domain, x.items.length, x.complied, x.answered]), [['Access', 2, 1, 2], ['Logging', 2, 0, 1]]);
  assert.deepEqual(domainsOf(LIST), ['Access', 'Logging']);
  assert.deepEqual(statusCounts(LIST), { complied: 1, partially_complied: 0, not_complied: 1, in_progress: 1, na: 1 });
  assert.deepEqual(neighbours(LIST, 2), { prev: LIST[0], next: LIST[2] });
  assert.deepEqual(neighbours(LIST, 1), { prev: null, next: LIST[1] });
  assert.deepEqual(neighbours(LIST, 99), { prev: null, next: null });
  assert.deepEqual(neighbours(LIST, null), { prev: null, next: null });
  assert.ok(NOW > 0);
});
