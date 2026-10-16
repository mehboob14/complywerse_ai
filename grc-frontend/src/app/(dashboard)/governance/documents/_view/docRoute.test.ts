// Run from this folder (node --test reads [id] in a path as a glob): node --test _docRoute.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VIEWS, inStudio, viewOf } from './docRoute.ts';

test('links to statements or gap analysis open the classic page, where those tabs are', () => {
  for (const tab of ['statements', 'gap-analysis', 'GAPS ']) assert.equal(inStudio(true, new URLSearchParams({ tab })), false);
  assert.equal(inStudio(true, new URLSearchParams({ tab: 'lifecycle' })), true);
});

const params = (q: string) => new URLSearchParams(q);

test('inStudio needs the switch on and no ?classic=1', () => {
  assert.equal(inStudio(true, params('')), true);
  assert.equal(inStudio(true, params('tab=chain')), true);
  assert.equal(inStudio(true, params('classic=0')), true);
  assert.equal(inStudio(true, params('classic=1')), false);
  assert.equal(inStudio(false, params('')), false);
  assert.equal(inStudio(undefined, params('')), false);
});

test('viewOf maps every old tab and every new view', () => {
  const cases: [string, string][] = [
    ['viewer', 'document'],
    ['document', 'document'],
    ['lifecycle', 'approvals'],
    ['sign-off', 'approvals'],
    ['discussion', 'approvals'],
    ['review-history', 'approvals'],
    ['approvals', 'approvals'],
    ['controls', 'mappings'],
    ['statements', 'mappings'],
    ['gap-analysis', 'mappings'],
    ['gaps', 'mappings'],
    ['mappings', 'mappings'],
    ['chain', 'versions'],
    ['versions', 'versions'],
  ];
  for (const [tab, view] of cases) assert.equal(viewOf(tab), view, tab);
});

test('viewOf ignores case and spaces, falls back to document', () => {
  assert.equal(viewOf('  Sign-Off '), 'approvals');
  assert.equal(viewOf('CHAIN'), 'versions');
  assert.equal(viewOf(null), 'document');
  assert.equal(viewOf(undefined), 'document');
  assert.equal(viewOf(''), 'document');
  assert.equal(viewOf('nope'), 'document');
  assert.equal(viewOf('constructor'), 'document');
});

test('VIEWS lists the four views in order', () => {
  assert.deepEqual(VIEWS.map((v) => [v.key, v.label]), [
    ['document', 'Document'],
    ['approvals', 'Approvals'],
    ['mappings', 'Mappings'],
    ['versions', 'Versions'],
  ]);
});
