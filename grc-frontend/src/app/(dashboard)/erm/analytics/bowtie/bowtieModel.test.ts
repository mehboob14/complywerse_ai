import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectivenessLabel, hasGap, itemControls, placeControls, sideFor } from './bowtieModel.ts';
import type { BowTieItem, LinkedControl } from './bowtieModel.ts';

const control = (link_id: number, control_type: string | null, effectiveness: string | null = null): LinkedControl =>
  ({ link_id, name: `Control ${link_id}`, control_type, effectiveness });

test('a control is placed by its own type, untyped controls apart', () => {
  const placed = placeControls([control(1, 'preventive'), control(2, 'detective'), control(3, 'Corrective'), control(4, null)]);
  assert.deepEqual(placed.preventive.map((c) => c.link_id), [1]);
  assert.deepEqual(placed.mitigating.map((c) => c.link_id), [2, 3]);
  assert.deepEqual(placed.unclassified.map((c) => c.link_id), [4]);
  assert.equal(sideFor(undefined), 'unclassified');
});

test('a cause needs a preventive control and a consequence a mitigating one', () => {
  const cause: BowTieItem = { id: 1, side: 'cause', title: 'Manual keying' };
  const loss: BowTieItem = { id: 2, side: 'consequence', title: 'Funds lost' };
  const controls = [control(1, 'preventive')];
  assert.equal(hasGap(cause, controls), false);
  assert.equal(hasGap(loss, controls), true);
  assert.equal(hasGap(cause, []), true);
});

test('controls placed on an item replace its side; links no longer on the risk are ignored', () => {
  const controls = [control(1, 'preventive'), control(2, 'detective')];
  const onlyDetective: BowTieItem = { id: 1, side: 'cause', title: 'x', control_link_ids: [2] };
  assert.equal(hasGap(onlyDetective, controls), true);
  assert.equal(hasGap({ id: 2, side: 'consequence', title: 'y', control_link_ids: [2] }, controls), false);
  const stale: BowTieItem = { id: 3, side: 'cause', title: 'z', control_link_ids: [99] };
  assert.deepEqual(itemControls(stale, controls).map((c) => c.link_id), [1]);
});

test('effectiveness reads Effective / Partly effective / Not assessed, never a percentage', () => {
  assert.equal(effectivenessLabel('effective'), 'Effective');
  assert.equal(effectivenessLabel('partially_effective'), 'Partly effective');
  assert.equal(effectivenessLabel('ineffective'), 'Not effective');
  assert.equal(effectivenessLabel('not assessed'), 'Not assessed');
  assert.equal(effectivenessLabel(null), 'Not assessed');
});
