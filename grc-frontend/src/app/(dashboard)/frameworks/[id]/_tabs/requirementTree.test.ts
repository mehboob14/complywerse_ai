// node --test "src/app/(dashboard)/frameworks/**/*.test.ts"      ([id] in a path is a glob class: name the folder with **)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CertificationControl, ControlStructure, EvidenceRequirement, SubControlNode } from '../../../../../types/index.ts';
import {
  OTHER_BAND_NAME, applicabilityTip, buildTree, controlEvidenceOf, defaultLayer, evidenceChips, evidenceOf, focusLayer, initialState, isMet, isOpen,
  isTickable, isTier, keyOf, leadInGroups, locate, parseLayer, placeCatalog, priorityTip, progress, setAll, statusOf, subControlsOf, toggled,
  totalProgress, treeControls, type OpenState,
} from './requirementTree.ts';

let n = 0;
const ctl = (over: Partial<CertificationControl> = {}): CertificationControl => {
  n += 1;
  return {
    id: n, control_code: `M1.1.${n}`, control_name: `Control ${n}`, status: 'not_started', domain_name: 'M1 Strategy and Planning', parent_section: 'M1.1',
    criteria_status: {}, sub_control_tree: null, ...over,
  } as unknown as CertificationControl;
};
const sub = (over: Partial<SubControlNode> = {}): SubControlNode => ({
  code: 'M1.1.1.1', number: 1, text: 'The entity shall do it.', lead_in: null, criterion_index: 0, met: false, consideration: false, points: [], evidence: [],
  ...over,
});

// a core family with two sub-families, a second core family, an annex family whose sub-family has only an id and a name
const STRUCTURE: ControlStructure = {
  version: 1,
  families: [
    {
      id: 'M1', name: 'Strategy and Planning', kind: 'Management',
      objective: 'To provide suitable organizational environment, leadership, and support for information security.',
      performance_indicators: ['Percentage of security initiatives approved by leadership that have been successfully executed.'],
    },
    { id: 'M2', name: 'Information Security Risk Management', kind: 'Management', objective: 'To manage risk.', performance_indicators: ['Risks treated.'] },
    { id: 'E1', name: 'National Cloud Security Policy', kind: 'Annex E' },
  ],
  subfamilies: [
    {
      id: 'M1.1', family: 'M1', name: 'Entity Context and Leadership', objective: 'To establish leadership and a management framework.',
      performance_indicators: ['Percentage of tasks completed.'], automation_guidance: 'Not applicable', threats: ['Insufficient resources'],
    },
    { id: 'M1.2', family: 'M1', name: 'Planning', objective: 'To plan.', performance_indicators: ['Plans approved.'], automation_guidance: 'Not applicable', threats: ['No plan'] },
    { id: 'M2.1', family: 'M2', name: 'Risk Assessment', objective: 'To assess.', performance_indicators: ['Assessments done.'], automation_guidance: 'Not applicable', threats: ['Unknown risk'] },
    { id: 'E1-2.1', family: 'E1', name: 'Cloud Governance' },
  ],
};

// ── the tree ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('controls are grouped by the sub-family of their parent_section, in the order the page gave, with the standard\'s names', () => {
  const a = ctl({ parent_section: 'M1.1', status: 'implemented' });
  const b = ctl({ parent_section: 'M1.2', status: 'verified' });
  const c = ctl({ parent_section: 'M1.1', status: 'in_progress' });
  const d = ctl({ parent_section: 'M1.2', status: 'not_applicable' });
  const [family] = buildTree([{ key: 'dom:m1', label: 'M1 Strategy and Planning', controls: [a, b, c, d] }], STRUCTURE);

  assert.equal(family.id, 'M1');
  assert.equal(family.title, 'Strategy and Planning');             // the id is drawn in the circle
  assert.equal(family.info?.objective, STRUCTURE.families[0].objective);
  assert.deepEqual(family.bands.map((x) => [x.id, x.name]), [['M1.1', 'Entity Context and Leadership'], ['M1.2', 'Planning']]);
  assert.deepEqual(family.bands.map((x) => x.controls.map((k) => k.id)), [[a.id, c.id], [b.id, d.id]]);
  assert.equal(family.bands[0].info?.automation_guidance, 'Not applicable');
});

test('compliant means implemented or verified, per sub-family and per family; in progress and not applicable are not', () => {
  const [family] = buildTree([{
    key: 'k', label: 'M1 Strategy and Planning',
    controls: [
      ctl({ status: 'implemented' }), ctl({ status: 'verified', parent_section: 'M1.2' }), ctl({ status: 'in_progress' }),
      ctl({ status: 'not_applicable', parent_section: 'M1.2' }), ctl({ status: 'not_started' }),
    ],
  }], STRUCTURE);
  assert.deepEqual(family.bands.map((x) => [x.compliant, x.total]), [[1, 3], [1, 2]]);
  assert.deepEqual([family.compliant, family.total], [2, 5]);
});

test('a family the structure does not know keeps its place and its whole label; the structure does not reorder anything', () => {
  const tree = buildTree(
    [
      { key: 'k2', label: 'M2 Information Security Risk Management', controls: [ctl({ parent_section: 'M2.1' })] },
      { key: 'kx', label: 'Z9 Something New', controls: [ctl({ parent_section: 'Z9.1' })] },
      { key: 'k1', label: 'M1 Strategy and Planning', controls: [ctl()] },
    ],
    STRUCTURE,
  );
  assert.deepEqual(tree.map((f) => f.key), ['k2', 'kx', 'k1']);
  assert.deepEqual(tree.map((f) => f.id), ['M2', null, 'M1']);
  assert.equal(tree[1].title, 'Z9 Something New');
  assert.equal(tree[1].info, null);
});

test('a control whose sub-family the structure does not know goes to an "Other" band after the known ones', () => {
  const stray = ctl({ parent_section: 'M9.9' });
  const none = ctl({ parent_section: null });
  const known = ctl({ parent_section: 'M1.2' });
  const [family] = buildTree([{ key: 'k', label: 'M1 Strategy and Planning', controls: [stray, known, none] }], STRUCTURE);
  assert.deepEqual(family.bands.map((b) => b.name), ['Planning', OTHER_BAND_NAME]);
  assert.deepEqual(family.bands[1].controls.map((c) => c.id), [stray.id, none.id]);
  assert.equal(family.bands[1].info, null);
  assert.equal(family.bands[1].id, '');
});

test('an annex family and its sub-family carry only an id and a name', () => {
  const [family] = buildTree(
    [{ key: 'e1', label: 'E1 National Cloud Security Policy (Annex E)', controls: [ctl({ parent_section: 'E1-2.1', domain_name: 'E1 National Cloud Security Policy (Annex E)' })] }],
    STRUCTURE,
  );
  assert.equal(family.id, 'E1');
  assert.equal(family.title, 'National Cloud Security Policy (Annex E)');
  assert.equal(family.info?.objective, undefined);
  assert.equal(family.bands[0].name, 'Cloud Governance');
  assert.equal(family.bands[0].info?.objective, undefined);
  assert.equal(family.bands[0].info?.threats, undefined);
});

test('no structure at all still gives one band per sub-family-less family (everything under "Other")', () => {
  const [family] = buildTree([{ key: 'k', label: 'M1 Strategy and Planning', controls: [ctl(), ctl()] }], null);
  assert.equal(family.id, null);
  assert.equal(family.title, 'M1 Strategy and Planning');
  assert.deepEqual(family.bands.map((b) => [b.name, b.total]), [[OTHER_BAND_NAME, 2]]);
});

test('treeControls lists the controls in order and locate finds where one sits', () => {
  const a = ctl({ parent_section: 'M1.2' });
  const b = ctl({ parent_section: 'M1.1' });
  const tree = buildTree([{ key: 'k', label: 'M1 Strategy and Planning', controls: [a, b] }], STRUCTURE);
  assert.deepEqual(treeControls(tree).map((c) => c.id), [a.id, b.id]);
  assert.equal(locate(tree, b.id)?.band.id, 'M1.1');
  assert.equal(locate(tree, b.id)?.family.key, 'k');
  assert.equal(locate(tree, 123456), null);
});

// ── open and closed ─────────────────────────────────────────────────────────────────────────────────────────────────────

const TWO = () => {
  const done = ctl({ status: 'implemented', parent_section: 'M1.1' });
  const todo = ctl({ status: 'not_started', parent_section: 'M2.1', domain_name: 'M2 Information Security Risk Management' });
  const todo2 = ctl({ status: 'not_started', parent_section: 'E1-2.1', domain_name: 'E1 National Cloud Security Policy (Annex E)' });
  const tree = buildTree(
    [
      { key: 'm1', label: 'M1 Strategy and Planning', controls: [done] },
      { key: 'm2', label: 'M2 Information Security Risk Management', controls: [todo] },
      { key: 'e1', label: 'E1 National Cloud Security Policy (Annex E)', controls: [todo2] },
    ],
    STRUCTURE,
  );
  return { done, todo, todo2, tree };
};

test('on arrival only the first section with something still to do is open', () => {
  const { tree } = TWO();
  assert.deepEqual(defaultLayer(tree), { [keyOf('f', 'm2')]: true });
  const allDone = buildTree([{ key: 'm1', label: 'M1 Strategy and Planning', controls: [ctl({ status: 'verified' })] }], STRUCTURE);
  assert.deepEqual(defaultLayer(allDone), {});
  assert.deepEqual(defaultLayer([]), {});
});

test('the section and sub-family of a deep-linked control are opened as well', () => {
  const { tree, todo2 } = TWO();
  assert.deepEqual(focusLayer(tree, todo2.id), { 'f:e1': true, 'b:e1|E1-2.1': true });
  assert.deepEqual(focusLayer(tree, null), {});
  assert.deepEqual(focusLayer(tree, 99999), {});
  const state = initialState(tree, null, todo2.id);
  assert.equal(isOpen(state, false, 'f', 'm2'), true);       // the default
  assert.equal(isOpen(state, false, 'f', 'e1'), true);       // the deep link
  assert.equal(isOpen(state, false, 'f', 'm1'), false);
});

test('what the session kept replaces the default, but not the deep-linked place', () => {
  const { tree, todo2 } = TWO();
  const state = initialState(tree, { 'f:m1': true, 'f:m2': false, 'c:7': true }, todo2.id);
  assert.equal(isOpen(state, false, 'f', 'm1'), true);
  assert.equal(isOpen(state, false, 'f', 'm2'), false);
  assert.equal(isOpen(state, false, 'f', 'e1'), true);
  assert.equal(isOpen(state, false, 'c', 7), true);
  assert.deepEqual(state.filtered, {});
});

test('sections start closed, sub-families open, controls closed; a click flips only that one', () => {
  const state: OpenState = { normal: {}, filtered: {} };
  assert.equal(isOpen(state, false, 'f', 'm1'), false);
  assert.equal(isOpen(state, false, 'b', 'm1|M1.1'), true);
  assert.equal(isOpen(state, false, 'c', 5), false);
  const next = toggled(toggled(toggled(state, false, 'f', 'm1'), false, 'b', 'm1|M1.1'), false, 'c', 5);
  assert.deepEqual(next.normal, { 'f:m1': true, 'b:m1|M1.1': false, 'c:5': true });
  assert.deepEqual(next.filtered, {});
  assert.deepEqual(state.normal, {});                         // nothing is changed in place
});

test('while a search or filter is on everything found is open; clicks then go to a layer that is thrown away, controls stay in the kept one', () => {
  let state: OpenState = { normal: { 'f:m1': false }, filtered: {} };
  assert.equal(isOpen(state, true, 'f', 'm1'), true);         // the kept layer says closed; the filter shows it anyway
  assert.equal(isOpen(state, true, 'b', 'm1|M1.1'), true);
  state = toggled(state, true, 'f', 'm1');
  assert.equal(isOpen(state, true, 'f', 'm1'), false);
  assert.equal(isOpen(state, false, 'f', 'm1'), false);       // the kept layer was not touched...
  assert.deepEqual(state.normal, { 'f:m1': false });
  assert.deepEqual(state.filtered, { 'f:m1': false });
  state = toggled(state, true, 'c', 9);
  assert.deepEqual(state.normal, { 'f:m1': false, 'c:9': true });
  assert.equal(isOpen(state, true, 'c', 9), true);
});

test('Expand all opens every section and sub-family and leaves the controls; Collapse all closes them all, controls too', () => {
  const { tree } = TWO();
  const start: OpenState = { normal: { 'c:3': true, 'f:m1': true }, filtered: {} };
  const open = setAll(start, false, tree, true);
  assert.equal(isOpen(open, false, 'f', 'e1'), true);
  assert.equal(isOpen(open, false, 'b', 'e1|E1-2.1'), true);
  assert.equal(isOpen(open, false, 'c', 3), true);
  const shut = setAll(open, false, tree, false);
  assert.equal(isOpen(shut, false, 'f', 'm1'), false);
  assert.equal(isOpen(shut, false, 'b', 'm2|M2.1'), false);
  assert.equal(isOpen(shut, false, 'c', 3), false);
  assert.deepEqual(start.normal, { 'c:3': true, 'f:m1': true });
});

test('Expand all and Collapse all during a search change the temporary layer, not the kept one (but still close the controls)', () => {
  const { tree } = TWO();
  const start: OpenState = { normal: { 'f:m1': true, 'c:3': true }, filtered: {} };
  const shut = setAll(start, true, tree, false);
  assert.equal(isOpen(shut, true, 'f', 'm1'), false);
  assert.equal(isOpen(shut, false, 'f', 'm1'), true);
  assert.equal(isOpen(shut, false, 'c', 3), false);
  const open = setAll(shut, true, tree, true);
  assert.equal(isOpen(open, true, 'f', 'm1'), true);
});

test('what sessionStorage gives back is trusted only when it is a layer of booleans under the three kinds of key', () => {
  assert.deepEqual(parseLayer('{"f:a":true,"b:a|M1.1":false,"c:4":true}'), { 'f:a': true, 'b:a|M1.1': false, 'c:4': true });
  assert.deepEqual(parseLayer('{"f:a":true,"x:a":true,"c:4":"yes","f:b":1}'), { 'f:a': true });
  assert.equal(parseLayer(null), null);
  assert.equal(parseLayer(''), null);
  assert.equal(parseLayer('not json'), null);
  assert.equal(parseLayer('[true]'), null);
  assert.equal(parseLayer('"x"'), null);
  assert.equal(parseLayer('null'), null);
});

// ── sub-controls ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('sub-controls come in the standard\'s order, a control without a tree has none, and the tree is not changed', () => {
  const tree = [sub({ code: 'M1.1.1.2', number: 2 }), sub({ code: 'M1.1.1.1', number: 1 }), sub({ code: 'M1.1.1.10', number: 10 }), sub({ code: 'M1.1.1.3', number: 3 })];
  const control = ctl({ sub_control_tree: tree });
  assert.deepEqual(subControlsOf(control).map((s) => s.number), [1, 2, 3, 10]);
  assert.deepEqual(tree.map((s) => s.number), [2, 1, 10, 3]);
  assert.deepEqual(subControlsOf(ctl()), []);
  assert.deepEqual(subControlsOf(ctl({ sub_control_tree: [] })), []);
});

test('a sub-control is met by the ticks given; without ticks by what the server computed; a line to consider is never met', () => {
  const tick = sub({ criterion_index: 1, met: false });
  assert.equal(isMet(tick, { '1': true }), true);
  assert.equal(isMet(tick, { '0': true }), false);
  assert.equal(isMet(tick, {}), false);
  assert.equal(isMet({ criterion_index: 1, met: true }, null), true);
  assert.equal(isMet({ criterion_index: 1, met: true }, undefined), true);
  assert.equal(isMet({ criterion_index: 1, met: false }, undefined), false);
  assert.equal(isMet({ criterion_index: null, met: null }, { '0': true }), false);
  assert.equal(isTickable(sub({ criterion_index: 0 })), true);                  // index 0 is a criterion
  assert.equal(isTickable(sub({ criterion_index: null })), false);
});

test('the ticks a control shows are the local override first, then the server\'s', () => {
  const control = ctl({ criteria_status: { '0': true } });
  assert.deepEqual(statusOf(control, {}), { '0': true });
  assert.deepEqual(statusOf(control, { [control.id]: { '1': true } }), { '1': true });
  assert.deepEqual(statusOf(control, { [control.id]: {} }), {});                // an override that unticked everything wins
  assert.equal(statusOf({ id: 1, criteria_status: undefined }, {}), null);
});

test('progress counts the tickable sub-controls only, and totals add the controls up', () => {
  const considerations = [sub({ code: 'E.1', number: 1, criterion_index: null, consideration: true }), sub({ code: 'E.2', number: 2, criterion_index: 0 }), sub({ code: 'E.3', number: 3, criterion_index: 1 })];
  const annex = ctl({ sub_control_tree: considerations, criteria_status: { '1': true } });
  const core = ctl({ sub_control_tree: [sub({ number: 1, criterion_index: 0 }), sub({ number: 2, criterion_index: 1 }), sub({ number: 3, criterion_index: 2 })], criteria_status: { '0': true, '2': true } });
  const none = ctl();
  assert.deepEqual(progress(annex, annex.criteria_status), { met: 1, total: 2 });
  assert.deepEqual(progress(core, core.criteria_status), { met: 2, total: 3 });
  assert.deepEqual(progress(none, none.criteria_status), { met: 0, total: 0 });
  assert.deepEqual(totalProgress([annex, core, none], {}), { met: 3, total: 5 });
  assert.deepEqual(totalProgress([annex, core, none], { [core.id]: { '0': true, '1': true, '2': true } }), { met: 4, total: 5 });
});

// ── lead-ins ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LEAD = 'The entity shall determine:';
const shared = (i: number, rest: string, over: Partial<SubControlNode> = {}) =>
  sub({ code: `M1.1.1.${i}`, number: i, criterion_index: i - 1, lead_in: LEAD, text: `${LEAD} ${rest}`, ...over });

test('when every sub-control begins with the same lead-in it is shown once and each row keeps what follows it', () => {
  const groups = leadInGroups([shared(1, 'interested parties.'), shared(2, 'their requirements.'), shared(3, 'their needs.')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].leadIn, LEAD);
  assert.deepEqual(groups[0].rows.map((r) => r.text), ['interested parties.', 'their requirements.', 'their needs.']);
});

test('a control that mixes a sentence of its own with lines under a lead-in (annex E) reads in order: the sentence, then the lead-in once', () => {
  const take = 'When defining the policy the customer shall take the following into account:';
  const groups = leadInGroups([
    sub({ code: 'E1-2.1.1.1', number: 1, text: 'The entity shall establish a policy.', lead_in: null }),
    sub({ code: 'E1-2.1.1.2', number: 2, text: `${take} data can be accessed by the provider.`, lead_in: take, criterion_index: null, consideration: true }),
    sub({ code: 'E1-2.1.1.3', number: 3, text: `${take} assets can be kept in the cloud.`, lead_in: take, criterion_index: null, consideration: true }),
  ]);
  assert.deepEqual(groups.map((g) => g.leadIn), [null, take]);
  assert.deepEqual(groups[0].rows.map((r) => r.text), ['The entity shall establish a policy.']);
  assert.deepEqual(groups[1].rows.map((r) => r.text), ['data can be accessed by the provider.', 'assets can be kept in the cloud.']);
});

test('a sub-control that stands alone keeps its whole sentence, and neighbours without a lead-in share one list', () => {
  const groups = leadInGroups([
    sub({ number: 1, text: 'One.', lead_in: null }),
    sub({ number: 2, text: 'Two.', lead_in: null }),
    shared(3, 'only one under this lead-in.'),
    sub({ number: 4, text: 'Four.', lead_in: null }),
  ]);
  assert.deepEqual(groups.map((g) => g.leadIn), [null]);
  assert.deepEqual(groups[0].rows.map((r) => r.text), ['One.', 'Two.', `${LEAD} only one under this lead-in.`, 'Four.']);
});

test('two different lead-ins in a row make two groups', () => {
  const other = 'The entity shall ensure:';
  const groups = leadInGroups([
    shared(1, 'a.'), shared(2, 'b.'),
    sub({ number: 3, lead_in: other, text: `${other} c.` }), sub({ number: 4, lead_in: other, text: 'A sentence that does not start with it.' }),
  ]);
  assert.deepEqual(groups.map((g) => g.leadIn), [LEAD, other]);
  assert.deepEqual(groups[1].rows.map((r) => r.text), ['c.', 'A sentence that does not start with it.']);
  assert.deepEqual(leadInGroups([]), []);
});

test('should the data keep a lead-in apart from the text, the rows read the same', () => {
  const groups = leadInGroups([
    sub({ number: 1, lead_in: LEAD, text: 'interested parties.' }),
    sub({ number: 2, lead_in: LEAD, text: 'their requirements.' }),
    sub({ number: 3, lead_in: 'The entity shall ensure:', text: 'a lone one.' }),
  ]);
  assert.deepEqual(groups.map((g) => g.leadIn), [LEAD, null]);
  assert.deepEqual(groups[0].rows.map((r) => r.text), ['interested parties.', 'their requirements.']);
  assert.deepEqual(groups[1].rows.map((r) => r.text), ['The entity shall ensure: a lone one.']);
});

test('a sub-control whose text is only the lead-in keeps it (nothing to strip down to)', () => {
  const groups = leadInGroups([shared(1, '', { text: LEAD }), shared(2, 'b.')]);
  assert.deepEqual(groups[0].rows.map((r) => r.text), [LEAD, 'b.']);
});

// ── evidence and artifacts ──────────────────────────────────────────────────────────────────────────────────────────────

const req = (title: string, over: Partial<EvidenceRequirement> = {}): EvidenceRequirement => ({ type: 'document', title, description: `About ${title}`, ...over });

test('evidence chips carry the file type of the recommendation of the same name, or the name alone', () => {
  const chips = evidenceChips(
    ['Interested parties register', 'requirements of interested parties', 'Board minutes'],
    [req('Interested parties register', { filetype: 'xlsx' }), req('Requirements of interested parties', { format: 'docx' }), req('Other thing', { filetype: 'PDF' })],
  );
  assert.deepEqual(chips.map((c) => [c.name, c.filetype]), [['Interested parties register', 'XLSX'], ['requirements of interested parties', 'DOCX'], ['Board minutes', null]]);
  assert.equal(chips[0].description, 'About Interested parties register');
  assert.equal(chips[2].description, null);
});

test('evidence chips drop repeats and empty names and cope with nothing', () => {
  assert.deepEqual(evidenceChips(['A', 'a', '', 'B'], []).map((c) => c.name), ['A', 'B']);
  assert.deepEqual(evidenceChips(null, null), []);
  assert.deepEqual(evidenceChips([], [req('X')]), []);                          // names decide; a recommendation nobody names is not shown
});

test('a sub-control\'s evidence is its titles looked up in the control\'s own recommendations; a title the control lacks stays as the bare title', () => {
  const control = ctl({
    evidence_requirements: [req('Interested parties register', { filetype: 'xlsx' }), req('Requirements of interested parties', { format: 'docx' })],
  });
  // the node carries titles only: no evidence_requirements of its own (the sub-control tree does not repeat the control's list)
  const node = sub({ evidence: ['interested parties register', 'Requirements of interested parties', 'Board minutes'] });
  assert.equal('evidence_requirements' in node, false);
  assert.deepEqual(evidenceOf(control, node).map((c) => [c.name, c.filetype]), [
    ['interested parties register', 'XLSX'], ['Requirements of interested parties', 'DOCX'], ['Board minutes', null],
  ]);
  assert.equal(evidenceOf(control, node)[2].description, null);
  assert.deepEqual(evidenceOf(control, sub({ evidence: [] })), []);
  assert.deepEqual(evidenceOf(ctl({ evidence_requirements: undefined }), sub({ evidence: ['A'] })).map((c) => [c.name, c.filetype]), [['A', null]]);
});

test('the evidence of the control as a whole: what covers none of its sub-controls; for a control without sub-controls, all of it', () => {
  const reqs = [req('Policy approval', { filetype: 'pdf' }), req('Interested parties register', { filetype: 'xlsx' })];
  const withTree = ctl({ sub_control_tree: [sub()], control_evidence: ['Policy approval'], evidence_requirements: reqs });
  assert.deepEqual(controlEvidenceOf(withTree).map((c) => [c.name, c.filetype]), [['Policy approval', 'PDF']]);
  const treeButNothingOwn = ctl({ sub_control_tree: [sub()], control_evidence: [], evidence_requirements: reqs });
  assert.deepEqual(controlEvidenceOf(treeButNothingOwn), []);                    // every item covers a sub-control: nothing at control level

  const mapping = ctl({ sub_control_tree: null, control_evidence: [], evidence_requirements: reqs });          // an annex F row asked without control_evidence
  assert.deepEqual(controlEvidenceOf(mapping).map((c) => c.name), ['Policy approval', 'Interested parties register']);
  const mappingNamed = ctl({ sub_control_tree: [], control_evidence: ['Interested parties register'], evidence_requirements: reqs });
  assert.deepEqual(controlEvidenceOf(mappingNamed).map((c) => [c.name, c.filetype]), [['Interested parties register', 'XLSX']]);
  assert.deepEqual(controlEvidenceOf(ctl({ evidence_requirements: undefined })), []);
});

test('an annex sub-control with no criterion (a row with fewer than two shall-obligations) is not a consideration but still has no tick, and is not counted', () => {
  const lone = sub({ code: 'E2-2.1.1', number: 1, criterion_index: null, consideration: false, met: null });
  const control = ctl({ sub_control_tree: [lone], criteria_status: { '0': true } });       // a stray tick under index 0 changes nothing
  assert.equal(isTickable(lone), false);
  assert.equal(isMet(lone, control.criteria_status), false);
  assert.deepEqual(progress(control, control.criteria_status), { met: 0, total: 0 });
  assert.deepEqual(totalProgress([control], {}), { met: 0, total: 0 });
});

type Item = { id: number; name: string; sub_controls?: string[] | null };
test('an artifact sits under every sub-control it names; one that names none of this control\'s belongs to the control', () => {
  const items: Item[] = [
    { id: 1, name: 'Register', sub_controls: ['M1.1.1.1', 'M1.1.1.2'] },
    { id: 2, name: 'Policy', sub_controls: ['M1.1.1.2'] },
    { id: 3, name: 'Approval', sub_controls: [] },
    { id: 4, name: 'Matched by another control', sub_controls: ['M1.1.2.1'] },
    { id: 5, name: 'Old payload' },
    { id: 6, name: 'Null payload', sub_controls: null },
    { id: 7, name: 'Repeats', sub_controls: ['M1.1.1.1', 'M1.1.1.1'] },
  ];
  const { byCode, controlLevel } = placeCatalog(items, ['M1.1.1.1', 'M1.1.1.2', 'M1.1.1.3']);
  assert.deepEqual(byCode['M1.1.1.1'].map((i) => i.id), [1, 7]);
  assert.deepEqual(byCode['M1.1.1.2'].map((i) => i.id), [1, 2]);
  assert.equal(byCode['M1.1.1.3'], undefined);
  assert.deepEqual(controlLevel.map((i) => i.id), [3, 4, 5, 6]);
  assert.deepEqual(placeCatalog([], ['M1.1.1.1']), { byCode: {}, controlLevel: [] });
});

test('a code is matched whole: M1.1.1 is not M1.1.1.1', () => {
  const { byCode, controlLevel } = placeCatalog([{ id: 1, sub_controls: ['M1.1.1.1'] }], ['M1.1.1', 'M1.1.1.10']);
  assert.deepEqual(byCode, {});
  assert.equal(controlLevel.length, 1);
});

// ── words ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the priority and applicability wordings', () => {
  assert.equal(priorityTip('P1'), 'Implementation priority P1 of 4 — the order the standard suggests for planning, not a measure of criticality');
  assert.equal(applicabilityTip('Always applicable'), 'Applies to every entity');
  assert.equal(applicabilityTip('Based on risk assessment'), "Applies unless the entity's risk assessment justifies leaving it out");
  assert.equal(applicabilityTip('Applicable to IaaS, PaaS and SaaS'), 'Applicable to IaaS, PaaS and SaaS');   // an annex wording explains itself
  assert.deepEqual(['P1', 'P4', 'P0', 'P5', 'p1', '', null, undefined].map(isTier), [true, true, false, false, false, false, false, false]);
});
