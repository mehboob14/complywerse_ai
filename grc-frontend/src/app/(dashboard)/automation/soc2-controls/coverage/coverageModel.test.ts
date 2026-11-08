// node --test "src/app/(dashboard)/automation/soc2-controls/coverage/coverageModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inferredShare, isAccounted, matchWords, matchingUnmapped, orderedFrameworks, totalInferred, type FrameworkCoverage } from './coverageModel.ts';
import { requirementDisposition } from '../../../../../lib/statuses/controls.ts';
import { DISPOSITIONS } from './coverageModel.ts';

const fw = (label: string, over: Partial<FrameworkCoverage> = {}): FrameworkCoverage => ({
  key: label.toLowerCase(), label, total: 10, counts: { mapped: 10, other_party: 0, out_of_scope: 0, pending: 0 }, mapped_pct: 100, accounted_pct: 100, inferred: 0, unmapped: [], ...over,
});

test('what is still to assess comes first, then the least mapped', () => {
  const list = [
    fw('Complete'),
    fw('Few pending', { counts: { mapped: 8, other_party: 0, out_of_scope: 0, pending: 2 }, mapped_pct: 80 }),
    fw('Many pending', { counts: { mapped: 5, other_party: 0, out_of_scope: 0, pending: 5 }, mapped_pct: 50 }),
    fw('Accounted but low', { counts: { mapped: 4, other_party: 6, out_of_scope: 0, pending: 0 }, mapped_pct: 40 }),
  ];
  assert.deepEqual(orderedFrameworks(list).map((f) => f.label), ['Many pending', 'Few pending', 'Accounted but low', 'Complete']);
  assert.equal(isAccounted(list[2]), false);
  assert.equal(isAccounted(list[3]), true);
});

test('a search keeps the requirements that hold every word, in the code, the name or the reason', () => {
  const u = (code: string, title: string, reason: string) => ({ code, reference: code, title, disposition: 'other_party' as const, rule: 'r', reason });
  const f = fw('F', { unmapped: [u('A.1', 'Board oversight', 'Binds the regulator'), u('A.2', 'Exchange rules', 'Binds the exchange operator'), u('B.1', null as unknown as string, 'Outside the catalogue')] });
  assert.equal(matchingUnmapped(f, '').length, 3);
  assert.deepEqual(matchingUnmapped(f, 'binds regulator').map((x) => x.code), ['A.1']);
  assert.deepEqual(matchingUnmapped(f, 'BINDS').map((x) => x.code), ['A.1', 'A.2']);
  assert.deepEqual(matchingUnmapped(f, 'b.1').map((x) => x.code), ['B.1']);
  assert.deepEqual(matchingUnmapped(f, 'nothing like it'), []);
});

test('a framework mapped by roll-up reads as the weaker claim it is, and nothing mapped is not a ratio', () => {
  const exact = fw('Exact');
  const half = fw('Half', { inferred: 5 });
  const all = fw('All', { inferred: 10 });
  const none = fw('None', { counts: { mapped: 0, other_party: 0, out_of_scope: 0, pending: 10 }, inferred: 0 });
  assert.deepEqual(matchWords(exact), { text: 'Exact', weak: false });
  assert.deepEqual(matchWords(half), { text: '50% inferred', weak: true });
  assert.deepEqual(matchWords(fw('Some', { inferred: 2 })), { text: '20% inferred', weak: false });
  assert.deepEqual(matchWords(all), { text: '100% inferred', weak: true });
  assert.equal(inferredShare(none), null);
  assert.equal(totalInferred([exact, half, all]), 15);
});

test('every disposition the server writes has a tone and a word', () => {
  for (const d of DISPOSITIONS) assert.ok(requirementDisposition.has(d), d);
});
