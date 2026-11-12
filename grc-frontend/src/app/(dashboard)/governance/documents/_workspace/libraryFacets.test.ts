// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryFacets.test.ts"
// The facet engine decides the same documents as the rule it replaces in the page (libraryModel.matchesFilters), and its live counts are what choosing an option would show.
// Held together over a 150-document corpus with a three-level department tree (a dangling department, a loop, an inactive one), every status, framework lists that override
// each other, unclassified and mixed-case classifications, review dates around the instant, expiry, attestation, the server's lists (attention, waiting) and the search.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countMatching, countOf, evaluate } from '../../../../../components/records/facetEngine.ts';
import { departmentScopes } from './library.ts';
import { RAIL_ORDER, chosenOf, departmentsAbove, indexDocuments, orderedOptions, railOptions, ruleOf, type FacetContext } from './libraryFacets.ts';
import { NO_FILTERS, NO_OWNER, fold, matchesFilters, type Filters, type LibDoc, type MatchContext } from './libraryModel.ts';

const NOW = new Date('2026-11-06T09:00:00Z');
const DAY = 86_400_000;
const naive = (ms: number) => new Date(ms).toISOString().slice(0, 19);

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r = rng(2026);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const STATUSES = ['draft', 'pending_review', 'pending_approval', 'approved', 'published', 'published', 'expired', 'archived', 'exception_applied', 'review_required'];
const DEPARTMENTS = [
  { id: 1, name: 'Information Security', parent_department_id: null, is_active: true },
  { id: 2, name: 'Cyber Defence', parent_department_id: 1, is_active: true },
  { id: 3, name: 'Identity and Access', parent_department_id: 2, is_active: true },
  { id: 4, name: 'Risk', parent_department_id: null, is_active: true },
  { id: 5, name: 'Closed Unit', parent_department_id: 4, is_active: false },
  { id: 6, name: 'Loop A', parent_department_id: 7, is_active: true },       // a loop: both count as top departments
  { id: 7, name: 'Loop B', parent_department_id: 6, is_active: true },
  { id: 8, name: 'Orphan', parent_department_id: 99, is_active: true },       // a missing parent
];
const PEOPLE = [{ id: 1, display_name: 'Ayesha Admin', email: 'a@x.test' }, { id: 2, display_name: 'Olivia Owner', email: 'o@x.test' }, { id: 3, display_name: 'Edward Editor', email: 'e@x.test' }];

function corpus(): LibDoc[] {
  return Array.from({ length: 150 }, (_, k): LibDoc => {
    const id = k + 1;
    const status = pick(STATUSES);
    const frameworks = r() < 0.3 ? [] : Array.from({ length: Math.floor(r() * 5) }, () => 1 + Math.floor(r() * 9));
    return {
      id, title: `${pick(['Access', 'Zürich', 'Data', 'Backup', 'مرحبا', 'Vendor'])} ${pick(['Policy', 'Standard', 'Procedure'])} ${id}`, document_code: r() < 0.2 ? null : `LIB-${id}`,
      description: r() < 0.5 ? 'Applies to every branch' : null, doc_type: pick(['policy', 'policy', 'standard', 'procedure', 'guideline', 'risk_policy']), status,
      classification: pick(['internal', 'Confidential', ' restricted ', '', null, 'public']),
      owner_id: r() < 0.15 ? null : pick([1, 2, 3, 9]), owner_name: null, author_id: pick([1, 2, 3]), author_name: null,
      department_id: r() < 0.15 ? null : pick([1, 2, 3, 4, 5, 6, 7, 8, 42]), framework_ids: frameworks, applicable_framework_ids: r() < 0.2 ? [3, 4] : [],
      tags: r() < 0.3 ? ['privacy'] : [], next_review_date: r() < 0.2 ? null : naive(NOW.getTime() + Math.round((r() * 400 - 120) * DAY)),
      expiry_date: r() < 0.3 ? naive(NOW.getTime() + Math.round((r() * 90 - 10) * DAY)) : null,
      version_in_force: ['draft', 'pending_review', 'review_required'].includes(status) && r() < 0.5 ? '1.0' : null, current_version: '1.0',
      created_at: naive(NOW.getTime() - 100 * DAY), updated_at: naive(NOW.getTime() - id * DAY), file_name: null,
    };
  }).map((d) => ({ ...d, owner_name: d.owner_id ? `Owner ${d.owner_id}` : null }));
}

const docs = corpus();
const coverage: Record<number, number> = {};
docs.forEach((d, i) => { if (i % 3 === 0) coverage[d.id] = pick([0, 12, 50, 99, 100]); });
const attention = new Set(docs.filter((d) => d.id % 7 === 0).map((d) => d.id));
const waiting = new Set(docs.filter((d) => d.id % 5 === 0).map((d) => d.id));
const lookups: MatchContext = {
  departments: Object.fromEntries(DEPARTMENTS.map((d) => [String(d.id), d.name])), departmentScope: departmentScopes(DEPARTMENTS),
  frameworks: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), { short: `FW${i + 1}`, name: `Framework number ${i + 1}` }])),
  coverage, me: 2, now: NOW, attention, waiting,
};
const ctx: FacetContext = { now: NOW, coverage, above: departmentsAbove(DEPARTMENTS) };
const index = indexDocuments(docs, ctx, lookups);

const f = (patch: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...patch });
const reference = (flt: Filters) => docs.filter((d) => matchesFilters(d, flt, lookups)).map((d) => d.id);
const engine = (flt: Filters) => evaluate(index, chosenOf(flt), ruleOf(flt, lookups)).matches.map((d) => d.id);

const CASES: Filters[] = [
  f({}), f({ statuses: ['draft'] }), f({ statuses: ['archived'] }), f({ statuses: ['draft', 'published'] }), f({ statuses: ['exception_applied'] }),
  f({ types: ['policy'] }), f({ types: ['policy', 'risk_policy'] }), f({ types: ['nonsense'] }),
  f({ owners: ['2'] }), f({ owners: [NO_OWNER] }), f({ owners: ['2', NO_OWNER, '9'] }), f({ owners: ['404'] }),
  f({ departments: ['1'] }), f({ departments: ['2'] }), f({ departments: ['3'] }), f({ departments: ['4'] }), f({ departments: ['none'] }), f({ departments: ['42'] }), f({ departments: ['6'] }), f({ departments: ['8'] }), f({ departments: ['1', '4'] }), f({ departments: ['77'] }),
  f({ frameworks: ['3'] }), f({ frameworks: ['1', '2'] }), f({ frameworks: ['none'] }), f({ frameworks: ['abc'] }), f({ frameworks: ['9', 'none'] }),
  f({ classifications: ['internal'] }), f({ classifications: ['confidential', 'restricted'] }), f({ classifications: [''] }),
  f({ review: ['overdue'] }), f({ review: ['due_soon'] }), f({ review: ['ok'] }), f({ review: ['unscheduled'] }), f({ review: ['overdue', 'ok'] }),
  f({ attestation: ['complete'] }), f({ attestation: ['in_progress'] }), f({ attestation: ['not_started'] }), f({ attestation: ['none'] }), f({ attestation: ['complete', 'none'] }),
  f({ mine: true }), f({ expiring: true }), f({ attention: 'stuck' }), f({ waiting: true }),
  f({ search: 'policy' }), f({ search: 'zurich' }), f({ search: 'information security' }), f({ search: 'framework number 3' }), f({ search: 'privacy' }), f({ search: 'zzzz' }), f({ search: 'in review' }), f({ search: 'owner 2' }),
  f({ statuses: ['published'], review: ['overdue'], departments: ['1'] }), f({ types: ['policy'], frameworks: ['3'], owners: ['2'], search: 'access' }),
  f({ statuses: ['draft', 'pending_review'], mine: true, review: ['unscheduled'] }), f({ departments: ['2'], waiting: true, attestation: ['none'] }),
  f({ statuses: ['archived'], types: ['policy'], search: 'data' }), f({ expiring: true, statuses: ['published'], classifications: ['internal'] }),
];

test('the engine decides the same documents as matchesFilters, for every kind of filter and for combinations', () => {
  assert.ok(reference(f({})).length > 50 && reference(f({ statuses: ['archived'] })).length > 3);                  // the corpus has something in it
  for (const flt of CASES) assert.deepEqual(engine(flt), reference(flt), JSON.stringify(flt));
});

test('countMatching is the length of the same answer', () => {
  for (const flt of CASES) assert.equal(countMatching(index, chosenOf(flt), ruleOf(flt, lookups)), reference(flt).length, JSON.stringify(flt));
});

test('the number beside every option is what choosing it would show with the other filters as they are', () => {
  const options = railOptions({ docs, people: PEOPLE, departments: DEPARTMENTS, frameworks: lookups.frameworks });
  const bases: Filters[] = [f({}), f({ search: 'policy' }), f({ statuses: ['published'], departments: ['1'] }), f({ owners: ['2'], frameworks: ['3', '4'], review: ['overdue', 'ok'] }), f({ mine: true, types: ['policy'] }), f({ statuses: ['archived'] })];
  for (const base of bases) {
    const { counts } = evaluate(index, chosenOf(base), ruleOf(base, lookups));
    for (const facet of RAIL_ORDER) {
      for (const o of options[facet]) {
        const would = reference({ ...base, [facet]: [o.value] }).length;
        assert.equal(countOf(counts, facet, o.value), would, `${facet}=${o.value} under ${JSON.stringify(base)}`);
      }
    }
  }
});

test('the department of a document counts for it and for every department above it; a loop, a missing parent and a dangling id stay what matchesDepartment says', () => {
  const above = departmentsAbove(DEPARTMENTS);
  assert.deepEqual(above['3'], ['1', '2', '3']);
  assert.deepEqual(above['6'].concat(above['7']).sort(), ['6', '7']);                  // each is its own top department
  assert.deepEqual(above['8'], ['8']);
  const scope = departmentScopes(DEPARTMENTS);
  for (const d of DEPARTMENTS) for (const e of DEPARTMENTS) assert.equal(above[String(e.id)].includes(String(d.id)), scope[String(d.id)].includes(e.id), `${d.id} ${e.id}`);
});

test('the rail lists the options the page always offered, the department tree indented with its own names, and the statuses documents are really in', () => {
  const o = railOptions({ docs, people: PEOPLE, departments: DEPARTMENTS, levelNames: undefined, frameworks: lookups.frameworks });
  assert.deepEqual(o.statuses.map((s) => s.value).slice(0, 7), ['draft', 'pending_review', 'pending_approval', 'approved', 'published', 'expired', 'exception_applied']);
  assert.equal(o.statuses[o.statuses.length - 1].value, 'archived');
  assert.ok(o.statuses.some((s) => s.value === 'review_required'));                    // a status in use that the page never listed is listed
  assert.deepEqual(o.review.map((s) => s.value), ['overdue', 'due_soon', 'ok', 'unscheduled']);
  assert.equal(o.departments[0].value, 'none');
  const unit = o.departments.find((d) => d.value === '3');
  assert.deepEqual([unit?.label, unit?.indent, unit?.title], ['Identity and Access', 2, 'Information Security › Cyber Defence › Identity and Access']);
  assert.ok(o.types.some((t) => t.value === 'risk_policy'));
  assert.ok(o.owners.some((p) => p.value === '9'));                                    // an owner the people list does not hold is still a value the rows have
  assert.equal(o.frameworks[0].value, 'none');
});

test('long option lists put the person\'s choices first, then "none" (No owner, the gap), then the most documents', () => {
  const list = [{ value: 'none', label: 'No owner' }, { value: '1', label: 'Ann' }, { value: '2', label: 'Bob' }, { value: '3', label: 'Cy' }];
  const count = (v: string) => ({ none: 99, '1': 1, '2': 7, '3': 7 }[v] ?? 0);
  assert.deepEqual(orderedOptions('owners', list, [], count).map((x) => x.value), ['none', '2', '3', '1']);
  assert.deepEqual(orderedOptions('owners', list, ['1'], count).map((x) => x.value), ['1', 'none', '2', '3']);
  assert.deepEqual(orderedOptions('statuses', list, [], count).map((x) => x.value), ['none', '1', '2', '3']);          // the short lists keep their own order
  assert.equal(fold('Zürich'), 'zurich');
});
