// node --test "src/app/(dashboard)/workflow-engine/workflowModel.test.ts"
// The Workflow Engine page's rules: tabs, the list newest first with triggers in words, the count of runs, the mail form's sentences and body, and the sample data of a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasSmtpErrors, isEmail, newestFirst, parseSample, runsLine, SMTP_DEFAULTS, smtpBody, smtpErrors, TAB_KEYS, TAB_LABELS, triggerWords, tryBody, TRY_DEFAULT_EVENT,
} from './workflowModel.ts';

test('the five tabs the page always had are kept, each with a name', () => {
  assert.deepEqual(TAB_KEYS, ['builder', 'workflows', 'analytics', 'approvals', 'schedules']);
  assert.deepEqual(TAB_KEYS.map((k) => TAB_LABELS[k]), ['Builder', 'Workflows', 'Analytics', 'Approvals', 'Schedules & webhooks']);
});

test('a trigger is said in words, not as a code name', () => {
  assert.equal(triggerWords('risk.created'), 'Risk created');
  assert.equal(triggerWords('manual.trigger'), 'Manual trigger');
  assert.equal(triggerWords('evidence_uploaded'), 'Evidence uploaded');
  assert.equal(triggerWords(''), '—');
  assert.equal(triggerWords(null), '—');
});

test('saved workflows list newest first by when they were last changed (UTC), one without a time last, ties in the server order', () => {
  const rows = [
    { id: 1, name: 'a', updated_at: '2026-11-01T10:00:00' },
    { id: 2, name: 'b', updated_at: null },
    { id: 3, name: 'c', updated_at: '2026-11-05T08:00:00' },
    { id: 4, name: 'd', updated_at: '2026-11-01T10:00:00' },
  ];
  assert.deepEqual(newestFirst(rows).map((r) => r.id), [3, 1, 4, 2]);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3, 4], 'the input is not reordered');
});

test('the line of runs counts every run and names only the kinds that are not zero', () => {
  assert.equal(runsLine({ total_instances: 12, completed: 9, running: 1, failed: 1, waiting: 1 }), '12 runs · 9 completed · 1 running · 1 failed · 1 waiting');
  assert.equal(runsLine({ total_instances: 1, completed: 1 }), '1 run · 1 completed');
  assert.equal(runsLine({}), '0 runs');
  assert.equal(runsLine(null), '0 runs');
  assert.equal(runsLine({ total_instances: 1234, completed: 1200 }), '1,234 runs · 1,200 completed');
});

test('the mail form says why it cannot be saved, and sends the same body the page always sent', () => {
  assert.equal(isEmail('noreply@yourcompany.com'), true);
  assert.equal(isEmail('nope'), false);
  const empty = smtpErrors(SMTP_DEFAULTS);
  assert.deepEqual(Object.keys(empty).sort(), ['smtp_password', 'smtp_username']);
  assert.equal(hasSmtpErrors(empty), true);
  assert.ok(smtpErrors({ ...SMTP_DEFAULTS, smtp_host: ' ', smtp_username: 'a', smtp_password: 'b', smtp_port: '99999', from_email: 'x' }).smtp_port);
  assert.ok(smtpErrors({ ...SMTP_DEFAULTS, smtp_username: 'a', smtp_password: 'b', from_email: 'x' }).from_email);
  const good = { ...SMTP_DEFAULTS, smtp_username: ' me@x.com ', smtp_password: 'secret' };
  assert.equal(hasSmtpErrors(smtpErrors(good)), false);
  assert.deepEqual(smtpBody(good), {
    config_name: 'default', smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_username: 'me@x.com', smtp_password: 'secret', from_email: 'me@x.com', from_name: 'ComplyVerse', use_tls: true,
  });
  assert.equal(smtpBody({ ...good, smtp_port: '' }).smtp_port, 587, 'no port is the usual one');
  assert.equal(smtpBody({ ...good, from_email: 'noreply@x.com', config_name: ' ' }).from_email, 'noreply@x.com');
  assert.equal(SMTP_DEFAULTS.smtp_password, '', 'the password is never pre-filled');
});

test('the sample data of a test run is empty or an object, and the body names the workflow, the event and the data', () => {
  assert.deepEqual(parseSample(''), { ok: true, value: {} });
  assert.deepEqual(parseSample('  '), { ok: true, value: {} });
  assert.deepEqual(parseSample('{"severity":"high"}'), { ok: true, value: { severity: 'high' } });
  assert.equal(parseSample('{oops').ok, false);
  assert.equal(parseSample('[1,2]').ok, false);
  assert.equal(parseSample('"text"').ok, false);
  assert.match((parseSample('{oops') as { message: string }).message, /not valid/);
  assert.deepEqual(tryBody(7, ' ', {}), { workflow_definition_id: 7, trigger_event: TRY_DEFAULT_EVENT, payload: {} });
  assert.deepEqual(tryBody(7, 'risk.created', { a: 1 }), { workflow_definition_id: 7, trigger_event: 'risk.created', payload: { a: 1 } });
});
