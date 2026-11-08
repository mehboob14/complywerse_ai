// node --test "src/app/(dashboard)/tasks/_insights/insightsLinks.test.ts"
// The Insights tab's numbers are LINKS: each opens All tasks on an address the register reads (its own `readAddress(REGISTER_SCHEMA)`, `pageOf`, the facet engine). Here every number of the tab, with the
// document requests in and out, is held to the count the register shows for the address it links to, over a fixture with every awkward case in it (statuses a module wrote, a category with a comma,
// co-owners, tasks nobody has, document requests, every due moment).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate } from '../../../../components/records/facetEngine.ts';
import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { REGISTER_SCHEMA, pageOf, type RegisterAddress } from '../_register/taskAddress.ts';
import { chosenOf, indexTasks, ruleOf } from '../_register/taskFacets.ts';
import type { RegisterTask } from '../taskRecord.ts';
import { INSIGHTS_SCHEMA, linksOf } from './insightsLinks.ts';
import { countedRows, insightsOf } from './insightsModel.ts';

const NOW = new Date('2026-11-10T09:30:00Z');
const person = (id: number) => ({ id, display_name: `Person ${id}` });
const REQUEST = { request_id: 1, kind: 'review', document_id: 3, open_href: '/governance/documents/3' } as never;

function task(id: number, over: Partial<RegisterTask> = {}): RegisterTask {
  return {
    id, title: `Task ${id}`, source: 'Manual', source_module: null, source_entity_type: null, priority: 'Medium', status: 'Open', category: 'Other',
    assigned_owner_id: null, assigned_owner: null, assigned_user_ids: [], assignees: [], reviewer_id: null, reviewer: null, created_by_id: 2, created_by: person(2),
    due_date: null, sla_status: 'No SLA', completed_at: null, created_at: '2026-10-01T08:00:00', updated_at: null, ...over,
  };
}

function make(n: number): RegisterTask[] {
  const statuses = ['Open', 'In Progress', 'Under Review', 'Completed', 'Verified', 'Reopened', 'planned', 'in progress'];
  const priorities = ['Critical', 'High', 'Medium', 'Low', 'high', 'Informational'];
  const sources = ['Manual', 'Audit', 'Risk', 'Compliance', '', 'Vendor Finding'];
  const categories = ['Remediation', 'Review', 'Policy, Procedure', '', 'Other'];
  const dues = [null, '2026-10-01T00:00:00', '2026-11-10T09:00:00', '2026-11-10T18:00:00', '2026-11-12T00:00:00', '2026-11-30T00:00:00', '2027-02-01T00:00:00'];
  const modules: Array<Partial<RegisterTask>> = [{}, {}, {}, {}, { source_module: 'committees', source_entity_type: 'OversightAction' }, { source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation', document_request: REQUEST }, { source_module: 'vendor_risk' }];
  const rows: RegisterTask[] = [];
  for (let i = 1; i <= n; i += 1) {
    const owners = i % 6 === 0 ? [] : i % 4 === 0 ? [(i % 5) + 1, ((i + 2) % 5) + 1] : [(i % 7) + 1];
    rows.push(task(i, {
      status: statuses[i % statuses.length], priority: priorities[i % priorities.length], source: sources[i % sources.length], category: categories[i % categories.length],
      due_date: dues[i % dues.length], assigned_owner_id: owners[0] ?? null, assigned_owner: owners.length ? person(owners[0]) : null, assigned_user_ids: owners, assignees: owners.map(person),
      completed_at: ['Completed', 'Verified'].includes(statuses[i % statuses.length]) ? '2026-10-20T08:00:00' : null, ...modules[i % modules.length],
    }));
  }
  return rows;
}
const ALL = make(500);

/** What the register shows for an address of the tab: it reads the address, indexes EVERY task (the register has them all) and evaluates. */
function shown(href: string): number {
  const page = pageOf(readAddress(REGISTER_SCHEMA, href.slice(href.indexOf('?'))) as RegisterAddress);
  const ctx = { me: null, now: NOW };
  return evaluate(indexTasks(ALL, ctx), chosenOf(page.filters), ruleOf(page.filters, ctx)).matches.length;
}

for (const includeDocuments of [true, false]) {
  test(`EVERY number of the tab is the register's own count of the address it links to (document requests ${includeDocuments ? 'in' : 'out'})`, () => {
    const rows = countedRows(ALL, includeDocuments);
    const i = insightsOf(rows, NOW);
    const links = linksOf(rows, includeDocuments);
    assert.ok(i.overdue > 10 && i.done > 10 && i.workload.length > 3, 'the fixture has some of each');
    assert.equal(shown(links.all), i.total, 'total');
    assert.equal(shown(links.overdue), i.overdue, 'overdue');
    assert.equal(shown(links.oldest), i.overdue, 'the oldest first is the same tasks');
    assert.equal(shown(links.active as string), i.active, 'active');
    assert.equal(shown(links.done as string), i.done, 'completed and verified');
    for (const r of i.byStatus) assert.equal(shown(links.status(r.key) as string), r.count, `status ${r.key}`);
    for (const r of i.byPriority) assert.equal(shown(links.priority(r.key) as string), r.count, `priority ${r.key}`);
    for (const r of i.bySource) assert.equal(shown(links.source(r.key) as string), r.count, `source ${r.key}`);
    for (const r of i.completionBySource) assert.equal(shown(links.source(r.key) as string), r.total, `completion by source ${r.key}`);
    for (const r of i.byCategory.filter((c) => !c.key.includes(','))) assert.equal(shown(links.category(r.key) as string), r.count, `category ${r.key}`);
    for (const r of i.workload) assert.equal(shown(links.owner(r.key) as string), r.count, `owner ${r.label}`);
  });
}

test('with document requests out every address names the kinds it keeps; with them in none does', () => {
  const on = linksOf(ALL, true);
  const off = linksOf(ALL, false);
  assert.doesNotMatch(on.all, /kind=/);
  assert.equal(on.all, '/tasks?tab=all');
  assert.match(off.all, /kind=task%2Ccommittee%2Cregulatory%2Cvendor%2Cissue%2Cworkflow/);
  assert.doesNotMatch(off.all, /document/);
  for (const href of [off.overdue, off.status('Open'), off.owner(1)]) assert.match(href as string, /kind=task/);
});

test('a word that cannot travel in an address (a comma) is counted but not linked; an empty set has no link rather than an address that shows everything', () => {
  const l = linksOf(ALL, true);
  assert.equal(l.category('Policy, Procedure'), null);
  assert.ok(l.category('Review'));
  const none = linksOf([], true);
  assert.equal(none.active, null);
  assert.equal(none.done, null);
  assert.equal(none.owner(1), null);
  const onlyOpen = linksOf([task(1)], true);
  assert.ok(onlyOpen.active && onlyOpen.done === null);
});

test('the open and done words are the ones the tasks hold, in the workflow\'s order, a word a module wrote included', () => {
  const l = linksOf(ALL, true);
  const status = new URLSearchParams((l.active as string).split('?')[1]).get('status');
  assert.equal(status, 'Open,In Progress,Under Review,Reopened,planned');
  assert.equal(new URLSearchParams((l.done as string).split('?')[1]).get('status'), 'Completed,Verified');
});

test('a person\'s link is their open tasks: the owner and the open statuses', () => {
  const l = linksOf(ALL, true);
  const q = new URLSearchParams((l.owner(3) as string).split('?')[1]);
  assert.equal(q.get('tab'), 'all');
  assert.equal(q.get('owner'), '3');
  assert.equal(q.get('status'), 'Open,In Progress,Under Review,Reopened,planned');
});

test('the tab\'s own address state: ?documents=off, any other value is the default, and the tab and every other parameter are left alone', () => {
  assert.deepEqual(readAddress(INSIGHTS_SCHEMA, ''), { documents: 'on' });
  assert.deepEqual(readAddress(INSIGHTS_SCHEMA, '?tab=reports&documents=off'), { documents: 'off' });
  assert.deepEqual(readAddress(INSIGHTS_SCHEMA, '?documents=maybe'), { documents: 'on' });
  assert.equal(writeAddress(INSIGHTS_SCHEMA, '?tab=reports', { documents: 'off' }), 'tab=reports&documents=off');
  assert.equal(writeAddress(INSIGHTS_SCHEMA, '?tab=reports&documents=off', { documents: 'on' }), 'tab=reports');
});
