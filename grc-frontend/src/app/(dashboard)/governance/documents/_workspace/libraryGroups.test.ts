// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryGroups.test.ts"
// Group by: which group a document is in, the groups in a sensible order, the figures on a group's line (count, overdue by the library's rule, acknowledged from the attestation the
// documents carry, no owner), a document with several frameworks in each, and what is drawn for a group (one row for a document, never two with the same id).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GROUP_LABEL, GROUP_MENU, attestationOf, flipGroup, groupedOrder, groupAria, groupButtonLabel, groupDocs, groupIsOpen, groupNote, groupOf, groupTrees, groupsLine, NO_FOLD,
  planGroups, setAllGroups, showAllPatch, type GroupDoc, type GroupLookups,
} from './libraryGroups.ts';
import { GROUP_KEYS, type GroupKey } from './libraryModel.ts';

const NOW = new Date('2026-11-11T10:00:00Z');
type Doc = GroupDoc & { parent_document_id: number | null };
const doc = (id: number, over: Partial<Doc> = {}): Doc => ({
  id, title: `Doc ${id}`, document_code: null, doc_type: 'policy', status: 'published', classification: 'internal', owner_id: 1, owner_name: 'Dana Okoro', department_id: 10,
  framework_ids: [], applicable_framework_ids: [], next_review_date: '2027-06-01T00:00:00', created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00',
  parent_document_id: null, attestation: null, ...over,
});
const LK: GroupLookups = {
  departments: { '10': 'Operations', '11': 'Support', '12': 'Finance' },
  departmentPaths: { '10': 'Operations', '11': 'Operations › Support', '12': 'Finance' },
  frameworks: { '1': { short: 'ISO 27001', name: 'ISO/IEC 27001:2022' }, '2': { short: 'SOC 2', name: 'SOC 2 Trust Services' } },
};

test('the keys and their words: every key has a label, the menu lists every key once, the button says what is chosen', () => {
  assert.deepEqual([...GROUP_MENU].sort(), [...GROUP_KEYS].sort());
  for (const k of GROUP_KEYS) assert.ok(GROUP_LABEL[k]);
  assert.equal(groupButtonLabel('department'), 'Group: Department');
  assert.equal(groupButtonLabel('none'), 'Group: None');
  assert.equal(groupButtonLabel('review'), 'Group: Review month');
});

test('none has no groups: the list is flat', () => {
  assert.deepEqual(groupDocs([doc(1)], 'none', LK, NOW), []);
  assert.deepEqual(groupOf(doc(1), 'none', LK, NOW), []);
});

test('department: by the document\'s own department (its path where it has one), the largest first, "No department" last, an unknown department is none', () => {
  const docs = [doc(1), doc(2, { department_id: 11 }), doc(3, { department_id: 11 }), doc(4, { department_id: null }), doc(5, { department_id: 99 }), doc(6, { department_id: 10 }), doc(7, { department_id: 10 })];
  const groups = groupDocs(docs, 'department', LK, NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.count]), [['Operations', 3], ['Operations › Support', 2], ['No department', 2]]);
  assert.deepEqual(groups[2].docs.map((d) => d.id), [4, 5]);                          // the documents keep the order they were given in
  assert.equal(groups[0].key, 'department:10');
  assert.equal(groups[2].none, true);
  assert.equal(groups[1].title, 'Operations › Support');
});

test('status: in life-cycle order, then expired and the rest, archived last of the known ones', () => {
  const statuses = ['archived', 'published', 'something_new', 'draft', 'expired', 'approved', 'pending_review', 'exception_applied', 'pending_approval'];
  const groups = groupDocs(statuses.map((status, i) => doc(i + 1, { status })), 'status', LK, NOW);
  assert.deepEqual(groups.map((g) => g.id), ['draft', 'pending_review', 'pending_approval', 'approved', 'published', 'expired', 'exception_applied', 'archived', 'something_new']);
  assert.equal(groups[0].label, 'Draft');
  assert.equal(groups[1].label, 'In review');
  assert.equal(groups.at(-1)?.label, 'Something new');                                   // a status the library has no word for still starts with a capital
});

test('owner: by person, the largest first, a person with no name is still a group, "No owner" last', () => {
  const docs = [doc(1, { owner_id: 5, owner_name: 'Zed' }), doc(2, { owner_id: 6, owner_name: 'Amy' }), doc(3, { owner_id: 6, owner_name: 'Amy' }), doc(4, { owner_id: null, owner_name: null }), doc(5, { owner_id: 7, owner_name: null })];
  const groups = groupDocs(docs, 'owner', LK, NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Amy', 'Unnamed owner', 'Zed', 'No owner']);           // ties by name
  assert.deepEqual(groups.map((g) => g.id), ['6', '7', '5', 'none']);
  assert.equal(groups[3].withoutOwner, 1);
  assert.equal(groups[0].withoutOwner, 0);
});

test('classification: public to restricted, anything else after them, "No classification" last', () => {
  const docs = ['restricted', 'Public', 'confidential', null, 'secret', 'internal', ''].map((classification, i) => doc(i + 1, { classification }));
  assert.deepEqual(groupDocs(docs, 'classification', LK, NOW).map((g) => g.label), ['Public', 'Internal', 'Confidential', 'Restricted', 'Secret', 'No classification']);
  assert.equal(groupDocs(docs, 'classification', LK, NOW).at(-1)?.docs.length, 2);                    // null and ''
});

test('type: the largest first, by name on a tie', () => {
  const docs = [doc(1, { doc_type: 'standard' }), doc(2, { doc_type: 'policy' }), doc(3, { doc_type: 'policy' }), doc(4, { doc_type: 'procedure' })];
  assert.deepEqual(groupDocs(docs, 'type', LK, NOW).map((g) => [g.label, g.count]), [['Policy', 2], ['Procedure', 1], ['Standard', 1]]);
});

test('framework: the frameworks a document SHOWS (the applicable ones, else its own) decide, and a document of two frameworks is in both', () => {
  const docs = [doc(1, { framework_ids: [1, 2] }), doc(2, { applicable_framework_ids: [2], framework_ids: [1] })];
  const groups = groupDocs(docs, 'framework', LK, NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.docs.map((d) => d.id)]), [['SOC 2', [1, 2]], ['ISO 27001', [1]]]);
  assert.deepEqual(groupOf(docs[0], 'framework', LK, NOW).map((t) => t.id), ['1', '2']);
});

test('framework: the order is by size then name with "No framework" last (the unnamed one before it)', () => {
  const docs = [doc(1, { framework_ids: [1, 2] }), doc(2, { framework_ids: [1] }), doc(3, { framework_ids: [] }), doc(4, { framework_ids: [77] })];
  const groups = groupDocs(docs, 'framework', LK, NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.count]), [['ISO 27001', 2], ['SOC 2', 1], ['Unnamed framework', 1], ['No framework', 1]]);
  assert.equal(groups[0].title, 'ISO/IEC 27001:2022');
  assert.equal(groups.reduce((n, g) => n + g.count, 0), 5);                                          // 4 documents, one of them counted twice
  assert.deepEqual(groups[0].docs.map((d) => d.id), [1, 2]);
});

test('review month: by the month of the next review, the calendar order; "No review date", then "Not published" (no review owed) last', () => {
  const docs = [
    doc(1, { next_review_date: '2027-01-15T00:00:00' }), doc(2, { next_review_date: '2026-11-30T00:00:00' }), doc(3, { next_review_date: '2026-03-01T00:00:00' }),
    doc(4, { next_review_date: null }), doc(5, { status: 'draft', next_review_date: '2026-12-01T00:00:00' }), doc(6, { next_review_date: '2027-01-02T00:00:00' }), doc(7, { status: 'archived', next_review_date: null }),
  ];
  const groups = groupDocs(docs, 'review', LK, NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.count]), [['March 2026', 1], ['November 2026', 1], ['January 2027', 2], ['No review date', 1], ['Not published', 2]]);
  assert.deepEqual(groups.map((g) => g.id), ['2026-03', '2026-11', '2027-01', 'none', 'not-in-force']);
});

test('overdue is the library\'s rule: a review owed whose date has passed; a draft with an old date is not overdue', () => {
  const docs = [
    doc(1, { next_review_date: '2026-10-01T00:00:00' }), doc(2, { next_review_date: '2026-11-11T09:00:00' }), doc(3, { next_review_date: '2026-11-11T18:00:00' }),
    doc(4, { status: 'draft', next_review_date: '2026-01-01T00:00:00' }), doc(5, { status: 'expired', next_review_date: '2026-01-01T00:00:00' }),
  ];
  const [g] = groupDocs(docs, 'department', LK, NOW);
  assert.equal(g.count, 5);
  assert.equal(g.overdue, 2);
});

test('acknowledged: people who did / people asked over the documents that have a request, as the library rounds a percentage; none when no document has a request', () => {
  const docs = [
    doc(1, { attestation: { pct: 80, done: 8, total: 10 } }), doc(2, { attestation: { pct: 50, done: 1, total: 2 } }), doc(3), doc(4, { attestation: { pct: 0, done: 0, total: 0 } }),
    doc(5, { department_id: 11 }), doc(6, { department_id: 12, attestation: { pct: 100, done: 4, total: 4 } }),
  ];
  const groups = groupDocs(docs, 'department', LK, NOW);
  const by = (label: string) => groups.find((g) => g.label === label);
  assert.deepEqual(by('Operations')?.acknowledged, { pct: 75, done: 9, total: 12, documents: 2 });      // 9 of 12; the request that asked nobody and the document with none are not counted
  assert.equal(by('Operations › Support')?.acknowledged, null);                                          // never 0%
  assert.equal(by('Finance')?.acknowledged?.pct, 100);
});

test('acknowledged never rounds to an extreme that is not true, and reads the coverage counts of an older server that sends none on the rows', () => {
  const near = groupDocs([doc(1, { attestation: { pct: 99.7, done: 299, total: 300 } })], 'type', LK, NOW);
  assert.equal(near[0].acknowledged?.pct, 99);
  const few = groupDocs([doc(1, { attestation: { pct: 0.3, done: 1, total: 300 } })], 'type', LK, NOW);
  assert.equal(few[0].acknowledged?.pct, 1);
  const old = groupDocs([doc(1), doc(2)], 'type', { ...LK, counts: { 2: { done: 3, total: 4 } } }, NOW);
  assert.deepEqual(old[0].acknowledged, { pct: 75, done: 3, total: 4, documents: 1 });
  assert.equal(attestationOf(doc(1), {}), null);
  assert.deepEqual(attestationOf(doc(1, { attestation: { pct: 50, done: 1, total: 2 } }), { counts: { 1: { done: 9, total: 9 } } }), { done: 1, total: 2 });   // the row wins
});

test('what "Show all" on a group sets in the library\'s filters, and null where they cannot say it', () => {
  const g = (id: string, none = false) => ({ id, none });
  assert.deepEqual(showAllPatch('department', g('10')), { departments: ['10'] });
  assert.deepEqual(showAllPatch('department', g('none', true)), { departments: ['none'] });
  assert.deepEqual(showAllPatch('status', g('pending_review')), { statuses: ['pending_review'] });
  assert.deepEqual(showAllPatch('owner', g('6')), { owners: ['6'] });
  assert.deepEqual(showAllPatch('owner', g('none', true)), { owners: ['none'] });
  assert.deepEqual(showAllPatch('framework', g('none', true)), { frameworks: ['none'] });
  assert.deepEqual(showAllPatch('type', g('policy')), { types: ['policy'] });
  assert.deepEqual(showAllPatch('classification', g('restricted')), { classifications: ['restricted'] });
  assert.equal(showAllPatch('classification', g('none', true)), null);
  assert.equal(showAllPatch('review', g('2026-11')), null);                                           // a month is not a bucket of the Review filter
  assert.equal(showAllPatch('review', g('not-in-force', true)), null);
  assert.deepEqual(showAllPatch('review', g('none', true)), { review: ['unscheduled'] });
  assert.equal(showAllPatch('none', g('x')), null);
});

test('the words of a group: what a screen reader hears, the count line (cut says so), the (i) note', () => {
  const [g] = groupDocs([doc(1, { next_review_date: '2026-01-01T00:00:00', owner_id: null, owner_name: null, attestation: { pct: 50, done: 1, total: 2 } }), doc(2, { attestation: { pct: 50, done: 1, total: 2 } })], 'department', LK, NOW);
  assert.equal(groupAria(g), 'Operations, 2 documents, 1 overdue, 50% acknowledged, 1 without an owner');
  assert.equal(groupAria({ label: 'X', count: 1, overdue: 0, acknowledged: null, withoutOwner: 0 }), 'X, 1 document');
  assert.equal(groupsLine({ groups: 6, documents: 128, loaded: 128, total: 128 }), '6 groups · 128 documents');
  assert.equal(groupsLine({ groups: 1, documents: 1, loaded: 1000, total: 1240 }), '1 group · 1 document in the 1,000 loaded');
  assert.ok(groupNote('framework').includes('counted under each'));
  assert.ok(groupNote('review').includes('Not published'));
  assert.ok(!groupNote('owner').includes('counted under each'));
});

test('open and closed: a short library opens, a long one starts closed, a choice is kept, Expand all / Collapse all', () => {
  assert.equal(groupIsOpen(NO_FOLD, 'owner:5', 40), true);
  assert.equal(groupIsOpen(NO_FOLD, 'owner:5', 41), false);
  const closed = flipGroup(NO_FOLD, 'owner:5', 12);
  assert.equal(groupIsOpen(closed, 'owner:5', 12), false);
  assert.equal(groupIsOpen(flipGroup(closed, 'owner:5', 12), 'owner:5', 12), true);
  assert.equal(groupIsOpen(flipGroup(NO_FOLD, 'owner:5', 500), 'owner:5', 500), true);
  const all = setAllGroups(['a', 'b'], true);
  assert.deepEqual([groupIsOpen(all, 'a', 999), groupIsOpen(all, 'b', 999)], [true, true]);
  const none = setAllGroups(['a', 'b'], false);
  assert.deepEqual([groupIsOpen(none, 'a', 1), groupIsOpen(none, 'b', 1)], [false, false]);
});

test('what is drawn: a document has ONE full row (in the first group it is in); the other frameworks list it as a slim line that says where', () => {
  const docs = [doc(1, { framework_ids: [1, 2] }), doc(2, { framework_ids: [1] }), doc(3, { framework_ids: [2], parent_document_id: 1 })];
  const groups = groupDocs(docs, 'framework', LK, NOW);
  const trees = groupTrees(groups);
  const iso = trees.get('framework:1')!;
  const soc = trees.get('framework:2')!;
  assert.deepEqual(iso.top.map((d) => d.id), [1, 2]);
  assert.deepEqual(iso.also, []);
  assert.deepEqual(soc.top.map((d) => d.id), [3]);                                                    // 3 is a child of 1, but 1's row is in the other group: 3 stands at the top here
  assert.deepEqual(soc.also.map((a) => [a.doc.id, a.home]), [[1, 'ISO 27001']]);
  const rowIds = Array.from(trees.values()).flatMap((t) => t.top.map((d) => d.id));
  assert.equal(new Set(rowIds).size, rowIds.length);                                                  // no id twice
});

test('the plan: a closed group is its header only; an open one lists its first lines and says how many are left', () => {
  const docs = Array.from({ length: 20 }, (_, i) => doc(i + 1, { department_id: i < 18 ? 10 : 11 }));
  const groups = groupDocs(docs, 'department', LK, NOW);
  const trees = groupTrees(groups);
  const plan = planGroups(groups, trees, { isOpen: (g) => g.id === '10', extra: {}, rowsOf: (_g, top) => top.map((d) => d.id) });
  assert.deepEqual(plan.map((p) => p.kind), ['group', 'docs', 'group']);
  const docsItem = plan[1] as Extract<(typeof plan)[number], { kind: 'docs' }>;
  assert.equal(docsItem.rows.length, 15);
  assert.equal(docsItem.remaining, 3);
  const more = planGroups(groups, trees, { isOpen: () => true, extra: { 'department:10': 50 }, rowsOf: (_g, top) => top.map((d) => d.id) });
  assert.equal((more[1] as typeof docsItem).remaining, 0);
  assert.equal((more[1] as typeof docsItem).rows.length, 18);
});

test('the plan: the limit counts the slim lines too, after the full rows', () => {
  const docs = [...Array.from({ length: 14 }, (_, i) => doc(i + 1, { framework_ids: [1] })), ...Array.from({ length: 5 }, (_, i) => doc(i + 100, { framework_ids: [2, 1] }))];
  const groups = groupDocs(docs, 'framework', LK, NOW);
  const trees = groupTrees(groups);
  const keys = groups.map((g) => g.key);
  const plan = planGroups(groups, trees, { isOpen: () => true, extra: {}, rowsOf: (_g, top) => top.map((d) => d.id) });
  const second = plan.find((p) => p.kind === 'docs' && p.group.key === keys[1]) as Extract<(typeof plan)[number], { kind: 'docs' }>;
  assert.ok(second);
  assert.ok(second.rows.length + second.also.length <= 15);
  assert.equal(second.remaining, Math.max(0, second.tree.top.length + second.tree.also.length - 15));
});

test('GroupKey is the lead\'s contract: every key groups without throwing, on an empty list and on one document', () => {
  for (const k of GROUP_KEYS as readonly GroupKey[]) {
    assert.deepEqual(groupDocs([], k, LK, NOW), []);
    assert.ok(groupDocs([doc(1)], k, LK, NOW).length <= 1);
  }
});

test('the shown order lists a document once', () => {
  const docs = [doc(1, { framework_ids: [1, 2] }), doc(2, { framework_ids: [2] }), doc(3, { owner_id: null, owner_name: null })];
  assert.deepEqual(groupedOrder(groupDocs(docs, 'framework', LK, NOW)).map((d) => d.id), [1, 2, 3]);             // SOC 2 (2 documents) first, in the order given: 1, 2; ISO adds nothing new; then No framework: 3
});
