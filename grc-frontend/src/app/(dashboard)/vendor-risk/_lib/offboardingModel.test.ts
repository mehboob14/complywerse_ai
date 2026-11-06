// node --test "src/app/(dashboard)/vendor-risk/_lib/offboardingModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { exitLine, hintFor, openExits, progress, WHOLE } from './offboardingModel.ts';
import type { Offboarding } from './offboardingApi.ts';

const steps = (done: number, total = 7) => Array.from({ length: total }, (_, i) => ({ item: `Step ${i + 1}`, done: i < done }));

const base: Offboarding = {
  items: steps(3), started: true, archived_at: null, reason: 'Contract ended', started_at: '2026-03-05T10:00:00', started_by: 'Dana Okafor',
  notes: null, links_revoked: 2, engagements: [],
};
const payroll = { id: 12, name: 'Payroll run', ended: false, items: steps(1), done: 1, total: 7, completed_at: null,
  reason: 'Replaced by Contoso', started_at: '2026-03-06T08:00:00', started_by: 'Tara Analyst', notes: 'Certificate on the shared drive' };

test('nothing is under way until an exit starts, and the whole relationship leads when both are', () => {
  assert.deepEqual(openExits(undefined), []);
  assert.deepEqual(openExits({ ...base, started: false }), []);
  const both = openExits({ ...base, engagements: [payroll] });
  assert.deepEqual(both.map((x) => [x.scope, x.engagementId, x.name]), [['relationship', null, WHOLE], ['engagement', 12, 'Payroll run']]);
  assert.equal(both[1].notes, 'Certificate on the shared drive');
  assert.equal(both[1].linksRevoked, null);                                   // one engagement's exit closes no portal link
});

test('an archived supplier or an engagement that has ended is history, not an exit under way', () => {
  assert.deepEqual(openExits({ ...base, archived_at: '2026-04-01T00:00:00' }), []);
  assert.deepEqual(openExits({ ...base, started: false, engagements: [{ ...payroll, ended: true }] }), []);
  assert.deepEqual(openExits({ ...base, started: false, engagements: [{ ...payroll, completed_at: '2026-04-01T00:00:00' }] }), []);
});

test('one scope can be asked for: an engagement, or the whole relationship', () => {
  const all = { ...base, engagements: [payroll, { ...payroll, id: 13, name: 'Pensions' }] };
  assert.deepEqual(openExits(all, { engagementId: 13 }).map((x) => x.name), ['Pensions']);
  assert.deepEqual(openExits(all, { engagementId: null }).map((x) => x.name), [WHOLE]);
  assert.deepEqual(openExits(all, { engagementId: 99 }), []);
});

test('progress counts the steps ticked, and an empty list is never complete', () => {
  assert.deepEqual(progress(steps(3)), { done: 3, total: 7, all: false });
  assert.deepEqual(progress(steps(7)), { done: 7, total: 7, all: true });
  assert.deepEqual(progress([]), { done: 0, total: 0, all: false });
});

test('the line under the title says when it started, how far it is and what closed', () => {
  const [whole, one] = openExits({ ...base, engagements: [payroll] });
  assert.equal(exitLine(whole), 'Started 5 Mar 2026 · 3 of 7 steps done · 2 portal links revoked');
  assert.equal(exitLine(one), 'Started 6 Mar 2026 · 1 of 7 steps done');
  assert.equal(exitLine({ ...whole, linksRevoked: 1 }), 'Started 5 Mar 2026 · 3 of 7 steps done · 1 portal link revoked');
  assert.equal(exitLine({ ...whole, linksRevoked: null }), 'Started 5 Mar 2026 · 3 of 7 steps done · portal links revoked');
  assert.equal(exitLine({ ...whole, startedAt: null, items: steps(0, 1) }), '0 of 1 step done · 2 portal links revoked');
});

test('the standard steps have a hint and a step someone added has none', () => {
  assert.equal(hintFor('Final payments settled'), 'Nothing is owed either way.');
  assert.ok(['Revoke all vendor access and credentials', 'Return or certifiably destroy our data', 'Contracts closed out'].every((s) => hintFor(s)));
  assert.equal(hintFor('Collect the badges'), undefined);
});
