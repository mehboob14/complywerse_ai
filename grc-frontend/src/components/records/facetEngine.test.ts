// node --test "src/components/records/facetEngine.test.ts"
// The live counts of the facet explorer, held against a brute-force oracle: for every facet and every value, the count is the number of records that pass the rule and
// every OTHER facet and have the value; the matches are the records that pass everything; a facet's own choice never changes its own counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countMatching, countOf, evaluate, indexRows, type Chosen, type FacetSpec, type Rule } from './facetEngine.ts';

interface Row { id: number; status: string; tags: string[]; owner: number | null; archived: boolean; text: string }

const rng = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const STATUSES = ['draft', 'review', 'approved', 'published', 'archived'];
const TAGS = ['a', 'b', 'c', 'd', 'e'];
function rows(n: number, seed = 1): Row[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, id) => {
    const status = STATUSES[Math.floor(r() * STATUSES.length)];
    return {
      id, status, archived: status === 'archived', owner: r() < 0.2 ? null : Math.floor(r() * 6),
      tags: TAGS.filter(() => r() < 0.3), text: ['alpha beta', 'beta gamma', 'gamma delta', 'delta'][Math.floor(r() * 4)],
    };
  });
}
const SPECS: FacetSpec<Row>[] = [
  { key: 'status', values: (d) => [d.status], passesUnchosen: (d) => !d.archived },
  { key: 'tags', values: (d) => (d.tags.length ? d.tags : ['none']) },
  { key: 'owner', values: (d) => [d.owner == null ? 'none' : String(d.owner)] },
];

// the oracle: the definition, written the slow way
function passes(d: Row, chosen: Chosen, skip: string | null, rule: Rule<Row>, i: number, text: string): boolean {
  for (const t of rule.terms ?? []) if (!text.includes(t)) return false;
  if (rule.extra && !rule.extra(d, i)) return false;
  for (const s of SPECS) {
    if (s.key === skip) continue;
    const c = chosen[s.key];
    if (c && c.length) { if (!s.values(d).some((v) => c.includes(v))) return false; } else if (s.passesUnchosen && !s.passesUnchosen(d)) return false;
  }
  return true;
}

function oracle(data: Row[], chosen: Chosen, rule: Rule<Row>) {
  const matches = data.filter((d, i) => passes(d, chosen, null, rule, i, d.text));
  const counts: Record<string, Map<string, number>> = {};
  for (const s of SPECS) {
    counts[s.key] = new Map();
    data.forEach((d, i) => {
      if (!passes(d, chosen, s.key, rule, i, d.text)) return;
      for (const v of s.values(d)) counts[s.key].set(v, (counts[s.key].get(v) ?? 0) + 1);
    });
  }
  return { matches, counts };
}

const CHOICES: Chosen[] = [
  {}, { status: ['draft'] }, { status: ['archived'] }, { status: ['draft', 'review'], tags: ['a'] }, { tags: ['none'] }, { tags: ['a', 'b'], owner: ['none', '2'] },
  { owner: ['3'], status: ['published'], tags: ['c'] }, { status: ['nonsense'] }, { owner: ['99'] },
];
const RULES: Rule<Row>[] = [{}, { terms: ['beta'] }, { terms: ['gamma', 'delta'] }, { extra: (d) => d.id % 2 === 0 }, { terms: ['alpha'], extra: (d) => d.owner != null }];

test('matches and counts equal the brute-force definition for every choice and rule', () => {
  const data = rows(400);
  const index = indexRows(data, SPECS, (d) => d.text);
  for (const chosen of CHOICES) for (const rule of RULES) {
    const got = evaluate(index, chosen, rule);
    const want = oracle(data, chosen, rule);
    assert.deepEqual(got.matches.map((d) => d.id), want.matches.map((d) => d.id), JSON.stringify(chosen));
    for (const s of SPECS) assert.deepEqual(Array.from(got.counts[s.key]).sort(), Array.from(want.counts[s.key]).sort(), `${s.key} ${JSON.stringify(chosen)}`);
    assert.equal(countMatching(index, chosen, rule), want.matches.length);
  }
});

test('the count of an option is what choosing it would show, with the other facets as they are', () => {
  const data = rows(300, 7);
  const index = indexRows(data, SPECS, (d) => d.text);
  const base: Chosen = { tags: ['a'], owner: ['1', '2'] };
  const { counts } = evaluate(index, base);
  for (const v of STATUSES) {
    const would = evaluate(index, { ...base, status: [v] }).matches.length;
    assert.equal(countOf(counts, 'status', v), would, v);                           // choosing the status alone replaces the status choice
  }
  for (const v of TAGS.concat('none')) assert.equal(countOf(counts, 'tags', v), evaluate(index, { ...base, tags: [v] }).matches.length, v);
});

test('a facet\'s own choice does not change its own counts, and a zero is a zero', () => {
  const data = rows(200, 3);
  const index = indexRows(data, SPECS, (d) => d.text);
  const all = evaluate(index, {});
  const chosenTag = evaluate(index, { tags: ['a'] });
  assert.deepEqual(Array.from(chosenTag.counts.tags).sort(), Array.from(all.counts.tags).sort());
  assert.equal(countOf(chosenTag.counts, 'status', 'nobody-has-this'), 0);
});

test('the unchosen rule of a facet keeps archived records out of every other count but its own', () => {
  const data = rows(300, 11);
  const index = indexRows(data, SPECS, (d) => d.text);
  const e = evaluate(index, {});
  assert.ok(e.matches.every((d) => !d.archived));
  assert.equal(countOf(e.counts, 'status', 'archived'), data.filter((d) => d.archived).length);       // the status facet still says how many are archived
  assert.equal(Array.from(e.counts.owner.values()).reduce((a, b) => a + b, 0), data.filter((d) => !d.archived).length);
  const archived = evaluate(index, { status: ['archived'] });
  assert.ok(archived.matches.every((d) => d.archived));
});

test('10,000 records are indexed and evaluated within a loose bound (reported as a diagnostic)', (ctx) => {
  const data = rows(10_000, 5);
  let t = performance.now();
  const index = indexRows(data, SPECS, (d) => d.text);
  const built = performance.now() - t;
  t = performance.now();
  for (let k = 0; k < 20; k++) evaluate(index, { status: ['draft'], tags: ['a'] }, { terms: ['beta'] });
  const each = (performance.now() - t) / 20;
  ctx.diagnostic(`10,000 records: index ${built.toFixed(1)} ms, evaluate ${each.toFixed(2)} ms each`);
  assert.ok(built < 1500 && each < 150, `${built} ${each}`);
});
