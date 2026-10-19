// node --test trackedChanges.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ackBaseline, approvedVersionId, compareLine, defaultBaseline, isApprovalEvent, openingBaseline, versionOrigin, versionPill, versionsBetween } from './trackedChanges.ts';

const v = (id: number, origin: string, changes: number, extra: { restored_from?: string; reverts?: { since_version: string; changes: number } } = {}) =>
  ({ id, origin, changes, restored_from: extra.restored_from ?? null, reverts: extra.reverts ?? null });

test('the default baseline passes over sign-off stamps and versions that changed nothing', () => {
  assert.equal(defaultBaseline([v(1, 'initial', 0), v(2, 'ai', 3), v(3, 'signoff', 1), v(4, 'nochange', 0)]), 1);
  assert.equal(defaultBaseline([v(1, 'initial', 0), v(2, 'manual', 1), v(3, 'revert', 2)]), 2);
  assert.equal(defaultBaseline([v(1, 'initial', 0), v(2, 'signoff', 1)]), 1);
  assert.equal(defaultBaseline([v(1, 'initial', 0)]), 1);
  assert.equal(defaultBaseline([]), null);
});

test('a version is named by what made it', () => {
  assert.equal(versionOrigin(v(1, 'initial', 0)), 'Original');
  assert.equal(versionOrigin(v(2, 'manual', 1)), 'By hand');
  assert.equal(versionOrigin(v(3, 'restore', 2, { restored_from: '1.0' })), 'Restored v1.0');
  assert.equal(versionPill(v(4, 'revert', 2, { reverts: { since_version: '1.1', changes: 2 } })), 'Taken back 2 changes since v1.1');
  assert.equal(versionPill(v(5, 'signoff', 1)), 'Sign-off stamp');
});

test('a comparison covers the versions after its baseline up to its end', () => {
  const all = [v(1, 'initial', 0), v(2, 'ai', 1), v(3, 'revert', 1), v(4, 'signoff', 1)];
  assert.deepEqual(versionsBetween(all, 2).map((x) => x.id), [3, 4]);
  assert.deepEqual(versionsBetween(all, 1, 3).map((x) => x.id), [2, 3]);
  assert.deepEqual(versionsBetween(all, 9), []);
});

const at = (x: ReturnType<typeof v>, when: string, comparable = true) => ({ ...x, at: when, comparable });
const approvedAt = (when: string) => ({ at: when, to: 'approved' });

test('a document opens with the changes since the last approved version marked, when the text changed after it', () => {
  const vs = [at(v(1, 'initial', 0), '2026-10-01'), at(v(2, 'ai', 2), '2026-10-02'), at(v(3, 'manual', 1), '2026-10-04')];
  assert.deepEqual(openingBaseline(vs, [approvedAt('2026-10-03')]), { id: 2, approved: true });
  // published counts as approved; the version made in the same tick as the approval is the approved one
  assert.equal(approvedVersionId(vs, [{ at: '2026-10-02', to: 'published' }]), 2);
});

test('an approval stamped before every version takes the first version as the approved one', () => {
  const vs = [at(v(1, 'initial', 0), '2026-10-02'), at(v(2, 'ai', 2), '2026-10-03')];
  assert.equal(approvedVersionId(vs, [approvedAt('2026-10-01')]), 1);
  assert.deepEqual(openingBaseline(vs, [approvedAt('2026-10-01')]), { id: 1, approved: true });
  assert.equal(approvedVersionId([], [approvedAt('2026-10-01')]), null);
});

test('without an approval, or with nothing changed since it, the version before the newest change is the baseline', () => {
  const vs = [at(v(1, 'initial', 0), '2026-10-01'), at(v(2, 'ai', 2), '2026-10-02'), at(v(3, 'signoff', 1), '2026-10-03')];
  assert.deepEqual(openingBaseline(vs, []), { id: 1, approved: false });
  assert.deepEqual(openingBaseline(vs, [approvedAt('2026-10-03')]), { id: 1, approved: false });
});

test('nothing is marked for a single version, for stamps only, or when a version in between cannot be read', () => {
  assert.equal(openingBaseline([at(v(1, 'initial', 0), '2026-10-01')], []), null);
  assert.equal(openingBaseline([at(v(1, 'initial', 0), '2026-10-01'), at(v(2, 'signoff', 1), '2026-10-02')], []), null);
  assert.equal(openingBaseline([at(v(1, 'initial', 0), '2026-10-01'), at(v(2, 'ai', 1), '2026-10-02'), at(v(3, 'file', 0), '2026-10-03', false)], []), null);
});

test('the line says which versions are compared', () => {
  const vs = [{ id: 1, number: '1.0' }, { id: 2, number: '1.1' }, { id: 3, number: '1.2' }];
  assert.equal(compareLine(vs, 2, null, 2), 'Changes in v1.2 since v1.1 (approved)');
  assert.equal(compareLine(vs, 1, 2, null), 'Changes in v1.1 since v1.0 (the original)');
  assert.equal(compareLine(vs, 2, null, null), 'Changes in v1.2 since v1.1');
  assert.equal(compareLine(vs, 3, null, null), null);
});

test('a person asked again opens on the changes since the version they last acknowledged', () => {
  const vs = [
    { ...at(v(1, 'initial', 0), '2026-10-01'), number: '1.0' }, { ...at(v(2, 'ai', 2), '2026-10-02'), number: '1.1' },
    { ...at(v(3, 'manual', 1), '2026-10-03'), number: '2.0' }, { ...at(v(4, 'signoff', 1), '2026-10-04'), number: '2.0' },
  ];
  assert.equal(ackBaseline(vs, '1.0'), 1);
  assert.equal(ackBaseline(vs, '1.1'), 2);
  assert.equal(ackBaseline(vs, '2.0'), null);          // the newest 2.0 is the current one: nothing after it
  assert.equal(ackBaseline(vs, '9.9'), null);
  assert.equal(ackBaseline(vs, null), null);
  const unreadable = [vs[0], { ...vs[1], comparable: false }, vs[2]];
  assert.equal(ackBaseline(unreadable, '1.0'), null);
});

test('only review, approval, signing, rejection and publication events are approvals', () => {
  for (const kind of ['sent_for_review', 'sent_for_approval', 'signed', 'rejected', 'published', 'review_completed',
    'reviewed', 'approved', 'acknowledged', 'request_cancelled', 'participant_removed', 'return_to_draft']) assert.ok(isApprovalEvent({ kind, to: null }), kind);
  assert.ok(isApprovalEvent({ kind: 'status_changed', to: 'approved' }));
  assert.ok(!isApprovalEvent({ kind: 'status_changed', to: 'pending_review' }));
  assert.ok(!isApprovalEvent({ kind: 'created', to: null }));
  assert.ok(!isApprovalEvent({ kind: 'version_rollback', to: null }));
  assert.ok(!isApprovalEvent({ kind: 'owner_assigned', to: null }));                  // an owner change is not an approval
});
