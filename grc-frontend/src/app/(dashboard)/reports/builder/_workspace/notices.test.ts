// node --test "src/app/(dashboard)/reports/builder/_workspace/notices.test.ts"
// P-R6: the server's skipped filters are said, in words, never hidden; gap filters the browser re-checks are not alarming; nothing technical reaches the sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skippedFilterLines, summaryWarningLines, notice } from './notices.ts';

const labelOf = (k: string) => ({ status: 'Status', owner: 'Owner' } as Record<string, string>)[k] ?? k;

test('a skipped filter is a sentence with the field, the condition and what it means for the rows', () => {
  const lines = skippedFilterLines([{ col: 'status', op: 'in', reason: 'unknown_column' }], labelOf);
  assert.deepEqual(lines, ['Status is any of: this field cannot be filtered on the server, so the rows are not narrowed by it.']);
});

test('every known reason has words and an unknown one still reads as a sentence', () => {
  const reasons = ['unknown_column', 'unsupported_operator', 'invalid_value', 'something_new'];
  const lines = skippedFilterLines(reasons.map((reason) => ({ col: 'owner', op: 'eq', reason })), labelOf);
  assert.equal(lines.length, 4);
  lines.forEach((l) => assert.doesNotMatch(l, /unknown_column|unsupported_operator|invalid_value|something_new|_/));
  assert.match(lines[3], /could not be applied/);
});

test('a gap filter the browser re-checks is not reported', () => {
  assert.deepEqual(skippedFilterLines([{ col: 'linkpresence_evidence', op: 'notlinked', reason: 'unsupported_operator' }], labelOf), []);
});

test('nothing skipped gives no lines and no notice', () => {
  assert.deepEqual(skippedFilterLines(undefined, labelOf), []);
  assert.deepEqual(skippedFilterLines([], labelOf), []);
  assert.equal(notice('x', []), null);
  assert.deepEqual(notice('Some filters were not applied', ['a']), { title: 'Some filters were not applied', lines: ['a'] });
});

test('a summary that left out filters, a breakdown field and calculations says each', () => {
  const lines = summaryWarningLines({ skipped_filters: [{ col: 'owner', op: 'eq', reason: 'invalid_value' }], skipped_group_by: ['status'], skipped_measures: ['m1', 'm2'] }, labelOf);
  assert.equal(lines.length, 3);
  assert.match(lines[1], /not broken down by Status/);
  assert.match(lines[2], /2 calculations were left out/);
  assert.match(summaryWarningLines({ skipped_measures: ['m1'] }, labelOf)[0], /1 calculation was left out/);
});
