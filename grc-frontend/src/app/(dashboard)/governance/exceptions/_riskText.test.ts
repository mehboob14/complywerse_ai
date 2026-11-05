// node --test "src/app/(dashboard)/governance/exceptions/_riskText.test.ts"
// What the exception details say about potential risks, compensating controls and assets (D62): ratings in the register's bands, the organisation's own names for
// the levels, the risks by round and step, what a control covers (by title and name, never by number), the drafts of the forms, and the question before "Mark
// implemented". The shapes are what exception_risks, exception_controls and exception_assets send.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addedLine, assessmentWord, assetNameMap, byLine, controlDue, controlFormTouched, controlInput, controlWord, coverNames, coverableRisks, currentRound, draftOfRisk, emptyControlForm,
  emptyRiskDraft, foundNoneLine, formOfControl, groupRisks, levelOptions, levelPill, levelsLine, myAssessment, ratingOf, riskDraftTouched, riskInput, riskTitleMap, roundLabel,
  answerWords, uncoveredQuestion, withChosen,
} from './_riskText.ts';
import type { CompensatingControl, PotentialRisk } from './_types.ts';

const risk = (over: Partial<PotentialRisk> = {}): PotentialRisk => ({
  id: 1, round: 1, step_position: 1, step_name: 'Review', step_kind: 'review', recorded_by: { id: 5, name: 'Sara' }, title: 'The shared password leaks', description: null,
  likelihood: 3, impact: 5, score: 15, rating: 'high', rating_label: 'High', likelihood_label: null, impact_label: null, none_identified: false, register_risk_id: null, source: 'manual',
  created_at: '2026-11-04T10:00:00', mine: false, can_edit: false, ...over,
});
const none = (over: Partial<PotentialRisk> = {}) => risk({ title: null, likelihood: null, impact: null, score: null, rating: null, rating_label: null, none_identified: true, ...over });
const control = (over: Partial<CompensatingControl> = {}): CompensatingControl => ({
  id: 4, title: 'Encrypted drives only', description: 'Issued by the helpdesk.', risk_ids: [1, 2], asset_ids: [10], owner: { id: 7, name: 'Chen' }, due_date: '2026-11-19T00:00:00', status: 'planned',
  evidence: [{ kind: 'link', url: 'https://intranet.test/video', label: 'Video page' }, { kind: 'evidence', evidence_id: 3, label: 'Penetration test summary' }],
  created_by: { id: 7, name: 'Chen' }, source: 'manual', created_at: '2026-11-10T10:00:00', can_edit: true, ...over,
});

test('the rating is the register\'s own: 20 and over critical, 12 high, 6 medium, below that low; nothing until both levels are set', () => {
  assert.equal(ratingOf(5, 4), 'critical');
  assert.equal(ratingOf(4, 5), 'critical');
  assert.equal(ratingOf(4, 4), 'high');
  assert.equal(ratingOf(3, 4), 'high');
  assert.equal(ratingOf(3, 3), 'medium');
  assert.equal(ratingOf(2, 3), 'medium');
  assert.equal(ratingOf(2, 2), 'low');
  assert.equal(ratingOf(1, 1), 'low');
  assert.equal(ratingOf(null, 4), null);
  assert.equal(ratingOf(3, undefined), null);
});

test('a rating or a criticality is a pill in the priority tones, in the server\'s word when it sent one; nothing without a word', () => {
  assert.deepEqual(levelPill('critical'), { tone: 'danger', label: 'Critical' });
  assert.deepEqual(levelPill('high', 'High'), { tone: 'warning', label: 'High' });
  assert.deepEqual(levelPill('medium'), { tone: 'progress', label: 'Medium' });
  assert.deepEqual(levelPill('low'), { tone: 'neutral', label: 'Low' });
  assert.equal(levelPill(null), null);
  assert.equal(levelPill(undefined), null);
  assert.equal(levelPill(''), null);
});

test('likelihood and impact are said in the organisation\'s words when it has set them, else as numbers; a level not set is left out', () => {
  assert.equal(levelsLine(risk()), 'Likelihood 3 · Impact 5');
  assert.equal(levelsLine(risk({ likelihood_label: 'Possible', impact_label: 'Catastrophic' })), 'Likelihood Possible · Impact Catastrophic');
  assert.equal(levelsLine(risk({ likelihood_label: 'Possible' })), 'Likelihood Possible · Impact 5');
  assert.equal(levelsLine(risk({ impact: null })), 'Likelihood 3');
  assert.equal(levelsLine(risk({ likelihood: null, impact: null })), '');
  const words = answerWords({ likelihood: { '3': 'Possible' }, impact: { '3': 'Moderate', '4': '', x: 'not a level' } });
  assert.deepEqual(words, { likelihood: { 3: 'Possible' }, impact: { 3: 'Moderate' } });
  assert.deepEqual(answerWords(null), { likelihood: {}, impact: {} });
  assert.deepEqual(answerWords(undefined), { likelihood: {}, impact: {} });
  assert.deepEqual(levelOptions(words.likelihood), [
    { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3 · Possible' }, { value: '4', label: '4' }, { value: '5', label: '5' },
  ]);
  assert.deepEqual(levelOptions(undefined).map((o) => o.label), ['1', '2', '3', '4', '5']);
});

test('the risks are grouped by round and step: the round that counts first by step, the others newest first; without a rule one group, "Approval"', () => {
  const rows = [
    risk({ id: 1, round: 1, step_position: 1 }), risk({ id: 2, round: 2, step_position: 2, step_name: 'Approval', step_kind: 'approval' }), risk({ id: 3, round: 2, step_position: 1 }),
    risk({ id: 4, round: 2, step_position: 1 }), none({ id: 5, round: 2, step_position: 2, step_name: 'Approval', step_kind: 'approval' }),
  ];
  const { current, earlier } = groupRisks(rows, 2);
  assert.deepEqual(current.map((g) => [g.title, g.rows.map((r) => r.id)]), [['Review', [3, 4]], ['Approval', [2, 5]]]);
  assert.deepEqual(earlier.map((r) => [r.round, r.groups.map((g) => g.rows.map((x) => x.id))]), [[1, [[1]]]]);
  assert.equal(new Set(current.map((g) => g.key)).size, 2);
  assert.deepEqual(groupRisks(rows, 3).current, []);                                        // a new round with nothing recorded yet
  assert.deepEqual(groupRisks(rows, 3).earlier.map((r) => r.round), [2, 1]);
  const older = groupRisks([risk({ id: 9, round: null, step_position: null, step_name: null, step_kind: null })], null);
  assert.deepEqual(older.current.map((g) => g.title), ['Approval']);
  assert.deepEqual(older.earlier, []);
  assert.deepEqual(groupRisks([], 1), { current: [], earlier: [] });
  assert.equal(groupRisks([risk({ round: 1 }), risk({ id: 2, round: null, step_position: null })], 1).earlier[0].round, null);
  assert.equal(roundLabel(2), 'Round 2');
  assert.equal(roundLabel(null), 'Earlier');
});

test('the round that counts is the approval\'s own, else the newest round the risks were recorded in (an implementer is not shown the approval; the older flow has no round)', () => {
  const rows = [risk({ id: 1, round: 1 }), risk({ id: 2, round: 2 })];
  assert.equal(currentRound(rows, 3), 3);                                                      // a new round with nothing recorded yet
  assert.equal(currentRound(rows, 2), 2);
  assert.equal(currentRound(rows, undefined), 2);
  assert.equal(currentRound(rows, null), 2);
  assert.equal(currentRound([risk({ round: null, step_position: null })], undefined), null);
  assert.equal(currentRound([], undefined), null);
  const seen = groupRisks(rows, currentRound(rows, undefined));
  assert.deepEqual(seen.current.map((g) => g.rows.map((r) => r.id)), [[2]]);                  // the implementer reads the last round at once, the first one is folded away
  assert.deepEqual(seen.earlier.map((r) => r.round), [1]);
});

test('who recorded what: a plain line when someone found none, "You" for the person\'s own', () => {
  assert.equal(foundNoneLine(none()), 'Sara found none');
  assert.equal(foundNoneLine(none({ mine: true })), 'You found none');
  assert.equal(byLine(risk()), 'By Sara');
  assert.equal(byLine(risk({ mine: true })), 'By you');
});

test('the person asked sees what they have recorded at their open step; only their own risks still open to change count', () => {
  const mine = [risk({ id: 1, mine: true, can_edit: true }), risk({ id: 2, mine: true, can_edit: true }), risk({ id: 3, mine: true, can_edit: false }), risk({ id: 4 }), none({ id: 5, mine: true, can_edit: true })];
  assert.deepEqual(myAssessment({ recorded: true, none_identified: false }, mine), { recorded: true, none_identified: false, count: 2 });
  assert.deepEqual(myAssessment({ recorded: false, none_identified: false }, []), { recorded: false, none_identified: false, count: 0 });
  assert.deepEqual(myAssessment(null, mine), { recorded: false, none_identified: false, count: 2 });
  assert.deepEqual(assessmentWord({ recorded: false, none_identified: false, count: 0 }), { tone: 'warning', label: 'Not recorded' });
  assert.deepEqual(assessmentWord({ recorded: true, none_identified: true, count: 0 }), { tone: 'success', label: 'None identified' });
  assert.deepEqual(assessmentWord({ recorded: true, none_identified: false, count: 2 }), { tone: 'success', label: '2 recorded' });
});

test('the controls name the risks by title and the assets by name: a row that says "none" is no risk, and a number the lists do not know is left out', () => {
  const rows = [risk({ id: 1, title: 'Data leaves on a lost drive', round: 2 }), risk({ id: 2, title: 'Malware comes in', round: 2 }), risk({ id: 3, title: 'Old round risk', round: 1 }), none({ id: 4, round: 2 })];
  const titles = riskTitleMap(rows);
  assert.deepEqual(titles, { 1: 'Data leaves on a lost drive', 2: 'Malware comes in', 3: 'Old round risk' });
  assert.deepEqual(coverableRisks(rows, 2).map((r) => r.id), [1, 2]);
  assert.deepEqual(coverableRisks(rows, null).map((r) => r.id), [1, 2, 3]);
  const assets = assetNameMap([{ asset_id: 10, name: 'Core banking platform' }, { asset_id: 11, name: 'Intranet' }]);
  assert.deepEqual(coverNames(control({ risk_ids: [2, 99, 1], asset_ids: [11, 98] }), titles, assets), { risks: ['Malware comes in', 'Data leaves on a lost drive'], assets: ['Intranet'] });
  assert.deepEqual(coverNames(control({ risk_ids: [], asset_ids: [] }), titles, assets), { risks: [], assets: [] });
});

test('a control is planned or in place, and due on a day as written', () => {
  assert.deepEqual(controlWord('planned'), { tone: 'pending', label: 'Planned' });
  assert.deepEqual(controlWord('in_place'), { tone: 'success', label: 'In place' });
  assert.equal(controlDue(control()), '19 Nov 2026');
  assert.equal(controlDue(control({ due_date: null })), '');
});

test('the risk form: empty, from a risk, "touched" once anything is typed or chosen, and what the server takes (levels and note can be cleared)', () => {
  assert.deepEqual(emptyRiskDraft(), { title: '', description: '', likelihood: '', impact: '' });
  assert.equal(riskDraftTouched(emptyRiskDraft()), false);
  assert.equal(riskDraftTouched({ ...emptyRiskDraft(), title: '  ' }), false);
  assert.equal(riskDraftTouched({ ...emptyRiskDraft(), impact: '2' }), true);
  const draft = draftOfRisk(risk({ description: 'Eight technicians know it.' }));
  assert.deepEqual(draft, { title: 'The shared password leaks', description: 'Eight technicians know it.', likelihood: '3', impact: '5' });
  assert.deepEqual(riskInput({ ...draft, title: ' Changed ' }), { title: 'Changed', description: 'Eight technicians know it.', likelihood: 3, impact: 5 });
  assert.deepEqual(riskInput({ title: 'x', description: ' ', likelihood: '', impact: '' }), { title: 'x', description: '', likelihood: null, impact: null });
  assert.deepEqual(draftOfRisk(none()), { title: '', description: '', likelihood: '', impact: '' });
});

test('the control form: from a control and back to what the server takes; an empty evidence line is not sent; a change is noticed', () => {
  const form = formOfControl(control());
  assert.deepEqual(form, {
    title: 'Encrypted drives only', description: 'Issued by the helpdesk.', riskIds: ['1', '2'], assetIds: ['10'], ownerId: '7', due: '2026-11-19', status: 'planned',
    evidence: [{ kind: 'link', url: 'https://intranet.test/video', label: 'Video page' }, { kind: 'evidence', evidenceId: '3', label: 'Penetration test summary' }],
  });
  assert.deepEqual(controlInput(form), {
    title: 'Encrypted drives only', description: 'Issued by the helpdesk.', risk_ids: [1, 2], asset_ids: [10], owner_id: 7, due_date: '2026-11-19', status: 'planned',
    evidence: [{ kind: 'link', url: 'https://intranet.test/video', label: 'Video page' }, { kind: 'evidence', evidence_id: 3, label: 'Penetration test summary' }],
  });
  const loose = { ...emptyControlForm(), title: ' A control ', evidence: [{ kind: 'link' as const, url: ' ', label: '' }, { kind: 'evidence' as const, evidenceId: '', label: '' }, { kind: 'link' as const, url: ' https://a.test ', label: '' }] };
  assert.deepEqual(controlInput(loose), { title: 'A control', description: '', risk_ids: [], asset_ids: [], owner_id: null, due_date: null, status: 'planned', evidence: [{ kind: 'link', url: 'https://a.test', label: undefined }] });
  assert.equal(controlFormTouched(form, formOfControl(control())), false);
  assert.equal(controlFormTouched(form, { ...form, riskIds: ['1'] }), true);
  assert.equal(controlFormTouched(emptyControlForm(), emptyControlForm()), false);
});

test('an asset says who put it there and at which stage', () => {
  assert.equal(addedLine({ added_by: { id: 3, name: 'Olivia' }, stage: 'request' }), 'Added by Olivia at the request');
  assert.equal(addedLine({ added_by: { id: 7, name: 'Chen' }, stage: 'implementation' }), 'Added by Chen at the implementation');
  assert.equal(addedLine({ added_by: null, stage: 'request' }), 'Added at the request');
});

test('only the server\'s question about uncovered risks is asked; every other refusal is shown as it is', () => {
  const answer = (status: number, detail: unknown) => ({ isAxiosError: true, response: { status, data: { detail } } });
  const question = '2 potential risks have no compensating control: Data leaves on a lost drive; Malware comes in. Mark it implemented anyway?';
  assert.equal(uncoveredQuestion(answer(409, question)), question);
  assert.equal(uncoveredQuestion(answer(409, '1 potential risk has no compensating control: Leavers keep access. Mark it implemented anyway?')), '1 potential risk has no compensating control: Leavers keep access. Mark it implemented anyway?');
  assert.equal(uncoveredQuestion(answer(409, 'The implementation is finished: its compensating controls are kept as they were.')), null);
  assert.equal(uncoveredQuestion(answer(409, 'This exception has no implementation waiting.')), null);
  assert.equal(uncoveredQuestion(answer(400, 'Record at least one compensating control before you mark it implemented.')), null);
  assert.equal(uncoveredQuestion(answer(400, question)), null);
  assert.equal(uncoveredQuestion(new Error('Network Error')), null);
  assert.equal(uncoveredQuestion(null), null);
  assert.equal(uncoveredQuestion(answer(409, undefined)), null);
});

test('a value already chosen always has a name in its list: one the list lacks is added under the name it is known by, and one with no name is not invented', () => {
  const people = [{ value: '5', label: 'Sara Reviewer', description: 'sara@example.test' }, { value: '6', label: 'Khalid Approver' }];
  assert.deepEqual(withChosen(people, ['5'], {}), people);
  assert.deepEqual(withChosen(people, ['9'], { 9: 'Chen Support' }), [...people, { value: '9', label: 'Chen Support' }]);
  assert.deepEqual(withChosen(people, ['9', null, undefined, '5'], { 9: 'Chen Support' }), [...people, { value: '9', label: 'Chen Support' }]);
  assert.deepEqual(withChosen(people, ['9'], {}), people);                                       // never a number as a name
  assert.deepEqual(withChosen([], [], {}), []);
  assert.notEqual(withChosen(people, [], {}), people);                                           // a new array every time
});
