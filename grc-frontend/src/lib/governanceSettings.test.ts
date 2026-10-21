// node --test src/lib/governanceSettings.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changes, courseOf, daysFor, noAccess, renderTemplate, retrySettings, sampleValues, shownKinds, templateProblem, validate, type GovernanceSettings } from './governanceSettings.ts';

const base: GovernanceSettings = {
  review_days: 7, approval_days: 7, ack_days: 14, remind_days: 3, remind_every_days: 0, owner_after_days: 0, admin_after_days: 7,
  escalate_role_id: null, email: true,
  notify: { request: 'both', reminder: 'both', overdue: 'both', escalation: 'both', approved: 'both', published: 'both', rejected: 'both',
    changes: 'both', resubmitted: 'both', delegated: 'both' },
  task_create: { review: true, approval: true, acknowledgement: true, changes: true },
  task_priority: { review: 'High', approval: 'High', acknowledgement: 'Medium', changes: 'High' },
  task_title: '{action}: {document}',
  task_description: 'Please {verb} "{document}", version {version}, by {due_date}.',
  task_category: 'Compliance',
};

test('the defaults are valid', () => {
  assert.deepEqual(validate(base), {});
});

test('numbers out of range, and escalation not after the owner, are named in the person\'s words', () => {
  const errors = validate({ ...base, review_days: 0, remind_every_days: 2.5, owner_after_days: 9 });
  assert.equal(errors.review_days, 'Days to review must be a whole number from 1 to 365.');
  assert.equal(errors.remind_every_days, 'Days between reminders must be a whole number from 0 to 60.');
  assert.match(errors.admin_after_days ?? '', /^Escalate further later than the owner is told/);
  assert.deepEqual(validate({ ...base, owner_after_days: 6 }), {});
});

test('templates: unknown placeholders, open braces and empty text are refused like the server does', () => {
  assert.equal(templateProblem('Task title', '{doc}', 200), 'Task title: {doc} is not a placeholder. Use {action}, {verb}, {document}, {version}, {due_date}, {owner}, {link}.');
  assert.match(templateProblem('Task title', '{document.__class__}', 200) ?? '', /is not a placeholder/);
  assert.match(templateProblem('Task title', '{document!r}', 200) ?? '', /is not a placeholder/);
  assert.equal(templateProblem('Task description', 'Read {document', 2000), 'Task description: a { or } is not closed. Placeholders look like {document}.');
  assert.equal(templateProblem('Task description', 'a } b', 2000), 'Task description: a { or } is not closed. Placeholders look like {document}.');
  assert.equal(templateProblem('Task title', '   ', 200), 'Task title cannot be empty.');
  assert.equal(templateProblem('Task title', 'x'.repeat(201), 200), 'Task title is too long (at most 200 characters).');
  assert.equal(templateProblem('Task title', 'Use {{braces}} for {document}', 200), null);
  assert.equal(validate({ ...base, task_title: '{who}' }).task_title?.startsWith('Task title: {who}'), true);
});

test('the preview fills every placeholder and keeps literal braces', () => {
  const today = new Date(Date.UTC(2026, 9, 18, 12));
  const values = sampleValues('acknowledgement', base, today);
  assert.equal(values.due_date, '01 Nov 2026');
  assert.equal(renderTemplate(base.task_title, values), 'Acknowledge: Acceptable Use Policy');
  assert.equal(renderTemplate(base.task_description, values), 'Please acknowledge "Acceptable Use Policy", version 1.2, by 01 Nov 2026.');
  assert.equal(renderTemplate(base.task_description, sampleValues('approval', base, today)), 'Please approve and sign "Acceptable Use Policy", version 1.2, by 25 Oct 2026.');
  assert.equal(renderTemplate('{{x}} {owner} {link}', sampleValues('review', base, today)), '{x} Sara Khan /governance/documents/3?tab=lifecycle');
  assert.equal(sampleValues('review', { ...base, review_days: 2 }, today).due_date, '20 Oct 2026');
});

test('a task category is needed, at most 100 characters', () => {
  assert.equal(validate({ ...base, task_category: '  ' }).task_category, 'Task category must be 1 to 100 characters.');
  assert.equal(validate({ ...base, task_category: 'x'.repeat(101) }).task_category, 'Task category must be 1 to 100 characters.');
  assert.deepEqual(validate({ ...base, task_category: 'Governance' }), {});
  assert.deepEqual(changes(base, { ...base, task_category: 'Governance' }), { task_category: 'Governance' });
});

test('only what changed is sent, a map whole, never the derived email switch', () => {
  assert.deepEqual(changes(base, base), {});
  const draft = { ...base, review_days: 3, email: false, notify: { ...base.notify, rejected: 'off' as const } };
  assert.deepEqual(changes(base, draft), { review_days: 3, notify: draft.notify });
  // the server's review_days follows approval_days until it is set: a new approval_days pins the review days the form shows
  assert.deepEqual(changes(base, { ...base, approval_days: 10 }), { approval_days: 10, review_days: 7 });
});

test('a request\'s course: first reminder, due date, owner told, escalated', () => {
  const today = new Date(Date.UTC(2026, 9, 18, 12));
  assert.deepEqual(courseOf('review', { ...base, owner_after_days: 1, admin_after_days: 5 }, today),
    { due: '25 Oct 2026', firstReminder: '22 Oct 2026', owner: '26 Oct 2026', further: '30 Oct 2026' });
  assert.equal(courseOf('review', { ...base, remind_days: 0 }, today).firstReminder, null);
  assert.equal(courseOf('review', { ...base, remind_days: 10 }, today).firstReminder, '18 Oct 2026');     // further ahead: at once
});

test('without a governance right the settings are refused once and said so, not retried', () => {
  const refused = { response: { status: 403, data: { detail: 'Only an administrator or someone with a governance right can see these settings.' } } };
  assert.equal(noAccess(refused), true);
  assert.equal(noAccess({ response: { status: 500 } }), false);
  assert.equal(noAccess(new Error('Network Error')), false);
  assert.equal(noAccess(null), false);
  assert.equal(retrySettings(0, refused), false);
  assert.equal(retrySettings(0, { response: { status: 502 } }), true);
  assert.equal(retrySettings(3, { response: { status: 502 } }), false);
});

test('proposed changes: their rows show only when the server has settings for them, given 3 days unless set', () => {
  assert.deepEqual(shownKinds(base), ['review', 'approval', 'acknowledgement', 'changes']);          // a server from before proposals
  const newer = { ...base, task_create: { ...base.task_create, decide: true, revise: false }, task_priority: { ...base.task_priority, decide: 'High' as const } };
  assert.deepEqual(shownKinds(newer), ['review', 'approval', 'acknowledgement', 'changes', 'decide', 'revise']);
  assert.deepEqual([daysFor('decide', base), daysFor('revise', { ...base, revise_days: 5 }), daysFor('changes', base), daysFor('review', base)], [3, 5, 7, 7]);
  const today = new Date(2026, 9, 18);
  assert.equal(sampleValues('decide', base, today).link, '/governance/documents/3?tab=proposals&proposal=12');
  assert.equal(sampleValues('decide', base, today).due_date, '21 Oct 2026');
  assert.equal(renderTemplate(base.task_description, sampleValues('decide', base, today)), 'Please accept or reject the proposed change "Acceptable Use Policy", version 1.2, by 21 Oct 2026.');
});
