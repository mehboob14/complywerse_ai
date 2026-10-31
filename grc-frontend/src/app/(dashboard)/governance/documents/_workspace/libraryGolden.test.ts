// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryGolden.test.ts"
// The D40 rules as they stood BEFORE the optional `?expiry=30d` filter was added (UX revamp, Gate 4 group B). A fixed corpus of 150 documents is run through
// every filter, the search, all ten sorts, the tree, the summary numbers, the address and the CSV; what comes out is recorded in libraryGolden.json (a count, the
// first ids and a hash of the whole answer for each case). The golden was written by the unmodified rules, so this test proves that the filter, when it is off,
// changes nothing: every result is byte-identical. It is not a second implementation to keep in step: if a D40 rule is changed on purpose, regenerate the file
// with `UPDATE_GOLDEN=1 node --test <this file>` and read the diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { unlessArchivedAsked } from './archive.ts';
import { buildTree, treeEntries } from './docTree.ts';
import {
  BUILT_IN_VIEWS, NO_FILTERS, NO_OWNER, SORT_KEYS, compareDocs, exportColumnsFor, fromParams, kpis, matchesFilters, toCsv, toParams, viewMatching, withLibraryParams,
  type Filters, type LibDoc, type Lookups, type MatchContext, type Sort,
} from './libraryModel.ts';

const NOW = new Date('2026-10-31T09:00:00Z');
const GOLDEN = new URL('./libraryGolden.json', import.meta.url);
const DAY = 86_400_000;

// mulberry32: the same corpus on every machine
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(31);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const naive = (ms: number) => new Date(ms).toISOString().slice(0, 19);       // the server writes naive UTC

const STATUSES = ['draft', 'pending_review', 'pending_approval', 'approved', 'published', 'expired', 'archived', 'exception_applied', 'review_required'];
const TYPES = ['policy', 'policy', 'standard', 'procedure', 'guideline', 'charter', 'framework', 'risk_policy'];
const WORDS = ['Access', 'Control', 'Zürich', 'Müller', 'Çelik', 'Data', 'Retention', 'Backup', 'Incident', 'Vendor', 'Cloud', 'Mobile', 'Password', 'Privacy', 'Network',
  'Change', 'Physical', 'Remote', 'Crypto', 'Review', 'Framework', 'مرحبا', 'سياسة', '10', '9', '[Draft]', 'ﬁnance', 'Business', 'Continuity'];
const CLASSES = ['internal', 'Confidential', ' restricted ', '', null, 'public'];
const TAGS = ['privacy', 'hr', 'bcp', 'payments', 'cloud', 'vendor'];
const PEOPLE: [number, string][] = [[1, 'Ayesha Admin'], [2, 'Olivia Owner'], [3, 'Edward Editor'], [4, 'Paula Publisher'], [5, 'Sara Reviewer'], [6, 'Zoë Müller']];
const VERSIONS = ['1.0', '1.1', '2.0', '2.10', '2.9', 'v3.1', '', null, '4'];

type Doc = LibDoc & { parent_document_id: number | null };
function corpus(): Doc[] {
  const docs: Record<string, unknown>[] = [];
  for (let i = 1; i <= 150; i++) {
    const status = i % 17 === 0 ? 'exception_applied' : pick(STATUSES);
    const owner = rand() < 0.15 ? null : pick(PEOPLE);
    const author = pick(PEOPLE);
    const frameworks = rand() < 0.3 ? [] : Array.from({ length: Math.floor(rand() * 6) }, () => 1 + Math.floor(rand() * 12));
    const published = status === 'published' ? pick(['1.0', '2.0', '3.1']) : null;
    const version = pick(VERSIONS);
    const onItsWay = ['draft', 'pending_review', 'pending_approval', 'approved', 'review_required'].includes(status);
    const review = rand() < 0.2 ? null : naive(NOW.getTime() + Math.round((rand() * 500 - 100) * DAY));
    docs.push({
      id: i,
      title: `${pick(WORDS)} ${pick(WORDS)} ${pick(['Policy', 'Standard', 'Procedure', 'Guideline'])}${i % 11 === 0 ? ' ' + 'W'.repeat(60) : ''}`,
      document_code: rand() < 0.1 ? null : `LIB-${String(i).padStart(3, '0')}`,
      description: rand() < 0.3 ? null : `${pick(WORDS)} ${pick(WORDS)} description for ${pick(WORDS)}`,
      doc_type: pick(TYPES),
      status,
      classification: pick(CLASSES),
      owner_id: owner ? owner[0] : null,
      owner_name: owner ? owner[1] : null,
      author_id: author[0],
      author_name: author[1],
      department_id: rand() < 0.2 ? null : pick([10, 11, 12, 99]),
      framework_ids: frameworks,
      applicable_framework_ids: rand() < 0.4 ? frameworks.slice(0, 2) : [],
      tags: rand() < 0.5 ? [] : [pick(TAGS), pick(TAGS)],
      next_review_date: review,
      expiry_date: rand() < 0.5 ? null : naive(NOW.getTime() + Math.round((rand() * 80 - 20) * DAY)),       // present on the rows; only the new filter reads it
      version_in_force: status === 'published' ? published : onItsWay && rand() < 0.4 ? pick(['1.0', '2.0']) : null,
      current_version: version,
      created_at: naive(NOW.getTime() - Math.round(rand() * 400 * DAY)),
      updated_at: rand() < 0.05 ? null : naive(NOW.getTime() - Math.round(rand() * 300 * DAY)),
      file_name: rand() < 0.5 ? null : `${pick(WORDS)}.pdf`,
      parent_document_id: i > 20 && rand() < 0.25 ? 1 + Math.floor(rand() * (i - 1)) : null,
    });
  }
  return docs as unknown as Doc[];
}

const lookups: Lookups = {
  departments: { 10: 'Operations', 11: 'Finance › Treasury', 12: 'Legal' },
  frameworks: { 1: { short: 'ISO', name: 'ISO 27001' }, 2: { short: 'NCA', name: 'NCA ECC' }, 3: { short: '', name: 'PDPL' }, 5: { short: 'SOC', name: 'SOC 2' } },
  coverage: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [i + 1, [0, 37, 100, 64][i % 4]]).filter((_, i) => i % 3 !== 0)) as Record<number, number>,
  me: 2,
};
const ctx: MatchContext = { ...lookups, now: NOW };
const docs = corpus();

const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });
const CASES: [string, Filters, Sort][] = [];
const byDefault: Sort = { key: 'updated', dir: 'desc' };
const add = (name: string, over: Partial<Filters>, sort: Sort = byDefault) => CASES.push([name, f(over), sort]);
add('none', {});
for (const s of STATUSES) add(`status ${s}`, { statuses: [s] });
add('status mix', { statuses: ['draft', 'published'] });
add('status archived', { statuses: ['archived'] });
add('status archived+draft in the address reads archived alone', { statuses: ['archived', 'draft'] });
add('type policy', { types: ['policy'] });
add('type policy+standard', { types: ['policy', 'standard'] });
add('type unknown', { types: ['risk_policy'] });
add('owner 2', { owners: ['2'] });
add('owner none', { owners: [NO_OWNER] });
add('owner 2+none', { owners: ['2', NO_OWNER] });
add('dept 10', { departments: ['10'] });
add('dept none', { departments: ['none'] });
add('dept dangling', { departments: ['99'] });
add('fw 1', { frameworks: ['1'] });
add('fw 1+2', { frameworks: ['1', '2'] });
add('fw none', { frameworks: ['none'] });
add('fw nonsense', { frameworks: ['abc'] });
add('class internal', { classifications: ['internal'] });
add('class confidential+restricted', { classifications: ['confidential', ' restricted '] });
for (const b of ['overdue', 'due_soon', 'ok', 'unscheduled'] as const) add(`review ${b}`, { review: [b] });
add('review two', { review: ['overdue', 'due_soon'] });
for (const b of ['complete', 'in_progress', 'not_started', 'none'] as const) add(`att ${b}`, { attestation: [b] });
add('att two', { attestation: ['complete', 'in_progress'] });
add('mine', { mine: true });
for (const q of ['policy', 'zurich', 'muller', 'celik', 'data policy', 'framework', 'review', 'مرحبا', 'LIB-0', 'iso 27001', 'operations', 'finance treasury', 'privacy', 'pdf', '  ', 'W'.repeat(60), 'draft', 'exception'])
  add(`search ${q.trim().slice(0, 12) || 'blank'}`, { search: q });
add('status+review', { statuses: ['published'], review: ['overdue'] });
add('type+search', { types: ['policy'], search: 'data' });
add('owner+dept', { owners: ['2', '3'], departments: ['10'] });
add('review+att+mine', { review: ['ok', 'overdue'], attestation: ['none'], mine: true });
add('everything', { search: 'policy', types: ['policy', 'standard'], statuses: ['published', 'approved'], owners: ['2', NO_OWNER], departments: ['10', 'none'], frameworks: ['1', 'none'], classifications: ['internal'], review: ['ok'], attestation: ['none'], mine: false });
for (const key of SORT_KEYS) for (const dir of ['asc', 'desc'] as const) add(`sort ${key}:${dir}`, {}, { key, dir });
add('sort title with a search', { search: 'policy' }, { key: 'title', dir: 'asc' });

const digest = (ids: unknown[]) => ({ n: ids.length, head: ids.slice(0, 10), sha: createHash('sha1').update(JSON.stringify(ids)).digest('hex') });

function compute() {
  const out: Record<string, unknown> = {};
  for (const [name, filters, sort] of CASES) {
    const scope = unlessArchivedAsked([...docs], filters.statuses);
    const matches = scope.filter((d) => matchesFilters(d, filters, ctx));
    const ordered = [...matches].sort(compareDocs(sort, lookups));
    const sortedScope = [...scope].sort(compareDocs(sort, lookups));
    const tree = treeEntries(buildTree(sortedScope, new Set(matches.map((d) => d.id)))).map((e) => [e.doc.id, e.depth, e.match ? 1 : 0]);
    const params = toParams({ filters, sort }).toString();
    const back = fromParams(new URLSearchParams(params));
    out[name] = {
      matches: digest(matches.map((d) => d.id)),
      ordered: digest(ordered.map((d) => d.id)),
      tree: digest(tree),
      params,
      roundTrip: toParams(back).toString(),
      view: viewMatching(BUILT_IN_VIEWS, { filters, sort })?.id ?? null,
      withForeign: withLibraryParams(new URLSearchParams('aiDraftTitle=x&q=old'), { filters, sort }, 7, 'folders').toString(),
    };
  }
  const k = kpis(docs, NOW);
  out['kpis'] = k;
  const all = docs.filter((d) => d.status !== 'archived').sort(compareDocs(byDefault, lookups));
  out['csv'] = { all: createHash('sha1').update(toCsv(all, exportColumnsFor([]), lookups)).digest('hex'), narrow: createHash('sha1').update(toCsv(all, exportColumnsFor(['type', 'owner', 'frameworks', 'updated']), lookups)).digest('hex') };
  out['someOwnerless'] = docs.filter((d) => d.owner_id == null).length;
  out['addressOldStyle'] = ['q=policy&type=policy,standard&status=published&owner=2,none&dept=10&fw=1&review=overdue&att=none&cls=internal&mine=1&sort=title:asc&open=5&view=folders']
    .map((q) => ({ q, state: toParams(fromParams(new URLSearchParams(q))).toString() }));
  return out;
}

test('every filter, the search, the ten sorts, the tree, the summary, the address and the CSV give the answers the unmodified rules gave', () => {
  const now = compute();
  if (process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(GOLDEN, '{\n' + Object.keys(now).map((k) => `${JSON.stringify(k)}: ${JSON.stringify(now[k])}`).join(',\n') + '\n}\n');       // one line per case: a diff names the case
    return;
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(now), Object.keys(golden));
  for (const key of Object.keys(golden)) assert.deepEqual(now[key], golden[key], `the answer for "${key}" changed`);
});

test('the corpus really exercises the rules: every status, a nested tree, rows without an owner, and an expiry date on the rows', () => {
  assert.equal(new Set(docs.map((d) => d.status)).size, STATUSES.length);
  assert.ok(docs.some((d) => d.parent_document_id != null));
  assert.ok(docs.some((d) => d.owner_id == null));
  assert.ok(docs.filter((d) => (d as unknown as { expiry_date: string | null }).expiry_date).length > 30);
  assert.ok(CASES.length >= 80);
});
