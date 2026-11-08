// node --test "src/app/(dashboard)/tasks/_insights/aiModel.test.ts"
// The AI helpers of Task Management (aiModel.ts): what each one reads is said in words and is what the server selects (a test re-reads the router for the 50), only suggestions worth offering are
// offered, and a prediction's risk and confidence read the same whether the AI wrote a fraction, a percent or a word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import type { RegisterTask } from '../taskRecord.ts';
import { AI_READS, aiReach, loadChips, percentOf, predictionView, priorityRows, reassignRows, riskTone } from './aiModel.ts';

function task(id: number, over: Partial<RegisterTask> = {}): RegisterTask {
  return {
    id, title: `Task ${id}`, source: 'Manual', source_module: null, source_entity_type: null, priority: 'Medium', status: 'Open', category: 'Other',
    assigned_owner_id: 5, assigned_owner: { id: 5, display_name: 'Ada' }, reviewer_id: null, reviewer: null, created_by_id: 2, created_by: null,
    due_date: null, sla_status: 'No SLA', completed_at: null, created_at: null, updated_at: null, ...over,
  };
}
const many = (n: number, over: (i: number) => Partial<RegisterTask> = () => ({})) => Array.from({ length: n }, (_, i) => task(i + 1, over(i)));

test('what the helper reads is said in words: fewer than 50, all of them; more, the 50 it picks and how many there are', () => {
  assert.equal(aiReach('prioritize', many(12), true), 'Reads all 12 tasks: the open tasks you can see.');
  assert.equal(aiReach('prioritize', many(1), true), 'Reads all 1 task: the open tasks you can see.');
  assert.equal(aiReach('prioritize', many(80), true), 'Reads 50 tasks: the open tasks you can see created most recently, of 80. The others are not looked at.');
  assert.equal(aiReach('prioritize', many(20, (i) => ({ status: i < 5 ? 'Completed' : 'Open' })), true), 'Reads all 15 tasks: the open tasks you can see.', 'a finished task is not read');
  assert.equal(aiReach('prioritize', [], true), 'There are no open tasks to read.');
});

test('Predict reads only the open tasks that have a due date, the ones that fall due soonest', () => {
  const rows = many(90, (i) => ({ due_date: i < 70 ? '2026-12-01T00:00:00' : null }));
  assert.equal(aiReach('predict', rows, true), 'Reads 50 tasks: the open tasks with a due date you can see that fall due soonest, of 70. The others are not looked at.');
  assert.equal(aiReach('predict', many(4, () => ({ due_date: '2026-12-01T00:00:00' })), true), 'Reads all 4 tasks: the open tasks with a due date you can see.');
  assert.equal(aiReach('predict', many(4), true), 'There are no open tasks with a due date to read.');
});

test('Balance reads every open task, and says a document request is never moved', () => {
  assert.equal(aiReach('balance', many(300), true), 'Reads every open task you can see (300 tasks). A document request counts in the load and is never moved.');
  assert.equal(aiReach('balance', [], true), 'There are no open tasks to read.');
});

test('a load that was cut at the ceiling does not claim a count it does not have', () => {
  assert.equal(aiReach('prioritize', many(80), false), 'Reads 50 tasks: the open tasks you can see created most recently. The others are not looked at.');
  assert.equal(aiReach('balance', many(80), false), 'Reads every open task you can see. A document request counts in the load and is never moved.');
});

const router = new URL('../../../../../../backend/grc/routers/critical_tasks_router.py', import.meta.url);
test('the 50 is the server\'s: Reprioritize takes the newest 50 open tasks, Predict the 50 due soonest, Balance has no limit', { skip: !existsSync(router) }, () => {
  const text = readFileSync(router, 'utf8');
  const part = (name: string, next: string) => text.slice(text.indexOf(`def ${name}`), text.indexOf(`def ${next}`));
  assert.equal(AI_READS, 50);
  const prioritize = part('ai_prioritize_tasks', 'ai_analyze_root_cause');
  assert.match(prioritize, /\.order_by\(CriticalTask\.created_at\.desc\(\)\)\.limit\(50\)/);
  assert.match(prioritize, /CriticalTask\.status\.notin_\(\["Completed", "Verified"\]\)/);
  const predict = part('ai_predict_escalations', 'ai_balance_workload');
  assert.match(predict, /CriticalTask\.due_date\.isnot\(None\)/);
  assert.match(predict, /\.order_by\(CriticalTask\.due_date\.asc\(\)\)\.limit\(50\)/);
  const balance = text.slice(text.indexOf('def ai_balance_workload'));
  assert.doesNotMatch(balance.slice(0, balance.indexOf('client = _get_openai_client()')), /\.limit\(/);
  assert.match(balance, /source_module == doc_lifecycle\.SOURCE_MODULE:\s+continue/, 'a document request is never in the movable tasks');
});

// ── Reprioritize ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('priority rows: named by title, the task\'s real current priority, only changes that change something, one per task, only the four priorities in the workflow\'s spelling', () => {
  const rows = [task(1, { priority: 'High' }), task(2, { priority: 'Low', title: 'Patch the firewall' }), task(3, { priority: 'critical' })];
  const out = priorityRows([
    { task_id: 1, current_priority: 'Low', suggested_priority: 'high', justification: 'already High: nothing to change' },       // the AI believed Low; the task is High
    { task_id: 2, current_priority: 'Low', suggested_priority: 'critical', justification: ' Customer data is exposed. ' },
    { task_id: 2, current_priority: 'Low', suggested_priority: 'High' },                                                           // a second one for the same task
    { task_id: 3, current_priority: 'Critical', suggested_priority: 'Urgent' },                                                    // not one of the four
    { task_id: 99, current_priority: 'Medium', suggested_priority: 'High', justification: 'not in the list' },
    { current_priority: 'Low', suggested_priority: 'High' },                                                                       // no task
    { task_id: 4, suggested_priority: undefined },
  ], rows, false);
  assert.deepEqual(out.map((r) => [r.taskId, r.title, r.current, r.suggested, r.reason]), [[2, 'Patch the firewall', 'Low', 'Critical', 'Customer data is exposed.'], [99, null, 'Medium', 'High', 'not in the list']], 'a list cut at the ceiling may be too short to hold a real task');
  assert.deepEqual(priorityRows([{ task_id: 99, suggested_priority: 'High' }, { task_id: 2, suggested_priority: 'High' }], rows, true).map((r) => r.taskId), [2], 'with every task loaded, a task that is not there is an id the AI made up');
  assert.deepEqual(priorityRows(null, rows, true), []);
  assert.deepEqual(priorityRows([{ task_id: 3, suggested_priority: 'high' }], rows, true).map((r) => r.current), ['Critical'], 'the real priority, in the workflow\'s spelling');
});

// ── Balance ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('reassign rows: the task must be in the list and the person known by id, not already the owner; the people after the move are the new owner first and everyone else who was on it', () => {
  const rows = [
    task(1, { title: 'Update the register', assigned_user_ids: [5, 8, 9], assignees: [{ id: 5 }, { id: 8 }, { id: 9 }] }),
    task(2),
    task(5, { assigned_owner_id: 5, assigned_owner: { id: 5, display_name: 'Ada' }, assigned_user_ids: [5, 7], assignees: [{ id: 5 }, { id: 7 }] }),
  ];
  const out = reassignRows([
    { task_id: 1, task_title: 'AI title', current_owner: 'Someone', suggested_owner: 'Bo', suggested_owner_id: 7, reason: ' Bo has room ' },
    { task_id: 2, suggested_owner: 'Ada', suggested_owner_id: 5 },                               // Ada already owns it
    { task_id: 3, task_title: 'Not in the list', current_owner: 'Cy', suggested_owner: 'Di', suggested_owner_id: 8 },   // the list does not hold it: its people are not known
    { task_id: 4, suggested_owner: 'Nobody known', suggested_owner_id: null },                    // the AI named someone who is nobody
    { task_id: 1, suggested_owner: 'Cy', suggested_owner_id: 9 },                                  // a second one for task 1
    { task_id: 5, current_owner: 'Ada', suggested_owner: 'Bo', suggested_owner_id: 7 },          // Bo is already on it: he moves to the front, Ada leaves, nobody twice
  ], rows);
  assert.deepEqual(out.map((r) => [r.taskId, r.title, r.from, r.to, r.people, r.reason]), [[1, 'Update the register', 'Ada', 'Bo', [7, 8, 9], 'Bo has room'], [5, 'Task 5', 'Ada', 'Bo', [7], '']]);
  assert.deepEqual(reassignRows([{ task_id: 2, suggested_owner: 'Bo', suggested_owner_id: 7 }], [task(2, { assigned_owner_id: null, assigned_owner: null })]).map((r) => [r.from, r.people]), [['Nobody', [7]]], 'a task nobody had');
});

test('the load the AI describes: a number, or an object with a count and a level; anything else is left out', () => {
  assert.deepEqual(loadChips({ Ada: 7, Bo: { task_count: 3, load_level: 'low' }, Cy: { load_level: 'high' }, Di: 'many', Ed: { task_count: 2 } }), [
    { name: 'Ada', count: 7, level: null }, { name: 'Bo', count: 3, level: 'low' }, { name: 'Ed', count: 2, level: null },
  ]);
  assert.deepEqual(loadChips(null), []);
});

// ── Predict ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a score reads on a 0-100 scale whether the AI wrote 85, 0.85 or "85"; the risk rule is the old one: 80 and up danger, 50 and up warning', () => {
  assert.equal(percentOf(85), 85);
  assert.equal(percentOf(0.85), 85);
  assert.equal(percentOf('72'), 72);
  assert.equal(percentOf(1), 100);
  assert.equal(percentOf(0), 0);
  assert.equal(percentOf('high'), null);
  assert.equal(percentOf(-3), null);
  assert.equal(percentOf(undefined), null);
  assert.deepEqual([riskTone(80), riskTone(79.9), riskTone(50), riskTone(49), riskTone(null)], ['danger', 'warning', 'warning', 'success', 'success']);
});

test('a prediction reads as a title, a task to open, a risk, a confidence (a percent or the AI\'s own word), a day, factors and actions', () => {
  const v = predictionView({ task_id: 12, title: ' Renew the certificate ', risk_score: 0.9, confidence: 'high', predicted_breach_date: '2026-11-20', risk_factors: ['No owner', ' ', 3 as never], recommended_actions: ['Assign someone'] });
  assert.deepEqual(v, { taskId: 12, title: 'Renew the certificate', tone: 'danger', risk: 90, confidence: 'High', breach: '2026-11-20', factors: ['No owner'], actions: ['Assign someone'] });
  const bare = predictionView({});
  assert.deepEqual([bare.taskId, bare.title, bare.tone, bare.risk, bare.confidence, bare.breach], [null, 'A task', 'success', null, null, null]);
  assert.equal(predictionView({ confidence: 0.834 }).confidence, '83%');
  assert.equal(predictionView({ confidence: 72 }).confidence, '72%');
});
