// node --test "src/app/(dashboard)/control-library/_library/libraryModel.test.ts"
// The Control Library's numbers: a group's completion, shared and unique, the headline figures with and without a built view, the reconciliation words, and the addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCoverage, completionOf, completionTone, distinctSorted, domainHref, headline, parsePicked, reconciliation, scopedCounts, sharedOf, shortFramework, splitOf,
  type ControlGroup, type GroupsResponse,
} from './libraryModel.ts';

const group = (id: number, over: Partial<ControlGroup> = {}): ControlGroup => ({
  id, code: `G${id}`, name: `Group ${id}`, description: 'd', category: 'c', domain: 'x', keywords: ['k'], normalized_control_count: 10, standalone_control_count: 4, total_control_count: 10, ...over,
});

test('completion: 20 for each of description, category, domain, keywords and controls; none for a group with no control', () => {
  assert.equal(completionOf(group(1)), 100);
  assert.equal(completionOf(group(1, { description: null })), 80);
  assert.equal(completionOf(group(1, { description: null, category: null, keywords: [] })), 40);
  assert.equal(completionOf(group(1, { total_control_count: 0 })), 0);
  assert.deepEqual([completionTone(70), completionTone(69), completionTone(40), completionTone(39)], ['success', 'warning', 'warning', 'danger']);
});

test('shared is the unified controls less the standalone ones, never negative', () => {
  assert.equal(sharedOf(group(1)), 6);
  assert.equal(sharedOf(group(1, { normalized_control_count: 2, standalone_control_count: 5 })), 0);
  assert.deepEqual(splitOf([group(1), group(2, { normalized_control_count: 3, standalone_control_count: 3 })]), { sets: 6, standalone: 7 });
});

test('short framework names: the first matching part wins, otherwise the first word', () => {
  assert.equal(shortFramework('ISO/IEC 27001:2022'), 'ISO 27001');
  assert.equal(shortFramework('NIST SP 800-53 Rev 5'), 'NIST 800-53');
  assert.equal(shortFramework('Acme Security Standard'), 'Acme');
  assert.equal(shortFramework(null), '');
});

const data: GroupsResponse = {
  items: [group(1, { normalized_control_count: 10, standalone_control_count: 4, total_control_count: 10 }), group(2, { normalized_control_count: 5, standalone_control_count: 5, total_control_count: 5 }), group(3, { normalized_control_count: 0, standalone_control_count: 0, total_control_count: 0 })],
  total: 3, skip: 0, limit: 200, total_mapped_controls: 15, total_raw_controls: 22, library_framework_count: 6,
};

test('unscoped headline: the server\'s totals, sets and unique over the groups, duplicates are raw less unified', () => {
  const h = headline({ data, showEmpty: true, picked: [], coverage: undefined, availableCount: 9 });
  assert.deepEqual([h.scoped, h.domains, h.controls, h.frameworks, h.sets, h.standalone, h.rawTotal, h.duplicates, h.groups.length], [false, 3, 15, 6, 6, 9, 22, 7, 3]);
  assert.equal(headline({ data, showEmpty: false, picked: [], coverage: undefined, availableCount: 9 }).groups.length, 2, 'empty groups can be left out');
  assert.equal(headline({ data: { ...data, library_framework_count: undefined, total_mapped_controls: undefined }, showEmpty: true, picked: [], coverage: undefined, availableCount: 9 }).frameworks, 9);
  assert.equal(headline({ data: { ...data, total_mapped_controls: undefined }, showEmpty: true, picked: [], coverage: undefined, availableCount: 9 }).controls, 15, 'the sum of the groups when the server did not say');
  assert.equal(headline({ data: undefined, showEmpty: true, picked: [], coverage: undefined, availableCount: 0 }).controls, 0);
});

const coverage = buildCoverage([
  { id: 1, d: { sets: [{ members: [{ framework: 'ISO/IEC 27001' }, { framework: 'PCI DSS 4' }] }, { members: [{ framework: 'ISO/IEC 27001' }, { framework: 'ISO/IEC 27001' }] }], standalone_controls: [{ members: [{ framework: 'SOC 2' }] }] } },
  { id: 2, d: { sets: [{ members: [{ framework: 'SOC 2' }, { framework: 'PCI DSS 4' }] }], standalone_controls: [] } },
  null,
]);

test('coverage: sets as their distinct short frameworks, a set counts once for each framework in it', () => {
  assert.deepEqual(coverage.byDomain[1].sets, [['ISO 27001', 'PCI DSS'], ['ISO 27001']]);
  assert.deepEqual(coverage.byDomain[1].standalone, ['SOC 2']);
  assert.deepEqual(coverage.frameworks, ['ISO 27001', 'PCI DSS', 'SOC 2']);
  assert.deepEqual(coverage.fwTotals, { 'ISO 27001': 2, 'PCI DSS': 2, 'SOC 2': 2 });
  assert.equal(scopedCounts(coverage, 99, ['SOC 2']), null);
  assert.deepEqual(scopedCounts(coverage, 1, ['PCI DSS']), { sets: 1, standalone: 0, total: 1 });
});

test('scoped headline: groups recomputed for the picked frameworks, those left with nothing dropped, raw is the picked frameworks\' totals', () => {
  const h = headline({ data, showEmpty: true, picked: ['ISO 27001', 'PCI DSS'], coverage, availableCount: 9 });
  assert.equal(h.scoped, true);
  assert.deepEqual(h.groups.map((g) => [g.id, g.total_control_count, g.standalone_control_count]), [[1, 2, 0], [2, 1, 0]]);
  assert.deepEqual([h.domains, h.controls, h.frameworks, h.sets, h.standalone, h.rawTotal, h.duplicates], [2, 3, 2, 3, 0, 4, 1]);
  assert.equal(h.repeated, 1, 'one requirement is repeated across two of the picked frameworks (ISO 27001 and PCI DSS in group 1)... and group 2 has only PCI DSS picked');
  const soc = headline({ data, showEmpty: true, picked: ['SOC 2'], coverage, availableCount: 9 });
  assert.deepEqual(soc.groups.map((g) => g.id), [1, 2]);
  assert.equal(headline({ data, showEmpty: true, picked: ['SOC 2'], coverage: undefined, availableCount: 9 }).scoped, false, 'a view waits for its coverage');
});

test('the reconciliation shows only when duplicates were merged, and says whose frameworks', () => {
  const plain = headline({ data, showEmpty: true, picked: [], coverage: undefined, availableCount: 9 });
  assert.deepEqual(reconciliation(plain, 0, 9), { show: true, who: 'Your 9 frameworks', repeated: 6 });
  const none = headline({ data: { ...data, total_raw_controls: 15 }, showEmpty: true, picked: [], coverage: undefined, availableCount: 9 });
  assert.equal(reconciliation(none, 0, 9).show, false);
  const scoped = headline({ data, showEmpty: true, picked: ['ISO 27001', 'PCI DSS'], coverage, availableCount: 9 });
  assert.deepEqual(reconciliation(scoped, 2, 9), { show: true, who: 'Your 2 frameworks', repeated: 1 });
});

test('addresses: the view travels to a domain, and the picked frameworks read back', () => {
  assert.equal(domainHref(7, []), '/control-library/7');
  assert.equal(domainHref(7, ['ISO 27001', 'SOC 2']), '/control-library/7?fw=ISO%2027001%2CSOC%202');
  assert.deepEqual(parsePicked(' ISO 27001, ,SOC 2 '), ['ISO 27001', 'SOC 2']);
  assert.deepEqual(parsePicked(null), []);
  assert.deepEqual(distinctSorted(['b', null, 'a', 'b', '']), ['a', 'b']);
});
