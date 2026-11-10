// node --test "src/app/(dashboard)/vendor-risk/_lib/policyModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_REOPEN, approverOptions, savePatch, atDefaults, bandsBad, cadenceBad, isDirty, policyPatch, problems, reopenFrom, standing, toDraft, toggled,
  windowBad, withDefaults, type PolicyView,
} from './policyModel.ts';

const POLICY: PolicyView = {
  thresholds: { critical: 75, high: 50, medium: 25 },
  cadence_days: { critical: 180, high: 365, medium: 730, low: 1095 },
  remediation_days: { critical: 7, high: 30, medium: 90, low: 180 },
  skip_matrix: { critical: [], high: [], medium: ['dd_planning'], low: ['dd_planning', 'questionnaire', 'scoring', 'findings'] },
  required_reviewers: { critical: ['security', 'privacy', 'legal'], high: ['security', 'privacy'], medium: ['security'], low: [] },
  approver_roles: { critical: null, high: null, medium: null, low: null },
};
const saved = () => toDraft(POLICY, DEFAULT_REOPEN);

test('a draft is a copy: editing it never touches what was loaded', () => {
  const draft = saved();
  draft.skip_matrix.high.push('scoring');
  draft.cadence_days.critical = 90;
  assert.deepEqual(POLICY.skip_matrix.high, []);
  assert.equal(POLICY.cadence_days.critical, 180);
});

test('nothing changed, nothing is sent', () => {
  assert.equal(policyPatch(saved(), saved()), null);
  assert.equal(savePatch(saved(), saved()), null);
  assert.equal(isDirty(saved(), saved()), false);
});

test('only the settings that changed are sent, and within one only the tiers that did', () => {
  const draft = saved();
  draft.cadence_days.critical = 90;
  draft.remediation_days.low = 120;
  draft.skip_matrix.high = ['scoring'];
  draft.required_reviewers.low = ['security'];
  draft.approver_roles.critical = 'Risk Committee';
  assert.deepEqual(policyPatch(draft, saved()), {
    cadence_days: { critical: 90 },
    remediation_days: { low: 120 },
    skip_matrix: { high: ['scoring'] },
    required_reviewers: { low: ['security'] },
    approver_roles: { critical: 'Risk Committee' },
  });
  assert.equal(isDirty(draft, saved()), true);
});

test('the three bands go together: one moved, all three are sent', () => {
  const draft = saved();
  draft.thresholds.high = 55;
  assert.deepEqual(policyPatch(draft, saved()), { thresholds: { critical: 75, high: 55, medium: 25 } });
});

test('a chip list has no order of its own: the same chips in another order are no change', () => {
  const draft = saved();
  draft.required_reviewers.critical = ['legal', 'security', 'privacy'];
  assert.equal(policyPatch(draft, saved()), null);
  draft.required_reviewers.critical = ['legal', 'security'];
  assert.deepEqual(policyPatch(draft, saved()), { required_reviewers: { critical: ['legal', 'security'] } });
});

test('an approver role put back to "anyone" is a change to null, and an unchanged null is not one', () => {
  const was = toDraft({ ...POLICY, approver_roles: { ...POLICY.approver_roles, high: 'Risk Committee' } }, DEFAULT_REOPEN);
  const draft = toDraft({ ...POLICY, approver_roles: { ...POLICY.approver_roles, high: 'Risk Committee' } }, DEFAULT_REOPEN);
  draft.approver_roles.high = null;
  assert.deepEqual(policyPatch(draft, was), { approver_roles: { high: null } });
  assert.equal(policyPatch(was, was), null);
});

test('the reopen thresholds that changed go in the save as `reassess_on`, one entry per tier, and none of it is a policy setting', () => {
  const draft = saved();
  draft.reopen.critical = 'high';
  draft.reopen.low = 'medium';
  assert.deepEqual(savePatch(draft, saved()), { reassess_on: { critical: 'high', low: 'medium' } });
  assert.equal(policyPatch(draft, saved()), null);               // the policy part of the body has nothing of it
  assert.equal(isDirty(draft, saved()), true);
});

test('the reopen thresholds are read from the config\'s tier policy, and a missing or odd one is the shipped default', () => {
  assert.deepEqual(reopenFrom(null), DEFAULT_REOPEN);
  assert.deepEqual(reopenFrom({ tier_policy: { critical: { reassess_on: 'low' }, high: { reassess_on: 'bogus' }, medium: {} } }),
    { critical: 'low', high: 'high', medium: 'high', low: 'critical' });
});

test('bands, cadence and fix windows are checked before Save, in words', () => {
  assert.deepEqual(problems(saved()), []);
  const draft = saved();
  draft.thresholds.high = 80;
  assert.equal(bandsBad(draft.thresholds), true);
  assert.equal(problems(draft).length, 1);
  assert.match(problems(draft)[0], /falling/);
  draft.thresholds = { critical: 75, high: 50, medium: 25 };
  draft.cadence_days.low = 10;
  draft.remediation_days.critical = 400;
  assert.deepEqual(problems(draft), ['Reviews run every 30 to 1,825 days', 'Fix windows are 1 to 365 days']);
  assert.equal(bandsBad({ critical: 75, high: 75, medium: 25 }), true);          // strictly falling
  assert.equal(bandsBad({ critical: 101, high: 50, medium: 25 }), true);
  assert.equal(bandsBad({ critical: 75, high: 50, medium: -1 }), true);
  assert.equal(bandsBad({ critical: 75, high: 50, medium: Number.NaN }), true);
  assert.equal(bandsBad({ critical: 75, high: 50, medium: 0 }), false);
  assert.equal(cadenceBad(30), false);
  assert.equal(cadenceBad(1825), false);
  assert.equal(cadenceBad(29), true);
  assert.equal(cadenceBad(180.5), true);
  assert.equal(cadenceBad(Number.NaN), true);
  assert.equal(windowBad(1), false);
  assert.equal(windowBad(365), false);
  assert.equal(windowBad(0), true);
  assert.equal(windowBad(366), true);
});

test('a section can be put back to the shipped defaults, and only that section', () => {
  const draft = saved();
  draft.cadence_days.critical = 90;
  draft.thresholds.high = 55;
  draft.remediation_days.low = 120;
  draft.approver_roles.critical = 'Risk Committee';
  draft.reopen.critical = 'high';
  const bands = withDefaults(draft, POLICY, 'bands');
  assert.deepEqual([bands.thresholds, bands.cadence_days], [POLICY.thresholds, POLICY.cadence_days]);
  assert.equal(bands.remediation_days.low, 120);                         // the others are left as they are
  assert.equal(bands.approver_roles.critical, 'Risk Committee');
  const approvals = withDefaults(draft, POLICY, 'approvals');
  assert.equal(approvals.approver_roles.critical, null);
  assert.deepEqual(approvals.reopen, DEFAULT_REOPEN);
  assert.equal(approvals.cadence_days.critical, 90);
  assert.deepEqual(withDefaults(draft, POLICY, 'remediation').remediation_days, POLICY.remediation_days);
  assert.deepEqual(withDefaults(draft, POLICY, 'skips').skip_matrix, POLICY.skip_matrix);
  assert.deepEqual(withDefaults(draft, POLICY, 'reviewers').required_reviewers, POLICY.required_reviewers);
  assert.equal(draft.cadence_days.critical, 90);                          // the draft it was given is not touched
  assert.deepEqual(draft.reopen, { ...DEFAULT_REOPEN, critical: 'high' });
});

test('a section at its defaults has nothing to put back', () => {
  const draft = saved();
  for (const part of ['bands', 'remediation', 'skips', 'reviewers', 'approvals'] as const) assert.equal(atDefaults(draft, POLICY, part), true, part);
  draft.skip_matrix.high = ['scoring'];
  draft.reopen.low = 'low';
  assert.equal(atDefaults(draft, POLICY, 'skips'), false);
  assert.equal(atDefaults(draft, POLICY, 'approvals'), false);
  assert.equal(atDefaults(draft, POLICY, 'bands'), true);
  const other = toDraft({ ...POLICY, required_reviewers: { ...POLICY.required_reviewers, low: ['legal'] } }, DEFAULT_REOPEN);
  assert.equal(atDefaults(other, POLICY, 'reviewers'), false);
});

test('a chip switches on and off and keeps the order of its list', () => {
  const order = ['dd_planning', 'questionnaire', 'scoring', 'findings', 'contracting', 'onboarding'];
  assert.deepEqual(toggled(['scoring'], 'dd_planning', order), ['dd_planning', 'scoring']);
  assert.deepEqual(toggled(['dd_planning', 'scoring'], 'scoring', order), ['dd_planning']);
  assert.deepEqual(toggled([], 'onboarding', order), ['onboarding']);
});

test('the approver choices: anyone, each role, and a role the policy still names that no longer exists', () => {
  assert.deepEqual(approverOptions(['Admin', 'Risk Committee'], null), [
    { value: '', label: 'Anyone who may approve' }, { value: 'Admin', label: 'Admin' }, { value: 'Risk Committee', label: 'Risk Committee' },
  ]);
  assert.deepEqual(approverOptions(['Admin'], 'Old Role').at(-1), { value: 'Old Role', label: 'Old Role (no such role now)' });
  assert.equal(approverOptions(['Admin'], 'Admin').length, 2);
  assert.equal(standing(true), 'Tuned for this workspace');
  assert.equal(standing(false), 'On the shipped defaults');
});

test('Save is ONE request: the policy and the reopen thresholds go in the same body, only what changed', () => {
  const draft = saved();
  assert.equal(savePatch(draft, saved()), null);
  draft.reopen.critical = 'high';
  assert.deepEqual(savePatch(draft, saved()), { reassess_on: { critical: 'high' } }, 'a reopen change alone is still a save');
  draft.cadence_days.critical = 90;
  draft.approver_roles.high = 'CISO';
  assert.deepEqual(savePatch(draft, saved()), { cadence_days: { critical: 90 }, approver_roles: { high: 'CISO' }, reassess_on: { critical: 'high' } });
  assert.equal(isDirty(draft, saved()), true);
});
