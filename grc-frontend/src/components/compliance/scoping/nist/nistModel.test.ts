import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactsOf, documentsFor, domainsOf, evidenceByArtifact, figuresOf, filterItems, isControl, progressOf, statusTone, statusWord, type NistItem } from './nistModel.ts';

const control = (id: number, label: string, determinations: Array<'satisfied' | 'other_than_satisfied' | 'not_applicable' | null>, status = 'in_progress', domain = 'AC - Access Control'): NistItem => ({
  id, item_number: label, area_domain: domain, subdomain_name: `${label} Account Management`, control_description: `${label} Account Management: a. Define accounts`, compliance_status: status,
  evidence_count: 0, assignees: [], gaps_identified: null, proposed_solution: null,
  assessment_data: {
    kind: '800-53A', control: label, family: label.slice(0, 2), title: 'Account Management', statement: 'a. Define accounts',
    objectives: determinations.map((d, i) => ({ id: `${label}a.[0${i + 1}]`, text: `account types ${i} are defined`, determination: d, note: '' })),
    methods: { EXAMINE: ['Access control policy', 'list of active system accounts'], INTERVIEW: ['Organizational personnel with account management responsibilities'] },
  },
});
const profile = (id: number, current: 'NI' | 'FI' | null, status: string): NistItem => ({
  id, item_number: `GV.OC-0${id}`, area_domain: 'GV - Govern', subdomain_name: 'GV.OC Organizational Context', control_description: 'The mission is understood', compliance_status: status,
  evidence_count: 0, assignees: [], gaps_identified: null, proposed_solution: null,
  assessment_data: { kind: 'CSF2', function: 'GV', function_name: 'GOVERN', category: 'GV.OC', category_title: 'Organizational Context', outcome: 'The mission is understood', examples: [{ id: 'Ex1', text: 'Share the mission' }], current, target: 'FI' },
});

test('how far a control is: the objectives decided, by what they were decided', () => {
  assert.deepEqual(progressOf(control(1, 'AC-01', ['satisfied', 'other_than_satisfied', 'not_applicable', null])), { total: 4, determined: 3, satisfied: 1, other: 1, na: 1 });
  assert.deepEqual(progressOf(profile(1, 'FI', 'complied')), { total: 0, determined: 0, satisfied: 0, other: 0, na: 0 });
});

test('a status goes by NIST\'s own word for a control and by the implementation level for a profile', () => {
  assert.equal(statusWord(control(1, 'AC-01', [null, null])), 'Not started');
  assert.equal(statusWord(control(1, 'AC-01', ['satisfied', null])), 'In progress');
  assert.equal(statusWord(control(1, 'AC-01', ['satisfied', 'satisfied'], 'complied')), 'Satisfied');
  assert.equal(statusWord(control(1, 'AC-01', ['other_than_satisfied'], 'not_complied')), 'Other than satisfied');
  assert.equal(statusWord(control(1, 'AC-01', ['not_applicable'], 'na')), 'Not applicable');
  assert.equal(statusWord(profile(1, null, 'in_progress')), 'Not rated');
  assert.equal(statusWord(profile(1, 'NI', 'not_complied')), 'Not implemented');
  assert.deepEqual(['complied', 'not_complied', 'partially_complied', 'na'].map((s) => statusTone(control(1, 'AC-01', [null], s))), ['success', 'danger', 'warning', 'neutral']);
  assert.equal(statusTone(control(1, 'AC-01', [null, null])), 'pending');
  assert.equal(statusTone(control(1, 'AC-01', ['satisfied', null])), 'progress');
});

test('a search reads the control, its title, its objectives and a profile\'s examples; the filters narrow by domain and status', () => {
  const items = [control(1, 'AC-01', [null], 'in_progress'), control(2, 'AU-02', ['satisfied'], 'complied', 'AU - Audit and Accountability'), profile(3, 'NI', 'not_complied')];
  const ids = (f: Partial<{ text: string; domain: string; status: 'all' | 'open' | 'complied' | 'not_complied' | 'partially_complied' | 'na' }>) => filterItems(items, { text: '', domain: '', status: 'all', ...f }).map((i) => i.id);
  assert.deepEqual(ids({}), [1, 2, 3]);
  assert.deepEqual(ids({ text: ' au-02 ' }), [2]);
  assert.deepEqual(ids({ text: 'share the mission' }), [3]);
  assert.deepEqual(ids({ text: 'account types 0' }), [1, 2]);
  assert.deepEqual(ids({ domain: 'AU - Audit and Accountability' }), [2]);
  assert.deepEqual(ids({ status: 'open' }), [1]);
  assert.deepEqual(ids({ status: 'not_complied' }), [3]);
  assert.deepEqual(ids({ text: 'nothing like this' }), []);
});

test('the domains say how many items each holds and how many have a finding', () => {
  const items = [control(1, 'AC-01', [null]), control(2, 'AC-02', ['satisfied'], 'complied'), control(3, 'AU-02', [null], 'in_progress', 'AU - Audit and Accountability')];
  assert.deepEqual(domainsOf(items), [{ name: 'AC - Access Control', total: 2, done: 1 }, { name: 'AU - Audit and Accountability', total: 1, done: 0 }]);
});

test('the header figures count every item once, not applicable as decided, and an empty list is not 0%', () => {
  const items = [control(1, 'AC-01', ['satisfied'], 'complied'), control(2, 'AC-02', ['other_than_satisfied'], 'not_complied'), control(3, 'AC-03', ['not_applicable'], 'na'), control(4, 'AC-04', [null]), profile(5, 'FI', 'partially_complied')];
  assert.deepEqual(figuresOf(items), { total: 5, complied: 1, partial: 1, notComplied: 1, inProgress: 1, na: 1, decided: 4, percent: 80 });
  assert.equal(figuresOf([]).percent, null);
});

test('a control names its artifacts by method, and a profile by its examples, each with the key evidence is filed under', () => {
  const a = artifactsOf(control(1, 'AC-01', [null]));
  assert.deepEqual(a.map((x) => [x.method, x.text]), [['EXAMINE', 'Access control policy'], ['EXAMINE', 'list of active system accounts'], ['INTERVIEW', 'Organizational personnel with account management responsibilities']]);
  assert.equal(a[0].key, 'EXAMINE | Access control policy');
  const long = control(1, 'AC-01', [null]);
  assert.ok(isControl(long.assessment_data));
  long.assessment_data.methods = { EXAMINE: ['x'.repeat(400)] };
  assert.equal(artifactsOf(long)[0].key.length, 300);                                                       // the key is what is stored on the evidence link: at most 300 characters
  assert.deepEqual(artifactsOf(profile(1, null, 'in_progress')).map((x) => x.key), ['Ex1 | Share the mission']);
  assert.deepEqual(artifactsOf({ assessment_data: null }), []);
});

test('an assessment is offered the publications that serve it (official templates first) and the catalog documents of its own framework', () => {
  const pub = (id: string, serves: string[], templates: number) => ({ id, serves, templates: Array.from({ length: templates }, (_, i) => ({ name: `t${i}` })) });
  const doc = (framework_key: string, artifact_id: string) => ({ framework_key, artifact_id });
  const lib = {
    publications: [pub('SP800-53', ['nist_800_53a', 'nist_csf2'], 1), pub('SP800-61', ['nist_csf2'], 0), pub('SP800-18', ['nist_800_53a'], 4), pub('SP800-163', ['mobile_app_security'], 0), pub('SP800-53A', ['nist_800_53a'], 0)],
    catalog: [doc('nist_sp_800_53_r5', 'a'), doc('nist_csf_2', 'b'), doc('nist_ai_rmf', 'c'), doc('nist_sp_800_53_r5', 'd')],
  };
  const control800 = documentsFor('nist_800_53a', lib);
  assert.deepEqual(control800.publications.map((p) => p.id), ['SP800-53', 'SP800-18', 'SP800-53A']);               // templates first (stable: the library's order within each group)
  assert.deepEqual(control800.catalog.map((d) => d.artifact_id), ['a', 'd']);                                       // only SP 800-53 documents; not CSF, not the AI RMF
  assert.deepEqual(documentsFor('nist_csf2', lib).catalog.map((d) => d.artifact_id), ['b']);
  assert.deepEqual(documentsFor('nist_csf2', lib).publications.map((p) => p.id), ['SP800-53', 'SP800-61']);
  assert.deepEqual(documentsFor('asvs_checklist', lib), { publications: [], catalog: [] });                         // not a NIST assessment: nothing from here
  assert.deepEqual(documentsFor('nist_csf2', undefined), { publications: [], catalog: [] });                        // the library has not loaded
});

test('evidence is grouped by the artifact it answers, the rest answers the control as a whole', () => {
  const rows = [{ id: 1, evidence_id: 1, evidence_name: 'Policy', evidence_file_name: 'p.pdf', artifact: 'EXAMINE | Access control policy' }, { id: 2, evidence_id: 2, evidence_name: 'Scan', evidence_file_name: 's.txt', artifact: null },
    { id: 3, evidence_id: 3, evidence_name: 'Policy v2', evidence_file_name: 'p2.pdf', artifact: 'EXAMINE | Access control policy' }];
  const g = evidenceByArtifact(rows);
  assert.deepEqual(g.whole.map((r) => r.id), [2]);
  assert.deepEqual(g.by['EXAMINE | Access control policy'].map((r) => r.id), [1, 3]);
});
