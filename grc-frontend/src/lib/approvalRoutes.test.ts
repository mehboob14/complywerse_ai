// node --test src/lib/approvalRoutes.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blankStage, defaultStages, isDefaultShape, moved, picked, routeProblem, routeSummary, stagesOf, toApi, type DraftStage, type RouteView } from './approvalRoutes.ts';

const u = (id: number, display: string) => ({ target_type: 'user', target_id: id, display });
const RANA = u(2, 'Rana'), RAFAY = u(3, 'Rafay'), UMA = u(6, 'Uma');
const BOARD = { target_type: 'role', target_id: 10, display: 'Board' };
const name = (t: { display?: string }) => t.display ?? '?';

test('a route opens with the two stages of today and is sent as reviewers and approvers while it keeps their shape', () => {
  const stages = defaultStages([RANA], [BOARD]);
  assert.deepEqual(stages.map((s) => [s.kind, s.name, s.order, s.rule]), [['review', 'Review', 'together', 'all'], ['approval', 'Approval', 'together', 'all']]);
  assert.equal(isDefaultShape(stages), true);
  assert.equal(isDefaultShape([{ ...stages[0], people: [] }, stages[1]]), true);          // no reviewers: straight to approval, as today
  assert.equal(isDefaultShape([{ ...stages[0], order: 'in_turn' }, stages[1]]), false);
  assert.equal(isDefaultShape([{ ...stages[0], due_days: 3 }, stages[1]]), false);
  assert.equal(isDefaultShape([{ ...stages[0], name: 'Department head' }, stages[1]]), false);
  assert.equal(isDefaultShape([...stages, { ...blankStage('information'), people: [UMA] }]), false);
  assert.equal(isDefaultShape([stages[1], stages[0]]), false);                              // approval before review
});

test('X, then Y, then Z, then any one of the Board, in words and as sent', () => {
  const stages: DraftStage[] = [
    { ...blankStage('review'), order: 'in_turn', people: [RANA, RAFAY, UMA] },
    { ...blankStage('approval'), rule: 'any', people: [BOARD, u(4, 'Mina')] },
    { ...blankStage('information'), people: [] },                                         // nobody chosen: left out
  ];
  assert.equal(routeSummary(stages, name), 'Rana, then Rafay, then Uma review, one after another; then any one of Board or Mina approves.');
  assert.deepEqual(toApi(stages), [
    { name: 'Review', kind: 'review', order: 'in_turn', rule: 'all', min_count: null, due_days: null,
      people: [{ target_type: 'user', target_id: 2 }, { target_type: 'user', target_id: 3 }, { target_type: 'user', target_id: 6 }] },
    { name: 'Approval', kind: 'approval', order: 'together', rule: 'any', min_count: null, due_days: null,
      people: [{ target_type: 'role', target_id: 10 }, { target_type: 'user', target_id: 4 }] },
  ]);
  assert.equal(routeSummary([{ ...blankStage('concurrence'), rule: 'at_least', min_count: 2, people: [RANA, RAFAY, UMA] }], name),
    'At least 2 of Rana, Rafay and Uma concur.');
  assert.equal(routeSummary([{ ...blankStage('information'), people: [UMA] }], name), 'Uma is told.');
});

test('what is wrong is said before sending', () => {
  assert.equal(routeProblem(defaultStages([], [])), 'Choose who reviews or approves it.');
  assert.equal(routeProblem([{ ...blankStage('information'), people: [UMA] }]), 'Add a stage where someone reviews or approves.');
  assert.equal(routeProblem([{ ...blankStage('review'), rule: 'at_least', min_count: 3, people: [RANA, RAFAY] }]),
    'Stage 1: at least how many have to sign? A number from 1 to 2.');
  assert.equal(routeProblem([{ ...blankStage('review'), rule: 'at_least', min_count: 3, people: [RANA, BOARD] }]), '');   // a role: any number
  assert.equal(routeProblem([{ ...blankStage('review'), due_days: 0, people: [RANA] }]), 'Stage 1: days to act must be from 1 to 365.');
  assert.equal(routeProblem(defaultStages([RANA], [])), '');
});

test('a route of its own is changed as the server keeps it, people in their turn order', () => {
  const route: RouteView = {
    custom: true, current: null, hold: null, stages: [{
      position: 1, name: 'Department head', kind: 'review', kind_label: 'Reviewed by', order: 'in_turn', rule: 'all', min_count: null, due_days: 3,
      signature: true, allow_reject: false, allow_delegate: true, status: 'not_started', progress: null,
      people: [RAFAY, RANA].map((p, i) => ({ ...p, assignment_id: i + 1, display: p.display, state: 'not_yet' as const, signer: null, on_behalf_of: null,
        at: null, comment: null, due_date: null, delegated_to: null })),
    }],
  };
  const [s] = stagesOf(route, [], []);
  assert.deepEqual([s.name, s.order, s.due_days, s.people.map((p) => p.target_id)], ['Department head', 'in_turn', 3, [3, 2]]);
  assert.deepEqual(stagesOf({ ...route, custom: false }, [RANA], []).map((x) => x.kind), ['review', 'approval']);
});

test('people keep their turn when more are picked, and move up and down', () => {
  assert.deepEqual(picked(['user:6', 'user:2', 'user:3'], [RAFAY, RANA]).map((p) => p.target_id), [3, 2, 6]);
  assert.deepEqual(picked(['user:2'], [RAFAY, RANA]).map((p) => p.target_id), [2]);
  assert.deepEqual(moved([1, 2, 3], 2, -1), [1, 3, 2]);
  assert.deepEqual(moved([1, 2, 3], 0, -1), [1, 2, 3]);
});
