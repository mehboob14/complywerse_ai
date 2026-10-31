// Run from this folder: node --test docTabs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { docTabs, type DocTabsInput } from './docTabs.ts';
import { VIEWS, viewOf } from './docRoute.ts';

const base: DocTabsInput = { library: true, open: 'document', proposals: 0, proposalsWaiting: 0, openRemarks: 0, pendingApprovals: 0, yourStep: false };
const keys = (over: Partial<DocTabsInput> = {}) => docTabs({ ...base, ...over }).map((t) => t.key);

test('a reader of the library sees the same views, in the same order, with the same names as before', () => {
  assert.deepEqual(docTabs(base).map((t) => [t.key, t.label]), [
    ['document', 'Document'], ['approvals', 'Approvals'], ['discussion', 'Discussion'], ['statements', 'Statements'], ['mappings', 'Mappings'], ['gaps', 'Gap analysis'],
    ['versions', 'Change log'],
  ]);
});

test('Proposed changes is in the strip once there is a proposal, or while it is the open view', () => {
  assert.ok(!keys().includes('proposals'));
  assert.ok(keys({ proposals: 1 }).includes('proposals'));
  assert.ok(keys({ open: 'proposals' }).includes('proposals'));
  assert.deepEqual(docTabs({ ...base, proposals: 2 }).map((t) => t.key), VIEWS.map((v) => v.key));        // all eight, in VIEWS order
});

test('without the right to read the library, its three views are not offered', () => {
  assert.deepEqual(keys({ library: false }), ['document', 'approvals', 'discussion', 'versions']);
  assert.deepEqual(keys({ library: false, proposals: 1 }), ['document', 'approvals', 'proposals', 'discussion', 'versions']);
});

test('every view an old link can ask for is a view the strip can show', () => {
  const shown = new Set(docTabs({ ...base, proposals: 1 }).map((t) => t.key));
  for (const tab of ['viewer', 'lifecycle', 'sign-off', 'comments', 'review-history', 'proposals', 'proposed-changes', 'controls', 'gap-analysis', 'chain', 'change-log', 'history']) {
    assert.ok(shown.has(viewOf(tab)), tab);
  }
});

test('the badges: a count only when there is something to count, and "Your step" instead of a count on Approvals', () => {
  const tab = (over: Partial<DocTabsInput>, key: string) => docTabs({ ...base, proposals: 1, ...over }).find((t) => t.key === key);
  assert.equal(tab({ pendingApprovals: 0 }, 'approvals')?.count, undefined);
  assert.equal(tab({ pendingApprovals: 3 }, 'approvals')?.count, 3);
  assert.deepEqual(tab({ yourStep: true, pendingApprovals: 3 }, 'approvals'), { key: 'approvals', label: 'Approvals · Your step' });
  assert.equal(tab({ openRemarks: 0 }, 'discussion')?.count, undefined);
  assert.equal(tab({ openRemarks: 12 }, 'discussion')?.count, 12);
  assert.equal(tab({ proposalsWaiting: 2 }, 'proposals')?.count, 2);
  assert.equal(tab({}, 'document')?.count, undefined);
});
