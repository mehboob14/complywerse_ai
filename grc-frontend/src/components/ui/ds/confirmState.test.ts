// node --test "src/components/ui/ds/confirmState.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIRM_IDLE, checkRequest, openConfirm, settleConfirm, type ConfirmState, type Transition } from './confirmState.ts';

type Q = { title: string; confirmLabel: string };
const q = (title: string): Q => ({ title, confirmLabel: 'Do it' });

/** A tiny host like useConfirm: promises per question, resolved only through the transitions. */
function host() {
  let state: ConfirmState<Q> = CONFIRM_IDLE;
  const answers = new Map<number, boolean[]>();
  const apply = (t: Transition<Q>) => {
    state = t.state;
    for (const a of t.answers) answers.set(a.id, [...(answers.get(a.id) ?? []), a.value]);
  };
  return {
    get state() { return state; },
    answers,
    ask: (request: Q) => { apply(openConfirm(state, request)); return state.id; },
    settle: (id: number, value: boolean) => apply(settleConfirm(state, id, value)),
  };
}

test('a question opens the dialog with its own id and keeps its words', () => {
  const t = openConfirm(CONFIRM_IDLE, q('Archive?'));
  assert.deepEqual(t.state, { open: true, id: 1, request: q('Archive?') });
  assert.deepEqual(t.answers, []);
});

test('yes and no are each answered once, and the dialog closes but keeps its words for the fade-out', () => {
  for (const value of [true, false]) {
    const h = host();
    const id = h.ask(q('Archive?'));
    h.settle(id, value);
    assert.deepEqual(h.answers.get(id), [value]);
    assert.equal(h.state.open, false);
    assert.deepEqual(h.state.request, q('Archive?'));
  }
});

test('a double click on the confirm button answers once', () => {
  const h = host();
  const id = h.ask(q('Delete?'));
  h.settle(id, true);
  h.settle(id, true);
  h.settle(id, false);                                  // a late Escape or a second click: nothing more happens
  assert.deepEqual(h.answers.get(id), [true]);
});

test('a second question while one is showing replaces it; the first is answered no, once', () => {
  const h = host();
  const first = h.ask(q('One?'));
  const second = h.ask(q('Two?'));                      // e.g. a double click on the trigger before the scrim was up
  assert.notEqual(first, second);
  assert.deepEqual(h.answers.get(first), [false]);
  assert.equal(h.state.open, true);
  assert.deepEqual(h.state.request, q('Two?'));
  h.settle(first, true);                                // a click that belongs to the dialog that was replaced: ignored
  assert.deepEqual(h.answers.get(first), [false]);
  assert.equal(h.state.open, true);
  h.settle(second, true);
  assert.deepEqual(h.answers.get(second), [true]);
  assert.equal(h.answers.get(first)?.length, 1);
});

test('a question asked after the previous one was answered opens fresh, with nothing left over', () => {
  const h = host();
  const first = h.ask(q('One?'));
  h.settle(first, true);
  const second = h.ask(q('Two?'));
  assert.equal(second, first + 1);
  assert.equal(h.state.open, true);
  assert.equal(h.answers.get(first)?.length, 1);
  h.settle(first, false);                               // the old dialog's late click must not answer the new question
  assert.equal(h.state.open, true);
  assert.equal(h.answers.get(second), undefined);
});

test('an answer with nothing open, or with an id that was never asked, changes nothing', () => {
  const t = settleConfirm(CONFIRM_IDLE, 0, true);
  assert.deepEqual(t, { state: CONFIRM_IDLE, answers: [] });
  const open = openConfirm(CONFIRM_IDLE, q('x')).state;
  assert.deepEqual(settleConfirm(open, 99, true), { state: open, answers: [] });
});

test('the page going away answers the open question no (settling the id that is showing)', () => {
  const h = host();
  const id = h.ask(q('Archive?'));
  h.settle(h.state.id, false);
  assert.deepEqual(h.answers.get(id), [false]);
  h.settle(h.state.id, false);                          // and again on a second cleanup: still once
  assert.deepEqual(h.answers.get(id), [false]);
});

test('the transitions never change the state they are given', () => {
  const before = openConfirm(CONFIRM_IDLE, q('x')).state;
  const copy = JSON.stringify(before);
  openConfirm(before, q('y'));
  settleConfirm(before, before.id, true);
  assert.equal(JSON.stringify(before), copy);
});

test('a question needs a title and a confirm label; there is no default "OK"', () => {
  assert.doesNotThrow(() => checkRequest({ title: 'Archive 3 documents?', confirmLabel: 'Archive 3 documents' }));
  assert.throws(() => checkRequest({ title: 'Archive?' }), /confirmLabel/);
  assert.throws(() => checkRequest({ title: 'Archive?', confirmLabel: '   ' }), /confirmLabel/);
  assert.throws(() => checkRequest({ confirmLabel: 'Archive' }), /title/);
  assert.throws(() => checkRequest({ title: '', confirmLabel: 'Archive' }), /title/);
});
