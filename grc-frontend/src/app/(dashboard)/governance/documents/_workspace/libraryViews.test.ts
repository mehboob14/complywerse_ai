// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryViews.test.ts"
// The compliance views are data in the library's own vocabulary: they survive the address and the browser's storage as they are, they keep what they promise on real-shaped documents,
// they never collide with a built-in view, and the page knows which one it is on (filters and order, then layout and grouping where the view remembers them).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WORKSPACE_VIEWS, WORKSPACE_VIEW_IDS, activeView, viewLook } from './libraryViews.ts';
import { GROUP_KEYS, LIBRARY_VIEWS, BUILT_IN_VIEWS, NO_FILTERS, fromParams, matchesFilters, sameState, toParams, type LibDoc, type MatchContext } from './libraryModel.ts';
import { loadViews, saveViews } from './libraryPrefs.ts';

const NOW = new Date('2026-11-11T10:00:00Z');
const doc = (id: number, over: Partial<LibDoc> = {}): LibDoc => ({
  id, title: `Doc ${id}`, document_code: null, doc_type: 'policy', status: 'published', classification: 'internal', owner_id: 1, owner_name: 'Dana', department_id: 10,
  next_review_date: '2027-06-01T00:00:00', created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00', ...over,
});
const ctx = (coverage: Record<number, number> = {}): MatchContext => ({ departments: {}, frameworks: {}, coverage, me: null, now: NOW });
const keep = (v: (typeof WORKSPACE_VIEWS)[number], docs: LibDoc[], coverage?: Record<number, number>) => docs.filter((d) => matchesFilters(d, v.state.filters, ctx(coverage))).map((d) => d.id);
const view = (id: string) => WORKSPACE_VIEWS.find((v) => v.id === id)!;

test('the six compliance views, with their layout and grouping, each built-in, ids that never change', () => {
  assert.deepEqual(WORKSPACE_VIEWS.map((v) => [v.id, v.name, v.layout, v.group]), [
    ['framework-coverage', 'Framework coverage', 'table', 'framework'],
    ['overdue-by-owner', 'Overdue by owner', 'table', 'owner'],
    ['acks-outstanding', 'Acknowledgements outstanding', 'table', 'department'],
    ['review-calendar', 'Review calendar', 'calendar', 'none'],
    ['approval-pipeline', 'Approval pipeline', 'board', 'status'],
    ['restricted', 'Restricted', 'table', 'department'],
  ]);
  assert.ok(WORKSPACE_VIEWS.every((v) => v.builtIn));
  assert.equal(new Set(WORKSPACE_VIEW_IDS).size, WORKSPACE_VIEW_IDS.length);
  for (const v of WORKSPACE_VIEWS) {
    assert.ok((LIBRARY_VIEWS as readonly string[]).includes(v.layout), v.id);
    assert.ok((GROUP_KEYS as readonly string[]).includes(v.group), v.id);
  }
});

test('no view takes the id or the exact state of a built-in one of the library, so each is a view of its own in the Views menu', () => {
  for (const v of WORKSPACE_VIEWS) {
    assert.ok(!BUILT_IN_VIEWS.some((b) => b.id === v.id), `${v.id} is a built-in id`);
    assert.ok(!BUILT_IN_VIEWS.some((b) => sameState(b.state, v.state)), `${v.id} has the state of a built-in view`);
    for (const other of WORKSPACE_VIEWS) if (other !== v) assert.ok(!sameState(other.state, v.state), `${v.id} and ${other.id} have one state`);
  }
});

test('each state is in the library\'s own grammar: it survives the address, and the browser\'s storage, as it is', () => {
  for (const v of WORKSPACE_VIEWS) assert.ok(sameState(fromParams(toParams(v.state)), v.state), v.id);
  const store = new Map<string, string>();
  const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, s: string) => { store.set(k, s); } };
  saveViews(kv, 'k', WORKSPACE_VIEWS);                       // built-in ones are never saved: only the person's own
  assert.deepEqual(loadViews(kv, 'k'), []);
});

test('Framework coverage keeps what is in force (a draft covers nothing) and sorts A to Z inside a framework', () => {
  const v = view('framework-coverage');
  assert.deepEqual(keep(v, [doc(1), doc(2, { status: 'draft' }), doc(3, { status: 'approved' }), doc(4, { status: 'archived' })]), [1]);
  assert.deepEqual(v.state.sort, { key: 'title', dir: 'asc' });
});

test('Overdue by owner keeps the reviews past their date, the oldest first', () => {
  const v = view('overdue-by-owner');
  assert.deepEqual(keep(v, [doc(1, { next_review_date: '2026-10-01T00:00:00' }), doc(2), doc(3, { status: 'draft', next_review_date: '2026-01-01T00:00:00' }), doc(4, { next_review_date: '2026-11-11T18:00:00' })]), [1]);
  assert.deepEqual(v.state.sort, { key: 'review', dir: 'asc' });
});

test('Acknowledgements outstanding keeps the documents with a request that not everyone has answered, the least answered first', () => {
  const v = view('acks-outstanding');
  assert.deepEqual(keep(v, [doc(1), doc(2), doc(3), doc(4)], { 1: 100, 2: 40, 3: 0 }), [2, 3]);       // 1 is complete, 4 has no request
  assert.deepEqual(v.state.sort, { key: 'attestation', dir: 'asc' });
});

test('Approval pipeline keeps the documents on their way and nothing in force; Restricted keeps the Restricted classification in whatever case the data spells it', () => {
  assert.deepEqual(keep(view('approval-pipeline'), ['draft', 'pending_review', 'pending_approval', 'approved', 'published', 'archived', 'expired'].map((status, i) => doc(i + 1, { status }))), [1, 2, 3, 4]);
  assert.deepEqual(keep(view('restricted'), [doc(1, { classification: 'Restricted' }), doc(2, { classification: 'restricted' }), doc(3), doc(4, { classification: null })]), [1, 2]);
});

test('Review calendar has no filter of its own: the calendar leaves out what owes no review', () => {
  assert.deepEqual(view('review-calendar').state.filters, NO_FILTERS);
});

test('the page is on the view its filters, order, layout and grouping say: an older view (no layout) fits any layout; a Workspace view needs its own', () => {
  const all = [...BUILT_IN_VIEWS, ...WORKSPACE_VIEWS];
  const overdue = BUILT_IN_VIEWS.find((v) => v.id === 'overdue')!;
  assert.equal(activeView(all, overdue.state, 'table', 'none')?.id, 'overdue');
  assert.equal(activeView(all, overdue.state, 'board', 'department')?.id, 'overdue');                 // the library's older view: any layout, any grouping
  assert.equal(activeView(all, view('overdue-by-owner').state, 'table', 'owner')?.id, 'overdue-by-owner');
  assert.equal(activeView(all, view('overdue-by-owner').state, 'table', 'department'), null);          // its filters and order, another grouping: a custom look
  assert.equal(activeView(all, view('restricted').state, 'table', 'department')?.id, 'restricted');
  assert.equal(activeView(all, view('restricted').state, 'board', 'department'), null);
  assert.equal(activeView(all, view('review-calendar').state, 'calendar', 'none')?.id, 'review-calendar');
  assert.equal(activeView(all, view('review-calendar').state, 'table', 'none'), null);
  assert.equal(activeView([], overdue.state, 'table', 'none'), null);
});

test('where several views fit, the one that remembers both layout and grouping wins, then the first', () => {
  const state = view('restricted').state;
  const plain = { id: 'plain', name: 'p', state };
  const layoutOnly = { id: 'layout', name: 'l', state, layout: 'table' as const };
  const both = { id: 'both', name: 'b', state, layout: 'table' as const, group: 'department' as const };
  assert.equal(activeView([plain, layoutOnly, both], state, 'table', 'department')?.id, 'both');
  assert.equal(activeView([plain, layoutOnly], state, 'table', 'owner')?.id, 'layout');
  assert.equal(activeView([plain, { ...plain, id: 'second' }], state, 'board', 'none')?.id, 'plain');
});

test('applying a view sets its layout and grouping where it remembers them, and leaves the page\'s own where it does not', () => {
  assert.deepEqual(viewLook(view('approval-pipeline')), { layout: 'board', group: 'status' });
  assert.deepEqual(viewLook(BUILT_IN_VIEWS[0]), {});
  assert.deepEqual(viewLook({ layout: 'tracker' }), { layout: 'tracker' });
});
