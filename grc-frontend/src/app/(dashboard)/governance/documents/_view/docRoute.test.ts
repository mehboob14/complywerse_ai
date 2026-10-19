// Run from this folder (node --test reads [id] in a path as a glob): node --test _docRoute.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LIBRARY_VIEWS, VIEWS, inStudio, retryUnlessRefused, viewOf } from './docRoute.ts';

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
    ['discussion', 'discussion'],               // the Discussion is a view of its own again
    ['comments', 'discussion'],
    ['review-history', 'approvals'],
    ['approvals', 'approvals'],
    ['statements', 'statements'],
    ['controls', 'mappings'],
    ['mappings', 'mappings'],
    ['gap-analysis', 'gaps'],
    ['gaps', 'gaps'],
    ['chain', 'versions'],
    ['versions', 'versions'],
    ['change-log', 'versions'],                 // the Change log
    ['history', 'versions'],
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

test('VIEWS lists the seven views in order; statements, mappings and gap analysis are the library\'s', () => {
  assert.deepEqual(VIEWS.map((v) => [v.key, v.label]), [
    ['document', 'Document'],
    ['approvals', 'Approvals'],
    ['discussion', 'Discussion'],
    ['statements', 'Statements'],
    ['mappings', 'Mappings'],
    ['gaps', 'Gap analysis'],
    ['versions', 'Change log'],
  ]);
  assert.deepEqual(VIEWS.filter((v) => LIBRARY_VIEWS.has(v.key)).map((v) => v.key), ['statements', 'mappings', 'gaps']);
  for (const tab of ['statements', 'mappings', 'gap-analysis']) assert.ok(LIBRARY_VIEWS.has(viewOf(tab)), tab);
});

test('a refused or missing document is not asked for again; other failures up to three times', () => {
  for (const status of [403, 404]) assert.equal(retryUnlessRefused(0, { response: { status } }), false, String(status));
  assert.equal(retryUnlessRefused(0, { response: { status: 500 } }), true);
  assert.equal(retryUnlessRefused(2, new Error('Network Error')), true);
  assert.equal(retryUnlessRefused(3, { response: { status: 502 } }), false);
  assert.equal(retryUnlessRefused(0, null), true);
});
