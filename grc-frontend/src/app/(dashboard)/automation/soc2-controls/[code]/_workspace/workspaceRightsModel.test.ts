// node --test "src/app/(dashboard)/automation/soc2-controls/[code]/_workspace/workspaceRightsModel.test.ts"
// A right is held as the server reads it: by its exact name, or by being an administrator. A route that accepts either of two names is met by either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { WS_NO_RIGHT, WS_RIGHT, mayDo, rightsOf, whyNot, type WsRightKey } from './workspaceRightsModel.ts';

test('the exact name decides, and a route that takes either of two names is met by either', () => {
  assert.equal(mayDo('testing', ['controls:control_testing:view'], false), false);
  assert.equal(mayDo('testing', ['controls:control_testing:edit'], false), true);
  assert.equal(mayDo('signOff', ['controls:control_testing:edit'], false), false, 'recording a test is not signing it off');
  assert.equal(mayDo('riskLink', ['erm:risks:edit'], false), true);
  assert.equal(mayDo('riskLink', ['controls:control_library:edit'], false), true);
  assert.equal(mayDo('riskLink', ['erm:risks:view'], false), false);
  assert.equal(mayDo('frameworks', ['compliance:frameworks:view'], false), false);
  assert.equal(mayDo('frameworks', [], true), true, 'an administrator holds every right');
});

test('every right has its plain words, and a person who holds it is told nothing', () => {
  assert.deepEqual(Object.keys(WS_RIGHT).sort(), Object.keys(WS_NO_RIGHT).sort());
  const none = rightsOf([], false);
  (Object.keys(WS_RIGHT) as WsRightKey[]).forEach((k) => {
    assert.equal(none[k], false, k);
    assert.match(whyNot(none, k) ?? '', /^You need the right to /, k);
  });
  const admin = rightsOf([], true);
  (Object.keys(WS_RIGHT) as WsRightKey[]).forEach((k) => assert.equal(whyNot(admin, k), undefined, k));
});

test('the names are the ones the backend checks', () => {
  const BACKEND = new URL('../../../../../../../../backend/grc/modules/', import.meta.url);
  const read = (rel: string) => { try { return readFileSync(new URL(rel, BACKEND), 'utf8'); } catch { return null; } };
  const assurance = read('automation/assurance.py');
  if (assurance == null) return;                                                                      // the backend is not beside this checkout
  const router = read('automation/router.py') ?? '';
  const scf = read('scf/router.py') ?? '';
  assert.ok(assurance.includes(`require_tenant_permission("${WS_RIGHT.testing[0]}")`));
  assert.ok(assurance.includes(`require_tenant_permission("${WS_RIGHT.signOff[0]}")`));
  assert.ok(router.includes(`require_tenant_permission("${WS_RIGHT.evidence[0]}")`));
  assert.ok(scf.includes(`require_tenant_permission("${WS_RIGHT.libraryEdit[0]}")`));
  assert.ok(scf.includes(`require_tenant_permission("${WS_RIGHT.assign[0]}")`));
  assert.ok(scf.includes(`require_tenant_permission("${WS_RIGHT.frameworks[0]}")`));
  assert.ok(router.includes(`require_tenant_permission("${WS_RIGHT.scan[0]}")`));
  for (const name of WS_RIGHT.riskLink) assert.ok(router.includes(`"${name}"`), name);
  for (const name of WS_RIGHT.assetLink) assert.ok(router.includes(`"${name}"`), name);
});
