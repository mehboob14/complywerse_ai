// node --test "src/app/(dashboard)/tasks/_insights/insightsModel.test.ts"
// The numbers of the Insights tab (insightsModel.ts) are the server's `reports/summary` numbers, worked out from the lean list: every formula against a fixture worked by hand, the router's own text
// re-read so a change there fails here, the three things that differ on purpose (workload by everyone on a task, the trend with its year, canonical words), and "Include document requests".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { taskStatus } from '../../../../lib/statuses/tasks.ts';
import type { RegisterTask } from '../taskRecord.ts';
import { AGING, agingBucket, completionBySource, countedRows, documentCount, insightsOf, isOverdueNow, round1, share, slaCounts, trendOf, workloadOf } from './insightsModel.ts';

const NOW = new Date('2026-03-15T12:00:00Z');
const person = (id: number, name: string) => ({ id, display_name: name });
const ADA = person(1, 'Ada'); const BO = person(2, 'Bo'); const CY = person(3, 'Cy'); const DI = person(4, 'Di');

function task(id: number, over: Partial<RegisterTask> = {}): RegisterTask {
  return {
    id, title: `Task ${id}`, source: 'Manual', source_module: null, source_entity_type: null, priority: 'Medium', status: 'Open', category: 'Other',
    assigned_owner_id: null, assigned_owner: null, assigned_user_ids: [], assignees: [], reviewer_id: null, reviewer: null, created_by_id: 9, created_by: null,
    due_date: null, sla_status: 'No SLA', completed_at: null, created_at: '2026-03-01T08:00:00', updated_at: null, ...over,
  };
}
const on = (...people: Array<{ id: number; display_name: string }>) => ({ assigned_owner_id: people[0]?.id ?? null, assigned_owner: people[0] ?? null, assigned_user_ids: people.map((p) => p.id), assignees: people });
const REQUEST = { request_id: 1, kind: 'review', document_id: 3, open_href: '/governance/documents/3' } as never;

/** twelve tasks worked by hand (see the numbers in each test); NOW is 15 Mar 2026, 12:00 UTC */
const ROWS: RegisterTask[] = [
  task(1, { ...on(ADA), due_date: '2026-03-10T00:00:00', priority: 'High', source: 'Audit', category: 'Review' }),                                                  // 5.5 days late
  task(2, { ...on(ADA, BO), status: 'In Progress', due_date: '2026-03-01T12:00:00', priority: 'High', source: 'Audit' }),                                          // exactly 14 days late
  task(3, { ...on(BO), due_date: '2026-02-20T00:00:00', priority: 'Critical', source: 'Risk' }),                                                                   // 22.5 days late
  task(4, { due_date: '2026-01-01T00:00:00', priority: 'Low', source: '' }),                                                                                        // 73 days late, nobody, no source
  task(5, { status: 'Completed', due_date: '2026-03-05T00:00:00', completed_at: '2026-03-04T10:00:00', created_at: '2026-02-10T08:00:00', source: 'Audit' }),        // on time
  task(6, { status: 'Completed', due_date: '2026-03-05T00:00:00', completed_at: '2026-03-06T10:00:00', created_at: '2026-02-12T08:00:00', source: 'Risk' }),         // late
  task(7, { status: 'Verified', completed_at: '2026-03-02T10:00:00', source: 'Risk' }),                                                                            // no due date
  task(8, { ...on(ADA), due_date: '2026-03-20T00:00:00', source: 'Audit' }),                                                                                       // not yet due
  task(9, { ...on(CY), status: 'Under Review', source: 'Risk' }),
  task(10, { status: 'Completed', due_date: '2026-03-10T00:00:00', completed_at: null }),                                                                           // done, no completion moment
  task(11, { due_date: '2026-03-15T12:00:00' }),                                                                                                                    // due exactly now: not late
  task(12, { ...on(DI), due_date: '2026-03-14T00:00:00', source: 'Governance document', source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation', document_request: REQUEST }),
];

test('round1 is Python\'s round(x, 1): the nearest tenth, an exact tie to the even one', () => {
  assert.equal(round1(6.25), 6.2);
  assert.equal(round1(6.75), 6.8);
  assert.equal(round1(43.75), 43.8);
  assert.equal(round1(0.25), 0.2);
  assert.equal(round1(0.15), 0.1, '0.15 is a hair under in binary');
  assert.equal(round1(0.45), 0.5, '0.45 is a hair over');
  assert.equal(round1((1 / 3) * 100), 33.3);
  assert.equal(round1((2 / 3) * 100), 66.7);
  assert.equal(round1((3 / 10) * 100), 30);
  assert.equal(round1(100), 100);
  assert.equal(round1(0), 0);
});

test('overdue is the server\'s: the due moment has passed and the task is not Completed or Verified (a task due this very second is not late)', () => {
  const late = ROWS.filter((t) => isOverdueNow(t, NOW)).map((t) => t.id);
  assert.deepEqual(late, [1, 2, 3, 4, 12]);
  assert.equal(insightsOf(ROWS, NOW).overdue, 5);
  assert.equal(isOverdueNow(task(1, { status: 'verified', due_date: '2026-01-01T00:00:00' }), NOW), false, 'however the status is spelled');
});

test('overdue aging: whole days late, 7 or fewer, 14, 30, more', () => {
  const day = 86_400_000;
  const due = (days: number) => new Date(NOW.getTime() - days * day);
  assert.equal(agingBucket(due(0.5), NOW), '0-7 days');
  assert.equal(agingBucket(due(7.9), NOW), '0-7 days', '7 days and 21 hours is still 7 whole days');
  assert.equal(agingBucket(due(8), NOW), '8-14 days');
  assert.equal(agingBucket(due(14.99), NOW), '8-14 days');
  assert.equal(agingBucket(due(15), NOW), '15-30 days');
  assert.equal(agingBucket(due(30.5), NOW), '15-30 days');
  assert.equal(agingBucket(due(31), NOW), '30+ days');
  const a = insightsOf(ROWS, NOW).aging;
  assert.deepEqual(a.map((x) => x.label), Array.from(AGING));
  assert.deepEqual(a.map((x) => x.count), [2, 1, 1, 1]);
  assert.equal(a.reduce((n, x) => n + x.count, 0), insightsOf(ROWS, NOW).overdue, 'the buckets add up to the overdue count');
  assert.equal(a[0].percent, 40, 'a share of the overdue tasks');
});

test('completion rate: done (Completed and Verified) over all tasks, one decimal; active is the rest; no tasks is zero, not a division', () => {
  const i = insightsOf(ROWS, NOW);
  assert.equal(i.total, 12);
  assert.equal(i.done, 4);
  assert.equal(i.active, 8);
  assert.equal(i.completionRate, 33.3);
  const none = insightsOf([], NOW);
  assert.deepEqual([none.total, none.done, none.active, none.overdue, none.completionRate, none.slaCompliance], [0, 0, 0, 0, 0, 0]);
});

test('SLA compliance: of the tasks with a due date, the ones finished by it and the open ones not yet due; a task done with no completion moment is not met', () => {
  assert.deepEqual(slaCounts(ROWS, NOW), { met: 3, total: 10 });                       // 5 (on time), 8 (not yet due), 11 (due this second)
  assert.equal(insightsOf(ROWS, NOW).slaCompliance, 30);
  assert.deepEqual(slaCounts([task(1, { status: 'Completed', due_date: '2026-03-05T00:00:00', completed_at: '2026-03-05T00:00:00' })], NOW), { met: 1, total: 1 }, 'finished at the due moment is on time');
  assert.deepEqual(slaCounts([task(1), task(2, { status: 'Verified' })], NOW), { met: 0, total: 0 }, 'no due date, no SLA');
});

test('the groups: statuses in the workflow\'s order, priorities Critical to Low, sources and categories most first, "Not set" for none; the shares add to the whole', () => {
  const i = insightsOf(ROWS, NOW);
  assert.deepEqual(i.byStatus.map((r) => [r.key, r.count]), [['Open', 6], ['In Progress', 1], ['Under Review', 1], ['Completed', 3], ['Verified', 1]]);
  assert.deepEqual(i.byStatus.map((r) => r.label), i.byStatus.map((r) => taskStatus.label(r.key)), 'the words are the registry\'s');
  assert.deepEqual(i.byPriority.map((r) => [r.key, r.count]), [['Critical', 1], ['High', 2], ['Medium', 8], ['Low', 1]]);
  assert.deepEqual(i.bySource.map((r) => [r.key, r.label, r.count]), [['Audit', 'Audit', 4], ['Risk', 'Risk', 4], ['Manual', 'Manual', 2], ['Governance document', 'Governance document', 1], ['none', 'Not set', 1]]);
  assert.equal(i.byStatus.reduce((n, r) => n + r.count, 0), i.total);
  assert.equal(i.byStatus[0].percent, 50);
  assert.deepEqual(i.byCategory.map((r) => [r.key, r.count]), [['Other', 11], ['Review', 1]]);
});

test('a status or priority is counted by its canonical word: "in progress" and "In Progress" are one bar, and a word nobody listed keeps its own after the workflow\'s', () => {
  const i = insightsOf([task(1, { status: 'in progress' }), task(2, { status: 'In Progress' }), task(3, { status: 'planned' }), task(4, { priority: 'high' }), task(5, { priority: 'Informational' })], NOW);
  assert.deepEqual(i.byStatus.map((r) => [r.key, r.count]), [['Open', 2], ['In Progress', 2], ['planned', 1]]);
  assert.deepEqual(i.byPriority.map((r) => r.key), ['High', 'Medium', 'Informational']);
});

test('completion by source: per source the tasks, the done ones and the rate, most tasks first', () => {
  const rows = completionBySource(ROWS);
  assert.deepEqual(rows.map((r) => [r.key, r.total, r.completed, r.rate]), [['Audit', 4, 1, 25], ['Risk', 4, 2, 50], ['Manual', 2, 1, 50], ['Governance document', 1, 0, 0], ['none', 1, 0, 0]]);
  assert.equal(rows[4].label, 'Not set');
  assert.deepEqual(completionBySource([task(1, { status: 'Completed' }), task(2), task(3)]).map((r) => r.rate), [33.3], 'one in three');
});

test('workload: the open tasks of each person, everyone on a task counted, most first, each a share of the busiest', () => {
  const w = workloadOf(ROWS);
  assert.deepEqual(w.map((r) => [r.key, r.label, r.count]), [['1', 'Ada', 3], ['2', 'Bo', 2], ['3', 'Cy', 1], ['4', 'Di', 1]]);
  assert.deepEqual(w.map((r) => r.percent), [100, (2 / 3) * 100, (1 / 3) * 100, (1 / 3) * 100]);
  assert.deepEqual(workloadOf([task(1, on(ADA)), task(2, { ...on(ADA), status: 'Completed' })]).map((r) => [r.label, r.count]), [['Ada', 1]], 'a finished task is nobody\'s load');
  assert.deepEqual(workloadOf([task(1, { assigned_owner_id: 77, assigned_user_ids: [77] })]).map((r) => r.label), ['Someone no longer here']);
});

test('workload equals the server\'s first-owner count wherever a task has one owner (the only difference is a task shared by two people)', () => {
  const single = ROWS.filter((t) => (t.assigned_user_ids ?? []).length <= 1);
  const server = new Map<number, number>();                                               // the old rule: the legacy owner of each active task
  single.forEach((t) => { if (t.assigned_owner_id && !['Completed', 'Verified'].includes(t.status)) server.set(t.assigned_owner_id, (server.get(t.assigned_owner_id) ?? 0) + 1); });
  const mine = new Map(workloadOf(single).map((r) => [Number(r.key), r.count]));
  assert.deepEqual(Array.from(mine.entries()).sort(), Array.from(server.entries()).sort());
  const shared = workloadOf(ROWS).find((r) => r.label === 'Bo')!.count;
  assert.equal(shared, 2, 'Bo is on task 3 and on the shared task 2: the server counted only task 3');
});

test('the trend is twelve calendar months ending with this one, the year said: in March February has its bar', () => {
  const t = trendOf(ROWS, NOW);
  assert.equal(t.length, 12);
  assert.deepEqual(t.map((m) => m.label), ['Apr 2025', 'May 2025', 'Jun 2025', 'Jul 2025', 'Aug 2025', 'Sep 2025', 'Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026']);
  assert.deepEqual(t.map((m) => m.key).slice(-3), ['2026-01', '2026-02', '2026-03']);
  const feb = t.find((m) => m.label === 'Feb 2026')!;
  const mar = t.find((m) => m.label === 'Mar 2026')!;
  assert.deepEqual([feb.created, feb.completed], [2, 0], 'tasks 5 and 6 were made in February');
  assert.deepEqual([mar.created, mar.completed], [10, 3], 'the other ten were made in March; 5, 6 and 7 were completed in it');
  assert.equal(t.reduce((n, m) => n + m.created, 0), 12);
});

test('trend edges: a month starts at its first moment and ends before the next; the current month ends at now; the year turns over', () => {
  const rows = [
    task(1, { created_at: '2026-03-01T00:00:00' }),                  // the first moment of March: March
    task(2, { created_at: '2026-02-28T23:59:59' }),                  // the last second of February
    task(3, { created_at: '2026-03-15T12:00:00' }),                  // now exactly: past the end of the current month (it ends at now)
    task(4, { created_at: '2026-03-20T00:00:00' }),                  // the future: nobody's month
    task(5, { status: 'Completed', completed_at: '2026-03-15T11:59:59' }),
  ];
  const t = trendOf(rows, NOW);
  assert.deepEqual([t[10].created, t[11].created, t[11].completed], [1, 2, 1]);   // Feb: task 2; Mar: tasks 1 and 5 (made 1 Mar 08:00)
  const jan = trendOf([task(1, { created_at: '2025-12-31T23:59:59' }), task(2, { created_at: '2026-01-01T00:00:00' })], new Date('2026-01-10T00:00:00Z'));
  assert.deepEqual(jan.map((m) => m.label).slice(-2), ['Dec 2025', 'Jan 2026']);
  assert.deepEqual([jan[10].created, jan[11].created], [1, 1]);
  assert.equal(jan[0].label, 'Feb 2025');
});

test('Include document requests: off leaves the document requests out of every number; on is every task (today\'s numbers)', () => {
  assert.equal(documentCount(ROWS), 1);
  assert.equal(countedRows(ROWS, true).length, 12);
  const without = countedRows(ROWS, false);
  assert.deepEqual(without.map((t) => t.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const i = insightsOf(without, NOW);
  assert.deepEqual([i.total, i.overdue, i.done, i.slaTotal, i.slaMet], [11, 4, 4, 9, 3]);
  assert.equal(i.completionRate, 36.4);
  assert.equal(i.slaCompliance, 33.3);
  assert.ok(!workloadOf(without).some((r) => r.label === 'Di'), 'the person who was only asked a document request has no load');
  assert.equal(share(1, 0), 0);
});

// ── the router: the formulas copied are the router's ─────────────────────────────────────────────────────────────────────────────────────
const router = new URL('../../../../../../backend/grc/routers/critical_tasks_router.py', import.meta.url);
test('the server\'s reports_summary still says what this file copies (a change there needs this file looked at)', { skip: !existsSync(router) }, () => {
  const text = readFileSync(router, 'utf8');
  const body = text.slice(text.indexOf('def reports_summary'), text.indexOf('def bulk_action'));
  for (const piece of [
    'CriticalTask.due_date < now,',
    'CriticalTask.status.notin_(["Completed", "Verified"])',
    'if days <= 7:', 'elif days <= 14:', 'elif days <= 30:',
    '"0-7 days": 0, "8-14 days": 0, "15-30 days": 0, "30+ days": 0',
    'days = (now - t.due_date).days',
    'completion_rate = round((completed_count / total * 100), 1) if total > 0 else 0',
    'sla_compliance = round((sla_met / sla_total * 100), 1) if sla_total > 0 else 0',
    'if t.completed_at and t.completed_at <= t.due_date:', 'elif t.due_date >= now:',
    'base.filter(CriticalTask.due_date.isnot(None))',
    'CriticalTask.status.in_(["Completed", "Verified"])',
    'relativedelta(months=i)', 'strftime("%b %Y")',
    'CriticalTask.created_at >= month_start', 'CriticalTask.created_at < month_end', 'CriticalTask.completed_at >= month_start', 'CriticalTask.completed_at < month_end',
    'month_end = this_month - relativedelta(months=i - 1) if i > 0 else now',
  ]) assert.ok(body.includes(piece), `reports_summary no longer has: ${piece}`);
  assert.match(body, /\.join\(CriticalTask, CriticalTask\.assigned_owner_id == GRCUser\.id\)/, 'the server\'s workload is the first owner: the one difference this file makes on purpose');
});
