// node --test "src/lib/statuses/tasks.test.ts"
// The Task Management words: every word the pages can show has a tone and a label (status, priority, SLA, approval, sub-task, SLA level), the lists the pages offer are
// registered (and nothing else is), the words are the ones the server writes, and an unknown word is neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { statusPill, type Statuses } from '../status.ts';
import { slaLevel, subTaskStatus, taskApproval, taskPriority, taskSla, taskStatus } from './tasks.ts';
import { PRIORITIES, STATUSES } from '../../app/(dashboard)/tasks/tasksModel.ts';
import { TASK_SLA_LABELS, TASK_SLA_ORDER } from '../../app/(dashboard)/tasks/slaConfig.ts';

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');
const ROUTER = new URL('../../../../backend/grc/routers/critical_tasks_router.py', import.meta.url);
const have = existsSync(ROUTER);

function covers(registry: Statuses, offered: readonly string[], extras: readonly string[] = []) {
  for (const word of offered) assert.ok(registry.has(word), `${registry.record}: "${word}" is offered and not registered`);
  const known = new Set([...offered, ...extras].map(norm));
  for (const word of registry.words) assert.ok(known.has(word), `${registry.record}: "${word}" is registered and nothing offers or writes it`);
}

test('every word the pages offer is registered, and nothing else is', () => {
  covers(taskStatus, STATUSES);
  covers(taskPriority, PRIORITIES);
  covers(taskSla, ['On Track', 'At Risk', 'Breached', 'Completed', 'No SLA']);
  covers(taskApproval, ['Pending', 'Approved', 'Rejected', 'Not Requested']);
  covers(subTaskStatus, ['Open', 'In Progress', 'Completed']);
  covers(slaLevel, TASK_SLA_ORDER);
});

test('the words are the ones the server writes (critical_tasks_router.py)', { skip: !have }, () => {
  const router = readFileSync(ROUTER, 'utf8');
  for (const word of ['On Track', 'At Risk', 'Breached', 'No SLA']) assert.ok(router.includes(`return "${word}"`), `_calc_sla_status says ${word}`);
  for (const word of ['Pending', 'Approved', 'Rejected']) assert.ok(router.includes(`task.approval_status = "${word}"`), `the approval routes write ${word}`);
  for (const word of STATUSES) assert.ok(router.includes(`"${word}"`), `${word} is a status of the router`);
});

test('the tones keep the meaning of the old colours: done green, moving blue, waiting purple, a look amber, late red, at rest grey', () => {
  assert.deepEqual(STATUSES.map((w) => taskStatus.tone(w)), ['neutral', 'progress', 'pending', 'success', 'success', 'warning']);
  assert.deepEqual(PRIORITIES.map((w) => taskPriority.tone(w)), ['danger', 'warning', 'progress', 'neutral']);
  assert.deepEqual(['On Track', 'At Risk', 'Breached', 'Completed', 'No SLA'].map((w) => taskSla.tone(w)), ['success', 'warning', 'danger', 'neutral', 'neutral']);
  assert.deepEqual(['Pending', 'Approved', 'Rejected'].map((w) => taskApproval.tone(w)), ['pending', 'success', 'danger']);
  assert.deepEqual(['Open', 'Completed'].map((w) => subTaskStatus.tone(w)), ['neutral', 'success']);
});

test('a pill always has its word, written the way the platform writes a status', () => {
  assert.deepEqual(statusPill(taskStatus, 'In Progress'), { tone: 'progress', label: 'In progress' });
  assert.deepEqual(statusPill(taskStatus, 'Under Review'), { tone: 'pending', label: 'Under review' });
  assert.deepEqual(statusPill(taskSla, 'No SLA'), { tone: 'neutral', label: 'No SLA' });
  assert.deepEqual(statusPill(taskSla, 'At Risk'), { tone: 'warning', label: 'At risk' });
  assert.deepEqual(statusPill(taskApproval, null), { tone: 'neutral', label: '—' });
  assert.deepEqual(statusPill(taskApproval, 'Not Requested'), { tone: 'neutral', label: 'Not requested' });
  assert.equal(slaLevel.label('info'), 'Informational');
  for (const level of TASK_SLA_ORDER) assert.equal(slaLevel.label(level).toLowerCase().startsWith(TASK_SLA_LABELS[level].toLowerCase().slice(0, 4)), true, `${level} reads as its SLA label`);
});

test('a status or priority nobody registered (a module wrote its own word, or its own case) is neutral with a readable label, never a guess', () => {
  assert.deepEqual(statusPill(taskStatus, 'planned'), { tone: 'neutral', label: 'Planned' });
  assert.deepEqual(statusPill(taskPriority, 'Informational'), { tone: 'neutral', label: 'Informational' });
  assert.deepEqual(statusPill(taskPriority, 'high'), { tone: 'warning', label: 'High' }, 'a lower-case word is the same word');
  assert.deepEqual(statusPill(taskStatus, null), { tone: 'neutral', label: '—' });
  assert.equal(taskStatus.tone('constructor'), 'neutral');
});
