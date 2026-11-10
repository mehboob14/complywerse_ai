// node --test "src/app/(dashboard)/reports/builder/_workspace/builderModel.test.ts"
// The workspace's rules: opening a report, sort, filter chips, gap shortcuts, adding fields (merge, not replace), asking before a module change, unsaved changes, and the key figures
// (the formulas of audit 5.1, moved unchanged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conditionText, drillNarrow, hasUnsaved, keyFacts, mergeAddedFields, newFieldCount, opLabel, picksFromVisible, savedShape, sortChoice, sortFromChoice, switchNeedsConfirm, toggleShortcut, toggleSort,
  togglePick, withoutCondition, workingSpec,
} from './builderModel.ts';
import { cellTone } from '../../_reports/cellTone.ts';
import { emptySpec, type ColumnDef, type FilterRules, type ReportSpec } from '../../_reports/types.ts';
import { EMPTY_TOKEN, encodeMultiValue } from '../../_reports/filter-utils.ts';

const parse = (k: string) => (k.startsWith('xmod_') ? { dataset: k.split('__')[0].slice(5), field: k.split('__')[1] } : null);
const xmod = (m: string, c: string) => `xmod_${m}__${c}`;

test('a saved report opens with every list present and as the table', () => {
  const s = workingSpec({ ...emptySpec('risks'), view: 'bar', visibleColumns: undefined, measures: undefined as never, sorts: undefined }, 'risks');
  assert.equal(s.view, 'table');
  assert.deepEqual([s.visibleColumns, s.measures, s.sorts, s.pinnedColumns], [[], [], [], []]);
  assert.equal(workingSpec(null, 'vendors').dataset, 'vendors');
});

test('sort: a click goes ascending, descending, off; Shift adds and removes a second column', () => {
  let s = toggleSort([], 'a', false);
  assert.deepEqual(s, [{ key: 'a', dir: 'asc' }]);
  s = toggleSort(s, 'a', false);
  assert.deepEqual(s, [{ key: 'a', dir: 'desc' }]);
  assert.deepEqual(toggleSort(s, 'a', false), []);
  s = toggleSort([{ key: 'a', dir: 'asc' }], 'b', true);
  assert.deepEqual(s, [{ key: 'a', dir: 'asc' }, { key: 'b', dir: 'asc' }]);
  s = toggleSort(s, 'b', true);
  assert.equal(s[1].dir, 'desc');
  assert.deepEqual(toggleSort(s, 'b', true), [{ key: 'a', dir: 'asc' }]);
});

test('the rail\'s sort choice round-trips, even for a key that holds a colon', () => {
  assert.equal(sortChoice([{ key: 'residual', dir: 'desc' }]), 'residual:desc');
  assert.deepEqual(sortFromChoice('residual:desc'), [{ key: 'residual', dir: 'desc' }]);
  assert.deepEqual(sortFromChoice('xmod_a:b:asc'), [{ key: 'xmod_a:b', dir: 'asc' }]);
  assert.deepEqual(sortFromChoice(''), []);
  assert.deepEqual(sortFromChoice('nonsense'), []);
});

test('a filter chip is a sentence', () => {
  const text: ColumnDef = { key: 'title', label: 'Title' };
  const link: ColumnDef = { key: 'linkpresence_evidence', label: 'Linked: Evidence', type: 'linkage' };
  const count: ColumnDef = { key: 'link_risks_count', label: 'Risks linked', type: 'number' };
  assert.equal(conditionText({ id: '1', col: 'linkpresence_evidence', op: 'notlinked', value: '' }, link), 'No Evidence linked');
  assert.equal(conditionText({ id: '1', col: 'linkpresence_evidence', op: 'linked', value: '' }, link), 'Has Evidence linked');
  assert.equal(conditionText({ id: '2', col: 'title', op: 'in', value: encodeMultiValue(['a', 'b', 'c', 'd', EMPTY_TOKEN]) }, text), 'Title is any of a, b, c +2');
  assert.equal(conditionText({ id: '3', col: 'title', op: 'in', value: encodeMultiValue([EMPTY_TOKEN]) }, text), 'Title is any of (none)');
  assert.equal(conditionText({ id: '4', col: 'link_risks_count', op: 'eq', value: '0' }, count), 'Risks linked = 0');
  assert.equal(conditionText({ id: '5', col: 'title', op: 'empty', value: 'x' }, text), 'Title is empty');
  assert.equal(conditionText({ id: '6', col: 'gone', op: 'contains', value: 'x' }, undefined), 'gone contains x');
  assert.equal(opLabel('nope'), 'nope');
});

test('the gap shortcuts add the condition, remove it when present and keep the filled ones', () => {
  const none: FilterRules = { logic: 'AND', conditions: [] };
  const once = toggleShortcut(none, 'gap', 'linkpresence_evidence');
  assert.deepEqual(once.conditions.map((c) => [c.col, c.op]), [['linkpresence_evidence', 'notlinked']]);
  assert.deepEqual(toggleShortcut(once, 'gap', 'linkpresence_evidence').conditions, []);
  const mixed: FilterRules = { logic: 'OR', conditions: [{ id: 'a', col: 'status', op: 'eq', value: 'Open' }, { id: 'b', col: 'owner', op: 'eq', value: '' }] };
  const withZero = toggleShortcut(mixed, 'zero', 'link_risks_count');
  assert.equal(withZero.logic, 'OR');
  assert.deepEqual(withZero.conditions.map((c) => c.id), ['a', 'cnt0_link_risks_count'], 'an empty rule is dropped, a filled one stays');
  assert.deepEqual(withoutCondition(withZero, 'a').conditions.map((c) => c.id), ['cnt0_link_risks_count']);
});

test('adding fields merges: a reorder is kept, a column the sheet cannot show is carried, new fields go last', () => {
  const own = new Set(['title', 'status', 'owner']);
  const visible = ['status', 'link_evidence_count', 'title'];                       // reordered; a linked aggregate the sheet cannot represent
  const picks = picksFromVisible(visible, 'risks', own, parse);
  assert.deepEqual(picks, { risks: ['status', 'title'] });
  const next = togglePick(togglePick(picks, 'risks', 'owner'), 'vendors', 'name');
  assert.deepEqual(mergeAddedFields(visible, next, 'risks', own, parse, xmod), ['status', 'link_evidence_count', 'title', 'owner', 'xmod_vendors__name']);
  assert.equal(newFieldCount(next, visible, 'risks', xmod), 2);
  const unticked = togglePick(picks, 'risks', 'status');
  assert.deepEqual(mergeAddedFields(visible, unticked, 'risks', own, parse, xmod), ['link_evidence_count', 'title']);
  assert.deepEqual(togglePick({ risks: ['a'] }, 'risks', 'a'), {}, 'an emptied module leaves no entry');
});

test('changing module asks only when something would be lost', () => {
  const blank = emptySpec('risks');
  assert.equal(switchNeedsConfirm(blank, 'risks', 'vendors'), false);
  assert.equal(switchNeedsConfirm({ ...blank, visibleColumns: ['title'] }, 'risks', 'vendors'), true);
  assert.equal(switchNeedsConfirm({ ...blank, visibleColumns: ['title'] }, 'risks', 'risks'), false);
  assert.equal(switchNeedsConfirm({ ...blank, search: ' x ' }, 'risks', 'vendors'), true);
  assert.equal(switchNeedsConfirm({ ...blank, visibleColumns: ['title'] }, null, 'vendors'), false);
});

test('unsaved: a saved report is compared by what Save writes, a new one by whether it holds any work', () => {
  const saved: ReportSpec = { ...emptySpec('risks'), id: 'r1', name: 'Open risks', visibleColumns: ['title'] };
  assert.equal(hasUnsaved({ ...saved, view: 'bar', updatedAt: 'x', mine: false }, saved), false, 'the view, the time and the owner are not part of the report');
  assert.equal(hasUnsaved({ ...saved, name: '  Open risks ' }, saved), false, 'spaces around the name are not a change');
  assert.equal(hasUnsaved({ ...saved, visibleColumns: ['title', 'status'] }, saved), true);
  assert.equal(hasUnsaved({ ...saved, shared: true }, saved), true);
  assert.notEqual(savedShape({ ...saved, search: 'x' }), savedShape(saved));
  assert.equal(hasUnsaved(emptySpec('risks'), null), false);
  assert.equal(hasUnsaved({ ...emptySpec('risks'), name: 'New' }, null), true);
  assert.equal(hasUnsaved({ ...emptySpec('risks'), rules: { logic: 'AND', conditions: [{ id: 'a', col: 'status', op: 'eq', value: 'Open' }] } }, null), true);
});

const facts = (datasetKey: string, rows: Record<string, unknown>[], matching = rows, summary: Parameters<typeof keyFacts>[0]['summary'] = null) => keyFacts({ datasetKey, rows, matching, summary }, new Date('2026-11-10T12:00:00Z'));

test('key figures: the rows and the rows that match; amber when filters narrow them; nothing for an empty load', () => {
  assert.deepEqual(facts('assets', []), []);
  const f = facts('assets', [{}, {}, {}], [{}]);
  assert.deepEqual(f.map((x) => [x.label, x.value, x.tone]), [['Total rows', '3', 'default'], ['Matching filters', '1', 'warning']]);
});

test('key figures: the module figures keep their formulas and appear only when above zero, four at most', () => {
  const risks = facts('risks', [{ residual_score: 20, closure_status: 'Open' }, { residual_score: '15', closure_status: 'closed' }, { residual_score: 14, closure_status: 'open' }]);
  assert.deepEqual(risks.map((x) => [x.label, x.value]), [['Total rows', '3'], ['Matching filters', '3'], ['High residual (≥15)', '2'], ['Open risks', '2']]);
  assert.equal(risks[2].tone, 'danger');
  assert.equal(facts('risks', [{ residual_score: 1 }]).length, 2);
  const tasks = facts('tasks', [{ due_date: '2026-11-01', status: 'open' }, { due_date: '2026-11-01', status: 'Done' }, { due_date: '2026-12-01', status: 'open' }, { status: 'open' }]);
  assert.equal(tasks.find((x) => x.label === 'Overdue')?.value, '1');
  const vulns = facts('vulnerabilities', [{ kev_flag: 'Yes', severity: 'Critical' }, { kev_flag: true, severity: 'high' }, { severity: 'low' }]);
  assert.deepEqual(vulns.slice(2).map((x) => [x.label, x.value]), [['KEV flagged', '2'], ['Critical/High', '2']]);
  const ex = facts('exceptions', [{ expires_at: '2026-11-20' }, { expires_at: '2026-09-01' }, { expires_at: '2027-05-01' }, {}]);
  assert.equal(ex.find((x) => x.label === 'Expiring soon')?.value, '1');
  const evidence = facts('evidence', [{ is_stale: 'yes', control_mappings_count: 0 }, { is_stale: false, control_mappings_count: 2 }, {}]);
  assert.deepEqual(evidence.slice(2).map((x) => [x.label, x.value]), [['Stale', '1'], ['Unlinked', '2']]);
});

test('key figures in summary mode: groups, source rows (not when the server summed), and the first total', () => {
  const rows = [{}, {}];
  const client = facts('risks', rows, rows, { groups: 4, sourceRows: 120, grand: { label: 'How many', value: 120 } });
  assert.deepEqual(client.map((x) => [x.label, x.value, x.tone]), [['Source rows', '120', 'default'], ['Summary groups', '4', 'default'], ['How many', '120', 'success']]);
  const server = facts('risks', rows, rows, { groups: 4, sourceRows: null, grand: null });
  assert.deepEqual(server.map((x) => x.label), ['Summary groups']);
  assert.equal(facts('risks', rows, rows, { groups: 1, sourceRows: 1, grand: { label: 'Average', value: 12.345 } })[2].value, '12.3');
  assert.equal(facts('risks', rows, rows, { groups: 1, sourceRows: 1, grand: { label: 'Highest', value: 'High' } })[2].value, 'High');
});

test('a badge cell takes its tone from the colour word the dataset gave it; no colour is neutral', () => {
  assert.equal(cellTone('bg-rose-50 text-rose-700 border-rose-200'), 'danger');
  assert.equal(cellTone('bg-amber-50 text-amber-700'), 'warning');
  assert.equal(cellTone('bg-orange-50 text-orange-700'), 'warning');
  assert.equal(cellTone('bg-emerald-50 text-emerald-700'), 'success');
  assert.equal(cellTone('bg-primary-50 text-primary-700'), 'progress');
  assert.equal(cellTone('bg-slate-100 text-slate-600'), 'neutral');
  assert.equal(cellTone(undefined), 'neutral');
});

test('a dashboard click narrows a copy of an AND report to the clicked category; an OR report opens as saved and says so', () => {
  const and: ReportSpec = { ...emptySpec('risks'), id: 'r1', rules: { logic: 'AND', conditions: [{ id: 'a', col: 'status', op: 'eq', value: 'Open' }] } };
  const narrowed = drillNarrow(and, 'category', 'Cyber', 'x1');
  assert.equal(narrowed.refused, false);
  assert.deepEqual(narrowed.spec.rules.conditions.map((c) => [c.id, c.col, c.op]), [['a', 'status', 'eq'], ['drill_x1', 'category', 'in']]);
  assert.equal(and.rules.conditions.length, 1, 'the saved report is not changed');
  assert.deepEqual(drillNarrow(and, 'category', '—', 'x2').spec.rules.conditions[1].value, encodeMultiValue([EMPTY_TOKEN]), "a blank group is the filter's blank token");
  const or: ReportSpec = { ...and, rules: { logic: 'OR', conditions: [{ id: 'a', col: 'status', op: 'eq', value: 'Open' }, { id: 'b', col: 'owner', op: 'eq', value: 'Sam' }] } };
  const kept = drillNarrow(or, 'category', 'Cyber');
  assert.equal(kept.refused, true);
  assert.equal(kept.spec, or);
  const one: ReportSpec = { ...or, rules: { logic: 'OR', conditions: [{ id: 'a', col: 'status', op: 'eq', value: 'Open' }] } };
  assert.equal(drillNarrow(one, 'category', 'Cyber').spec.rules.logic, 'AND', 'one active condition has no OR to preserve');
  assert.deepEqual(drillNarrow(and, null, null), { spec: and, refused: false });
});
