// node --test "src/components/ui/ds/searchModel.test.ts"
// The rules of DebouncedSearch apart from React: the quiet time, what a query is, when the list is asked, when the page's own query overwrites the box, what Escape
// does and what the clear button is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEARCH_DELAY, clearName, escapeClears, pageChangedQuery, queryOf, shouldAsk } from './searchModel.ts';

test('the list is asked after 300 ms of quiet: one request for a word, not one per letter', () => {
  assert.equal(SEARCH_DELAY, 300);
});

test('a query is what was typed without the spaces at either end; the middle is the person\'s own', () => {
  assert.equal(queryOf('  retention '), 'retention');
  assert.equal(queryOf('data  retention'), 'data  retention');
  assert.equal(queryOf('   '), '');
  assert.equal(queryOf(''), '');
});

test('the list is asked only when the query changed: a trailing space, or typing and deleting back to the same text, asks nothing', () => {
  assert.equal(shouldAsk('retention', ''), true);
  assert.equal(shouldAsk('retention ', 'retention'), false);
  assert.equal(shouldAsk(' retention', 'retention'), false);
  assert.equal(shouldAsk('retentio', 'retention'), true);
  assert.equal(shouldAsk('retention', 'retention'), false);
  assert.equal(shouldAsk('', 'retention'), true);                         // emptying the box asks for everything
  assert.equal(shouldAsk('   ', ''), false);                              // only spaces: still the empty query
});

test('the page\'s own change of query overwrites the box; the answer to this box\'s own ask does not', () => {
  assert.equal(pageChangedQuery('', 'retention'), true);                  // "Clear filters"
  assert.equal(pageChangedQuery('policy', 'retention'), true);            // a link with ?q=policy
  assert.equal(pageChangedQuery('retention', 'retention'), false);        // the page echoing what the box asked for: the person may be typing on
  assert.equal(pageChangedQuery(' retention', 'retention'), false);
});

test('Escape clears a box that has text and is not the box\'s key when it is empty (a panel around it closes)', () => {
  assert.equal(escapeClears('retention'), true);
  assert.equal(escapeClears(' '), true);
  assert.equal(escapeClears(''), false);
});

test('the clear button is named for what it clears', () => {
  assert.equal(clearName('Search documents'), 'Clear search documents');
  assert.equal(clearName('Find a department'), 'Clear find a department');
  assert.equal(clearName('  '), 'Clear search');
  assert.equal(clearName(''), 'Clear search');
});
