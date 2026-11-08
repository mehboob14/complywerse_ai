// node --test "src/app/(dashboard)/governance/regulatory-changes/_lib/drafts.test.ts"
// The tasks raised from an obligation or an impact assessment: what they carry, and the title of an assessment.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DUE_PRESETS, assessmentTitle, hasGap, inDays, taskForAssessment, taskForObligation } from './drafts.ts';
import type { Assessment, Obligation } from './types.ts';

const ob = (over: Partial<Obligation> = {}): Obligation => ({
  id: 5, ref: '4.2', quote: 'Banks shall report within 24 hours.', summary: 'Report incidents within 24 hours', obligation_type: 'reporting', applies_to: [], deadline: '2026-12-01', deadline_text: null,
  priority: 'high', verified: true, match_score: null, compliance_status: 'not_assessed', owner_id: 7, owner_name: 'Officer', owner_ids: [7, 8], department: null, notes: 'Runbook exists.', source: 'ai', ...over,
});
const assessment = (over: Partial<Assessment> = {}): Assessment => ({ id: 3, impact_level: 'high', impacted_item_type: 'policy', impacted_item_id: 11, impact_description: "Policy 'Incident response' requires update", ...over });

test('a task from an obligation carries its words, deadline, priority and owners, and the circular\'s quote', () => {
  const t = taskForObligation(ob());
  assert.equal(t.title, 'Report incidents within 24 hours');
  assert.equal(t.obligation_id, 5);
  assert.equal(t.due_date, '2026-12-01');
  assert.equal(t.priority, 'high');
  assert.deepEqual(t.assignee_ids, [7, 8]);
  assert.equal(t.description, 'Clause 4.2.\n\nThe circular: “Banks shall report within 24 hours.”\n\nRunbook exists.');
  assert.equal(taskForObligation(ob({ summary: 'x'.repeat(200) })).title?.length, 138, 'a long summary is cut to a title');
  assert.deepEqual(taskForObligation(ob({ owner_ids: undefined, owner_id: null })).assignee_ids, []);
});

test('a task from an impact assessment names what it fixes: the gap when there is one, else what changes; the kind sets the task type and the link', () => {
  const p = taskForAssessment(assessment({ gap_identified: true, gap_description: 'No retention schedule' }));
  assert.equal(p.title, "Remediate: Policy 'Incident response' requires update");
  assert.equal(p.description, 'No retention schedule');
  assert.equal(p.task_type, 'policy_update');
  assert.equal(p.linked_policy_id, 11);
  assert.equal(p.linked_control_id, null);
  assert.equal(p.impact_assessment_id, 3);
  const c = taskForAssessment(assessment({ impacted_item_type: 'control', impacted_item_id: 40, gap_description: 'Action needed: update', impact_level: 'weird' }));
  assert.equal(c.task_type, 'control_update');
  assert.equal(c.linked_control_id, 40);
  assert.equal(c.priority, 'low', 'a level the server does not know is the lowest');
  assert.match(c.description || '', /requires update/, 'an "Action needed:" line is not a description of the gap');
});

test('an assessment is titled by the record it names, else by the AI\'s first line, else by its kind', () => {
  assert.equal(assessmentTitle(assessment({ impacted_item_name: 'Incident response policy' })), 'Incident response policy');
  assert.equal(assessmentTitle(assessment()), "Policy 'Incident response' requires update");
  assert.equal(assessmentTitle(assessment({ impact_description: 'Control AC-2 needs work' })), 'Policy assessment', 'a line that starts with "Control" is not a name');
  assert.equal(hasGap({ gap_identified: false }), false);
  assert.equal(hasGap({ compliance_gaps: 'x' }), true);
});

test('the due presets are days from today, written as the date the date field takes', () => {
  const today = new Date(2026, 10, 28);
  assert.deepEqual(DUE_PRESETS.map(([, n]) => inDays(n, today)), ['2026-12-05', '2026-12-12', '2026-12-28', '2027-02-26']);
});
