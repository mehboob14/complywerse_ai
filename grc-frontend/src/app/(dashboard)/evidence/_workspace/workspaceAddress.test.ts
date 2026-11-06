// node --test "src/app/(dashboard)/evidence/_workspace/workspaceAddress.test.ts"
// The Evidence workspace's address: every state a link can name, junk falling back to the plain page, and the parameters other pages link with (control,
// control_id, type) left exactly as they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { OFFERED_VIEWS, SCHEMA, VIEW_KEYS } from './workspaceAddress.ts';

test('the plain address is the workbench of every record, and writes back to the plain address', () => {
  const s = readAddress(SCHEMA, '');
  assert.deepEqual(s, { view: 'workbench', section: 'records', q: '', status: [], evidence_type: [], open: 0, page: 1 });
  assert.equal(writeAddress(SCHEMA, '', s), '');
});

test('every view opens from the address, the switcher offers three of the five, and an unknown view is the workbench', () => {
  for (const v of VIEW_KEYS) assert.equal(readAddress(SCHEMA, `?view=${v}`).view, v);
  assert.equal(readAddress(SCHEMA, '?view=PIPELINE').view, 'pipeline');
  assert.equal(readAddress(SCHEMA, '?view=kanban').view, 'workbench');
  assert.deepEqual(OFFERED_VIEWS, ['workbench', 'pipeline', 'snapshot']);
  for (const v of OFFERED_VIEWS) assert.ok((VIEW_KEYS as readonly string[]).includes(v));
});

test('filters, search, the open file and the page round-trip; statuses the page does not know are dropped; the page is at least 1', () => {
  const q = '?view=register&status=pending_review,stale,junk&evidence_type=policy,log&q=firewall%20rules&open=42&page=3&section=settings';
  const s = readAddress(SCHEMA, q);
  assert.deepEqual(s, { view: 'register', section: 'settings', q: 'firewall rules', status: ['pending_review', 'stale'], evidence_type: ['policy', 'log'], open: 42, page: 3 });
  assert.deepEqual(readAddress(SCHEMA, writeAddress(SCHEMA, '', s)), s);
  assert.equal(readAddress(SCHEMA, '?page=0').page, 1);
  assert.equal(readAddress(SCHEMA, '?page=-2').page, 1);
  assert.equal(readAddress(SCHEMA, '?page=abc').page, 1);
  assert.equal(readAddress(SCHEMA, '?open=0').open, 0);
  assert.equal(readAddress(SCHEMA, '?open=12abc').open, 0);
});

test('what other pages link with is left alone: control, control_id and type are not the workspace\'s, and survive any change of its own', () => {
  const inbound = '?control=12&type=policy&control_id=7';
  const s = readAddress(SCHEMA, inbound);
  assert.deepEqual(s, { view: 'workbench', section: 'records', q: '', status: [], evidence_type: [], open: 0, page: 1 }, 'those links open the plain page, as they always did');
  const next = new URLSearchParams(writeAddress(SCHEMA, inbound, { ...s, q: 'x' }));
  assert.equal(next.get('control'), '12');
  assert.equal(next.get('type'), 'policy');
  assert.equal(next.get('control_id'), '7');
  assert.equal(next.get('q'), 'x');
});
