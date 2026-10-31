// node --test "src/components/ui/ds/fieldA11y.test.ts"
// The wiring of a form field: ids, aria-describedby, and what a control takes from its FormField or from its own props.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { controlA11y, describedBy, fieldIds, type FieldState } from './fieldA11y.ts';

test('a field has three related ids built from one base', () => {
  assert.deepEqual(fieldIds(':r1:'), { id: ':r1:', hintId: ':r1:-hint', errorId: ':r1:-error' });
  assert.deepEqual(fieldIds('title'), { id: 'title', hintId: 'title-hint', errorId: 'title-error' });
});

test('describedBy joins the ids that exist, in order, and is undefined when none does', () => {
  assert.equal(describedBy('a', 'b'), 'a b');
  assert.equal(describedBy('a', undefined, false, null, '', '  ', 'b'), 'a b');
  assert.equal(describedBy(' a '), 'a');
  assert.equal(describedBy(), undefined);
  assert.equal(describedBy(undefined, false, null, ''), undefined);
});

const field = (over: Partial<FieldState> = {}): FieldState => ({ id: 'f1', describedBy: undefined, invalid: false, required: false, ...over });

test('on its own a control keeps its own id and attributes, and nothing is added', () => {
  assert.deepEqual(controlA11y(null, {}), { id: undefined, 'aria-describedby': undefined, 'aria-invalid': undefined, 'aria-required': undefined });
  assert.deepEqual(
    controlA11y(null, { id: 'x', invalid: true, required: true, 'aria-describedby': 'help' }),
    { id: 'x', 'aria-describedby': 'help', 'aria-invalid': true, 'aria-required': true },
  );
});

test('inside a FormField the control takes the field id, the hint and error ids, invalid and required', () => {
  const a = controlA11y(field({ describedBy: 'f1-hint f1-error', invalid: true, required: true }), {});
  assert.deepEqual(a, { id: 'f1', 'aria-describedby': 'f1-hint f1-error', 'aria-invalid': true, 'aria-required': true });
});

test('the field owns the id (the label points at it); the control\'s own description comes after the field\'s', () => {
  const a = controlA11y(field({ describedBy: 'f1-hint' }), { id: 'mine', 'aria-describedby': 'extra' });
  assert.equal(a.id, 'f1');
  assert.equal(a['aria-describedby'], 'f1-hint extra');
});

test('either side can mark the control invalid or required, and "false" never reaches the DOM', () => {
  assert.equal(controlA11y(field(), { invalid: true })['aria-invalid'], true);
  assert.equal(controlA11y(field({ invalid: true }), {})['aria-invalid'], true);
  assert.equal(controlA11y(null, { 'aria-invalid': 'true' })['aria-invalid'], true);
  assert.equal(controlA11y(null, { 'aria-invalid': 'grammar' })['aria-invalid'], true);
  assert.equal(controlA11y(null, { 'aria-invalid': 'false' })['aria-invalid'], undefined);
  assert.equal(controlA11y(null, { 'aria-invalid': false })['aria-invalid'], undefined);
  assert.equal(controlA11y(field(), { required: true })['aria-required'], true);
  assert.equal(controlA11y(field({ required: true }), {})['aria-required'], true);
  assert.equal(controlA11y(null, { 'aria-required': 'true' })['aria-required'], true);
  assert.equal(controlA11y(null, { 'aria-required': 'false' })['aria-required'], undefined);
  assert.equal(controlA11y(field(), {})['aria-required'], undefined);
});
