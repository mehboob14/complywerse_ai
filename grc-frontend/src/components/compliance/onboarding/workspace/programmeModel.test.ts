// node --test "src/components/compliance/onboarding/workspace/programmeModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { controlsWords, NOT_STARTED_WORDS, ownerAction, personWords, scopeWords } from './programmeModel.ts';
import { eventSentence } from './workspaceModel.ts';

const scope = (extra: Record<string, unknown> = {}) => ({ reach: 'Selected parts only', whole_organisation: false, departments: [], systems: [], locations: [], processes: [], third_parties: [], ...extra }) as Parameters<typeof scopeWords>[0];

test('the scope is said in one line, and an unanswered scope is "not stated", never invented', () => {
  assert.equal(scopeWords(scope({ reach: 'Whole organisation', whole_organisation: true })), 'Whole organisation');
  assert.equal(scopeWords(scope({ reach: null })), 'Not stated');
  assert.equal(scopeWords(scope()), 'Selected parts');
  assert.equal(
    scopeWords(scope({ departments: [{ id: 1, name: 'Finance' }], systems: [{ id: 5, name: 'Core', type: 'application' }, { id: 6, name: 'Cards', type: null }], third_parties: [{ id: 'a', name: 'Host' }] })),
    'Selected parts: 1 department, 2 systems, 1 third party',
  );
});

test('the controls are "loaded, none assessed" for a new journey and say so when work had begun', () => {
  assert.equal(controlsWords({ total: 114, not_started: 114, begun: 0, without_owner: 114 }), '114 controls loaded, none assessed yet');
  assert.equal(controlsWords({ total: 1, not_started: 1, begun: 0, without_owner: 0 }), '1 control loaded, none assessed yet');
  assert.equal(controlsWords({ total: 10, not_started: 7, begun: 3, without_owner: 2 }), '10 controls loaded, 3 with work begun');
  assert.equal(controlsWords({ total: 0, not_started: 0, begun: 0, without_owner: 0 }), 'No controls in the journey yet');
});

test('a person without an account is named, and marked as one', () => {
  assert.equal(personWords({ name: 'Sana', account: true }), 'Sana');
  assert.equal(personWords({ name: 'Zed Auditor', account: false }), 'Zed Auditor (no account)');
});

test('the owner button names who and how many, and says why it is off', () => {
  assert.deepEqual(ownerAction(null), { shown: false, enabled: false, label: '', reason: null });
  assert.equal(ownerAction({ name: null, can_apply: false, without_owner: 0, why_not: 'No programme owner was named.' }).shown, false);
  assert.deepEqual(ownerAction({ name: 'Sana', can_apply: true, without_owner: 3, why_not: null }), { shown: true, enabled: true, label: 'Make Sana owner of 3 controls', reason: null });
  assert.equal(ownerAction({ name: 'Sana', can_apply: false, without_owner: 0, why_not: null }).reason, 'Every control has an owner already.');
  assert.equal(ownerAction({ name: 'Zed', can_apply: false, without_owner: 4, why_not: 'The programme owner has no account on this platform.' }).reason, 'The programme owner has no account on this platform.');
});

test('the card says once that nothing is compliant', () => {
  assert.match(NOT_STARTED_WORDS, /Nothing here is marked compliant/);
});

test('the history tells what the hand-off did, in plain words', () => {
  const none = () => null;
  assert.equal(eventSentence({ kind: 'programme_started', by: 'Sana', detail: { journey_made: true, controls: 114, people: 3, offered: 2, scope: true } }, none),
    'Compliance programme started by Sana: journey made, 114 controls loaded, 2 items offered as evidence');
  assert.equal(eventSentence({ kind: 'programme_started', by: null, detail: { journey_made: false, controls: 1, offered: 0 } }, none), 'Compliance programme started: journey linked, 1 control loaded');
  assert.equal(eventSentence({ kind: 'programme_updated', by: 'Omar', detail: { changed: ['scope', 'people', 'evidence', 'journey'] } }, none),
    'Compliance programme updated by Omar: scope, people, evidence offered, journey');
  assert.equal(eventSentence({ kind: 'owners_applied', by: 'Omar', detail: { controls: 3, owner: 'Sana' } }, none), 'Sana made owner of 3 controls by Omar');
  assert.equal(eventSentence({ kind: 'owners_applied', by: null, detail: { controls: 1 } }, none), 'The programme owner made owner of 1 control');
});
