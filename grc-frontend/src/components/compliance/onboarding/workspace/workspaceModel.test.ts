// node --test "src/components/compliance/onboarding/workspace/workspaceModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionRefusal, actionsOf, aiChange, aiKindsAfter, aiOrigin, appendRows, bannerOf, editsByStep, errorsByField, eventSentence, exclusionQuestions, gapQuestions, isLockedRefusal,
  jumpOf, jumpToRef, labelOfRef, mergeRefs, needsDepartments, neighbours, openCount, openingStage, reasonProblem, refusalLines, REVIEW, resolveStage, splitChecks, splitOrgChecks,
  splitRef, stageCount, stagesOf, suggestedRows, valueOf, visibleFields,
} from './workspaceModel.ts';

const steps = [
  { key: 'route', label: 'Route', fields: [{ key: 'goal', label: 'Goal', type: 'choice' }, { key: 'prior', label: 'Prior certificate', type: 'text' }] },
  { key: 'context', label: 'Context', fields: [{ key: 'interested_parties', label: 'Interested parties', type: 'table' }] },
  { key: 'scope', label: 'Scope', fields: [{ key: 'statement', label: 'Scope statement', type: 'longtext' }, { key: 'exclusions', label: 'Exclusions', type: 'table' }, { key: 'units', label: 'Units', type: 'org_pick', of: 'departments' }] },
] as unknown as Parameters<typeof aiKindsAfter>[0] & Parameters<typeof visibleFields>[0][];

const readiness = {
  ready: false,
  hidden: ['route.prior'],
  steps: [
    { key: 'route', label: 'Route', required_total: 2, required_ok: 2, complete: true },
    { key: 'context', label: 'Context', required_total: 1, required_ok: 0, complete: false },
    { key: 'scope', label: 'Scope', required_total: 3, required_ok: 1, complete: false },
  ],
  counts: { required_total: 9, required_ok: 4, advised_open: 2 },
};

test('the stages are the steps in order and a last Review; a page opens on the first step with something open', () => {
  const stages = stagesOf(steps);
  assert.deepEqual(stages.map((s) => s.key), ['route', 'context', 'scope', REVIEW]);
  assert.equal(stages[3].label, 'Review');
  assert.equal(openingStage(stages, readiness), 'context');
  assert.equal(openingStage(stages, { steps: readiness.steps.map((s) => ({ ...s, complete: true })) }), REVIEW);
  assert.equal(resolveStage(stages, 'scope', 'route'), 'scope');
  assert.equal(resolveStage(stages, 'nowhere', 'route'), 'route');
  assert.equal(resolveStage(stages, '', 'route'), 'route');
  assert.deepEqual([neighbours(stages, 'route').prev, neighbours(stages, 'route').next?.key], [null, 'context']);
  assert.deepEqual([neighbours(stages, REVIEW).prev?.key, neighbours(stages, REVIEW).next], ['scope', null]);
});

test('a stage says how many of its required answers are in; Review counts all of them', () => {
  assert.deepEqual(stageCount(readiness, 'scope'), { done: 1, total: 3, complete: false, badge: '1/3', words: '1 of 3 required' });
  assert.equal(stageCount(readiness, 'route').complete, true);
  assert.deepEqual(stageCount(readiness, REVIEW), { done: 4, total: 9, complete: false, badge: '4/9', words: '4 of 9 required' });
  assert.deepEqual(stageCount(readiness, 'unknown'), { done: 0, total: 0, complete: true, badge: '', words: 'Nothing required' });
});

test('edits show over the saved answer, go to the server one step at a time, and a field an earlier answer switched off is not drawn', () => {
  const answers = { route: { goal: 'Certification' }, scope: { statement: 'old' } };
  assert.equal(valueOf(answers, {}, 'scope', 'statement'), 'old');
  assert.equal(valueOf(answers, { 'scope.statement': 'new' }, 'scope', 'statement'), 'new');
  assert.equal(valueOf(answers, { 'scope.statement': '' }, 'scope', 'statement'), '');             // cleared by the person: shown empty, not the old text
  assert.equal(valueOf(answers, {}, 'context', 'interested_parties'), undefined);
  assert.deepEqual(editsByStep({ 'scope.statement': 'x', 'scope.exclusions': [], 'route.goal': 'Alignment' }), { scope: { statement: 'x', exclusions: [] }, route: { goal: 'Alignment' } });
  assert.deepEqual(visibleFields(steps[0] as never, readiness).map((f) => f.key), ['goal']);
  assert.deepEqual(splitRef('scope.statement'), { step: 'scope', field: 'statement' });
});

test('a refusal is shown under its field by name and never as a key', () => {
  const p = { errors: [{ field: 'scope.statement', message: 'Too long.' }, { field: 'scope.statement', message: 'again' }, { field: 'made.up', message: 'x' }] };
  assert.deepEqual(errorsByField(p), { 'scope.statement': 'Too long.', 'made.up': 'x' });
  assert.deepEqual(refusalLines(p, (ref) => labelOfRef(ref, steps)), ['Scope statement: Too long.']);
  assert.equal(labelOfRef('scope.nope', steps), null);
  assert.equal(isLockedRefusal({ status: 409, locked: ['scope.statement'] }), true);
  assert.equal(isLockedRefusal({ status: 409, locked: [] }), false);
  assert.equal(isLockedRefusal({ status: 422, locked: ['x'] }), false);
});

test('a refused decision says what right is missing, in words', () => {
  assert.match(actionRefusal('approve', { status: 403, message: 'Forbidden' }), /approve right/);
  assert.match(actionRefusal('reopen', { status: 403, message: 'Forbidden' }), /override right/);
  assert.match(actionRefusal('underway', { status: 403, message: 'Forbidden' }), /override right/);
  assert.match(actionRefusal('submit', { status: 403, message: 'Forbidden' }), /right to edit frameworks/);
  assert.match(actionRefusal('edit', { status: 403, message: 'Forbidden' }), /right to edit frameworks/);
  assert.equal(actionRefusal('submit', { status: 422, message: 'Some required answers are open.' }), 'Some required answers are open.');
});

test('checks: required first, advice after; each is put right where it is filled', () => {
  const checks = [
    { key: 'scope.statement', label: 'Scope statement', ok: false, required: true, hint: null, kind: 'field', step: 'scope' },
    { key: 'scope.exclusions', label: 'Exclusions', ok: false, required: false, hint: null, kind: 'field', step: 'scope' },
    { key: 'route.goal', label: 'Goal', ok: true, required: true, hint: null, kind: 'field', step: 'route' },
    { key: 'roles_distinct', label: 'Roles differ', ok: false, required: true, hint: 'x', kind: 'gate' },
  ] as const;
  const { required, advice, done } = splitChecks(checks as never);
  assert.deepEqual([required.map((c) => c.key), advice.map((c) => c.key), done.map((c) => c.key)], [['scope.statement', 'roles_distinct'], ['scope.exclusions'], ['route.goal']]);
  const stages = stagesOf(steps);
  assert.deepEqual(jumpOf(checks[0], stages), { kind: 'field', stage: 'scope', field: 'statement' });
  assert.deepEqual(jumpOf(checks[3], stages), { kind: 'none' });
  assert.deepEqual(jumpOf({ key: 'org.entities_sites', kind: 'org' }, stages), { kind: 'org', href: '/compliance/organisation' });
  assert.deepEqual(jumpOf({ key: 'roles_distinct', kind: 'gate', step: 'scope' }, stages), { kind: 'stage', stage: 'scope' });   // a rule opens the stage it reads
  assert.deepEqual(jumpOf({ key: 'roles_distinct', kind: 'gate' }, stages), { kind: 'none' });
  assert.deepEqual(jumpOf({ key: 'gone.field', kind: 'field', step: 'gone' }, stages), { kind: 'none' });
  const org = splitOrgChecks([{ key: 'org.entities_sites' }, { key: 'org.need.data_systems.key_systems' }, { key: 'sponsor_differs' }] as never);
  assert.deepEqual([org.needed.map((c) => c.key), org.profile.map((c) => c.key)], [['org.need.data_systems.key_systems'], ['org.entities_sites', 'sponsor_differs']]);
  assert.deepEqual(jumpToRef('scope.statement', steps), { stage: 'scope', field: 'statement' });
  assert.equal(jumpToRef('roles_distinct', steps), null);                                              // a gate key is not a field
});

test('each state allows its own decisions, and a button that is shown and off says why', () => {
  const not = { ready: false, counts: { required_total: 9, required_ok: 4, advised_open: 0 } };
  const yes = { ready: true, counts: { required_total: 9, required_ok: 9, advised_open: 0 } };
  assert.equal(openCount(not), 5);
  assert.deepEqual(actionsOf('draft', not).submit, { shown: true, enabled: false, reason: '5 required items are still open' });
  assert.deepEqual(actionsOf('draft', { ready: false, counts: { required_total: 2, required_ok: 1, advised_open: 0 } }).submit.reason, '1 required item is still open');
  assert.deepEqual(actionsOf('draft', yes).submit, { shown: true, enabled: true, reason: null });
  const shown = (state: 'draft' | 'ready' | 'complete' | 'underway') => Object.entries(actionsOf(state, yes)).filter(([, a]) => a.shown).map(([k]) => k);
  assert.deepEqual(shown('draft'), ['submit', 'underway']);
  assert.deepEqual(shown('ready'), ['approve', 'reopen', 'underway']);
  assert.deepEqual(shown('complete'), ['reopen']);
  assert.deepEqual(shown('underway'), ['approve']);
  assert.equal(actionsOf('underway', not).approve.enabled, false);                                         // underway is not approval: everything must be done
  assert.equal(actionsOf('ready', not).reopen.enabled, true);
  assert.equal(reasonProblem('too short', 20), 'Write at least 20 characters (9 so far).');
  assert.equal(reasonProblem('   ' + 'x'.repeat(20) + '  ', 20), null);
});

test('every kind of event is a sentence, with the person and the reason, and never raw data', () => {
  const label = (k: string) => ({ scope: 'Scope' } as Record<string, string>)[k] ?? null;
  const say = (kind: string, by: string | null, detail: Record<string, unknown> = {}) => eventSentence({ kind, by, detail }, label);
  assert.equal(say('created', 'Sana'), 'Onboarding started by Sana');
  assert.equal(say('saved', 'Sana', { step: 'scope', fields: ['statement', 'exclusions'] }), 'Edited Scope (2 fields) by Sana');
  assert.equal(say('saved', 'Sana', { step: 'scope', fields: ['statement'], reopened_review: true }), 'Edited Scope (1 field) by Sana. Sent back to draft');
  assert.equal(say('saved', null, { step: 'nowhere' }), 'Edited answers');
  assert.equal(say('submitted', 'Sana'), 'Submitted by Sana');
  assert.equal(say('approved', 'Ada'), 'Approved by Ada');
  assert.equal(say('approved', 'Ada', { note: 'Agreed with the sponsor' }), 'Approved by Ada: Agreed with the sponsor');
  assert.equal(say('reopened', 'Ada', { reason: 'The scope changes', from: 'complete' }), 'Reopened by Ada: The scope changes');
  assert.equal(say('marked_underway', 'Ada', { kind: 'Other', reason: 'The window is open' }), 'Marked underway by Ada (Other): The window is open');
  assert.equal(say('marked_underway', null, { source: 'legacy', kind: 'Other', reason: 'x' }), 'Marked underway: a journey existed before onboarding');
  assert.equal(say('journey_started', 'Sana'), 'Journey started by Sana');
  assert.equal(say('journey_blocked', null, { unmet: 3 }), 'Journey blocked: 3 required items were open');
  assert.equal(say('journey_blocked', null, { unmet: 0 }), 'Journey blocked: waiting for approval');
  assert.equal(say('some_new_kind', null), 'Some new kind');
  for (const k of ['created', 'saved', 'submitted', 'approved', 'reopened', 'marked_underway', 'journey_started', 'journey_blocked']) assert.doesNotMatch(say(k, 'A', { step: 'scope', fields: ['a'], reason: 'r', kind: 'k', unmet: 1 }), /[{}\[\]_]/);
});

test('banners say where the onboarding stands', () => {
  const fmt = (iso: string | null) => (iso ? '3 Nov 2026' : '');
  const base = { underway: null, underway_by: null, approved_at: null, approved_by: null, approval_note: null, submitted_by: null, submitted_at: null };
  assert.equal(bannerOf({ ...base, state: 'draft' }, fmt), null);
  assert.deepEqual(bannerOf({ ...base, state: 'underway', underway: { kind: 'Other', reason: 'The SOC 2 window opened in January.', at: '2026-11-03T08:00:00', source: 'manual' }, underway_by: 'Ada' }, fmt),
    { tone: 'warning', title: 'Already underway', action: null, text: 'Underway since 3 Nov 2026 by Ada because The SOC 2 window opened in January. What is open stays listed.' });
  assert.match(bannerOf({ ...base, state: 'underway', underway: { kind: 'Other', reason: 'A journey existed before framework onboarding.', at: null, source: 'legacy' } }, fmt)!.text, /journey existed before onboarding/);
  const done = bannerOf({ ...base, state: 'complete', approved_by: 'Ada', approved_at: '2026-11-03T08:00:00', approval_note: 'Agreed.' }, fmt)!;
  assert.deepEqual([done.title, done.action, done.text], ['Approved and locked', 'reopen', 'Approved by Ada on 3 Nov 2026. Agreed.']);
  const wait = bannerOf({ ...base, state: 'ready', submitted_by: 'Sana', submitted_at: '2026-11-03T08:00:00' }, fmt)!;
  assert.deepEqual([wait.title, wait.action], ['Waiting for approval', 'review']);
  assert.match(wait.text, /^Submitted by Sana on 3 Nov 2026\./);
});

test('names a picker has just been told show before the next read', () => {
  const base = { users: { '1': 'Ada' }, assets: {}, vendors: {}, departments: { '4': 'Finance' } };
  const merged = mergeRefs(base, { users: { '2': 'Sana' } });
  assert.deepEqual(merged.users, { '1': 'Ada', '2': 'Sana' });
  assert.deepEqual(merged.departments, { '4': 'Finance' });
  assert.deepEqual(base.users, { '1': 'Ada' });                                                        // the read answer is not changed
  assert.equal(needsDepartments(steps), true);
  assert.equal(needsDepartments([steps[0]] as never), false);
});

test('AI help sits beside its field, and only where the framework has that field', () => {
  assert.deepEqual(aiKindsAfter(steps, 'scope', 'statement'), ['scope_draft']);
  assert.deepEqual(aiKindsAfter(steps, 'scope', 'exclusions'), ['exclusions_check']);
  assert.deepEqual(aiKindsAfter(steps, 'context', 'interested_parties'), ['parties_suggest']);
  assert.deepEqual(aiKindsAfter(steps, 'route', 'goal'), []);
  assert.deepEqual(aiKindsAfter([steps[0]] as never, 'scope', 'statement'), []);
  assert.deepEqual(aiOrigin('ai').tag, 'AI');
  assert.deepEqual(aiOrigin('rules').tag, 'Rules');
  assert.match(aiOrigin('rules').note, /without AI/);
});

test('accepting a suggestion is a change of one field: a statement replaces, rows are appended, nothing is added twice', () => {
  assert.deepEqual(aiChange('scope_draft', { statement: '  The scope covers HQ. ' }, 'old'), { step: 'scope', field: 'statement', value: 'The scope covers HQ.', added: 1 });
  assert.deepEqual(aiChange('scope_draft', { statement: 'ignored' }, '', { text: 'Edited by the person' })?.value, 'Edited by the person');
  assert.equal(aiChange('scope_draft', { statement: '   ' }, ''), null);
  assert.equal(aiChange('gap_review', { questions: [] }, null), null);

  const current = [{ id: 'a1', item: 'Lahore', reason: 'Closed' }];
  const sug = { exclusions: [{ item: 'lahore', reason: 'again' }, { item: 'Karachi', reason: 'Separate entity' }, { item: '', reason: 'x' }], questions: [] };
  const out = aiChange('exclusions_check', sug, current)!;
  assert.deepEqual([out.step, out.field, out.added], ['scope', 'exclusions', 1]);
  assert.deepEqual(out.value, [{ id: 'a1', item: 'Lahore', reason: 'Closed' }, { item: 'Karachi', reason: 'Separate entity' }]);   // the existing row keeps its id; the new one gets its id from the server
  assert.equal(aiChange('exclusions_check', { exclusions: [{ item: 'Lahore', reason: '' }] }, current), null);               // nothing new: nothing to write

  const parties = { rows: [{ party: 'Regulator', kind: 'Regulator', requirement: 'Filings' }, { party: 'Staff', kind: 'Employee', requirement: 'Clear roles' }] };
  assert.deepEqual(aiChange('parties_suggest', parties, undefined, { rows: [1] })?.value, [{ party: 'Staff', kind: 'Employee', requirement: 'Clear roles' }]);
  assert.deepEqual(aiChange('parties_suggest', parties, null)?.added, 2);
  assert.deepEqual(appendRows('not rows', [{ k: 'a' }], 'k'), { value: [{ k: 'a' }], added: 1 });
});

test('suggestions are read defensively', () => {
  assert.deepEqual(suggestedRows('parties_suggest', { rows: [{ party: ' A ', kind: 'Customer', requirement: 'x', junk: 1 }, 'text', null] }), [{ party: 'A', kind: 'Customer', requirement: 'x' }]);
  assert.deepEqual(suggestedRows('exclusions_check', undefined), []);
  assert.deepEqual(exclusionQuestions({ questions: [{ item: 'Lahore', why: 'Is data processed there?' }, { item: 'x' }] }), [{ item: 'Lahore', why: 'Is data processed there?' }]);
  assert.deepEqual(gapQuestions({ questions: [{ field: 'scope.statement', question: 'What does it leave out?' }, { question: 'Anything else?' }, { field: 'x' }] }),
    [{ field: 'scope.statement', question: 'What does it leave out?' }, { field: '', question: 'Anything else?' }]);
});
