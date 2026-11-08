// node --test "src/app/(dashboard)/frameworks/\[id\]/_requirements/reqModel.test.ts"
// The rules of the Requirements tab: how far a requirement's evidence is, what a row carries, the quick views, the framework's own order, the section lines (family and
// sub-family for a standard with its own structure), the board and what a bulk action may take.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CertificationControl, ControlStructure } from '../../../../../types/index.ts';
import {
  DEFAULT_SORT, QUICK_IDS, bulkPlan, bulkSummary, boardDefs, checklistOf, evidenceCountsOf, evidenceLine, evidenceStateOf, groupInfos, inQuick, mergeOwners, naturalCompare,
  nextSort, searchTerms, sectionLabelOf, sortRows, statusFollowsTicks, tierOf, toRows, withGroups,
  type EvidenceCounts, type ReqRow,
} from './reqModel.ts';

let n = 0;
function control(over: Partial<CertificationControl> & Record<string, unknown> = {}): CertificationControl {
  n += 1;
  return {
    id: n, journey_id: 1, framework_control_id: null as unknown as number, parsed_control_id: 1000 + n, control_code: `C.${n}`, control_name: `Control ${n}`, control_statement: `The entity shall ${n}.`,
    domain_id: 0, domain_code: 'D', domain_name: 'D1 General', status: 'not_started', is_applicable: true, priority: 3, sub_controls: [], evidence_requirements: [], evidence: [],
    evidence_count: 0, required_evidence_count: 0, ...over,
  } as unknown as CertificationControl;
}
const ev = (review_status: 'pending' | 'approved' | 'rejected', id = 1) => ({ id, uploaded_at: '2026-11-01T00:00:00', review_status });
const E = (files: number, required: number, approved: number, pending = 0, rejected = 0): EvidenceCounts => ({ files, required, approved, pending, rejected });
const row = (over: Partial<CertificationControl> & Record<string, unknown> = {}, opts = {}): ReqRow => toRows([control(over)], opts)[0];

test('evidence: nothing yet, waiting for a reviewer, turned down, partly there, all there, nothing asked for', () => {
  assert.equal(evidenceStateOf(E(0, 3, 0)), 'none');
  assert.equal(evidenceStateOf(E(0, 0, 0)), 'not_asked');
  assert.equal(evidenceStateOf(E(2, 3, 1, 1)), 'review', 'a file waiting for a reviewer comes first');
  assert.equal(evidenceStateOf(E(2, 3, 0, 0, 2)), 'rejected');
  assert.equal(evidenceStateOf(E(2, 3, 1, 0, 1)), 'partial', 'one approved and one turned down is partly there');
  assert.equal(evidenceStateOf(E(3, 3, 3)), 'complete');
  assert.equal(evidenceStateOf(E(1, 0, 1)), 'complete', 'it asks for nothing in particular: one approved file is enough, as the server counts it');
  assert.equal(evidenceStateOf(E(1, 0, 0)), 'partial', 'a file nobody approved is not readiness');
});

test('the evidence counts come from the list payload, and the lists of files fill in what a count lacks', () => {
  const c = control({ evidence: [ev('approved', 1), ev('pending', 2), ev('rejected', 3)], evidence_count: 3, required_evidence_count: 6, approved_evidence_count: 1 });
  assert.deepEqual(evidenceCountsOf(c), { files: 3, required: 6, approved: 1, pending: 1, rejected: 1 });
  const bare = { evidence: [ev('approved')], evidence_requirements: [{ type: 'x', title: 'a', description: '' }, { type: 'x', title: 'b', description: '' }] } as unknown as CertificationControl;
  assert.deepEqual(evidenceCountsOf(bare), { files: 1, required: 2, approved: 1, pending: 0, rejected: 0 });
  assert.equal(evidenceLine(E(2, 6, 1, 1)), '1 of 6 approved');
  assert.equal(evidenceLine(E(9, 6, 9)), '6 of 6 approved', 'never more approved than asked for');
  assert.equal(evidenceLine(E(2, 0, 1)), '2 files');
  assert.equal(evidenceLine(E(0, 0, 0)), '—');
});

test('a row carries the status the server sent, the scope, the section in the framework\'s own order, the tier and the owners', () => {
  const rows = toRows([
    control({ control_code: 'A.5.1', domain_name: 'Organizational Controls', status: 'implemented', assigned_user_ids: [3], assignees: [{ id: 3, display_name: 'Aisha Khan', email: 'a@x.test' }] }),
    control({ control_code: 'A.6.1', domain_name: 'People Controls', is_applicable: false, is_critical: true, priority_level: 'P2' }),
    control({ control_code: 'A.5.2', domain_name: 'Organizational Controls', priority_level: 'N/A (NCA-guided)' }),
  ]);
  assert.deepEqual(rows.map((r) => r.sectionKey), ['0', '1', '0'], 'the second section is the second to appear');
  assert.deepEqual(rows.map((r) => r.inScope), [true, false, true]);
  assert.deepEqual(rows.map((r) => r.tier), [null, 'P2', null], 'text that is not a tier is no tier');
  assert.deepEqual(rows[0].owners, ['Aisha Khan']);
  assert.deepEqual(rows.map((r) => r.category), ['Organizational', 'People', 'Organizational']);
  assert.equal(rows[1].critical, true);
  assert.equal(tierOf({ priority_tier: 'P4', priority_level: 'P1' }), 'P4');
  assert.equal(sectionLabelOf({ domain_name: '', control_code: '5.2.1', original_control_code: '' }), 'Section 5');
  assert.equal(sectionLabelOf({ domain_name: ' ', control_code: 'DG.1', original_control_code: '' }), 'General');
});

test('an owner the payload has only an id for is named from the user list, and a legacy single assignee still reads', () => {
  assert.deepEqual(row({ assigned_user_ids: [7] }, { users: [{ id: 7, name: 'Sara Reviewer' }] }).owners, ['Sara Reviewer']);
  assert.deepEqual(row({ assigned_user_ids: [9] }).owners, ['User 9']);
  const legacy = row({ assigned_to_user_id: 4, assignee_name: 'Omar' });
  assert.deepEqual([legacy.ownerIds, legacy.owners], [[4], ['Omar']]);
});

test('the checklist is the standard\'s sub-controls that are criteria, else the assessment criteria; the person\'s unsaved ticks win', () => {
  const crit = control({ assessment_criteria: ['one', 'two', 'three', 'four'], criteria_status: { '0': true } });
  assert.deepEqual(checklistOf(crit), { kind: 'criteria', met: 1, total: 4 });
  assert.deepEqual(checklistOf(crit, { [crit.id]: { '0': true, '1': true } }), { kind: 'criteria', met: 2, total: 4 }, 'a tick not yet saved counts');
  const tree = control({
    assessment_criteria: ['x', 'y'], criteria_status: {},
    sub_control_tree: [
      { code: 'M1.1.1.1', number: 1, text: 'a', lead_in: null, criterion_index: 0, met: false, consideration: false, points: [], evidence: [] },
      { code: 'M1.1.1.2', number: 2, text: 'b', lead_in: null, criterion_index: 1, met: false, consideration: false, points: [], evidence: [] },
      { code: 'M1.1.1.3', number: 3, text: 'take into account', lead_in: null, criterion_index: null, met: null, consideration: true, points: [], evidence: [] },
    ],
  });
  assert.deepEqual(checklistOf(tree, { [tree.id]: { '1': true } }), { kind: 'subcontrols', met: 1, total: 2 }, 'a line with nothing to tick is not counted');
  assert.equal(checklistOf(control()), null);
  assert.equal(statusFollowsTicks(crit), true);
  assert.equal(statusFollowsTicks(control()), false, 'only a requirement without criteria has a status a person sets');
});

test('quick views: mine, needs evidence, waiting for review, unassigned, critical; the counts a chip shows are the rows in view', () => {
  const me = { me: 5 };
  const rows = toRows([
    control({ status: 'not_started', required_evidence_count: 3, evidence_count: 0, assigned_user_ids: [5] }),                                            // mine, needs evidence
    control({ status: 'in_progress', required_evidence_count: 2, evidence_count: 1, approved_evidence_count: 0, evidence: [ev('pending')] }),            // waiting for review
    control({ status: 'implemented', required_evidence_count: 1, evidence_count: 1, approved_evidence_count: 1, evidence: [ev('approved')], is_critical: true }),
    control({ status: 'verified' }),                                                                                                                    // done, nobody
  ]);
  const count = (id: (typeof QUICK_IDS)[number]) => rows.filter((r) => inQuick(id, r, me)).length;
  // all, mine, needs evidence (not the one already waiting for a reviewer), waiting for review, unassigned (not the done ones), critical
  assert.deepEqual(QUICK_IDS.map(count), [4, 1, 1, 1, 1, 1]);
  assert.equal(rows.filter((r) => inQuick('mine', r, { me: null })).length, 0, 'nobody is "me" until the person is known');
});

test('the framework\'s order: sections as published, clauses in natural order; any other key puts the rows without the value last', () => {
  const rows = toRows([
    control({ control_code: 'B.2', original_control_code: 'B.10', domain_name: 'B Second' }),
    control({ control_code: 'A.9', original_control_code: 'A.9', domain_name: 'A First' }),
    control({ control_code: 'A.10', original_control_code: 'A.10', domain_name: 'A First' }),
    control({ control_code: 'A.1', original_control_code: 'A.1', domain_name: 'B Second' }),
  ]);
  // sections follow the order the server sent (B Second appeared first)
  assert.deepEqual(sortRows(rows, DEFAULT_SORT).map((r) => r.control.original_control_code), ['A.1', 'B.10', 'A.9', 'A.10']);
  assert.deepEqual(sortRows(rows, { key: 'order', dir: 'desc' }).map((r) => r.control.original_control_code), ['A.10', 'A.9', 'B.10', 'A.1']);
  assert.ok(naturalCompare('1.2.9', '1.2.10') < 0 && naturalCompare('1', 'a') < 0);
  const withOwners = toRows([
    control({ status: 'implemented', assignees: [{ id: 1, display_name: 'Zed', email: '' }], assigned_user_ids: [1] }),
    control({ status: 'not_started' }),
    control({ status: 'in_progress', assignees: [{ id: 2, display_name: 'Amy', email: '' }], assigned_user_ids: [2] }),
  ]);
  assert.deepEqual(sortRows(withOwners, { key: 'status', dir: 'asc' }).map((r) => r.status), ['not_started', 'in_progress', 'implemented']);
  assert.deepEqual(sortRows(withOwners, { key: 'owner', dir: 'asc' }).map((r) => r.owners[0] ?? null), ['Amy', 'Zed', null]);
  assert.deepEqual(sortRows(withOwners, { key: 'owner', dir: 'desc' }).map((r) => r.owners[0] ?? null), ['Zed', 'Amy', null], 'the one with nobody is last both ways');
});

test('a header press: a new key starts in its first direction, the same key turns round, then back to the framework\'s order', () => {
  const s1 = nextSort(DEFAULT_SORT, 'status');
  assert.deepEqual(s1, { key: 'status', dir: 'asc' });
  assert.deepEqual(nextSort(s1, 'status'), { key: 'status', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'status', dir: 'desc' }, 'status'), DEFAULT_SORT);
});

test('the search looks at the code, name, specification, section, owners and the standard\'s sub-controls, every word of it', () => {
  const r = row({
    control_code: 'M1.1.1', control_name: 'Understanding the Entity', control_statement: 'Determine external factors', domain_name: 'M1 Strategy', assigned_user_ids: [2],
    assignees: [{ id: 2, display_name: 'Aisha Khan', email: '' }],
    sub_control_tree: [{ code: 'M1.1.1.4', number: 4, text: 'its internal capabilities.', lead_in: 'The entity shall determine:', criterion_index: 3, met: false, consideration: false, points: [], evidence: [] }],
  });
  for (const q of ['m1.1.1', 'understanding entity', 'external', 'strategy', 'aisha', 'internal capabilities', 'M1.1.1.4']) {
    assert.ok(searchTerms(q).every((t) => r.text.includes(t)), q);
  }
  assert.ok(!searchTerms('nothing here').every((t) => r.text.includes(t)));
});

test('section lines: a plain framework counts done per section of the requirements in view; a page that starts mid-section repeats the line', () => {
  const all = toRows([
    control({ domain_name: 'S1', status: 'implemented' }), control({ domain_name: 'S1', status: 'verified' }), control({ domain_name: 'S1', status: 'not_started' }),
    control({ domain_name: 'S2', status: 'in_progress' }),
  ]);
  const infos = groupInfos(all, null);
  assert.deepEqual([...infos.values()].map((g) => [g.title, g.done, g.total]), [['S1', 2, 3], ['S2', 0, 1]], 'implemented and verified are both done, each once');
  const page = all.slice(2);                         // starts with the third row of S1
  const items = withGroups(page, infos, false);
  assert.deepEqual(items.map((i) => (i.kind === 'group' ? `[${i.group.title} ${i.group.done}/${i.group.total}]` : 'row')), ['[S1 2/3]', 'row', '[S2 0/1]', 'row']);
});

const STRUCTURE: ControlStructure = {
  version: 1,
  families: [{ id: 'M1', name: 'Strategy', objective: 'Set direction.' }],
  subfamilies: [{ id: 'M1.1', family: 'M1', name: 'Context', objective: 'Know the entity.', threats: ['Drift'] }],
};

test('a standard with its own structure gets a family line and a sub-family line, named by the structure, with the standard\'s own words behind them', () => {
  const all = toRows([
    control({ domain_name: 'M1 Strategy', parent_section: 'M1.1', status: 'implemented' }),
    control({ domain_name: 'M1 Strategy', parent_section: 'M1.1', status: 'not_started' }),
    control({ domain_name: 'M1 Strategy', parent_section: 'ZZ', status: 'not_started' }),          // a sub-family the structure does not know
  ], { structure: STRUCTURE });
  const infos = groupInfos(all, STRUCTURE);
  const family = infos.get('0')!;
  assert.deepEqual([family.id, family.title, family.done, family.total], ['M1', 'Strategy', 1, 3]);
  assert.deepEqual(family.fields.map((f) => f.label), ['Objective']);
  const band = infos.get('0|M1.1')!;
  assert.deepEqual([band.level, band.id, band.title, band.done, band.total], [2, 'M1.1', 'Context', 1, 2]);
  assert.deepEqual(band.fields.map((f) => f.label), ['Objective', 'Relevant threats and vulnerabilities']);
  const lines = withGroups(all, infos, true).map((i) => (i.kind === 'group' ? `[${i.group.id || i.group.title}]` : 'row'));
  assert.deepEqual(lines, ['[M1]', '[M1.1]', 'row', 'row', 'row'], 'the requirements under a sub-family the structure does not know follow the section with no line of their own');
});

test('the board: a column per status in the order the work goes; a requirement out of scope has its own first column', () => {
  const rows = toRows([control({ status: 'not_started' }), control({ status: 'implemented' }), control({ status: 'in_progress', is_applicable: false })]);
  const label = (s: string) => s;
  const ids = boardDefs(rows, label).map((c) => c.id);
  assert.deepEqual(ids, ['out', 'not_started', 'in_progress', 'implemented', 'verified', 'other']);
  assert.deepEqual(boardDefs(rows.filter((r) => r.inScope), label).map((c) => c.id), ['not_started', 'in_progress', 'implemented', 'verified', 'other'], 'no out-of-scope column when none is in view');
  const placed = rows.map((r) => boardDefs(rows, label).find((c) => c.test(r))!.id);
  assert.deepEqual(placed, ['not_started', 'implemented', 'out']);
});

test('a bulk action takes what it applies to and says what it left; owners are added or replaced', () => {
  const rows = toRows([control(), control({ is_applicable: false }), control()]);
  assert.deepEqual(bulkPlan('assign', rows), { ids: rows.map((r) => r.id), skipped: 0, why: '' });
  const out = bulkPlan('scope_out', rows);
  assert.deepEqual([out.ids.length, out.skipped, out.why], [2, 1, '1 is already out of scope']);
  const back = bulkPlan('scope_in', rows);
  assert.deepEqual([back.ids.length, back.skipped, back.why], [1, 2, '2 are already in scope']);
  assert.deepEqual(mergeOwners([1, 2], [2, 3], 'add'), [1, 2, 3], 'nobody is taken off');
  assert.deepEqual(mergeOwners([1, 2], [3], 'replace'), [3]);
  assert.deepEqual(mergeOwners([1, 2], [], 'replace'), [], 'nobody chosen withdraws every owner');
  assert.deepEqual(mergeOwners([1], [], 'add'), [1]);
});

test('the summary of a bulk action counts what was done and says what was not', () => {
  const noun = { one: 'requirement', other: 'requirements' };
  assert.deepEqual(bulkSummary('Assigned', noun, { done: 3, failed: 0, skipped: 0 }), { title: 'Assigned 3 requirements' });
  assert.deepEqual(bulkSummary('Asked about', noun, { done: 1, failed: 0, skipped: 2 }, '2 are already out of scope'), { title: 'Asked about 1 requirement', message: '2 are already out of scope.' });
  const failed = bulkSummary('Assigned', noun, { done: 2, failed: 1, skipped: 0 });
  assert.match(failed.message ?? '', /1 could not be changed and stays selected/);
});
