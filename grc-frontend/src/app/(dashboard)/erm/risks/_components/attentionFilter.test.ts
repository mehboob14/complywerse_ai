// node --test "src/app/(dashboard)/erm/risks/_components/attentionFilter.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attentionFilterOf, matchesAttentionFilter } from './attentionFilter.ts';

test('only the two tile filters are read from the address', () => {
  assert.equal(attentionFilterOf('critical_open'), 'critical_open');
  assert.equal(attentionFilterOf('unscored'), 'unscored');
  assert.equal(attentionFilterOf('overdue'), null);
  assert.equal(attentionFilterOf(null), null);
});

test('critical open: active, both scores, residual in the critical band', () => {
  assert.equal(matchesAttentionFilter({ status: 'open', inherent_score: 25, residual_score: 20 }, 'critical_open'), true);
  assert.equal(matchesAttentionFilter({ status: 'open', inherent_score: 25, residual_score: 19 }, 'critical_open'), false);
  assert.equal(matchesAttentionFilter({ status: 'closed', inherent_score: 25, residual_score: 25 }, 'critical_open'), false);
  assert.equal(matchesAttentionFilter({ status: 'open', inherent_score: null, residual_score: 25 }, 'critical_open'), false);
});

test('unscored: active and missing either score', () => {
  assert.equal(matchesAttentionFilter({ status: 'open', inherent_score: 12, residual_score: null }, 'unscored'), true);
  assert.equal(matchesAttentionFilter({ status: 'in_treatment' }, 'unscored'), true);
  assert.equal(matchesAttentionFilter({ status: 'closed' }, 'unscored'), false);
  assert.equal(matchesAttentionFilter({ status: 'open', inherent_score: 4, residual_score: 2 }, 'unscored'), false);
});

test('no filter lets every risk through', () => {
  assert.equal(matchesAttentionFilter({ status: 'closed' }, null), true);
});
