// node --test "src/app/(dashboard)/tasks/_create/templateModel.test.ts"
// New task > From a template: what a template gives in words, and the body sent to create-from-template (read against the router).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checklistOf, deadlineWords, emptyTemplateForm, templateBody, templateFacts, templateKey, templateProblem, type TemplateRow } from './templateModel.ts';

const shipped: TemplateRow = { id: null, name: 'Vulnerability Remediation', description: 'Patch and verify', category: 'Remediation', priority: 'Critical', sla_days: 14, is_system: true, sub_tasks_template: [{ title: 'Assessment' }, { title: 'Patching/Fix' }, { title: ' ' }, 'Testing'] };
const own: TemplateRow = { id: 7, name: 'Quarterly review', description: null, category: 'Review', priority: 'Medium', sla_days: null, is_system: false, sub_tasks_template: [] };

test('a template says what it gives: category, priority, the deadline in days after it is created, the steps', () => {
  assert.equal(templateFacts(shipped), 'Remediation · Critical priority · Due 14 days after it is created · 3 steps');
  assert.equal(templateFacts(own), 'Review · Medium priority · No deadline');
  assert.equal(deadlineWords({ sla_days: 1 }), 'Due 1 day after it is created');
  assert.deepEqual(checklistOf(shipped), ['Assessment', 'Patching/Fix', 'Testing']);
  assert.deepEqual(checklistOf(own), []);
  assert.notEqual(templateKey(shipped), templateKey(own));
  assert.equal(templateKey(own), 'id-7');
});

test('the form starts with the template\'s name as the title; an empty or over-long title is refused before anything is sent', () => {
  const form = emptyTemplateForm(shipped);
  assert.deepEqual(form, { title: 'Vulnerability Remediation', owner: '', reviewer: '', approval: false });
  assert.equal(templateProblem(form), null);
  assert.match(templateProblem({ ...form, title: '  ' }) as string, /Enter a title/);
  assert.match(templateProblem({ ...form, title: 'x'.repeat(256) }) as string, /255 characters at most/);
});

test('the body names the template (id for the organization\'s own, name for a shipped one) and adds the people and the approval flag only when chosen', () => {
  assert.deepEqual(templateBody(shipped, { title: ' Patch ACME ', owner: '', reviewer: '', approval: false }), { template_name: 'Vulnerability Remediation', title: 'Patch ACME' });
  assert.deepEqual(templateBody(own, { title: 'Q4', owner: '4', reviewer: '9', approval: true }), { template_name: 'Quarterly review', template_id: 7, title: 'Q4', assigned_owner_id: 4, reviewer_id: 9, approval_required: true });
});

test('the body is what create-from-template reads (the router is re-read): template_id / template_name, title, assigned_owner_id, reviewer_id, approval_required', () => {
  const src = readFileSync('../backend/grc/routers/critical_tasks_router.py', 'utf8');
  const body = /def create_from_template\([\s\S]*?return _serialize_task\(task, include_relations=True\)/.exec(src)?.[0] ?? '';
  assert.ok(body.length > 500, 'found the endpoint');
  for (const key of ['template_name', 'template_id', 'title', 'assigned_owner_id', 'reviewer_id', 'approval_required']) assert.match(body, new RegExp(`data\\.get\\("${key}"`), key);
  assert.match(src, /@router\.get\("\/templates\/list"\)/);
  assert.match(src, /@router\.post\("\/create-from-template"/);
});
