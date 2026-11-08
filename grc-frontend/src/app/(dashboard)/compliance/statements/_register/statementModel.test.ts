// node --test "src/app/(dashboard)/compliance/statements/_register/statementModel.test.ts"
// The Statements register's rules: what a statement is called, the quick views, the order, the search over EVERY statement (the old one searched 20), the facet engine held to the
// plain filter, the address, who may assess, what "Convert to controls" takes and which evidence a save adds.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, countOf } from '../../../../../components/records/facetEngine.ts';
import { readAddress } from '../../../../../lib/addressState.ts';
import {
  DEFAULT_SORT, FIRST_DIR, NONE, QUICK_IDS, convertPlan, dayOf, evidenceToAdd, haystack, inQuick, mayAssess, nextSort, sortRows, statementTitle, type Sort, type StatementRow, type Viewer,
} from './statementModel.ts';
import { NO_FILTERS, chosenOf, filterChips, filterCount, indexStatements, orderedOptions, railOptions, removeChip, ruleOf, type Filters } from './statementFacets.ts';
import { STATEMENTS_SCHEMA, filtersPatch, pageOf, type StatementsAddress } from './statementAddress.ts';

let n = 0;
const stmt = (o: Partial<StatementRow> = {}): StatementRow => ({
  id: ++n, tenant_id: 1, document_id: 10, document_title: 'Access Control Policy', document_code: 'POL-AC', statement_code: `AC-${n}`, statement_text: 'Users must use MFA.', statement_summary: null,
  category: 'security', sub_category: null, priority: 'high', is_mandatory: true, status: 'active', effective_date: null, review_date: null, source_section: null, ai_confidence: null,
  compliance_status: 'not_assessed', compliance_score: null, next_assessment_date: null, assigned_to_user_id: null, assignee_name: null, created_at: null, ...o,
});
const ROWS: StatementRow[] = [
  stmt({ statement_code: 'AC-1', compliance_status: 'compliant', priority: 'critical', assigned_to_user_id: 7, assignee_name: 'Sara Reviewer' }),
  stmt({ statement_code: 'AC-2', compliance_status: 'non_compliant', priority: 'high', assigned_to_user_id: 8, assignee_name: 'Khalid Approver' }),
  stmt({ statement_code: 'AC-10', compliance_status: 'not_assessed', priority: null, category: null }),
  stmt({ statement_code: 'BC-1', document_id: 11, document_title: 'Backup Policy', document_code: 'POL-BK', category: 'it', compliance_status: 'partially_compliant', priority: 'low', statement_text: 'Backups are encrypted.' }),
  stmt({ statement_code: 'BC-2', document_id: 11, document_title: 'Backup Policy', document_code: 'POL-BK', category: 'it', compliance_status: 'not_assessed', priority: 'medium', assigned_to_user_id: 7, assignee_name: 'Sara Reviewer' }),
];
const ME: Viewer = { me: 7 };

test('a statement is called by its summary, else the start of its text, else "No text"', () => {
  assert.equal(statementTitle({ statement_summary: ' MFA for everyone ', statement_text: 'long' }), 'MFA for everyone');
  assert.equal(statementTitle({ statement_summary: null, statement_text: 'Users   must\nuse MFA.' }), 'Users must use MFA.');
  assert.equal(statementTitle({ statement_summary: '', statement_text: 'x'.repeat(300) }).length, 161, '160 characters and an ellipsis');
  assert.equal(statementTitle({ statement_summary: null, statement_text: '  ' }), 'No text');
});

test('the quick views count what they say; "mine" is empty without an account, not everything', () => {
  const count = (id: (typeof QUICK_IDS)[number], v = ME) => ROWS.filter((r) => inQuick(id, r, v)).length;
  assert.deepEqual(QUICK_IDS.map((id) => count(id)), [5, 2, 2, 1, 2]);
  assert.equal(count('mine', { me: null }), 0);
});

test('sorting: newest first by default, codes in natural order, the worst status first, a missing priority last whichever way', () => {
  const codes = (s: Sort) => sortRows(ROWS, s).map((r) => r.statement_code);
  assert.deepEqual(codes(DEFAULT_SORT), ['BC-2', 'BC-1', 'AC-10', 'AC-2', 'AC-1']);
  assert.deepEqual(codes({ key: 'code', dir: 'asc' }), ['AC-1', 'AC-2', 'AC-10', 'BC-1', 'BC-2'], 'AC-2 before AC-10');
  assert.deepEqual(codes({ key: 'status', dir: 'asc' }).slice(0, 2), ['AC-2', 'BC-1'], 'non-compliant, then partially compliant');
  assert.equal(codes({ key: 'priority', dir: 'asc' })[0], 'AC-1');
  assert.equal(codes({ key: 'priority', dir: 'asc' })[4], 'AC-10');
  assert.equal(codes({ key: 'priority', dir: 'desc' })[4], 'AC-10', 'no priority is last even when the column runs the other way');
});

test('a header turns a column round and a second turn goes back to the default', () => {
  const a = nextSort(DEFAULT_SORT, 'code');
  assert.deepEqual(a, { key: 'code', dir: FIRST_DIR.code });
  const b = nextSort(a, 'code');
  assert.deepEqual(b, { key: 'code', dir: 'desc' });
  assert.deepEqual(nextSort(b, 'code'), DEFAULT_SORT);
});

test('the search covers every statement\'s code, text, document, category and assignee, every word has to be found', () => {
  const find = (q: string) => evaluate(indexStatements(ROWS), chosenOf(NO_FILTERS), ruleOf({ ...NO_FILTERS, search: q }, ME)).matches.map((r) => r.statement_code);
  assert.deepEqual(find('backups encrypted'), ['BC-1']);
  assert.deepEqual(find('backup policy'), ['BC-1', 'BC-2']);
  assert.deepEqual(find('khalid'), ['AC-2'], 'the assignee');
  assert.deepEqual(find('pol-bk it'), ['BC-1', 'BC-2'], 'the document code and the category word');
  assert.deepEqual(find('nothing like this'), []);
  assert.ok(haystack(ROWS[2]).includes('no category'));
});

test('the facet engine agrees with the plain filter, and each option\'s count is what choosing it would show', () => {
  const idx = indexStatements(ROWS);
  const f: Filters = { ...NO_FILTERS, status: ['not_assessed', 'non_compliant'], document: ['10'] };
  const got = evaluate(idx, chosenOf(f), ruleOf(f, ME));
  const plain = ROWS.filter((r) => ['not_assessed', 'non_compliant'].includes(r.compliance_status) && r.document_id === 10).map((r) => r.id);
  assert.deepEqual(got.matches.map((r) => r.id), plain);
  // choosing "compliant" as well would add AC-1 (document 10)
  assert.equal(countOf(got.counts, 'status', 'compliant'), 1);
  // in the other document, with the status unchanged, backup statements that are not assessed would show
  assert.equal(countOf(got.counts, 'document', '11'), 1);
  // a quick view is a rule on top of the facets
  const mine = evaluate(idx, chosenOf(NO_FILTERS), ruleOf({ ...NO_FILTERS, quick: 'mine' }, ME));
  assert.deepEqual(mine.matches.map((r) => r.statement_code), ['AC-1', 'BC-2']);
});

test('the rail offers the five compliance words always, and the categories, documents and people the statements have', () => {
  const o = railOptions(ROWS);
  assert.deepEqual(o.status.map((x) => x.label), ['Compliant', 'Partially compliant', 'Non-compliant', 'Not assessed', 'Not applicable']);
  assert.deepEqual(o.priority.map((x) => x.value), ['critical', 'high', 'medium', 'low', NONE], 'a statement with no priority makes "No priority" an option');
  assert.deepEqual(o.category.map((x) => x.label), ['IT', 'Security', 'No category']);
  assert.deepEqual(o.document.map((x) => x.label), ['Access Control Policy', 'Backup Policy']);
  assert.deepEqual(o.assignee.map((x) => x.label), ['Khalid Approver', 'Sara Reviewer', 'Unassigned']);
  const kept = orderedOptions(o.status, ['not_applicable'], (v) => (v === 'compliant' ? 1 : 0));
  assert.deepEqual(kept.map((x) => x.value), ['compliant', 'not_applicable'], 'a chosen option with a 0 stays, the others with a 0 go');
});

test('chips say what is on and take it off; a count of filters includes the search and the quick view', () => {
  const f: Filters = { ...NO_FILTERS, search: ' mfa ', quick: 'mine', priority: ['critical'], document: ['10'] };
  assert.equal(filterCount(f), 4);
  const chips = filterChips(f, railOptions(ROWS));
  assert.deepEqual(chips.map((c) => c.label), ['Search: mfa', 'Assigned to me', 'Priority: Critical', 'Document: Access Control Policy']);
  let g = f;
  chips.forEach((c) => { g = removeChip(g, c); });
  assert.deepEqual(g, NO_FILTERS);
});

test('the address round-trips: a link opens the same view, a value the page cannot be in is the default', () => {
  const a = readAddress(STATEMENTS_SCHEMA, 'status=non_compliant&priority=critical,high&doc=10&quick=mine&q=mfa&sort=code:asc&open=420') as unknown as StatementsAddress;
  const page = pageOf(a);
  assert.deepEqual(page.filters, { search: 'mfa', status: ['non_compliant'], priority: ['critical', 'high'], category: [], document: ['10'], assignee: [], quick: 'mine' });
  assert.deepEqual(page.sort, { key: 'code', dir: 'asc' });
  assert.equal(page.openId, 420);
  const bad = pageOf(readAddress(STATEMENTS_SCHEMA, 'quick=everything&sort=colour:up&open=-3') as unknown as StatementsAddress);
  assert.equal(bad.filters.quick, null);
  assert.deepEqual(bad.sort, DEFAULT_SORT);
  assert.equal(bad.openId, null);
  assert.deepEqual(filtersPatch(page.filters), { q: 'mfa', status: ['non_compliant'], priority: ['critical', 'high'], category: [], doc: ['10'], assignee: [], quick: 'mine' });
});

test('who may assess: an unassigned statement, its assignee or an administrator (the half of the server rule the screen knows)', () => {
  assert.equal(mayAssess(null, 7, false), true);
  assert.equal(mayAssess(7, 7, false), true);
  assert.equal(mayAssess(8, 7, false), false);
  assert.equal(mayAssess(8, 7, true), true);
  assert.equal(mayAssess(8, null, false), false, 'an unknown account is not the assignee');
});

test('Convert to controls takes statements of one document and says so in words (it used to be an alert)', () => {
  const one = convertPlan([ROWS[0], ROWS[1]]);
  assert.deepEqual([one.ok, one.documentId, one.count, one.why], [true, 10, 2, null]);
  const two = convertPlan([ROWS[0], ROWS[3]]);
  assert.equal(two.ok, false);
  assert.equal(two.documentId, null);
  assert.match(two.why as string, /2 different documents/);
  assert.equal(convertPlan([]).ok, false);
});

test('a save adds only the evidence that is not linked yet, once each; the date input holds the day', () => {
  assert.deepEqual(evidenceToAdd([3, 4, 4, 9], [3, 5]), [4, 9]);
  assert.deepEqual(evidenceToAdd([], [1]), []);
  assert.equal(dayOf('2026-11-30T00:00:00'), '2026-11-30');
  assert.equal(dayOf(null), '');
});
