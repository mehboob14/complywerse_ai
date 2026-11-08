// node --test "src/app/(dashboard)/automation/soc2-controls/_explorer/controlsRightsModel.test.ts"
// A right is held as the server reads it: by its exact name, or by being an administrator. A person who may only read frameworks does not hold "manage frameworks".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { NO_RIGHT, RIGHT, holds } from './controlsRightsModel.ts';

test('the exact name decides, not a right under the same prefix', () => {
  assert.equal(holds(RIGHT.frameworks, ['compliance:frameworks:view'], false), false, 'read-only is not manage');
  assert.equal(holds(RIGHT.frameworks, ['compliance:frameworks:*'], false), true);
  assert.equal(holds(RIGHT.assign, ['controls:controls:*'], false), false, 'the server reads the name, so a wildcard of another name is not the right');
  assert.equal(holds(RIGHT.scan, [], false), false);
  assert.equal(holds(RIGHT.scan, [], true), true, 'an administrator holds every right');
});

test('every right has its plain words, and the names are the ones the backend checks', () => {
  assert.deepEqual(Object.keys(RIGHT).sort(), Object.keys(NO_RIGHT).sort());
  const BACKEND = new URL('../../../../../../../backend/grc/modules/', import.meta.url);
  const read = (rel: string) => { try { return readFileSync(new URL(rel, BACKEND), 'utf8'); } catch { return null; } };
  const scf = read('scf/router.py');
  if (scf == null) return;                                                                            // the backend is not beside this checkout
  assert.ok(scf.includes(`require_tenant_permission("${RIGHT.frameworks}")`));
  assert.ok(scf.includes(`"${RIGHT.assign}"`));
  assert.ok(scf.includes(`"${RIGHT.createControl}"`));
  assert.ok((read('automation/router.py') ?? '').includes(`"${RIGHT.scan}"`));
});
