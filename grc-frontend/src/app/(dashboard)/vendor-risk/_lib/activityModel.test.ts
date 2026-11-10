// node --test "src/app/(dashboard)/vendor-risk/_lib/activityModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityLine, type ActivityEntry } from './activityModel.ts';

const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({ id: 1, entity: 'finding', action: 'create', actor_name: 'S. Ali', from_value: null, to_value: null, reason: null, created_at: '2026-11-09T10:00:00', ...over });

test('a line names who did what in words, with no record number and no user number', () => {
  const l = activityLine(entry({ entity_id: 12, actor_id: 5 } as Partial<ActivityEntry>));
  assert.equal(l.who, 'S. Ali');
  assert.equal(l.what, 'added a finding');
  assert.doesNotMatch(JSON.stringify(l), /#\d|User \d|\b12\b/);
});

test('nobody signed in is "The system", never "User N"', () => {
  assert.equal(activityLine(entry({ actor_name: null })).who, 'The system');
  assert.equal(activityLine(entry({ actor_name: '   ' })).who, 'The system');
});

test('what changed reads from to, or "Now" when there was nothing before; the reason follows', () => {
  assert.equal(activityLine(entry({ entity: 'tiering', action: 'update', from_value: 'medium', to_value: 'high' })).detail, 'Medium to High');
  assert.equal(activityLine(entry({ entity: 'stage', action: 'update', to_value: 'in_progress' })).detail, 'Now In progress');
  assert.equal(activityLine(entry({ entity: 'stage', action: 'skip', reason: 'Covered by the parent contract' })).detail, 'Covered by the parent contract');
  assert.equal(activityLine(entry({ from_value: 'open', to_value: 'closed', reason: 'Fixed' })).detail, 'Open to Closed · Fixed');
  assert.equal(activityLine(entry()).detail, '');
});

test('a thing or a verb nobody worded is still a readable sentence', () => {
  assert.equal(activityLine(entry({ entity: 'brand_new_kind', action: 'update' })).what, 'changed a record');
  assert.equal(activityLine(entry({ action: 'quarantine' })).what, 'quarantine a finding');
  assert.equal(activityLine(entry({ entity: 'vendor', action: 'archive' })).what, 'archived the supplier');
  assert.equal(activityLine(entry({ entity: 'engagement', action: 'offboard' })).what, 'started the exit of an engagement');
});

test('a very long value or reason is cut, not poured onto the screen', () => {
  const long = 'x'.repeat(400);
  const l = activityLine(entry({ to_value: long, reason: long }));
  assert.ok(l.detail.length < 260, String(l.detail.length));
});
