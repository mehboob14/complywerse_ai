// node --test src/lib/vulnDepartments.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PATH_LEVELS, PATH_TARGETS, freeLevels, pathBody, pathSummary, targetLabel } from './vulnDepartments.ts';

test('the Add form sends what the server takes: a level, one of its targets, a percentage and the automatic switch', () => {
  assert.deepEqual(pathBody({ level: '2', target: 'head', threshold: '100', auto: true }),
    { escalation_level: 2, target_role: 'head', sla_threshold_percent: 100, auto_escalate: true });
  // the form used to send name, escalation_order and time_threshold_hours: the server has none of them, so every Add was a 422
  const body = pathBody({ level: 1, target: 'lead', threshold: '', auto: false });
  assert.deepEqual(Object.keys(body).sort(), ['auto_escalate', 'escalation_level', 'sla_threshold_percent', 'target_role']);
  assert.equal(body.auto_escalate, false);
});

test('the threshold is a whole percentage of at least 1, else the server default of 75', () => {
  const at = (threshold: string | number) => pathBody({ level: 1, target: 'lead', threshold, auto: true }).sla_threshold_percent;
  assert.equal(at(''), 75);
  assert.equal(at('0'), 75);
  assert.equal(at('-5'), 75);
  assert.equal(at('abc'), 75);
  assert.equal(at('82.6'), 83);
  assert.equal(at(150), 150);
});

test('the targets and levels are the ones the server allows', () => {
  assert.deepEqual(PATH_TARGETS.map((t) => t.value), ['lead', 'head', 'parent_dept_head']);   // "member" is refused with a 400
  assert.deepEqual([...PATH_LEVELS], [1, 2, 3]);
});

test('a path reads as who it goes to and when, and says when it is never used', () => {
  assert.equal(targetLabel('head'), 'Department head');
  assert.equal(targetLabel('parent_dept_head'), "Parent department's head");
  assert.equal(targetLabel('somebody-new'), 'somebody-new');                                    // an unknown target is shown, not hidden
  assert.equal(pathSummary({ target_role: 'lead', sla_threshold_percent: 75, auto_escalate: true }), 'Department lead · at 75% of the SLA');
  assert.equal(pathSummary({ target_role: 'head', sla_threshold_percent: 100, auto_escalate: false }),
    'Department head · at 100% of the SLA · automatic escalation is off');
});

test('only the levels no path uses are offered, lowest first', () => {
  assert.deepEqual(freeLevels([]), [1, 2, 3]);
  assert.deepEqual(freeLevels([{ escalation_level: 2 }]), [1, 3]);
  assert.deepEqual(freeLevels([{ escalation_level: 3 }, { escalation_level: 1 }, { escalation_level: 2 }]), []);
});
