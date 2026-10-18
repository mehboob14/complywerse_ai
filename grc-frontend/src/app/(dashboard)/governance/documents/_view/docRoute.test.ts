// Run from this folder (node --test reads [id] in a path as a glob): node --test _docRoute.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LIBRARY_VIEWS, VIEWS, inStudio, viewOf } from './docRoute.ts';

test('the AI Studio view is the only one: it needs the switch on, whatever the link asks for', () => {
  assert.equal(inStudio(true), true);
  assert.equal(inStudio(false), false);
  assert.equal(inStudio(undefined), false);
});

test('the classic page\'s Statements and Gap Analysis links open the studio\'s own views', () => {
  assert.equal(viewOf('statements'), 'statements');
  for (const tab of ['gap-analysis', 'gaps', 'Gap-Analysis']) assert.equal(viewOf(tab), 'gaps', tab);
  assert.equal(viewOf('controls'), 'mappings');                  // Mappings stays Mappings
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
    ['statements', 'statements'],
    ['controls', 'mappings'],
    ['mappings', 'mappings'],
    ['gap-analysis', 'gaps'],
    ['gaps', 'gaps'],
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

test('VIEWS lists the six views in order; statements, mappings and gap analysis are the library\'s', () => {
  assert.deepEqual(VIEWS.map((v) => [v.key, v.label]), [
    ['document', 'Document'],
    ['approvals', 'Approvals'],
    ['statements', 'Statements'],
    ['mappings', 'Mappings'],
    ['gaps', 'Gap analysis'],
    ['versions', 'Versions'],
  ]);
  assert.deepEqual(VIEWS.filter((v) => LIBRARY_VIEWS.has(v.key)).map((v) => v.key), ['statements', 'mappings', 'gaps']);
  for (const tab of ['statements', 'mappings', 'gap-analysis']) assert.ok(LIBRARY_VIEWS.has(viewOf(tab)), tab);
});
