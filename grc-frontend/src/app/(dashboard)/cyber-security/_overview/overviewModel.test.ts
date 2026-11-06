import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_FORMATS, inFlightByTab, statusMix, totalsOf, typeRow, typeRows, TYPE_FORMATS } from './overviewModel.ts';

const row = (over: Record<string, unknown> = {}) => ({
  id: 1, name: 'OWASP ASVS - Web', assessment_format: 'asvs_checklist', status: 'in_progress', due_date: null, overall_score: null, total_items: 10,
  complied_count: 0, partially_complied_count: 0, not_complied_count: 0, in_progress_count: 10, na_count: 0, scope_model: 'asset', phase: 'in_progress',
  template_id: 3, owner_id: 7, owner_name: 'Amina Khan', primary_asset_id: 5, primary_asset_name: 'Web', started_at: null, created_at: '2026-11-01T10:00:00', updated_at: null, ...over,
}) as never;

test('the types are in the order of the hub tabs, then the NIST ones made from the library', () => {
  assert.deepEqual(TYPE_FORMATS, ['asvs_checklist', 'owasp_v4_testing_checklist', 'mobile_app_security', 'csir_maturity', 'cti_maturity', 'incident_maturity', 'itsecops_maturity']);
  assert.deepEqual(ALL_FORMATS, [...TYPE_FORMATS, 'nist_800_53a', 'nist_csf2']);
  assert.deepEqual(typeRows([]).map((r) => r.tab), ['asvs', 'owasp_testing', 'cs_mobile', 'cs_csir', 'cs_cti', 'cs_incident', 'cs_itsecops', 'nist_library', 'nist_library']);
  assert.deepEqual(typeRows([]).slice(6).map((r) => r.href), ['/cyber-security?tab=cs_itsecops', '/cyber-security?tab=nist_library&assessment=nist_800_53a', '/cyber-security?tab=nist_library&assessment=nist_csf2']);
});

test('a NIST assessment is added up like the others, under its own type', () => {
  const nist = row({ id: 8, name: 'NIST SP 800-53A - Core Banking Platform', assessment_format: 'nist_800_53a', scope_model: 'system', primary_asset_id: null, primary_asset_name: null, total_items: 149, complied_count: 40, partially_complied_count: 0, not_complied_count: 9, na_count: 0, in_progress_count: 100 });
  const r = typeRow('nist_800_53a', [nist, row({ id: 9 })]);                                                  // the ASVS one is not its
  assert.deepEqual([r.label, r.assessments, r.total, r.complied, r.notComplied, r.gaps], ['NIST SP 800-53A', 1, 149, 40, 9, 109]);
  assert.equal(totalsOf(typeRows([nist])).typesStarted, 1);
  assert.equal(typeRow('nist_csf2', [nist]).assessments, 0);
});

test('a type adds up the assessments that count, with the hub\'s own definitions of coverage, compliant and gaps', () => {
  const a = row({ id: 1, total_items: 10, complied_count: 4, partially_complied_count: 1, not_complied_count: 1, na_count: 2, in_progress_count: 2 });
  const b = row({ id: 2, total_items: 10, complied_count: 2, in_progress_count: 8 });
  const r = typeRow('asvs_checklist', [a, b]);
  assert.deepEqual([r.assessments, r.total, r.complied, r.partial, r.notComplied, r.na, r.inProgress], [2, 20, 6, 1, 1, 2, 10]);
  assert.equal(r.assessed, 10);                                                   // 6 + 1 + 1 + 2 not applicable
  assert.equal(r.coverage, 50);                                                   // 10 of 20
  assert.equal(r.compliant, 60);                                                  // 6 of those 10
  assert.equal(r.gaps, 11);                                                       // 1 not complied + 10 not answered
});

test('a draft counts for nothing, an unanswered questionnaire only until one has started, and the type says what is in flight', () => {
  const questionnaire = row({ id: 3, scope_model: null, phase: null, primary_asset_id: null, primary_asset_name: null, total_items: 42, in_progress_count: 42 });
  const draft = row({ id: 4, phase: 'scoping', total_items: 0, in_progress_count: 0 });
  const started = row({ id: 5, total_items: 28, in_progress_count: 28 });
  assert.equal(typeRow('asvs_checklist', [questionnaire]).total, 42);             // as it has always been: the uploaded questionnaire is the assessment
  const withDraft = typeRow('asvs_checklist', [questionnaire, draft]);
  assert.deepEqual([withDraft.total, withDraft.drafts, withDraft.inFlight], [42, 1, 1]);
  const all = typeRow('asvs_checklist', [questionnaire, draft, started]);
  assert.deepEqual([all.assessments, all.total, all.drafts, all.inFlight], [1, 28, 1, 2]);   // the template stops counting; the draft and the started one are in flight
  assert.equal(typeRow('asvs_checklist', []).coverage, null);                     // nothing to cover is not 0%
  assert.equal(typeRow('asvs_checklist', []).compliant, null);
});

test('the totals add the types up, and count the types that have started', () => {
  const list = [row({ id: 1, complied_count: 5, in_progress_count: 5 }), row({ id: 2, assessment_format: 'csir_maturity', total_items: 4, complied_count: 1, not_complied_count: 1, in_progress_count: 2 })];
  const t = totalsOf(typeRows(list));
  assert.deepEqual([t.assessments, t.typesStarted, t.total, t.complied, t.notComplied, t.inProgress, t.gaps], [2, 2, 14, 6, 1, 7, 8]);
  assert.equal(t.coverage, 50);                                                   // 7 of 14
  assert.equal(totalsOf(typeRows([])).typesStarted, 0);
});

test('the status bar has a segment for each status that has something in it, and the shares add up to the whole bar', () => {
  const mix = statusMix({ total: 20, complied: 10, partial: 0, notComplied: 5, inProgress: 5, na: 0 });
  assert.deepEqual(mix.map((m) => [m.key, m.n]), [['complied', 10], ['notComplied', 5], ['inProgress', 5]]);
  assert.equal(Math.round(mix.reduce((s, m) => s + m.percent, 0)), 100);
  assert.deepEqual(statusMix({ total: 0, complied: 0, partial: 0, notComplied: 0, inProgress: 0, na: 0 }), []);
});

test('the tab strip gets a number only for a type with something in flight', () => {
  const list = [row({ id: 1 }), row({ id: 2, phase: 'scoping' }), row({ id: 3, assessment_format: 'cti_maturity', total_items: 2, complied_count: 2, in_progress_count: 0 })];
  assert.deepEqual(inFlightByTab(list), { asvs: 2 });
});

test('the NIST library tab carries the in-flight count of both NIST types', () => {
  const draft = (id: number, assessment_format: string) => row({ id, assessment_format, scope_model: 'system', phase: 'scoping', total_items: 0, in_progress_count: 0, primary_asset_id: null, primary_asset_name: null });
  assert.deepEqual(inFlightByTab([draft(1, 'nist_800_53a'), draft(2, 'nist_csf2'), draft(3, 'nist_csf2')]), { nist_library: 3 });
});
