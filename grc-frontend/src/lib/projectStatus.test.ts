// node --test "src/lib/projectStatus.test.ts"
// The Projects module's status words: every word a select of the project pages offers is registered (and the other way round, bar the words the AI "apply"
// step and the server's completion rule write), each word says what it used to say in colour, and an unknown word is neutral with its own readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { statusPill, type Statuses } from './status.ts';
import { budgetStatus, coverageStatus, dependencyStatus, milestoneStatus, projectHealth, projectStatus, riskStatus, taskStatus } from './projectStatus.ts';
import {
  BUDGET_STATUSES, COVERAGE_STATUSES, DEP_STATUSES, HEALTH_OPTIONS, MILESTONE_STATUSES, RISK_STATUSES, STATUSES, TASK_STATUSES,
} from '../app/(dashboard)/is-projects/_model.ts';

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');

function covers(registry: Statuses, offered: string[], extras: string[] = []) {
  for (const word of offered) assert.ok(registry.has(word), `${registry.record}: "${word}" is offered by a select and not registered`);
  const known = new Set([...offered, ...extras].map(norm));
  for (const word of registry.words) assert.ok(known.has(word), `${registry.record}: "${word}" is registered and nothing offers or writes it`);
}

test('every word a select offers is registered, and nothing else is, bar the words the AI plan and the completion rule write', () => {
  covers(projectStatus, STATUSES);
  covers(projectHealth, HEALTH_OPTIONS);
  covers(taskStatus, TASK_STATUSES, ['Not Started', 'Completed', 'Under Review']);      // AI plan: "Not Started"; BE/routers/is_projects_router.py reads Completed and Under Review
  covers(milestoneStatus, MILESTONE_STATUSES, ['Not Started']);                            // AI plan
  covers(riskStatus, RISK_STATUSES);
  covers(budgetStatus, BUDGET_STATUSES);
  covers(coverageStatus, COVERAGE_STATUSES);
  covers(dependencyStatus, DEP_STATUSES);
});

test('the tones keep the meaning the old colours had: moving blue, done green, held amber, blocked red, at rest grey', () => {
  assert.deepEqual(['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'].map((w) => projectStatus.tone(w)), ['pending', 'progress', 'warning', 'success', 'neutral']);
  assert.deepEqual(['On Track', 'At Risk', 'Off Track'].map((w) => projectHealth.tone(w)), ['success', 'warning', 'danger']);
  assert.deepEqual(['To Do', 'In Progress', 'In Review', 'Done', 'Blocked'].map((w) => taskStatus.tone(w)), ['neutral', 'progress', 'pending', 'success', 'danger']);
  assert.deepEqual(['Pending', 'In Progress', 'Completed', 'Delayed'].map((w) => milestoneStatus.tone(w)), ['pending', 'progress', 'success', 'danger']);
  assert.deepEqual(['Open', 'Mitigated', 'Closed', 'Resolved'].map((w) => riskStatus.tone(w)), ['warning', 'progress', 'neutral', 'success']);
  assert.deepEqual(['Pending', 'Approved', 'Rejected', 'Cancelled'].map((w) => budgetStatus.tone(w)), ['pending', 'success', 'danger', 'neutral']);
  assert.deepEqual(['Verified', 'Implemented', 'In Progress', 'Planned', 'Not Applicable'].map((w) => coverageStatus.tone(w)), ['success', 'progress', 'pending', 'neutral', 'neutral']);
  assert.deepEqual(['Active', 'Resolved', 'Blocked', 'Cancelled'].map((w) => dependencyStatus.tone(w)), ['progress', 'success', 'danger', 'neutral']);
});

test('a pill always has its word, written the way the platform writes a status', () => {
  assert.deepEqual(statusPill(projectStatus, 'In Progress'), { tone: 'progress', label: 'In progress' });
  assert.deepEqual(statusPill(projectHealth, 'Off Track'), { tone: 'danger', label: 'Off track' });
  assert.deepEqual(statusPill(coverageStatus, 'Not Applicable'), { tone: 'neutral', label: 'Not applicable' });
});

test('a word nobody registered is neutral with its own readable label, and a missing one is the dash', () => {
  assert.deepEqual(statusPill(projectStatus, 'Archived'), { tone: 'neutral', label: 'Archived' });
  assert.deepEqual(statusPill(taskStatus, 'Not Started'), { tone: 'neutral', label: 'Not started' });
  assert.deepEqual(statusPill(riskStatus, null), { tone: 'neutral', label: '—' });
  assert.equal(projectHealth.tone('constructor'), 'neutral');
});
