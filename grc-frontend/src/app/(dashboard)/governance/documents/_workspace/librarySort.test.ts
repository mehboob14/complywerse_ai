// node --test "src/app/(dashboard)/governance/documents/_workspace/librarySort.test.ts"
// sortDocs is compareDocs with the sort value worked out once per document: the same order, for every key and both directions, on titles with accents, Arabic, digits,
// equal values and documents with nothing in the column.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SORT_KEYS, compareDocs, sortDocs, type LibDoc, type Lookups } from './libraryModel.ts';

const TITLES = ['Zürich Policy', 'zurich policy', 'Access 10', 'Access 9', '[Draft] Plan', 'مرحبا', 'Access 9', 'ﬁnance', '', 'Backup'];
const docs: LibDoc[] = Array.from({ length: 120 }, (_, i) => ({
  id: i + 1, title: TITLES[i % TITLES.length] + (i % 3 === 0 ? ' x' : ''), document_code: null, doc_type: ['policy', 'standard', 'risk_policy'][i % 3],
  status: ['draft', 'published', 'archived', 'exception_applied', 'pending_review'][i % 5], owner_id: i % 4 === 0 ? null : i % 7, owner_name: i % 4 === 0 ? null : `Owner ${i % 7}`,
  department_id: i % 6 === 0 ? null : i % 5, framework_ids: Array.from({ length: i % 4 }, (_, k) => k + 1), next_review_date: i % 5 === 0 ? null : new Date(Date.UTC(2026, i % 12, 1 + (i % 28))).toISOString().slice(0, 19),
  current_version: ['1.0', '2.10', '2.9', null, 'v3.1'][i % 5], created_at: '2026-01-01T00:00:00', updated_at: i % 9 === 0 ? '' : new Date(Date.UTC(2026, 0, 1 + (i % 30), i % 24)).toISOString().slice(0, 19),
}));
const lookups: Lookups = { departments: { '1': 'Security', '2': 'security', '3': 'Ärzte', '4': 'Risk' }, frameworks: {}, coverage: Object.fromEntries(docs.filter((d) => d.id % 3 === 0).map((d) => [d.id, d.id % 101])), me: null };

test('sortDocs gives the order compareDocs gives, for every key and direction', () => {
  for (const key of SORT_KEYS) for (const dir of ['asc', 'desc'] as const) {
    const want = [...docs].sort(compareDocs({ key, dir }, lookups)).map((d) => d.id);
    assert.deepEqual(sortDocs(docs, { key, dir }, lookups).map((d) => d.id), want, `${key} ${dir}`);
  }
});

test('10,000 documents sort by title within a loose bound (reported as a diagnostic)', (ctx) => {
  const many = Array.from({ length: 10_000 }, (_, i) => ({ ...docs[i % docs.length], id: i + 1, title: `${TITLES[i % TITLES.length]} ${i}` }));
  const t = performance.now();
  sortDocs(many, { key: 'title', dir: 'asc' }, lookups);
  const took = performance.now() - t;
  ctx.diagnostic(`sortDocs by title, 10,000 documents: ${took.toFixed(0)} ms`);
  assert.ok(took < 3000, String(took));
});
