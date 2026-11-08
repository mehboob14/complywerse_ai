// node --test "src/app/(dashboard)/assessments/_register/registerConfig.test.ts"
// All assessments as a register: the rows (a list row joined to the board's score and to what waits for the person), every facet's values and options, the quick views and the number each
// shows, the sorts (rows with no value last), the board, the CSV and the address. The generic model is the one Business Continuity's registers use (bcm/_register/registerModel.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { boardOf, filtersOf, noFilters, optionsOf, plainFilter, quickCounts, schemaFor, sortRows, type Ctx } from '../../bcm/_register/registerModel.ts';
import { BOARD_STATUS, REGISTER, csvOf, dueValue, exportName, gradeValue, joinRows, sublineOf, subjectName, type RegisterRow } from './registerConfig.ts';
import { readAddress } from '../../../../lib/addressState.ts';
import type { Board, ListRow, MyWork } from '../_data/types.ts';

const NOW = Date.UTC(2026, 10, 8, 12);
const ctx: Ctx = { me: 7, now: NOW };
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 19);

const row = (id: number, over: Partial<ListRow>): ListRow => ({
  id, name: `Assessment ${id}`, assessment_type: 'gap_assessment', assessment_format: 'asvs_checklist', category: 'Cyber Security', source: null, file_name: null, status: 'in_progress', due_date: null,
  assessor: null, overall_score: null, total_items: 100, complied_count: 0, partially_complied_count: 0, not_complied_count: 0, in_progress_count: 100, na_count: 0, scope_model: 'asset', phase: 'in_progress',
  owner_id: 7, owner_name: 'Noor Ali', primary_asset_id: 4, primary_asset_name: 'Payments app', started_at: null, created_at: '2026-10-01T00:00:00', updated_at: '2026-10-02T00:00:00', ...over,
});

const list: ListRow[] = [
  row(1, { name: 'ASVS - Payments app', due_date: day(-3), updated_at: '2026-11-05T00:00:00' }),
  row(2, { name: 'CSIR Maturity - Enterprise CSIRT', assessment_format: 'csir_maturity', scope_model: 'process', primary_asset_id: null, primary_asset_name: null, owner_id: 9, owner_name: 'Bina Raza', due_date: day(12), updated_at: '2026-11-04T00:00:00' }),
  row(3, { name: 'ASVS - Core banking', phase: 'scoping', status: 'draft', owner_id: 7, due_date: null, updated_at: '2026-11-06T00:00:00' }),
  row(4, { name: 'PDPL toolkit', assessment_format: 'pdpl_assessment_toolkit', category: 'Privacy & Data', scope_model: null, phase: null, status: 'completed', owner_id: null, owner_name: null, primary_asset_id: null, primary_asset_name: null, due_date: day(-40), updated_at: '2026-11-01T00:00:00' }),
  row(5, { name: 'NCA DCC', assessment_format: 'nca_dcc_tool', category: 'NCA', scope_model: null, phase: null, status: 'draft', owner_id: 9, owner_name: 'Bina Raza', primary_asset_id: null, primary_asset_name: null, due_date: day(90), updated_at: '2026-11-03T00:00:00' }),
];

const board: Board = {
  as_of: '', performance: { score: 70, grade: 'good', assessments: 3 }, sla: { score: 50, gaps: 10, closed: 2, open: 8, overdue: 3 }, attention: { overdue_gaps: 3, open_gaps: 8, not_started: 1 },
  categories: [
    { category: 'Cyber Security', score: 60, sla: 40, count: 2, assessments: [
      { id: 1, name: 'ASVS - Payments app', format: 'asvs_checklist', family: 'asvs', status: 'in_progress', n_items: 100, content: 62, sla: 40, sla_counts: { gaps: 6, closed: 1, open: 5, overdue: 3 } },
      { id: 2, name: 'CSIR Maturity - Enterprise CSIRT', format: 'csir_maturity', family: 'maturity', status: 'in_progress', n_items: 40, content: null, sla: null, sla_counts: { gaps: 0, closed: 0, open: 0, overdue: 0 } },
    ] },
    { category: 'Privacy & Data', score: 91, sla: 80, count: 1, assessments: [{ id: 4, name: 'PDPL toolkit', format: 'pdpl_assessment_toolkit', family: 'checklist', status: 'completed', n_items: 80, content: 91, sla: 80, sla_counts: { gaps: 4, closed: 1, open: 3, overdue: 0 } }] },
  ],
};
const work: MyWork = {
  as_of: '', counts: { assigned: 1, overdue: 0, to_scope: 1, to_approve: 0, can_decide: 0 },
  assigned_items: [{ item_id: 5, item_number: 'AC-1', domain: null, description: 'x', compliance_status: 'in_progress', priority: null, remediation_status: null, due: null, overdue: false, via: 'user', assessment_id: 2, assessment_name: 'CSIR', assessment_format: 'csir_maturity', category: 'Cyber Security' }],
  scoping: [{ id: 3, name: 'ASVS - Core banking', assessment_format: 'asvs_checklist', category: 'Cyber Security', primary_asset_id: 4, primary_asset_name: 'Payments app', created_at: null, updated_at: null }],
  approvals: [],
};
const rows = joinRows(list, board, work);
const ids = (rs: readonly RegisterRow[]) => rs.map((r) => r.id).sort((a, b) => a - b);

test('rows are joined to the board\'s entry by id and to what waits for the person', () => {
  assert.equal(rows.length, 5);
  assert.equal(rows[0].entry?.content, 62);
  assert.equal(rows[2].entry, null, 'a draft being scoped is not counted by the board');
  assert.deepEqual(rows.filter((r) => r.waiting).map((r) => r.id), [2, 3], 'a control assigned to me in 2, a draft I own to scope in 3');
  assert.ok(rows.every((r) => r.boardKnown));
  const unknown = joinRows(list, undefined, undefined);
  assert.ok(unknown.every((r) => !r.boardKnown && !r.waiting && r.entry === null), 'no answer from the board: nothing is claimed');
});

test('score bands: the server\'s grades; not counted and nothing answered are told apart; unknown is no band at all', () => {
  assert.deepEqual(rows.map(gradeValue), ['fair', 'none', 'uncounted', 'excellent', 'uncounted']);
  assert.equal(gradeValue(joinRows(list, undefined, undefined)[0]), null);
});

test('subjects: an application, a function, or an uploaded workbook', () => {
  assert.equal(subjectName(rows[0]), 'Payments app');
  assert.equal(subjectName(rows[1]), 'Enterprise CSIRT');
  assert.equal(subjectName(rows[3]), '');
});

test('the line under a name says the kind and the subject only when the name does not already', () => {
  assert.equal(sublineOf(rows[1]), '', '"CSIR Maturity - Enterprise CSIRT" says both');
  assert.equal(sublineOf(rows[0]), 'OWASP ASVS', 'the name says the subject: ASVS - Payments app');
  assert.equal(sublineOf({ ...rows[0], name: 'Payments review' }), 'OWASP ASVS · Payments app');
  assert.equal(sublineOf(rows[3]), 'Saudi PDPL', 'an uploaded workbook has no subject');
  assert.equal(sublineOf({ ...rows[3], name: 'Saudi PDPL toolkit' }), '');
});

test('the due facet: a finished assessment has nothing to chase; the others are overdue, soon, later or none', () => {
  assert.deepEqual(rows.map((r) => dueValue(r, NOW)), ['overdue', 'soon', 'none', 'none', 'later']);
});

test('facets: every option a row can have is offered, and the counts of the filters agree with the plain rule', () => {
  const opts = optionsOf(REGISTER, rows, ctx);
  assert.deepEqual(opts.category.map((o) => o.value), ['cyber', 'nca', 'digital', 'privacy', 'audit', 'other']);
  assert.ok(['NCA DCC assessment', 'OWASP ASVS', 'Saudi PDPL', 'CSIR Maturity'].every((l) => opts.type.some((o) => o.label === l)), 'the kinds the rows hold');
  assert.equal(opts.type.find((o) => o.value === 'cti_maturity')?.label, 'CTI Maturity', 'a kind with no assessment keeps its name, so a link that chose it says so (the rail drops it while nobody holds it)');
  assert.ok(!opts.type.some((o) => /_/.test(o.label)), 'no raw format word is a label');
  assert.deepEqual(opts.status.map((o) => o.value), ['scoping', 'draft', 'in_progress', 'in_review', 'completed', 'archived']);
  assert.deepEqual(opts.owner.map((o) => o.label), ['Bina Raza', 'Noor Ali', 'Unassigned']);
  assert.deepEqual(opts.subject.map((o) => o.label), ['Enterprise CSIRT', 'Payments app', 'Uploaded workbook']);
  assert.deepEqual(opts.grade.map((o) => o.value), ['excellent', 'good', 'fair', 'poor', 'none', 'uncounted']);
  const f = (chosen: Record<string, string[]>) => ({ ...noFilters(REGISTER), chosen: { ...noFilters(REGISTER).chosen, ...chosen } });
  assert.deepEqual(ids(plainFilter(REGISTER, rows, f({ category: ['nca'] }), ctx)), [5]);
  assert.deepEqual(ids(plainFilter(REGISTER, rows, f({ status: ['draft', 'scoping'] }), ctx)), [3, 5]);
  assert.deepEqual(ids(plainFilter(REGISTER, rows, f({ owner: ['none'] }), ctx)), [4]);
  assert.deepEqual(ids(plainFilter(REGISTER, rows, f({ due: ['overdue', 'soon'] }), ctx)), [1, 2]);
  assert.deepEqual(ids(plainFilter(REGISTER, rows, f({ subject: ['none'] }), ctx)), [4, 5], 'uploaded workbooks have no subject');
  assert.deepEqual(ids(plainFilter(REGISTER, rows, f({ grade: ['uncounted'] }), ctx)), [3, 5]);
  assert.deepEqual(ids(plainFilter(REGISTER, rows, { ...noFilters(REGISTER), search: 'payments' }, ctx)), [1, 3], 'a search reads the name, the type, the subject, the owner');
  assert.deepEqual(ids(plainFilter(REGISTER, rows, { ...noFilters(REGISTER), search: 'bina' }, ctx)), [2, 5]);
});

test('quick views and the number each would show', () => {
  const counts = quickCounts(REGISTER, rows, ctx);
  assert.deepEqual(counts, { all: 5, waiting: 2, mine: 2, scoping: 1, overdue: 1, notstarted: 1, due30: 1 });
  const q = (id: string) => ids(plainFilter(REGISTER, rows, { ...noFilters(REGISTER), quick: id }, ctx));
  assert.deepEqual(q('waiting'), [2, 3]);
  assert.deepEqual(q('mine'), [1, 3]);
  assert.deepEqual(q('scoping'), [3]);
  assert.deepEqual(q('overdue'), [1], 'a gap past its date: the board\'s overdue count of the assessment');
  assert.deepEqual(q('notstarted'), [2], 'counted by the board, nothing answered');
  assert.deepEqual(q('due30'), [2]);
  const nobody: Ctx = { me: null, now: NOW };
  assert.equal(quickCounts(REGISTER, rows, nobody).mine, 0, 'without an account "Mine" is empty, and says so');
  assert.match(REGISTER.quick.find((x) => x.id === 'mine')?.note?.(nobody) ?? '', /could not be read/);
  assert.deepEqual(REGISTER.shown.filter((id) => !REGISTER.quick.some((x) => x.id === id)), [], 'every chip is a quick view');
});

test('sorts: a row with no value goes last whichever way the column runs', () => {
  const by = (key: string, dir: 'asc' | 'desc') => sortRows(REGISTER, rows, { key, dir }, ctx).map((r) => r.id);
  assert.deepEqual(by('score', 'desc'), [4, 1, 3, 2, 5], 'no score (not counted, or nothing answered) goes last, the tie by recent update');
  assert.deepEqual(by('score', 'asc'), [1, 4, 3, 2, 5]);
  assert.deepEqual(by('due', 'asc'), [4, 1, 2, 5, 3]);
  assert.deepEqual(by('due', 'desc'), [5, 2, 1, 4, 3]);
  assert.deepEqual(by('name', 'asc'), [3, 1, 2, 5, 4]);
  assert.deepEqual(by('updated', 'desc'), [3, 1, 2, 5, 4]);
  assert.equal(REGISTER.sorts.every((s) => typeof s.label === 'string' && s.label.length > 0), true);
});

test('the board puts each assessment in one column by status, and "Show all" of a column is a set of the Status facet', () => {
  const columns = boardOf(REGISTER, rows);
  assert.deepEqual(columns.map((c) => [c.id, c.rows.map((r) => r.id)]), [['scoping', [3]], ['draft', [5]], ['in_progress', [1, 2]], ['in_review', []], ['done', [4]]]);
  assert.equal(columns.reduce((n, c) => n + c.rows.length, 0), rows.length, 'nobody is left off the board');
  assert.deepEqual(BOARD_STATUS.done, ['completed', 'archived']);
  assert.deepEqual(Object.keys(BOARD_STATUS), REGISTER.board?.columns.map((c) => c.id));
});

test('the export: one line per assessment, spreadsheet formulas made harmless, a name of its own', () => {
  const text = csvOf(REGISTER, rows.slice(0, 2), ctx).split('\r\n');
  assert.equal(text[0], REGISTER.csvHead.join(','));
  assert.equal(text.length, 3);
  assert.match(text[1], /^ASVS - Payments app,OWASP ASVS,Cyber Security,In progress,Payments app,Noor Ali,,/);
  assert.match(text[1], /,62,Fair,5,3,100$/);
  assert.match(csvOf(REGISTER, [{ ...rows[0], name: '=cmd()' }], ctx), /^[^\r\n]*\r\n'=cmd\(\)/);
  assert.equal(exportName('2026-11-08', 42, false), 'assessments-2026-11-08-42-assessments.csv');
  assert.equal(exportName('2026-11-08', 1, true), 'assessments-2026-11-08-selected-1-assessment.csv');
});

test('the address: filters, quick view, sort and view live in it; junk is the default; the names a link may use', () => {
  const schema = schemaFor(REGISTER);
  const a = readAddress(schema, '?category=nca,cyber&type=asvs_checklist&status=draft&quick=waiting&sort=score:desc&view=board&open=12&q=pay');
  assert.deepEqual(filtersOf(REGISTER, a), { search: 'pay', quick: 'waiting', chosen: { category: ['nca', 'cyber'], type: ['asvs_checklist'], status: ['draft'], owner: [], due: [], subject: [], grade: [] } });
  assert.deepEqual([a.sort, a.view, a.open], [{ key: 'score', dir: 'desc' }, 'board', 12]);
  const junk = readAddress(schema, '?quick=nonsense&sort=bogus:up&view=cards&open=-3');
  assert.deepEqual([junk.quick, junk.sort, junk.view, junk.open], [null, REGISTER.defaultSort, 'list', 0]);
});
