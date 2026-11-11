// node --test "src/components/compliance/onboarding/workspace/versionModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRefusal, checkWords, countsSentence, journeyImpact, jumpFor, lastCheckedWords, MIN_NOTE, noteProblem, outcomesOf, reasonsText, reviewRefusal, staleByStep,
  staleMarks, trackedFrom, versionBannerOf, versionCell,
} from './versionModel.ts';

type Status = Parameters<typeof versionBannerOf>[0] & Parameters<typeof staleMarks>[0] & Parameters<typeof countsSentence>[0];
const status = (over: Record<string, unknown> = {}): NonNullable<Status> => ({
  state: 'needs_review', tracking: { since: '2026-11-01T00:00:00', source: 'approval', version: '2022', pending: false }, now: null, successor: null,
  reasons: [{ code: 'library_version', text: 'The library version changed from 2022 to 2023.' }, { code: 'controls', text: 'Controls changed: 1 added.' }, { code: 'questions', text: 'The questions changed (2 changes).' }],
  stale: { answers: [], decisions: [], new_questions: [], gate: [] }, controls: { added: 0, removed: 0, changed: 0, sample: { added: [], removed: [], changed: [] } },
  impact: null, counts: {}, minor: [], change_id: 'abc', checked_at: null, review_state: null, ...over,
}) as unknown as NonNullable<Status>;

const answer = (ref: string, reasons: string[], over: Record<string, unknown> = {}) => ({
  ref, step: ref.split('.')[0], step_label: ref.split('.')[0].toUpperCase(), label: `Q ${ref}`, answer: 'x', reasons: reasons.map((code) => ({ code, text: `${code} text.` })), ...over,
});

test('the banner warns while the framework changed, says what the answers are when it was reopened, and points to the new onboarding once one took over (a later entry)', () => {
  const b = versionBannerOf(status())!;
  assert.deepEqual([b.tone, b.title, b.action], ['warning', 'The framework changed since approval', 'review']);
  assert.equal(b.text, 'The library version changed from 2022 to 2023. Controls changed: 1 added. Nothing was changed. Look at what it affects and decide what to do.');
  const re = versionBannerOf(status({ review_state: 'changes_needed' }))!;
  assert.match(re.text, /reopened to change: the answers listed under Review changes are the ones to look at/);
  assert.equal(re.action, 'review');
  const sup = versionBannerOf(status({ state: 'superseded', review_state: 'migrated', successor: { framework_id: 4, name: 'x', version: '2', onboarding_id: 9 } }))!;
  assert.deepEqual([sup.tone, sup.action], ['info', 'successor']);
  assert.equal(versionBannerOf(status({ state: 'superseded', successor: { framework_id: null, name: null, version: null, onboarding_id: null } }))!.action, null);
  for (const state of ['current', 'not_tracked']) assert.equal(versionBannerOf(status({ state })), null);
  assert.equal(versionBannerOf(null), null);
  assert.equal(reasonsText(status(), 1), 'The library version changed from 2022 to 2023.');
});

test('"tracked from" shows only for an onboarding that was approved before tracking began', () => {
  const fmt = (iso: string | null) => (iso ? '12 Nov 2026' : '');
  assert.equal(trackedFrom(status({ tracking: { since: '2026-11-12T10:00:00', source: 'first_check', version: '2022', pending: false } }), fmt), 'Changes are tracked from 12 Nov 2026.');
  assert.equal(trackedFrom(status(), fmt), '');
  assert.equal(trackedFrom(status({ tracking: { since: null, source: null, version: null, pending: true } }), fmt), '');
  assert.equal(trackedFrom(null, fmt), '');
});

test('stale answers are grouped by step in the server order, and open the field, the step, or nothing', () => {
  const list = [answer('scope.locations', ['not_asked']), answer('applicability.reach', ['option']), answer('scope.products', ['removed']), answer('applicability.entity', ['type'])];
  assert.deepEqual(staleByStep(list as never).map((g) => [g.step, g.items.map((i) => i.ref)]), [['scope', ['scope.locations', 'scope.products']], ['applicability', ['applicability.reach', 'applicability.entity']]]);
  const steps = [{ key: 'applicability' }, { key: 'scope' }];
  assert.deepEqual(jumpFor(list[1] as never, steps), { stage: 'applicability', field: 'reach' });
  assert.deepEqual(jumpFor(list[0] as never, steps), { stage: 'scope', field: '' });          // hidden now: the step, not a field that is not there
  assert.equal(jumpFor(list[2] as never, steps), null);                                      // the question was removed: nothing to open
  assert.equal(jumpFor(list[1] as never, [{ key: 'scope' }]), null);                         // the step is gone too
  assert.deepEqual(jumpFor({ ref: 'scope.extra', step: 'scope', reasons: [] }, steps), { stage: 'scope', field: 'extra' });   // a new question
});

test('only a changed option or kind of answer marks its field; a removed or hidden question has no field to mark', () => {
  const v = status({ stale: { answers: [answer('a.x', ['option']), answer('a.y', ['removed']), answer('a.z', ['not_asked']), answer('a.w', ['type', 'option'])], decisions: [], new_questions: [], gate: [] } });
  assert.deepEqual(staleMarks(v), { 'a.x': 'Review: option text.', 'a.w': 'Review: type text. option text.' });
  assert.deepEqual(staleMarks(status({ state: 'current', stale: v.stale })), {});
  assert.deepEqual(staleMarks(null), {});
});

test('the counts are one plain sentence, and nothing when the change touches nothing', () => {
  assert.equal(countsSentence({ counts: { answers: 2, decisions: 1, new_questions: 1 } }), '2 answers, 1 decision, 1 new question');
  assert.equal(countsSentence({ counts: { answers: 1, controls_added: 1, controls_removed: 1, controls_changed: 1, gate: 2 } }), '1 answer, 3 controls, 2 checks');
  assert.equal(countsSentence({ counts: {} }), '');
  assert.equal(journeyImpact({ status: 'in_progress', controls: 40, affected: 3, evidence_files: 2 }), 'In progress: 3 of 40 controls are on changed ones, 2 evidence files');
  assert.equal(journeyImpact({ status: 'in_progress', controls: 1, affected: 1, evidence_files: 0 }), 'In progress: 1 of 1 control is on changed ones');
  assert.equal(journeyImpact({ status: 'completed', controls: 5, affected: 0, evidence_files: 0 }), 'Completed: none of its 5 controls is on a changed one');
});

test('the outcomes offered follow the state and the library: confirming always, reopening when settled, a new draft only when there is a newer entry nobody started', () => {
  const succ = { framework_id: 41, name: 'ISO', version: '2', onboarding_id: null };
  const labels = (state: string, successor: unknown) => outcomesOf({ state, version: { successor } as never }).map((o) => o.label);
  assert.deepEqual(labels('complete', null), ['Still correct', 'Reopen to change']);
  assert.deepEqual(labels('complete', succ), ['Still correct', 'Reopen to change', 'Start for the later entry']);
  assert.deepEqual(labels('complete', { ...succ, onboarding_id: 9 }), ['Still correct', 'Reopen to change']);
  assert.deepEqual(labels('complete', { ...succ, framework_id: null }), ['Still correct', 'Reopen to change']);
  assert.deepEqual(labels('underway', null), ['Still correct', 'Reopen to change']);
  assert.deepEqual(labels('draft', null), ['Still correct']);                                // a reopened draft is changed in place; confirming is what is left
  const [, reopen] = outcomesOf({ state: 'underway', version: { successor: null } as never });
  assert.match(reopen.text, /answers stay editable/);
  assert.match(outcomesOf({ state: 'complete', version: { successor: null } as never })[1].text, /draft/);
  assert.deepEqual(outcomesOf({ state: 'complete', version: { successor: null } as never }).map((o) => o.value), ['confirmed', 'changes_needed']);
});

test('the note must be long enough, and a refusal says which right is missing', () => {
  assert.equal(MIN_NOTE, 10);
  assert.equal(noteProblem('x'.repeat(10)), null);
  assert.equal(noteProblem('  short  '), 'Write at least 10 characters (5 so far).');
  assert.equal(noteProblem('abc', 20), 'Write at least 20 characters (3 so far).');
  assert.match(reviewRefusal('confirmed', { status: 403, message: 'Permission denied' }), /approve right/);
  assert.match(reviewRefusal('changes_needed', { status: 403, message: 'Permission denied' }), /override right/);
  assert.match(reviewRefusal('start_new_version', { status: 403, message: 'Permission denied' }), /right to edit frameworks/);
  assert.equal(reviewRefusal('confirmed', { status: 409, message: 'Nothing to review: nothing changed since it was approved.' }), 'Nothing to review: nothing changed since it was approved.');
});

test('a register row says why it needs a look, and a replaced row says so even with nothing wrong', () => {
  assert.deepEqual(versionCell({ review: null }), { pill: null, line: '' });
  assert.deepEqual(versionCell({}), { pill: null, line: '' });
  assert.deepEqual(versionCell({ review: { state: 'needs_review', text: 'The library version changed.' } }), { pill: { tone: 'warning', label: 'Needs review' }, line: 'The library version changed.' });
  assert.deepEqual(versionCell({ review: { state: 'superseded', text: 'A newer version has its own onboarding.', successor_onboarding_id: 3 } }), { pill: { tone: 'neutral', label: 'Superseded' }, line: 'A newer version has its own onboarding.' });
  assert.deepEqual(versionCell({ review: { state: 'current', text: null, replaced: true }, version: '2022' }), { pill: { tone: 'neutral', label: 'Replaced' }, line: 'Version 2022 is no longer the active entry.' });
  assert.equal(versionCell({ review: { state: 'current', text: null, replaced: true } }).line, 'No longer the active entry in the library.');
  assert.deepEqual(versionCell({ review: { state: 'current', text: null } }), { pill: null, line: '' });
});

test('the check says how many need review, or that nothing changed, and a refused check says who may run it', () => {
  assert.equal(checkWords({ checked: 12, started: 0, needs_review: 2 }), 'Checked 12 onboardings. 2 need review.');
  assert.equal(checkWords({ checked: 1, started: 0, needs_review: 1 }), 'Checked 1 onboarding. 1 needs review.');
  assert.equal(checkWords({ checked: 4, started: 0, needs_review: 0 }), 'Nothing changed.');
  assert.equal(checkWords({ checked: 4, started: 3, needs_review: 0 }), 'Nothing changed. Tracking started for 3.');
  assert.match(checkRefusal(403, 'Permission denied'), /right to edit frameworks/);
  assert.equal(checkRefusal(500, 'Something went wrong.'), 'Something went wrong.');
  assert.equal(lastCheckedWords('2026-11-12T08:00:00', () => '3 days ago'), 'Last checked 3 days ago');
  assert.equal(lastCheckedWords(null, () => 'x'), '');
  assert.equal(lastCheckedWords('2026-11-12', () => ''), '');
});
