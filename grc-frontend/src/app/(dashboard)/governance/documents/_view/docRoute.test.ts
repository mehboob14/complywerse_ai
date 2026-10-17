// Run from this folder (node --test reads [id] in a path as a glob): node --test _docRoute.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VIEWS, inStudio, viewOf } from './docRoute.ts';

test('the AI Studio view is the only one: it needs the switch on, whatever the link asks for', () => {
  assert.equal(inStudio(true), true);
  assert.equal(inStudio(false), false);
  assert.equal(inStudio(undefined), false);
  for (const tab of ['statements', 'gap-analysis', 'gaps']) assert.equal(viewOf(tab), 'mappings');   // they open Mappings, not the classic page
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
