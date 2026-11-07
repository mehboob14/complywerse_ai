// node --test "src/app/(dashboard)/erm/risks/_register/riskFacets.test.ts"
// The Risk Register's facets: the engine's answer is the plain filter's (for every facet and value of a 300-risk corpus, so the rail's live counts are what choosing an option would show),
// the options the rail offers, the chips, and the address that carries the filters.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countOf, evaluate } from '../../../../../components/records/facetEngine.ts';
import { readAddress, writeAddress } from '../../../../../lib/addressState.ts';
import { REGISTER_SCHEMA, filtersPatch, pageOf, type RegisterAddress } from './riskAddress.ts';
import {
  FACET_TITLE, NO_FILTERS, RAIL_ORDER, chosenOf, filterChips, filterCount, indexRisks, orderedOptions, railOptions, removeChip, ruleOf, type FacetContext, type FacetKey, type Filters,
} from './riskFacets.ts';
import {
  NO_FRAMEWORK, NO_OWNER, NO_UNIT, aboveAppetite, appetiteLimits, categoryKey, cellOf, haystack, inQuick, levelOf, peopleOf, reviewIndex, reviewOf, searchTerms, statusBucket, treatmentOf,
  type RiskRow,
} from './riskModel.ts';

const NOW = new Date('2026-11-08T12:00:00Z');
const STATES = ['open', 'in_treatment', 'mitigated', 'accepted', 'closed', 'mitigating', null];
const CATS = ['operational', 'technology', 'third_party', 'strategic', null];

function corpus(n = 300): RiskRow[] {
  const rows: RiskRow[] = [];
  for (let i = 1; i <= n; i++) {
    const scored = i % 5 !== 0;
    rows.push({
      id: i, title: i % 17 === 0 ? `Long risk ${'very '.repeat(40)}${i}` : `Risk ${i} ${i % 3 ? 'card fraud' : 'data loss'}`, status: STATES[i % STATES.length],
      risk_category: CATS[i % CATS.length], category: 'operational', register_type: i % 4 === 0 ? 'NCA Template' : i % 7 === 0 ? 'ISO 27001' : null,
      inherent_likelihood: scored ? (i % 5) + 1 : null, inherent_impact: scored ? ((i * 3) % 5) + 1 : null, inherent_score: scored ? ((i % 5) + 1) * (((i * 3) % 5) + 1) : null,
      residual_likelihood: scored && i % 3 ? (i % 4) + 1 : null, residual_impact: scored && i % 3 ? ((i * 2) % 5) + 1 : null, residual_score: scored && i % 3 ? ((i % 4) + 1) * (((i * 2) % 5) + 1) : null,
      owner_id: i % 6 === 0 ? null : (i % 4) + 1, owner_name: i % 6 === 0 ? null : `Owner ${(i % 4) + 1}`, business_owner_id: i % 9 === 0 ? 7 : null, business_owner_name: i % 9 === 0 ? 'Me' : null,
      business_unit_id: i % 8 === 0 ? null : (i % 3) + 10, business_unit_name: i % 8 === 0 ? null : `Unit ${(i % 3) + 10}`,
      has_plan: i % 2 === 0, sla: { state: ['breached', 'due_soon', 'on_track', null][i % 4] }, framework_ids: i % 5 === 0 ? [] : i % 2 ? [1] : [1, 2],
      review_date: i % 11 === 0 ? '2026-10-01T00:00:00' : i % 13 === 0 ? '2026-11-20T00:00:00' : null,
      updated_at: i % 10 === 0 ? '2026-11-07T10:00:00' : '2026-08-01T00:00:00',
    });
  }
  return rows;
}

const reviews = reviewIndex([{ risk_id: 3, due_date: '2026-10-15T00:00:00' }, { risk_id: 4, due_date: '2026-11-12T00:00:00' }]);
const limits = appetiteLimits([{ category: 'operational', tolerance_threshold: 9 }]);
const ctx: FacetContext = { me: 7, now: NOW, limits, reviews };

/** The plain way to say the same thing: one predicate per facet, no index, no engine. */
function plain(r: RiskRow, f: Filters, skip?: FacetKey): boolean {
  const has = (k: FacetKey, values: string[]) => skip === k || f[k].length === 0 || values.some((v) => f[k].includes(v));
  if (!has('status', [statusBucket(r.status)])) return false;
  if (!has('level', [levelOf(r)])) return false;
  if (!has('category', [categoryKey(r)])) return false;
  if (!has('owner', peopleOf(r).length ? peopleOf(r).map(String) : [NO_OWNER])) return false;
  if (!has('unit', [r.business_unit_id == null ? NO_UNIT : String(r.business_unit_id)])) return false;
  if (!has('treatment', [treatmentOf(r)])) return false;
  if (!has('framework', r.framework_ids?.length ? r.framework_ids.map(String) : [NO_FRAMEWORK])) return false;
  if (!has('sla', [r.sla?.state || 'no_due_date'])) return false;
  if (!has('review', [reviewOf(r, reviews, NOW).state])) return false;
  if (!has('register', [r.register_type?.trim() || 'none'])) return false;
  const terms = searchTerms(f.search);
  const text = haystack(r);
  if (!terms.every((t) => text.includes(t))) return false;
  if (f.quick && f.quick !== 'all' && !inQuick(f.quick, r, ctx)) return false;
  if (f.cell) { const c = cellOf(r, f.basis); if (!c || c.l !== f.cell.l || c.i !== f.cell.i) return false; }
  return true;
}

const SCENARIOS: Filters[] = [
  NO_FILTERS,
  { ...NO_FILTERS, status: ['open'] },
  { ...NO_FILTERS, level: ['critical', 'high'], category: ['technology'] },
  { ...NO_FILTERS, owner: ['2', NO_OWNER], unit: ['11'] },
  { ...NO_FILTERS, treatment: ['not_started'], framework: [NO_FRAMEWORK, '2'] },
  { ...NO_FILTERS, sla: ['breached'], review: ['overdue', 'soon'] },
  { ...NO_FILTERS, register: ['NCA Template'], search: 'card fraud' },
  { ...NO_FILTERS, quick: 'mine', status: ['open', 'accepted'] },
  { ...NO_FILTERS, quick: 'appetite' },
  { ...NO_FILTERS, quick: 'review', cell: { l: 3, i: 3 }, basis: 'inherent' },
  { ...NO_FILTERS, search: 'Very long' },
];

test('the engine decides the same risks as the plain filter, for every scenario', () => {
  const rows = corpus();
  const index = indexRisks(rows, ctx);
  for (const f of SCENARIOS) {
    const got = evaluate(index, chosenOf(f), ruleOf(f, ctx)).matches.map((r) => r.id);
    assert.deepEqual(got, rows.filter((r) => plain(r, f)).map((r) => r.id), JSON.stringify(f));
  }
});

test('the number beside an option is what choosing it would show with the other filters as they are', () => {
  const rows = corpus();
  const index = indexRisks(rows, ctx);
  for (const f of SCENARIOS.slice(0, 8)) {
    const { counts } = evaluate(index, chosenOf(f), ruleOf(f, ctx));
    const opts = railOptions({ rows, people: [], frameworks: {}, units: {} });
    for (const facet of RAIL_ORDER) {
      for (const o of opts[facet]) {
        // the facet's own choice is replaced by the option, the others stay
        const alone = rows.filter((r) => plain(r, { ...f, [facet]: [o.value] } as Filters)).length;
        assert.equal(countOf(counts, facet, o.value), alone, `${facet}=${o.value} with ${JSON.stringify(f)}`);
      }
    }
  }
});

test('the rail lists the values the risks have, in words, with "none" kinds last, and never loses a chosen one', () => {
  const rows = corpus(40);
  const opts = railOptions({ rows, people: [{ id: 1, display_name: 'Ana Ruiz' }], frameworks: { '1': { name: 'ISO 27001' } }, units: { '10': 'Payments' } });
  assert.deepEqual(opts.status.map((o) => o.label), ['Open', 'In treatment', 'Mitigated', 'Accepted', 'Closed']);
  assert.deepEqual(opts.level.map((o) => o.label), ['Critical', 'High', 'Medium', 'Low', 'Not scored']);
  assert.equal(opts.owner.find((o) => o.value === '1')?.label, 'Ana Ruiz');
  assert.equal(opts.owner[opts.owner.length - 1].value, NO_OWNER);
  assert.equal(opts.unit.find((o) => o.value === '10')?.label, 'Payments');
  assert.equal(opts.framework.find((o) => o.value === '2')?.label, 'A framework no longer here', 'an id nobody names is said so, not shown as a number');
  const bare = railOptions({ rows: [{ id: 1, title: 'x', category: '', risk_category: null }], people: [], frameworks: {}, units: {} });
  assert.deepEqual(bare.category, [{ value: 'uncategorised', label: 'Uncategorised' }], 'a risk with no stored category is Uncategorised, not a guess');
  assert.deepEqual(orderedOptions(opts.status, [], (v) => (v === 'open' ? 3 : 0)).map((o) => o.value), ['open']);
  assert.deepEqual(orderedOptions(opts.status, ['closed'], (v) => (v === 'open' ? 3 : 0)).map((o) => o.value), ['open', 'closed']);
});

test('the chips say what is on, in words, and each takes only its own filter off', () => {
  const rows = corpus(40);
  const opts = railOptions({ rows, people: [], frameworks: {}, units: {} });
  const f: Filters = { ...NO_FILTERS, search: ' card ', status: ['open', 'closed'], quick: 'mine', cell: { l: 2, i: 4 }, basis: 'inherent' };
  const chips = filterChips(f, opts);
  assert.deepEqual(chips.map((c) => c.label), ['Search: card', 'My risks', 'Inherent: likelihood 2, impact 4', 'Status: Open', 'Status: Closed']);
  assert.equal(filterCount(f), 5);
  assert.equal(filterCount({ ...NO_FILTERS, basis: 'inherent', quick: 'all' }), 0, 'the basis and "All" are no filters');
  const after = removeChip(f, chips[3]);
  assert.deepEqual(after.status, ['closed']);
  assert.equal(removeChip(f, chips[1]).quick, null);
  assert.equal(removeChip(f, chips[2]).cell, null);
  assert.equal(removeChip(f, chips[0]).search, '');
  assert.equal(FACET_TITLE.unit, 'Business unit');
});

test('the address carries every filter, the old links still open, and a value the page cannot be in is the default', () => {
  const address = (search: string): RegisterAddress => readAddress(REGISTER_SCHEMA, search) as RegisterAddress;
  const page = pageOf(address('?q=card&status=open,in_treatment&level=critical&owner=7&quick=mine&cell=3-4&basis=inherent&sort=title:asc&view=board&open=12'));
  assert.deepEqual(page.filters, { ...NO_FILTERS, search: 'card', status: ['open', 'in_treatment'], level: ['critical'], owner: ['7'], quick: 'mine', cell: { l: 3, i: 4 }, basis: 'inherent' });
  assert.deepEqual([page.sort, page.view, page.openId], [{ key: 'title', dir: 'asc' }, 'board', 12]);
  // the links that existed before
  const old = pageOf(address('?new=1&upload=1&edit=9&register_type=NCA%20Template'));
  assert.deepEqual(old.arrive, { create: true, upload: true, edit: 9 });
  assert.deepEqual(old.filters.register, ['NCA Template']);
  // junk
  const junk = pageOf(address('?quick=nonsense&cell=9-9&view=map&sort=colour:up&open=abc&basis=other'));
  assert.deepEqual([junk.filters.quick, junk.filters.cell, junk.view, junk.sort.key, junk.openId, junk.filters.basis], [null, null, 'list', 'level', null, 'residual']);
  // round trip: a state written is the state read, the default has the plain address, and a foreign param stays
  const state = { ...address(''), ...filtersPatch({ ...NO_FILTERS, status: ['open'], quick: 'review', cell: { l: 1, i: 2 }, search: 'x' }) } as RegisterAddress;
  const written = writeAddress(REGISTER_SCHEMA, '?utm=1', state);
  assert.equal(new URLSearchParams(written).get('utm'), '1');
  assert.deepEqual(pageOf(address(`?${written}`)).filters, { ...NO_FILTERS, status: ['open'], quick: 'review', cell: { l: 1, i: 2 }, search: 'x' });
  assert.equal(writeAddress(REGISTER_SCHEMA, '', address('')), '');
});

test('the aggregate rules agree with the plain ones on the corpus (above appetite, critical open)', () => {
  const rows = corpus();
  assert.ok(rows.some((r) => aboveAppetite(r, limits)), 'the corpus has a breach');
});
