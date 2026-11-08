// node --test "src/app/(dashboard)/admin/scheduler/schedulerModel.test.ts"
// The Scheduled jobs page's rules: how often, how long ago (server times are UTC), which of four states, and words that name no queue, task or setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ago, clockWords, every, failingCount, failureWords, jobName, stateOf } from './schedulerModel.ts';

test('a job\'s key reads as a name', () => {
  assert.equal(jobName('feed-refresh'), 'Feed refresh');
  assert.equal(jobName('expiry_sweep'), 'Expiry sweep');
  assert.equal(jobName(''), 'Job');
});

test('how often a job runs is said in the largest whole unit', () => {
  assert.deepEqual([60, 900, 3600, 21600, 86400, 172800, 5400].map(every), ['Every 1 min', 'Every 15 min', 'Hourly', 'Every 6 hours', 'Daily', 'Every 2 days', 'Every 90 min']);
});

test('how long ago is counted from UTC: a time with no zone is UTC, so it reads the same in every time zone', () => {
  const now = Date.UTC(2026, 10, 8, 12, 0, 0);
  assert.equal(ago(null, now), 'Never');
  assert.equal(ago('2026-11-08T11:59:40', now), 'Just now');
  assert.equal(ago('2026-11-08T11:48:00', now), '12 min ago');
  assert.equal(ago('2026-11-08T07:00:00', now), '5 h ago');
  assert.equal(ago('2026-11-04T12:00:00Z', now), '4 days ago');
  assert.equal(ago('not a time', now), 'Never');
});

test('a job is in one of four states, a failure first', () => {
  assert.equal(stateOf({ last_failure: { at: null, attempts: 1, detail: 'x' }, last_queued_at: null, overdue: true }), 'failing');
  assert.equal(stateOf({ last_failure: null, last_queued_at: null, overdue: true }), 'never');
  assert.equal(stateOf({ last_failure: null, last_queued_at: '2026-11-08T10:00:00', overdue: true }), 'overdue');
  assert.equal(stateOf({ last_failure: null, last_queued_at: '2026-11-08T10:00:00', overdue: false }), 'on_schedule');
  assert.equal(failingCount([{ last_failure: null }, { last_failure: { at: null, attempts: 2, detail: '' } }]), 1);
});

test('the page says a failure without the queue\'s address or error text, and a switched-off clock without a setting name', () => {
  assert.equal(failureWords({ last_failure: null }), '');
  assert.equal(failureWords({ last_failure: { at: null, attempts: 1, detail: 'Error 111 connecting to localhost:6379' } }), 'Could not be queued');
  assert.equal(failureWords({ last_failure: { at: null, attempts: 3, detail: 'x' } }), 'Could not be queued · tried 3 times');
  assert.equal(clockWords({ enabled: true, tick_seconds: 300 }), 'Running · checks every 5 min');
  assert.equal(clockWords({ enabled: false, tick_seconds: 300 }), 'Switched off on this server');
  const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /DISABLE_PLATFORM_CLOCK|redis|celery|\.task\b/i, 'no setting, queue or task name on the page');
});
