// node --test "src/lib/auditRegister/address.test.ts"
// The Issue Register's address: a notification's ?finding= opens the drawer, a number of the pack leads to the Register filtered to what it counts, other pages' params stay, and a name the
// register does not know is ignored. The Register's own names (q, quick, view, sort, page, id and its facets) are never the page's `section`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress } from '../addressState.ts';
import { RESERVED, buildSchema } from '../../components/records/registerModel.ts';
import { OWN_PARAMS, REGISTER_PARAMS, SECTIONS, drillAddress, drillOfPackRow, drillOfReport, sectionOf, withFindingAsId } from './address.ts';
import { registerDef } from './registerDef.ts';

test('the page\'s own names are not the register\'s: ?section= and ?setup= can never be a facet', () => {
  for (const name of OWN_PARAMS) assert.ok(!REGISTER_PARAMS.includes(name), name);
  assert.doesNotThrow(() => buildSchema(registerDef()));
  assert.ok(RESERVED.every((r) => REGISTER_PARAMS.includes(r)));
  // the Issues pages read ?tab=: the register must not write it
  assert.ok(!(OWN_PARAMS as readonly string[]).includes('tab'));
});

test('the tab is read from ?section=, and anything else is the Register', () => {
  assert.deepEqual(SECTIONS, ['register', 'summary', 'reports', 'queues', 'setup']);
  assert.equal(sectionOf(''), 'register');
  assert.equal(sectionOf('?section=queues'), 'queues');
  assert.equal(sectionOf('?section=SUMMARY'), 'summary');
  assert.equal(sectionOf('?section=nonsense'), 'register');
  assert.equal(sectionOf('?section=setup', ['register', 'summary']), 'register');     // a tab the person may not open
});

test('a notification\'s ?finding=7 opens finding 7\'s drawer, and keeps what else the address says', () => {
  assert.equal(withFindingAsId('?finding=7'), 'id=7');
  assert.equal(withFindingAsId('?section=queues&finding=7'), 'section=queues&id=7');
  assert.equal(withFindingAsId('?finding=abc'), '');
  assert.equal(withFindingAsId('?finding=7&id=9'), 'id=9');
  assert.equal(withFindingAsId('?source=regulator'), 'source=regulator');
  assert.equal(withFindingAsId(''), '');
});

test('a number of the pack leads to the Register filtered to what it counts', () => {
  assert.equal(drillAddress('?section=summary', drillOfPackRow('regulator', 'PD')), 'source=regulator&status=PD');
  assert.equal(drillAddress('?section=summary', drillOfPackRow('', 'open')), 'quick=open');
  assert.equal(drillAddress('?section=summary', drillOfPackRow('it_pen', 'open')), 'source=it_pen&quick=open');
  assert.equal(drillAddress('', { source: 'ey', report: 'ey-2024' }), 'source=ey&report=ey-2024');
});

test('a drill drops the register\'s old filters, the tab and the open finding, and keeps other pages\' params', () => {
  const from = '?section=summary&q=wire&quick=mine&source=ey&status=PD&page=3&id=9&register=audit&category=contract';
  assert.equal(drillAddress(from, { source: 'regulator', status: 'IP' }), 'register=audit&category=contract&source=regulator&status=IP');
  // and the Register reads what the drill wrote
  const def = registerDef();
  const state = readAddress(buildSchema(def), drillAddress(from, { source: 'regulator', status: 'IP' }));
  assert.deepEqual(state.source, ['regulator']);
  assert.deepEqual(state.status, ['IP']);
  assert.equal(state.quick, 'all');
  assert.equal(state.page, 1);
});

test('a report line leads to its findings: by its key, or by its name when it has none', () => {
  assert.equal(drillAddress('?section=reports', drillOfReport({ source: 'regulator', key: 'occ-1', report: 'Exam' })), 'source=regulator&report=occ-1');
  assert.equal(drillAddress('?section=reports', drillOfReport({ source: 'it_pen', key: null, report: 'CLD 2024' })), 'source=it_pen&q=CLD+2024');
});
