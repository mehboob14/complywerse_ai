import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_ROLES_OF, countedForOverview, fieldErrors, infoOf, inFlight, inRegister, isNistFormat, isQuestionnaire, registerSortValue, newParticipant, participantComplete, participantLabel, progressOf, NIST_INFO, ROLE_LABEL, ROLES_OF, splitList, stageOfCheck, stageState, subjectOf, toDateValue, fromDateValue, TYPE_INFO, typeHref, typeOfTab, unmet } from './scopingModel.ts';

const checks = [
  { key: 'subject', label: 'Application chosen', ok: true, required: true, hint: '' },
  { key: 'version', label: 'Version or build set', ok: false, required: true, hint: '' },
  { key: 'assessor', label: 'Assessor named', ok: false, required: true, hint: '' },
  { key: 'reviewer', label: 'Reviewer named', ok: false, required: false, hint: '' },
  { key: 'rules_of_engagement', label: 'Rules of engagement approved', ok: false, required: false, hint: '' },
];

test('every cyber type has its words, a hub tab that finds it again, and a kind of subject', () => {
  assert.deepEqual(Object.keys(TYPE_INFO), ['asvs_checklist', 'owasp_v4_testing_checklist', 'mobile_app_security', 'csir_maturity', 'cti_maturity', 'incident_maturity', 'itsecops_maturity']);
  for (const [format, info] of Object.entries(TYPE_INFO)) {
    assert.equal(typeOfTab(info.tab), format);
    assert.equal(info.needs.length, 4, format);
    assert.ok(info.about.length > 60 && info.how.length > 20 && info.label);
  }
  assert.deepEqual(Object.values(TYPE_INFO).map((t) => t.model), ['asset', 'asset', 'asset', 'process', 'process', 'process', 'process']);
  assert.equal(typeOfTab('nist_library'), undefined);
});

test('the NIST assessments have their words too, live in the NIST library tab, and are told apart from the seven', () => {
  assert.deepEqual(Object.keys(NIST_INFO), ['nist_800_53a', 'nist_csf2']);
  for (const [format, info] of Object.entries(NIST_INFO)) {
    assert.equal(info.tab, 'nist_library');
    assert.equal(info.model, 'system');
    assert.equal(info.needs.length, 4, format);
    assert.ok(info.about.length > 60 && info.how.length > 20 && info.method.length > 20 && info.publication);
    assert.equal(isNistFormat(format), true);
    assert.equal(infoOf(format), info);
    assert.equal(typeHref(format), `/cyber-security?tab=nist_library&assessment=${format}`);               // named, so a link and a reload land on it
    assert.equal(typeOfTab(info.tab), undefined);                                                          // the tab is not one assessment's page
  }
  assert.equal(isNistFormat('asvs_checklist'), false);
  assert.equal(infoOf('asvs_checklist'), TYPE_INFO.asvs_checklist);
  assert.equal(infoOf('nothing'), undefined);
  assert.equal(typeHref('asvs_checklist'), '/cyber-security?tab=asvs');
  assert.equal(typeHref('nothing'), '/cyber-security?tab=overview');
});

test('a NIST assessment is of a system: its checks, roles and register words follow', () => {
  assert.deepEqual(['system', 'baseline', 'functions', 'system_owner', 'as_of', 'independence'].map(stageOfCheck), ['scope', 'scope', 'scope', 'people', 'plan', 'people']);
  assert.equal(ROLE_LABEL('owner', 'system', 'nist_800_53a'), 'System owner');
  assert.equal(ROLE_LABEL('owner', 'system', 'nist_csf2'), 'Profile owner');
  assert.equal(ROLE_LABEL('approver', 'system'), 'Authorizing official');
  assert.equal(ROLE_LABEL('approver', 'asset'), 'Approver');
  assert.ok(ROLES_OF.system.includes('approver') && ROLES_OF.system.includes('assessor'));
  assert.ok(!ASSET_ROLES_OF.system.includes('component'));
  const nist = { name: 'NIST SP 800-53A - Core Banking Platform', primary_asset_name: null, scope_model: 'system' as const, assessment_format: 'nist_800_53a' };
  assert.equal(subjectOf(nist), 'Core Banking Platform');                                                   // read out of the name, like a function
});

test('a check belongs to the stage where it is filled, and the stage says how many required ones are missing', () => {
  assert.deepEqual(['subject', 'version', 'application_owner', 'assessor', 'rules_of_engagement', 'window', 'period', 'evidence_plan', 'nothing'].map(stageOfCheck),
    ['scope', 'scope', 'people', 'people', 'plan', 'plan', 'scope', 'plan', 'scope']);
  const view = { readiness: { ready: false, checks } };
  assert.deepEqual(stageState(view, 'scope'), { missing: 1, advice: 0, done: false });
  assert.deepEqual(stageState(view, 'people'), { missing: 1, advice: 1, done: false });
  assert.deepEqual(stageState(view, 'plan'), { missing: 0, advice: 1, done: true });                         // advice does not hold a stage back
  assert.equal(stageState(view, 'assessment').done, false);
  assert.deepEqual(stageState({ readiness: null }, 'scope'), { missing: 0, advice: 0, done: true });
  const { required, advice } = unmet(view.readiness);
  assert.deepEqual([required.map((c) => c.key), advice.map((c) => c.key)], [['version', 'assessor'], ['reviewer', 'rules_of_engagement']]);
});

test('progress is what is marked over what applies, and a register names what an assessment is of', () => {
  assert.equal(progressOf({ total_items: 4, complied_count: 1, partially_complied_count: 1, not_complied_count: 0, na_count: 1 }), 67);              // 2 of the 3 that apply
  assert.equal(progressOf({ total_items: 42, complied_count: 0, partially_complied_count: 0, not_complied_count: 0, na_count: 14 }), 0);           // just started: the level rules are no work
  assert.equal(progressOf({ total_items: 3, complied_count: 0, partially_complied_count: 0, not_complied_count: 0, na_count: 3 }), 100);           // nothing applies: nothing is left
  assert.equal(progressOf({ total_items: 0, complied_count: 0, partially_complied_count: 0, not_complied_count: 0, na_count: 0 }), 0);
  assert.equal(progressOf({ total_items: null, complied_count: null, partially_complied_count: null, not_complied_count: null, na_count: null }), 0);
  const row = { name: 'OWASP ASVS - Digital Banking Web', primary_asset_name: null, scope_model: 'asset' as const, assessment_format: 'asvs_checklist' };
  assert.equal(subjectOf({ ...row, primary_asset_name: 'Digital Banking Web' }), 'Digital Banking Web');
  assert.equal(subjectOf(row), 'Digital Banking Web');                                                       // a function: read out of the name
  assert.equal(subjectOf({ ...row, name: 'Renamed by someone' }), 'Renamed by someone');
  assert.equal(isQuestionnaire({ scope_model: null }), true);
  assert.equal(isQuestionnaire({ scope_model: 'asset' }), false);
});

test('roles read as the kind of assessment calls them, and an asset can be a component only of an application', () => {
  assert.equal(ROLE_LABEL('owner', 'asset'), 'Application owner');
  assert.equal(ROLE_LABEL('owner', 'process'), 'Process owner');
  assert.equal(ROLE_LABEL('reviewer', 'process'), 'Independent reviewer');
  assert.equal(ROLE_LABEL('reviewer', 'asset'), 'Reviewer');
  assert.ok(ROLES_OF.asset.includes('assessor') && ROLES_OF.process.includes('sponsor') && !ROLES_OF.asset.includes('sponsor'));
  assert.ok(ASSET_ROLES_OF.asset.includes('component') && !ASSET_ROLES_OF.process.includes('component'));
});

test('a participant is named by who they are, and one that cannot be saved yet says so', () => {
  const people = { '8': 'Amina Khan' };
  assert.equal(participantLabel({ ...newParticipant('user', 'owner'), user_id: 8 }, people), 'Amina Khan');
  assert.equal(participantLabel({ ...newParticipant('user', 'owner'), user_id: 9 }, people), 'Person 9');
  assert.equal(participantLabel({ ...newParticipant('team', 'contributor'), team_id: 2 }, people, { '2': 'Security Operations' }), 'Security Operations');
  assert.equal(participantLabel({ ...newParticipant('external', 'contributor'), name: 'Sana', organisation: 'Managed SOC Ltd' }, people), 'Sana (Managed SOC Ltd)');
  assert.deepEqual([newParticipant('user', 'owner'), { ...newParticipant('user', 'owner'), user_id: 8 }, newParticipant('team', 'contributor'), { ...newParticipant('team', 'contributor'), team_id: 2 },
    { ...newParticipant('external', 'contributor'), name: 'Sana' }, { ...newParticipant('external', 'contributor'), name: 'Sana', organisation: 'MSSP' }].map(participantComplete),
    [false, true, false, true, false, true]);
});

test('the server\'s field messages come back by field, the first of each, and anything else is nothing', () => {
  const err = { response: { data: { detail: { message: 'The scope is not complete or valid.', errors: [
    { field: 'environment', message: 'Input should be production' }, { field: 'participants.0.organisation', message: 'needs the organisation' }, { field: 'participants.1', message: 'second' }] } } } };
  assert.deepEqual(fieldErrors(err), { environment: 'Input should be production', participants: 'needs the organisation' });
  assert.deepEqual(fieldErrors({ response: { data: { detail: 'Assessment not found.' } } }), {});
  assert.deepEqual(fieldErrors(new Error('network')), {});
  assert.deepEqual(fieldErrors(null), {});
});

test('dates and lists go to and from their inputs', () => {
  assert.equal(toDateValue('2026-11-04T00:00:00'), '2026-11-04');
  assert.equal(toDateValue(null), '');
  assert.equal(fromDateValue(''), null);
  assert.equal(fromDateValue('2026-11-04'), '2026-11-04');
  assert.deepEqual(splitList('Pakistan, UAE\nQatar;  ;Pakistan'), ['Pakistan', 'UAE', 'Qatar']);
  assert.deepEqual(splitList('  '), []);
});

const row = (over: Partial<Parameters<typeof inRegister>[0][number]> = {}) => ({
  id: 1, name: 'OWASP ASVS - Digital Banking Web', assessment_format: 'asvs_checklist', status: 'in_progress', due_date: null, overall_score: null, total_items: 10,
  complied_count: 0, partially_complied_count: 0, not_complied_count: 0, in_progress_count: 10, na_count: 0, scope_model: 'asset' as const, phase: 'in_progress' as const,
  template_id: 3, owner_id: 7, owner_name: 'Amina Khan', primary_asset_id: 5, primary_asset_name: 'Digital Banking Web', started_at: null, created_at: '2026-11-01T10:00:00', updated_at: null, ...over,
});

test('an Overview counts what was started, never a draft, and the questionnaire only until something starts from it or when someone answered it', () => {
  const template = row({ id: 3, scope_model: null, phase: null, primary_asset_id: null, primary_asset_name: null });
  const answeredTemplate = { ...template, id: 4, complied_count: 2, in_progress_count: 8 };
  const started = row({ id: 5 });
  const draft = row({ id: 6, phase: 'scoping', total_items: 0, in_progress_count: 0 });
  const ids = (rows: Array<{ id: number }>) => rows.map((r) => r.id);
  assert.deepEqual(ids(countedForOverview([template])), [3]);                                                  // as it has always been: the uploaded questionnaire is the assessment
  assert.deepEqual(ids(countedForOverview([template, draft])), [3]);                                           // a draft changes nothing
  assert.deepEqual(ids(countedForOverview([template, draft, started])), [5]);                                  // started: the unanswered template is no longer counted
  assert.deepEqual(ids(countedForOverview([answeredTemplate, started])), [4, 5]);                              // an answered one is an assessment of its own
  assert.deepEqual(countedForOverview([]), []);
});

test('in flight is a draft or a started assessment with questions left, and never the questionnaire', () => {
  assert.equal(inFlight(row({ phase: 'scoping', total_items: 0 })), true);
  assert.equal(inFlight(row()), true);
  assert.equal(inFlight(row({ complied_count: 9, na_count: 1, in_progress_count: 0 })), false);                // everything marked
  assert.equal(inFlight(row({ scope_model: null, phase: null })), false);
});

test('a register shows what was made for an application or function, by phase and by what is typed, and sorts by what a column says', () => {
  const a = row({ id: 1 });
  const b = row({ id: 2, name: 'OWASP ASVS - Payments API', primary_asset_name: 'Payments API', phase: 'scoping', owner_name: 'Omar Sheikh' });
  const q = row({ id: 3, scope_model: null, phase: null });
  const ids = (rows: Array<{ id: number }>) => rows.map((r) => r.id);
  assert.deepEqual(ids(inRegister([a, b, q], 'all', '')), [1, 2]);                                             // the questionnaire has a card of its own
  assert.deepEqual(ids(inRegister([a, b, q], 'scoping', '')), [2]);
  assert.deepEqual(ids(inRegister([a, b, q], 'in_progress', '')), [1]);
  assert.deepEqual(ids(inRegister([a, b], 'all', ' pay ')), [2]);
  assert.deepEqual(ids(inRegister([a, b], 'all', 'omar')), [2]);
  assert.deepEqual(ids(inRegister([a, b], 'all', 'nothing')), []);
  assert.deepEqual([registerSortValue(a, 'subject'), registerSortValue(a, 'owner'), registerSortValue(b, 'phase'), registerSortValue(b, 'progress')], ['digital banking web', 'amina khan', 0, null]);
  assert.equal(registerSortValue(a, 'updated'), '2026-11-01T10:00:00');
});
