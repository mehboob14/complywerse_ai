// node --test "src/components/compliance/onboarding/gate/gateModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedFrom, gateFacts, neededWords, refusalFromProblem, startLabel } from './gateModel.ts';

const row = (id: number, state: string, over: Record<string, unknown> = {}) => ({ uploaded_framework_id: id, state, journey: null, onboarding_id: state === 'not_started' ? null : id * 10, ...over }) as Parameters<typeof gateFacts>[0] extends readonly (infer R)[] | undefined ? R : never;

test('a journey waits for the onboarding unless it already exists or the onboarding is complete or underway', () => {
  const rows = [row(1, 'not_started'), row(2, 'draft'), row(3, 'ready'), row(4, 'complete'), row(5, 'underway'), row(6, 'draft', { journey: { id: 9, status: 'in_progress' } })];
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => gateFacts(rows, id)?.needed), [true, true, true, false, false, false]);
  assert.deepEqual(gateFacts(rows, 2), { needed: true, state: 'draft', onboardingId: 20 });
  assert.deepEqual(gateFacts(rows, 1), { needed: true, state: 'not_started', onboardingId: null });
  assert.equal(gateFacts(rows, 99), null);                       // not in the register: the server decides
  assert.equal(gateFacts(undefined, 1), null);                   // the register has not answered: the server decides
});

test('the gate refusal is read from its 409 and nothing else is taken for it', () => {
  const base = { status: 409, code: 'onboarding_required', onboardingId: 12, state: 'draft' as const, message: 'Finish this framework\'s onboarding before starting its journey.', checks: [{ key: 'a', label: 'A', hint: null }] };
  assert.deepEqual(refusalFromProblem(base), { onboardingId: 12, state: 'draft', message: base.message, open: 1 });
  assert.equal(refusalFromProblem({ ...base, code: null }), null);
  assert.equal(refusalFromProblem({ ...base, status: 422 }), null);
  assert.deepEqual(refusalFromProblem({ ...base, onboardingId: null, state: 'not_started', checks: [] }), { onboardingId: null, state: 'not_started', message: base.message, open: 0 });
});

test('the notice says where the onboarding is, and the button what it does', () => {
  assert.equal(neededWords('not_started'), 'Start its onboarding first.');
  assert.equal(neededWords(null), 'Start its onboarding first.');
  assert.equal(neededWords('draft', 3), 'Its onboarding is a draft with 3 required items open.');
  assert.equal(neededWords('draft', 1), 'Its onboarding is a draft with 1 required item open.');
  assert.equal(neededWords('draft', 0), 'Its onboarding is a draft. Submit it and have it approved.');
  assert.equal(neededWords('ready'), 'Its onboarding waits for approval.');
  assert.deepEqual([startLabel(null, 'not_started'), startLabel(5, 'draft'), startLabel(5, 'ready')], ['Start onboarding', 'Continue onboarding', 'Open onboarding']);
});

test('the frameworks a scope could not start a journey for are read defensively', () => {
  assert.deepEqual(blockedFrom({ created: [], blocked: [{ slug: 'iso_27001', framework_id: 4, state: 'not_started', reason: 'Finish it.' }, { slug: 'soc2' }, { nope: 1 }, null] }),
    [{ slug: 'iso_27001', frameworkId: 4, state: 'not_started', reason: 'Finish it.' }, { slug: 'soc2', frameworkId: null, state: '', reason: '' }]);
  assert.deepEqual(blockedFrom({ created: [] }), []);
  assert.deepEqual(blockedFrom(undefined), []);
  assert.deepEqual(blockedFrom({ blocked: 'x' }), []);
});
