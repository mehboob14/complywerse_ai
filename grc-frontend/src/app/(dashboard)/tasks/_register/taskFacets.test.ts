// node --test "src/app/(dashboard)/tasks/_register/taskFacets.test.ts"
// The register's facets, quick views, options, chips, sort and grouping (taskFacets.ts): the facet engine's answer is held to a plain filter on a few hundred generated tasks, each quick view
// is the rule My work uses, an old link's words are still the filter's words, and the sorts put severity and the workflow in their own order (not the alphabet's).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countOf, evaluate } from '../../../../components/records/facetEngine.ts';
import { dueBucket, isMyWork, kindOf, nextStep, peopleOf, type RegisterTask } from '../taskRecord.ts';
import {
  DEFAULT_SORT, FACET_TITLE, NO_FILTERS, NONE, QUICK_IDS, QUICK_LABEL, RAIL_ORDER, SORT_KEYS, approvalValue, chosenOf, filterChips, filterCount, groupOf, groupTasks, haystack, indexTasks,
  inQuick, nextSort, orderedOptions, peopleNames, priorityValue, railOptions, removeChip, ruleOf, searchTerms, sortTasks, statusValue, type Filters, type RuleContext,
} from './taskFacets.ts';

const NOW = new Date('2026-11-10T09:30:00Z');
const ME = 5;
const CTX: RuleContext = { me: ME, now: NOW };
const PEOPLE = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, display_name: `Person ${id}` }));

/** a deterministic spread of tasks: every status, priority, due, kind, approval, owner count */
function make(n: number): RegisterTask[] {
  const statuses = ['Open', 'In Progress', 'Under Review', 'Completed', 'Verified', 'Reopened', 'planned'];
  const priorities = ['Critical', 'High', 'Medium', 'Low', 'high', 'Informational'];
  const modules = [null, null, null, 'committees', 'regulatory_changes', 'vendor_risk', 'issue_management', 'workflow_engine', 'criticality_assessment'];
  const dues = [null, '2026-11-01T00:00:00', '2026-11-10T09:00:00', '2026-11-10T18:00:00', '2026-11-12T00:00:00', '2026-11-30T00:00:00', '2027-02-01T00:00:00'];
  const rows: RegisterTask[] = [];
  for (let i = 1; i <= n; i += 1) {
    const owners = i % 5 === 0 ? [] : i % 7 === 0 ? [(i % 8) + 1, ((i + 3) % 8) + 1, ((i + 5) % 8) + 1] : [(i % 8) + 1];
    const status = statuses[i % statuses.length];
    const due = dues[i % dues.length];
    rows.push({
      id: i, title: `Task ${i} ${i % 11 === 0 ? 'Patch the VPN gateway' : 'Review the register'}`, source: i % 3 === 0 ? 'Audit' : 'Manual', source_module: modules[i % modules.length],
      source_entity_type: null, priority: priorities[i % priorities.length], status, category: i % 4 === 0 ? 'Review' : 'Other',
      assigned_owner_id: owners[0] ?? null, assigned_owner: owners.length ? { id: owners[0], display_name: `Person ${owners[0]}` } : null,
      assigned_user_ids: owners, assignees: owners.map((id) => ({ id, display_name: `Person ${id}` })),
      reviewer_id: i % 3 === 0 ? ((i + 1) % 8) + 1 : null, reviewer: i % 3 === 0 ? { id: ((i + 1) % 8) + 1, display_name: `Person ${((i + 1) % 8) + 1}` } : null,
      created_by_id: (i % 4) + 1, created_by: { id: (i % 4) + 1, display_name: `Person ${(i % 4) + 1}` },
      due_date: due, sla_status: 'No SLA', completed_at: null, created_at: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T08:00:00`, updated_at: null,
      approval_required: i % 6 === 0, approval_status: i % 6 === 0 ? (['Pending', 'Approved', 'Rejected', null] as const)[i % 4] : null,
      recurrence_pattern: i % 13 === 0 ? 'weekly' : null, links: i % 9 === 0 ? [{ kind: 'risk', id: 1, title: 'R', href: '/erm/risks/1' }] : [],
    });
  }
  return rows;
}
const ROWS = make(400);

/** the plain filter the engine must equal: a task passes when every facet with a choice has one of the chosen values, and the rule holds */
function plain(rows: readonly RegisterTask[], f: Filters, ctx: RuleContext): RegisterTask[] {
  const specs = indexTasks([], ctx).specs;
  const chosen = chosenOf(f);
  const terms = searchTerms(f.search);
  const quick = f.quick && f.quick !== 'all' ? f.quick : null;
  return rows.filter((t) => {
    if (terms.some((w) => !haystack(t).includes(w))) return false;
    if (quick && !inQuick(quick, t, ctx)) return false;
    return specs.every((s) => { const c = chosen[s.key]; return !c || c.length === 0 || s.values(t).some((v) => c.includes(v)); });
  });
}

test('the facet engine equals the plain filter on 400 tasks, for many choices at once', () => {
  const index = indexTasks(ROWS, CTX);
  const cases: Filters[] = [
    NO_FILTERS,
    { ...NO_FILTERS, status: ['Open', 'In Progress'] },
    { ...NO_FILTERS, status: ['planned'] },
    { ...NO_FILTERS, priority: ['Critical', 'High'], due: ['overdue', 'today'] },
    { ...NO_FILTERS, owner: ['3', NONE] },
    { ...NO_FILTERS, kind: ['committee', 'document'], approval: ['pending'] },
    { ...NO_FILTERS, search: 'vpn gateway' },
    { ...NO_FILTERS, search: 'person 4', quick: 'mine' },
    { ...NO_FILTERS, quick: 'overdue', source: ['Audit'] },
    { ...NO_FILTERS, quick: 'week' },
    { ...NO_FILTERS, quick: 'approve', reviewer: [String(ME)] },
    { ...NO_FILTERS, quick: 'unassigned', repeats: ['repeats', 'once'] },
    { ...NO_FILTERS, linked: ['linked'], creator: ['1', '2'], category: ['Review'] },
    { ...NO_FILTERS, sla: ['no_sla'], status: ['Completed', 'Verified'], due: ['done'] },
  ];
  for (const f of cases) {
    const got = evaluate(index, chosenOf(f), ruleOf(f, CTX)).matches.map((t) => t.id);
    assert.deepEqual(got, plain(ROWS, f, CTX).map((t) => t.id), JSON.stringify(f));
  }
});

test('the count beside an option is what choosing it would show with the other filters as they are', () => {
  const index = indexTasks(ROWS, CTX);
  const f: Filters = { ...NO_FILTERS, status: ['Open'], owner: ['2'] };
  const { counts } = evaluate(index, chosenOf(f), ruleOf(f, CTX));
  for (const value of ['In Progress', 'Under Review', 'Completed']) {
    assert.equal(countOf(counts, 'status', value), plain(ROWS, { ...f, status: [value] }, CTX).length, value);
  }
  for (const value of ['1', '2', '3', NONE]) {
    assert.equal(countOf(counts, 'owner', value), plain(ROWS, { ...f, owner: [value] }, CTX).length, `owner ${value}`);
  }
});

test('a task with several owners counts under each of them, once', () => {
  const t = ROWS.filter((r) => peopleOf(r).length === 3)[0];
  const index = indexTasks([t], CTX);
  const { counts } = evaluate(index, chosenOf(NO_FILTERS), ruleOf(NO_FILTERS, CTX));
  peopleOf(t).forEach((p) => assert.equal(countOf(counts, 'owner', String(p)), 1));
  assert.deepEqual(evaluate(index, chosenOf({ ...NO_FILTERS, owner: [String(peopleOf(t)[2])] }), {}).matches.length, 1, 'the server\'s owner filter looks at the first owner only; the facet at everyone');
});

// ── the quick views ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('each quick view is the rule My work uses', () => {
  for (const t of ROWS) {
    const done = t.status === 'Completed' || t.status === 'Verified';
    assert.equal(inQuick('mine', t, CTX), !done && isMyWork(t, ME));
    assert.equal(inQuick('overdue', t, CTX), dueBucket(t, NOW) === 'overdue');
    assert.equal(inQuick('week', t, CTX), ['today', 'week'].includes(dueBucket(t, NOW)));
    assert.equal(inQuick('approve', t, CTX), nextStep(t, ME)?.id === 'approve');
    assert.equal(inQuick('created', t, CTX), t.created_by_id === ME);
    assert.equal(inQuick('unassigned', t, CTX), !done && peopleOf(t).length === 0);
    assert.equal(inQuick('documents', t, CTX), kindOf(t) === 'document');
    assert.equal(inQuick('all', t, CTX), true);
  }
  assert.deepEqual(Object.keys(QUICK_LABEL), Array.from(QUICK_IDS));
  const none = { me: null, now: NOW };
  assert.equal(ROWS.filter((t) => inQuick('mine', t, none) || inQuick('created', t, none) || inQuick('approve', t, none)).length, 0, 'nobody signed in: nothing is mine');
});

// ── words, ids, options ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('an old link\'s words are the facet values: the workflow spelling for a status and a priority, whatever case the task holds', () => {
  assert.equal(statusValue('In Progress'), 'In Progress');
  assert.equal(statusValue('in_progress'), 'In Progress');
  assert.equal(statusValue('planned'), 'planned');
  assert.equal(statusValue(''), NONE);
  assert.equal(priorityValue('high'), 'High');
  assert.equal(priorityValue('Informational'), 'Informational');
  assert.equal(approvalValue({ approval_required: false, approval_status: 'Approved' }), 'not_needed');
  assert.equal(approvalValue({ approval_required: true, approval_status: null }), 'not_requested');
  assert.equal(approvalValue({ approval_required: true, approval_status: 'Pending' }), 'pending');
});

test('the rail lists the workflow\'s words first and any other word the tasks hold, people by name, and never a facet nobody has a value in twice', () => {
  const names = peopleNames(ROWS, PEOPLE);
  const options = railOptions(ROWS, names, CTX);
  assert.deepEqual(options.status.slice(0, 6).map((o) => o.value), ['Open', 'In Progress', 'Under Review', 'Completed', 'Verified', 'Reopened']);
  assert.ok(options.status.some((o) => o.value === 'planned' && o.label === 'Planned'), 'a word a module wrote is offered, readable');
  assert.deepEqual(options.priority.map((o) => o.value), ['Critical', 'High', 'Medium', 'Low', 'Informational'], 'a lower-case "high" is the High option');
  assert.deepEqual(options.due.map((o) => o.label), ['Overdue', 'Due today', 'Due in 7 days', 'Due in 30 days', 'Due later', 'No due date', 'Done']);
  assert.equal(options.owner[options.owner.length - 1].label, 'Unassigned');
  assert.ok(options.owner.slice(0, -1).every((o) => /^Person \d$/.test(o.label)));
  for (const k of RAIL_ORDER) {
    const values = options[k].map((o) => o.value);
    assert.equal(new Set(values).size, values.length, k);
    assert.ok(FACET_TITLE[k], k);
  }
  const counts = evaluate(indexTasks(ROWS, CTX), chosenOf(NO_FILTERS), ruleOf(NO_FILTERS, CTX)).counts;
  const shown = orderedOptions(options.status, [], (v) => countOf(counts, 'status', v));
  assert.ok(shown.length > 0 && shown.every((o) => countOf(counts, 'status', o.value) > 0));
  assert.ok(orderedOptions(options.status, ['Open'], () => 0).some((o) => o.value === 'Open'), 'a chosen option stays');
});

test('chips say what is on and removing one turns exactly that filter off', () => {
  const names = peopleNames(ROWS, PEOPLE);
  const options = railOptions(ROWS, names, CTX);
  const f: Filters = { ...NO_FILTERS, search: ' vpn ', quick: 'overdue', status: ['Open', 'In Progress'], owner: ['3'] };
  const chips = filterChips(f, options);
  assert.deepEqual(chips.map((c) => c.label), ['Search: vpn', 'Overdue', 'Status: Open', 'Status: In progress', 'Owner: Person 3']);
  assert.equal(filterCount(f), 5);
  assert.equal(filterCount({ ...NO_FILTERS, quick: 'all' }), 0, 'the All chip is no filter');
  let g = f;
  for (const chip of chips) g = removeChip(g, chip);
  assert.deepEqual({ ...g, search: g.search.trim() }, NO_FILTERS);
  assert.deepEqual(removeChip(f, chips[3]).status, ['Open']);
});

// ── sort, group ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('sorting: severity and the workflow in their own order, empty values last either way, a stable tie', () => {
  const names = peopleNames(ROWS, PEOPLE);
  const ids = (rows: RegisterTask[]) => rows.map((t) => t.id);
  const byPriority = sortTasks(ROWS, { key: 'priority', dir: 'asc' }, names);
  assert.deepEqual(byPriority.slice(0, 3).map((t) => priorityValue(t.priority)), ['Critical', 'Critical', 'Critical']);
  assert.equal(priorityValue(byPriority[byPriority.length - 1].priority), 'Informational', 'a word nobody ranks is last');
  const byStatus = sortTasks(ROWS, { key: 'status', dir: 'asc' }, names);
  assert.equal(statusValue(byStatus[0].status), 'Open');
  assert.equal(statusValue(byStatus[byStatus.length - 1].status), 'planned');
  for (const dir of ['asc', 'desc'] as const) {
    const due = sortTasks(ROWS, { key: 'due_date', dir }, names);
    const firstEmpty = due.findIndex((t) => !t.due_date);
    assert.ok(due.slice(firstEmpty).every((t) => !t.due_date), `no due date last (${dir})`);
    const owner = sortTasks(ROWS, { key: 'owner', dir }, names);
    const firstNobody = owner.findIndex((t) => peopleOf(t).length === 0);
    assert.ok(owner.slice(firstNobody).every((t) => peopleOf(t).length === 0), `unassigned last (${dir})`);
  }
  assert.deepEqual(ids(sortTasks(ROWS, DEFAULT_SORT, names)), ids(sortTasks(ROWS.slice().reverse(), DEFAULT_SORT, names)), 'the order does not depend on the order the tasks came in');
  assert.deepEqual(Array.from(SORT_KEYS).slice(0, 8), ['created_at', 'updated_at', 'title', 'priority', 'status', 'due_date', 'source', 'category'], 'the server\'s own column names, so an old link keeps its sort');
  assert.deepEqual(nextSort({ key: 'title', dir: 'asc' }, 'title'), { key: 'title', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'title', dir: 'asc' }, 'created_at'), { key: 'created_at', dir: 'desc' }, 'a date column starts newest first');
  assert.deepEqual(nextSort(DEFAULT_SORT, 'due_date'), { key: 'due_date', dir: 'asc' });
});

test('grouping: by owner (people by name, Unassigned last) and by due bucket (Overdue first, Done last); the sort inside a group is kept', () => {
  const names = peopleNames(ROWS, PEOPLE);
  const sorted = sortTasks(ROWS, { key: 'title', dir: 'asc' }, names);
  const byOwner = groupTasks(sorted, 'owner', names, NOW);
  const labels = byOwner.map((t) => groupOf(t, 'owner', names, NOW).label);
  const seen = labels.filter((l, i) => labels.indexOf(l) === i);
  assert.equal(seen[seen.length - 1], 'Unassigned');
  assert.deepEqual(seen.slice(0, -1), seen.slice(0, -1).slice().sort());
  assert.equal(new Set(labels).size, seen.length);
  const inGroup = byOwner.filter((t) => groupOf(t, 'owner', names, NOW).key === '3');
  assert.deepEqual(inGroup.map((t) => t.id), sorted.filter((t) => groupOf(t, 'owner', names, NOW).key === '3').map((t) => t.id));
  const byDue = groupTasks(sorted, 'due', names, NOW).map((t) => groupOf(t, 'due', names, NOW).key);
  const order = ['overdue', 'today', 'week', 'month', 'later', 'none', 'done'];
  assert.deepEqual(byDue.map((k) => order.indexOf(k)), byDue.map((k) => order.indexOf(k)).sort((a, b) => a - b));
  assert.deepEqual(groupTasks(sorted, 'none', names, NOW).map((t) => t.id), sorted.map((t) => t.id));
});
