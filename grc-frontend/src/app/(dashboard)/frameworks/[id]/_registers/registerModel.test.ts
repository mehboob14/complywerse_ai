// node --test "src/app/(dashboard)/frameworks/\[id\]/_registers/registerModel.test.ts"
// The Registers tab's pure rules: how a register's two shapes become one row, what is sent to create or update, what the AI reads and may write, how
// a cell reads, the search and the one filter, coverage, which six columns the table keeps, and what a row is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { REGISTER_CONFIGS } from '../_tabs/templateConfigs.ts';
import {
  aiItemsOf, aiPatchOf, cardTitleOf, aiRowsOf, bodyOf, cellText, coveragePct, defOfDefinition, defOfIso, draftOf, facetColumn, facetCounts, FACET_ALL, formatTyped,
  controlOptions, controlStores, hasEvidenceColumn, matchesFacet, pickControl, pickRisk, riskOptions, sameDraft, withCurrent, matchesSearch, movedCount, ownerName, riskTitleOf, rowLabel, rowOfData, rowOfEntry, sectionsOf, tableColumns, wantsEvidence,
  type Definition, type RegColumn,
} from './registerModel.ts';

const gap = defOfIso(REGISTER_CONFIGS.gap_analysis);
const audit = defOfIso(REGISTER_CONFIGS.internal_audit);
const treat = defOfIso(REGISTER_CONFIGS.risk_treatment);
const people = [{ id: 7, name: 'Amal Khan' }, { id: 8, name: 'Bilal Ahmed' }];

const entry = (over: Record<string, unknown> = {}) => ({
  id: 1, register_type: 'gap_analysis', seq: 0, is_seed: true, reference: '4 Context', title: 'Internal and external issues', status: 'not_started',
  action: null, owner_id: 7, owner_name: null, target_date: '2026-11-08T00:00:00', risk_register_id: null, data: {}, ...over,
});

const DEF: Definition = {
  type: 'pci_dss__x', label: 'Readiness', description: 'From the template.',
  columns: [
    { key: 'ref', label: 'Ref', type: 'auto' },
    { key: 'goal', label: 'Goal', type: 'text' },
    { key: 'outcome', label: 'Outcome', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'Not started', label: 'Not started', tone: 'slate' }, { value: 'Compliant', label: 'Compliant', tone: 'emerald' }, { value: 'Non-compliant', label: 'Non-compliant', tone: 'rose' }] },
    { key: 'owner', label: 'Owner', type: 'text', picker: 'users' },
    { key: 'due', label: 'Due', type: 'date' },
    { key: 'seen', label: 'Seen', type: 'datetime' },
    { key: 'proof', label: 'Proof', type: 'text', picker: 'evidence' },
    { key: 'odd', label: 'Odd', type: 'mystery' },
  ],
  formSections: [{ title: 'Where', keys: ['ref', 'goal', 'missing'] }, { title: 'Nothing', keys: ['nope'] }],
};
const dyn = defOfDefinition(DEF);

test('an ISO register is read from fixed columns, a generated one from its data: both give the same row', () => {
  const a = rowOfEntry(entry());
  assert.equal(a.id, 1);
  assert.equal(a.values.reference, '4 Context');
  assert.equal('data' in a.values, false, 'the data object is not a column');
  assert.equal(a.seed, true);
  assert.equal(a.riskId, null);
  const b = rowOfData({ id: 9, is_seed: false, risk_register_id: 12, data: { goal: 'Secure the network' } });
  assert.deepEqual(b.values, { goal: 'Secure the network' });
  assert.equal(b.riskId, 12);
  assert.deepEqual(rowOfData({ id: 3, data: null }).values, {});
});

test('the definition of a generated register: unknown types read as text, unknown pickers are dropped, colour words become tones, the form keeps only real columns', () => {
  assert.equal(dyn.shape, 'data');
  assert.equal(dyn.columns.find((c) => c.key === 'odd')?.kind, 'text');
  assert.equal(dyn.columns.find((c) => c.key === 'owner')?.picker, 'users');
  assert.equal(defOfDefinition({ ...DEF, columns: [{ key: 'x', label: 'X', type: 'text', picker: 'surprise' }] }).columns[0].picker, undefined);
  assert.deepEqual(dyn.columns.find((c) => c.key === 'status')?.options?.map((o) => o.tone), ['neutral', 'success', 'danger']);
  assert.deepEqual(dyn.sections, [{ title: 'Where', keys: ['ref', 'goal'] }], 'a section of no real column is dropped');
  assert.deepEqual(sectionsOf(undefined, dyn.columns), [{ title: '', keys: dyn.columns.map((c) => c.key) }]);
  assert.deepEqual(sectionsOf([], dyn.columns)[0].keys.length, dyn.columns.length);
});

test('the three ISO configs become columns with their pickers, options and form sections', () => {
  assert.equal(gap.shape, 'columns');
  assert.equal(gap.coverage, true);
  assert.equal(audit.coverage, false);
  assert.equal(gap.columns.find((c) => c.key === 'reference')?.picker, 'framework_controls');
  assert.equal(gap.columns.find((c) => c.key === 'reference')?.autofillKey, 'title');
  assert.equal(treat.columns.find((c) => c.key === 'reference')?.picker, 'framework_risks');
  assert.equal(treat.columns.find((c) => c.key === 'approved_by')?.picker, 'users');
  assert.deepEqual(gap.sections.map((s) => s.title), ['Requirement', 'Assessment', 'Ownership']);
  assert.deepEqual(gap.columns.find((c) => c.key === 'status')?.options?.map((o) => o.label), ['Not started', 'In progress', 'Covered', 'N/A']);
});

test('a new row starts empty, and a new Gap Analysis row starts "not started"; an edit copies the row', () => {
  assert.deepEqual(draftOf(null, gap), { status: 'not_started' });
  assert.deepEqual(draftOf(null, audit), {});
  assert.deepEqual(draftOf(null, dyn), {});
  const row = rowOfEntry(entry());
  const d = draftOf(row, gap);
  assert.notEqual(d, row.values);
  assert.equal(d.title, 'Internal and external issues');
});

test('ISO rows send every column (a missing one as null) and keep the risk link; generated rows send their data', () => {
  const body = bodyOf({ reference: 'A.5.1', title: 'T', status: 'covered', risk_register_id: 4, stray: 1 }, gap);
  assert.deepEqual(Object.keys(body).sort(), ['action', 'owner_id', 'reference', 'risk_register_id', 'status', 'target_date', 'title']);
  assert.equal(body.action, null);
  assert.equal(body.risk_register_id, 4);
  assert.equal('stray' in body, false);
  assert.equal('risk_register_id' in bodyOf({ reference: 'A' }, gap), false, 'no link in the draft, no link sent');
  assert.equal(bodyOf({ risk_register_id: null }, gap).risk_register_id, null);
  assert.deepEqual(bodyOf({ goal: 'g', __evidence: 'file.pdf' }, dyn), { data: { goal: 'g', __evidence: 'file.pdf' } });
});

test('the AI reads the six fields of an ISO row or the data of a generated row, and writes back only what it was allowed to', () => {
  const iso = rowOfEntry(entry({ result: 'conform', notes: 'n', owner_id: 8 }));
  assert.deepEqual(aiRowsOf([iso], 'columns'), [{ id: 1, reference: '4 Context', title: 'Internal and external issues', status: 'not_started', result: 'conform', action: null, notes: 'n' }]);
  const gen = rowOfData({ id: 5, data: { goal: 'g' } });
  assert.deepEqual(aiRowsOf([gen], 'data'), [{ id: 5, goal: 'g' }]);

  const items = aiItemsOf({ suggestions: [{ id: 1, status: 'covered', notes: 'ok', reference: 'IGNORED' }, { title: 'no id' }] }, 'columns');
  assert.equal(items.length, 1);
  assert.equal(items[0].fields.status, 'covered');
  assert.equal('reference' in items[0].fields, false);

  const out = { keys: ['status', 'outcome'], suggestions: [{ id: 5, status: 'Compliant', outcome: '', goal: 'IGNORED' }, { id: 6, status: '' }, { id: null, status: 'x' }] };
  assert.deepEqual(aiItemsOf(out, 'data'), [{ id: 5, fields: { status: 'Compliant' } }], 'empty answers and rows with no id are left out');
  assert.deepEqual(aiPatchOf(out), { status: 'Compliant' });
  assert.deepEqual(aiPatchOf({}), {});
});

test('a cell reads as words: an option by its label, an owner by name, a date as the day written, a typed time as typed', () => {
  const row = rowOfEntry(entry({ status: 'in_progress' }));
  const col = (key: string) => gap.columns.find((c) => c.key === key) as RegColumn;
  assert.equal(cellText(col('status'), row, people), 'In progress');
  assert.equal(cellText(col('owner_id'), row, people), 'Amal Khan');
  assert.equal(cellText(col('target_date'), row, people), '8 Nov 2026');
  assert.equal(cellText(col('action'), row, people), '');
  assert.equal(ownerName(rowOfEntry(entry({ owner_id: 99, owner_name: 'Former user' })), people), 'Former user');
  assert.equal(ownerName(rowOfEntry(entry({ owner_id: null, owner_name: null })), people), '');
  const g = rowOfData({ id: 2, data: { due: '2026-03-25', seen: '2026-11-08T14:30', status: 'Compliant', odd: 5 } });
  assert.equal(cellText(dyn.columns.find((c) => c.key === 'due') as RegColumn, g, people), '25 Mar 2026');
  assert.equal(cellText(dyn.columns.find((c) => c.key === 'seen') as RegColumn, g, people), '8 Nov 2026, 14:30');
  assert.equal(cellText(dyn.columns.find((c) => c.key === 'status') as RegColumn, g, people), 'Compliant');
  assert.equal(cellText(dyn.columns.find((c) => c.key === 'odd') as RegColumn, g, people), '5');
  assert.equal(formatTyped('2026-11-08 09:05'), '8 Nov 2026, 09:05');
  assert.equal(formatTyped('2026-11-08'), '8 Nov 2026');
});

test('the search finds what any column says, including an option\'s label and an owner\'s name', () => {
  const row = rowOfEntry(entry({ status: 'covered', action: 'Write the register' }));
  assert.equal(matchesSearch(row, gap.columns, people, ''), true);
  assert.equal(matchesSearch(row, gap.columns, people, '  context '), true);
  assert.equal(matchesSearch(row, gap.columns, people, 'COVERED'), true, 'the label of the option');
  assert.equal(matchesSearch(row, gap.columns, people, 'amal'), true, 'the owner');
  assert.equal(matchesSearch(row, gap.columns, people, 'nov 2026'), true, 'the date as shown');
  assert.equal(matchesSearch(row, gap.columns, people, 'zzz'), false);
});

test('the filter is the select that says where a row stands; each option counts its rows, "not set" last, and "all" shows every row', () => {
  assert.equal(facetColumn(gap.columns)?.key, 'status');
  assert.equal(facetColumn(audit.columns)?.key, 'result');
  assert.equal(facetColumn(treat.columns)?.key, 'status');
  assert.equal(facetColumn([{ key: 'a', label: 'A', kind: 'text' }]), null);
  assert.equal(facetColumn([{ key: 'level', label: 'L', kind: 'select', options: [{ value: 'h', label: 'High', tone: 'danger' }] }])?.key, 'level');
  const col = gap.columns.find((c) => c.key === 'status') as RegColumn;
  const rows = [entry({ id: 1, status: 'covered' }), entry({ id: 2, status: 'not_started' }), entry({ id: 3, status: 'covered' }), entry({ id: 4, status: null }), entry({ id: 5, status: 'odd_word' })].map(rowOfEntry);
  const counts = facetCounts(rows, col);
  assert.deepEqual(counts.map((c) => [c.value, c.count]), [['not_started', 1], ['covered', 2], ['odd_word', 1], ['', 1]], 'options in the order given, then unknown words, then not set');
  assert.equal(counts[0].label, 'Not started');
  assert.equal(counts[3].label, 'Not set');
  assert.equal(matchesFacet(rows[0], col, FACET_ALL), true);
  assert.equal(matchesFacet(rows[0], col, 'covered'), true);
  assert.equal(matchesFacet(rows[1], col, 'covered'), false);
  assert.equal(matchesFacet(rows[3], col, ''), true, 'a row with no value is "not set"');
  assert.equal(matchesFacet(rows[0], null, 'covered'), true);
});

test('coverage is covered over applicable, not-applicable rows leave the count, a whole percent, 0 with nothing to count', () => {
  const rows = (...s: Array<string | null>) => s.map((status, i) => rowOfEntry(entry({ id: i + 1, status })));
  assert.equal(coveragePct(rows('covered', 'covered', 'in_progress', 'not_applicable')), 67);
  assert.equal(coveragePct(rows('not_applicable')), 0);
  assert.equal(coveragePct([]), 0);
  assert.equal(coveragePct(rows('covered')), 100);
  assert.equal(movedCount([rowOfEntry(entry({ risk_register_id: 3 })), rowOfEntry(entry({ id: 2 }))]), 1);
});

test('the table keeps at most six columns: reference, main text, where it stands, owner, date, then the rest in order; the form still has them all', () => {
  const t = tableColumns(gap.columns);
  assert.deepEqual(t.map((x) => x.col.key), ['reference', 'title', 'status', 'action', 'owner_id', 'target_date'], 'the six of Gap Analysis, in the config\'s order');
  assert.deepEqual(t.map((x) => x.priority), [1, 1, 1, 3, 2, 2]);
  const risk = tableColumns(treat.columns);
  assert.deepEqual(risk.map((x) => x.col.key), ['reference', 'title', 'treatment_option', 'owner_id', 'target_date', 'status'], 'Risk Treatment: ten columns, six shown, status among them');
  assert.deepEqual(risk.map((x) => x.priority), [1, 1, 3, 2, 2, 1]);
  const wide: RegColumn[] = Array.from({ length: 12 }, (_, i) => ({ key: `c${i}`, label: `C${i}`, kind: 'text' as const }));
  const w = tableColumns(wide);
  assert.deepEqual(w.map((x) => x.col.key), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'], 'twelve text columns: the first six');
  assert.deepEqual(w.map((x) => x.priority), [1, 1, 1, 2, 2, 3]);
  assert.equal(tableColumns(wide, 3).length, 3);
  assert.equal(tableColumns([], 6).length, 0);
  const small = tableColumns(dyn.columns.slice(0, 3));
  assert.equal(small.length, 3);
});

test('a row is named by its reference and main text, cut; a row with no words is "Row N" when its place is known, else "this row"; punctuation says nothing', () => {
  assert.equal(rowLabel(rowOfEntry(entry()), gap.columns), '4 Context Internal and external issues');
  assert.equal(rowLabel(rowOfEntry(entry({ reference: null, title: null })), gap.columns), 'Row 1');
  assert.equal(rowLabel(rowOfEntry(entry({ reference: null, title: null, seq: 4 })), gap.columns), 'Row 5');
  assert.equal(rowLabel({ ...rowOfEntry(entry({ reference: null, title: null })), seq: null }, gap.columns), 'this row');
  assert.equal(rowLabel({ ...rowOfEntry(entry({ reference: null, title: null })), seq: null }, gap.columns, 60, 'This row'), 'This row');
  assert.equal(rowLabel(rowOfEntry(entry({ reference: ' - ', title: '—' })), gap.columns), 'Row 1', 'a dash is not a name');
  assert.equal(rowLabel(rowOfData({ id: 1, seq: 2, data: { goal: '-', outcome: '' } }), dyn.columns), 'Row 3');
  assert.equal(rowLabel(rowOfEntry(entry({ reference: '#2007', title: 'Laptop theft' })), gap.columns), 'Laptop theft', 'the risk number is not a name');
  const long = rowOfEntry(entry({ title: 'x'.repeat(200) }));
  assert.ok(rowLabel(long, gap.columns).length <= 60);
  assert.match(rowLabel(long, gap.columns), /…$/);
});

test('the title of a risk made from a row: an ISO row\'s title or reference; a generated row\'s first meaningful text', () => {
  assert.equal(riskTitleOf(rowOfEntry(entry()), gap), 'Internal and external issues');
  assert.equal(riskTitleOf(rowOfEntry(entry({ title: '' })), gap), '4 Context');
  assert.equal(riskTitleOf(rowOfEntry(entry({ title: 'x'.repeat(300) })), gap).length, 200);
  assert.equal(riskTitleOf(rowOfData({ id: 1, data: { goal: 'Secure the network', outcome: 'Controls are in place and tested' } }), dyn), 'Controls are in place and tested', 'a long text column first');
  assert.equal(riskTitleOf(rowOfData({ id: 1, data: { goal: 'Secure', outcome: '' } }), dyn), 'Secure');
  assert.equal(riskTitleOf(rowOfData({ id: 1, data: { goal: '12', outcome: '' } }), dyn), '12');
  assert.equal(riskTitleOf(rowOfData({ id: 1, data: {} }), dyn), '');
});

test('which registers need the evidence library', () => {
  assert.equal(hasEvidenceColumn(dyn), true);
  assert.equal(hasEvidenceColumn(gap), false);
  assert.equal(wantsEvidence(dyn), true);
  assert.equal(wantsEvidence(gap), false);
  assert.equal(wantsEvidence(defOfDefinition({ ...DEF, columns: [{ key: 'a', label: 'A', type: 'text' }] })), true, 'a generated register has the "Linked evidence" field');
});

test('the shipped definitions all become registers: a reference or main column, at most six table columns, every form key a column', () => {
  const url = new URL('../../../../../../../backend/grc/seed_data/framework_templates/pci_dss.json', import.meta.url);
  const file = fileURLToPath(url);
  if (!existsSync(file)) return;
  const def = JSON.parse(readFileSync(file, 'utf8')) as { registers: Definition[] };
  assert.ok(def.registers.length > 0);
  for (const r of def.registers) {
    const reg = defOfDefinition(r);
    const keys = new Set(reg.columns.map((c) => c.key));
    assert.ok(tableColumns(reg.columns).length <= 6, r.type);
    for (const s of reg.sections) for (const k of s.keys) assert.ok(keys.has(k), `${r.type}: ${k}`);
  }
});

test('a requirement picker stores the code when it fills a companion column or the register is generated, else the whole line; the value held stays in the list', () => {
  const controls = [{ code: 'A.5.1', title: 'Policies' }, { code: '4.1', title: '' }];
  const ref = (def: typeof gap, key: string) => def.columns.find((c) => c.key === key) as RegColumn;
  assert.equal(controlStores(gap, ref(gap, 'reference')), 'code', 'Gap Analysis fills the requirement text too');
  assert.equal(controlStores(audit, ref(audit, 'reference')), 'line');
  assert.equal(controlStores(treat, ref(treat, 'linked_control')), 'line');
  assert.equal(controlStores(dyn, dyn.columns[0]), 'code');
  assert.deepEqual(controlOptions(controls, '', 'code'), [{ value: 'A.5.1', label: 'A.5.1 — Policies' }, { value: '4.1', label: '4.1' }]);
  assert.deepEqual(controlOptions(controls, '', 'line').map((o) => o.value), ['A.5.1 — Policies', '4.1']);
  assert.deepEqual(controlOptions(controls, 'old code', 'code')[0], { value: 'old code', label: 'old code' });
  assert.equal(controlOptions(controls, 'A.5.1', 'code').length, 2, 'a value the list has is not added again');
  assert.deepEqual(withCurrent([{ value: 'a', label: 'A' }], ''), [{ value: 'a', label: 'A' }]);
  assert.deepEqual(pickControl(ref(gap, 'reference'), 'A.5.1', controls), { reference: 'A.5.1', title: 'Policies' });
  assert.deepEqual(pickControl(ref(gap, 'reference'), '4.1', controls), { reference: '4.1' }, 'a requirement with no text leaves the companion alone');
  assert.deepEqual(pickControl(ref(audit, 'reference'), 'A.5.1 — Policies', controls), { reference: 'A.5.1 — Policies' });
});

test('choosing a risk links it, writes its number as the reference and its title; clearing the choice keeps what was typed', () => {
  const risks = [{ id: 12, title: 'Laptop theft' }, { id: 13, title: '' }];
  assert.deepEqual(riskOptions(risks), [{ value: '12', label: 'Laptop theft' }, { value: '13', label: 'Untitled risk' }]);
  assert.deepEqual(pickRisk({ reference: 'x', title: 'typed' }, 12, risks), { risk_register_id: 12, reference: '#12', title: 'Laptop theft' });
  assert.deepEqual(pickRisk({ reference: 'x', title: 'typed' }, 13, risks), { risk_register_id: 13, reference: '#13', title: 'typed' });
  assert.deepEqual(pickRisk({ reference: 'x', title: 'typed' }, null, risks), { risk_register_id: null, reference: 'x', title: 'typed' });
});

test('a draft is unchanged when every field reads the same; an empty, a missing and a null value are one', () => {
  assert.equal(sameDraft({ a: 'x', b: null }, { a: 'x' }), true);
  assert.equal(sameDraft({ a: '' }, { a: null }), true);
  assert.equal(sameDraft({ a: 1 }, { a: '1' }), true);
  assert.equal(sameDraft({ a: 'x' }, { a: 'y' }), false);
  assert.equal(sameDraft({ a: 'x' }, {}), false);
  assert.equal(sameDraft({}, {}), true);
});

test('a phone card is titled by the first column, not by the whole row; a blank or risk-number first column falls back to the name of the row', () => {
  const first = gap.columns[0];
  assert.equal(cardTitleOf(rowOfEntry(entry()), first, gap.columns, people), '4 Context');
  assert.equal(cardTitleOf(rowOfEntry(entry({ reference: '' })), first, gap.columns, people), 'Internal and external issues');
  assert.equal(cardTitleOf(rowOfEntry(entry({ reference: '#2007', title: 'Laptop theft' })), first, gap.columns, people), 'Laptop theft');
  assert.equal(cardTitleOf(rowOfEntry(entry({ reference: 'x'.repeat(200) })), first, gap.columns, people).length, 90);
  assert.equal(cardTitleOf(rowOfEntry(entry({ reference: '', title: '' })), undefined, gap.columns, people), 'Row 1');
});
