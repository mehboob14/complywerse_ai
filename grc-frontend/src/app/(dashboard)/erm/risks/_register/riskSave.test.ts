// node --test "src/**/riskSave.test.ts"
// An edit that changed a likelihood or an impact is followed by the assess route (PUT has no score fields), and only then.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoresToAssess } from './riskModel.ts';

const was = { inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 3, residual_impact: 4 };

test('nothing is assessed when no likelihood or impact changed, or on create', () => {
  assert.equal(scoresToAssess(was, { ...was }), null);
  assert.equal(scoresToAssess(null, { ...was }), null, 'a create sends the scores with the risk');
  assert.equal(scoresToAssess(undefined, { ...was }), null);
});

test('a changed pair is assessed with the inherent pair, and the residual pair only when it is complete', () => {
  assert.deepEqual(scoresToAssess(was, { ...was, residual_likelihood: 2 }), { inherent_likelihood: 4, inherent_impact: 4, residual_likelihood: 2, residual_impact: 4 });
  assert.deepEqual(scoresToAssess({ inherent_likelihood: null }, { inherent_likelihood: 3, inherent_impact: 3 }), { inherent_likelihood: 3, inherent_impact: 3 });
  assert.deepEqual(scoresToAssess(was, { ...was, residual_impact: null }), { inherent_likelihood: 4, inherent_impact: 4 });
  assert.equal(scoresToAssess(was, { inherent_likelihood: null, inherent_impact: null, residual_likelihood: 2, residual_impact: 2 }), null, 'the server requires the inherent pair');
});
