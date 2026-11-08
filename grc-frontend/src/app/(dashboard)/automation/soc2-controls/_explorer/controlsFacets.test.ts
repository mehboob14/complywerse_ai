// node --test "src/app/(dashboard)/automation/soc2-controls/_explorer/controlsFacets.test.ts"
// The Controls explorer's facets: the engine's answer (matches and live counts) is held to the plain filter, the options are the values the controls have, and the chips come off one by one.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countOf, evaluate } from '../../../../../components/records/facetEngine.ts';
import {
  NO_FILTERS, chosenOf, filterChips, filterCount, indexControls, orderedOptions, plainFilter, railOptions, removeChip, ruleOf, type Filters,
} from './controlsFacets.ts';
import { withIds, type ControlRow } from './controlsModel.ts';

const NOW = new Date('2026-11-08T10:00:00Z');
const ctx = { me: 7, now: NOW };
const row = (id: string, over: Partial<ControlRow> = {}): ControlRow => ({
  control_id: id, title: `Title of ${id}`, category: 'Identity', sub_type: 'Manual', requirements: {}, checks_count: 0, overall_status: 'manual', owner_user_id: null, owner_name: null,
  assigned_user_ids: [], ownership_status: 'unowned', next_test_date: null, ...over,
});
const rows = withIds([
  row('IAC-06', { overall_status: 'failed', sub_type: 'Automated', owner_user_id: 7, owner_name: 'Amina Khan', ownership_status: 'ok', requirements: { soc2: [{ code: 'CC6.1' }], iso27001: [{ code: 'A.8.2' }] }, next_test_date: '2026-10-01T00:00:00' }),
  row('GOV-02', { category: 'Governance', overall_status: 'passed', sub_type: 'Hybrid', owner_user_id: 9, owner_name: 'Bilal Noor', ownership_status: 'overdue', requirements: { soc2: [{ code: 'CC1.1' }] } }),
  row('IAC-10', { overall_status: 'collection_failed', sub_type: 'Automated', requirements: { iso27001: [{ code: 'A.5.1' }] } }),
  row('BCD-04', { category: 'Continuity', overall_status: 'not_run', custom: true, sub_type: null }),
]);
const names = { soc2: 'SOC 2', iso27001: 'ISO 27001' };
const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });

const CASES: Filters[] = [
  NO_FILTERS,
  f({ status: ['failed'] }),
  f({ status: ['failed', 'passed'], domain: ['Identity'] }),
  f({ framework: ['soc2'] }),
  f({ framework: ['soc2', 'iso27001'], type: ['Automated'] }),
  f({ owner: ['_none'] }),
  f({ owner: ['late'] }),
  f({ owner: ['7', '9'] }),
  f({ origin: ['custom'] }),
  f({ quick: 'unowned' }),
  f({ quick: 'mine' }),
  f({ quick: 'overdue', framework: ['iso27001'] }),
  f({ search: 'a.8.2' }),
  f({ search: 'title of gov', status: ['passed'] }),
  f({ search: 'nothing matches this' }),
  f({ type: ['_none'] }),
  f({ framework: ['_none'] }),
];

test('the engine\'s matches are the plain filter\'s, for every combination', () => {
  const index = indexControls(rows);
  for (const c of CASES) {
    const got = evaluate(index, chosenOf(c), ruleOf(c, ctx)).matches.map((r) => r.control_id);
    const want = plainFilter(rows, c, ctx).map((r) => r.control_id);
    assert.deepEqual(got, want, JSON.stringify(c));
  }
});

test('a live count is what choosing the option would show', () => {
  const index = indexControls(rows);
  const base = f({ framework: ['soc2'] });
  const result = evaluate(index, chosenOf(base), ruleOf(base, ctx));
  for (const [facet, key] of [['status', 'status'], ['domain', 'domain'], ['type', 'type'], ['owner', 'owner'], ['origin', 'origin']] as const) {
    for (const [value, count] of Array.from(result.counts[facet].entries())) {
      const picked = f({ ...base, [key]: [value] });
      assert.equal(plainFilter(rows, picked, ctx).length, count, `${facet}=${value}`);
    }
  }
  // the framework facet's own choice does not empty its own list: iso27001 counts the controls that would show if it were chosen too
  assert.equal(countOf(result.counts, 'framework', 'iso27001'), plainFilter(rows, f({ framework: ['iso27001'] }), ctx).length);
});

test('the options are the values the controls have, named for the person', () => {
  const o = railOptions({ rows, frameworks: names });
  assert.deepEqual(o.framework.map((x) => x.label), ['ISO 27001', 'SOC 2', 'No framework']);
  assert.deepEqual(o.domain.map((x) => x.label), ['Continuity', 'Governance', 'Identity', 'No domain']);
  assert.deepEqual(o.type.map((x) => x.value), ['Automated', 'Hybrid', '_none'], 'only the types the controls have, in the order Automated, Hybrid, Manual');
  assert.deepEqual(o.owner.map((x) => x.label), ['Amina Khan', 'Bilal Noor', 'No owner', 'Owner’s date has passed']);
  assert.equal(o.status[0].label, 'Failing');
  assert.equal(o.status.length, 11);
  assert.deepEqual(o.origin.map((x) => x.label), ['SCF', 'Custom']);
});

test('an option nobody has is dropped, but a chosen one stays with a count of 0', () => {
  const opts = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
  const count = (v: string) => (v === 'a' ? 3 : 0);
  assert.deepEqual(orderedOptions(opts, [], count).map((o) => o.value), ['a']);
  assert.deepEqual(orderedOptions(opts, ['b'], count).map((o) => o.value), ['a', 'b']);
  assert.deepEqual(orderedOptions(opts, [], () => 0).map((o) => o.value), ['a', 'b'], 'with nothing to show it lists everything rather than an empty rail');
});

test('the chips say what is on, and take it off one at a time', () => {
  const o = railOptions({ rows, frameworks: names });
  const on = f({ search: 'mfa', quick: 'failing', status: ['failed'], framework: ['soc2'], owner: ['_none'] });
  assert.equal(filterCount(on), 5);
  const chips = filterChips(on, o);
  assert.deepEqual(chips.map((c) => c.label), ['Search: mfa', 'Failing', 'Status: Failing', 'Framework: SOC 2', 'Owner: No owner']);
  let cur = on;
  for (const c of chips) cur = removeChip(cur, c);
  assert.deepEqual(cur, NO_FILTERS);
  assert.equal(filterCount(f({ quick: 'all' })), 0, 'All is no filter');
});
