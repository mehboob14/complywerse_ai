// node --test "src/app/(dashboard)/vendor-risk/settings/settingsModel.test.ts"
// The Settings page's rules: every draft key belongs to exactly one section; each old address (#questions, #exposure, ...) still lands on the right place; a section saves only its own keys and a tier's
// approver role and reopen threshold are never in what it sends; what stops a save is said in words per section.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PART_KEYS, SECTIONS, SECTION_IDS, activeEvidence, bodyOf, days, dirtyKeys, dirtyOf, legacyTarget, problemsOf, sectionOf, sectionOfAnchor, toDraft,
  type ConfigResp, type Draft,
} from './settingsModel.ts';
import { exposureProblems, inWords } from './exposureModel.ts';

const QUANT = {
  currency: 'USD', iterations: 5000,
  breach_per_year: { critical: [0.1, 0.2, 0.4] }, outage_per_year: { critical: [0.1, 0.2, 0.4] }, records: { none: [0, 0, 0] },
  outage_cost_per_hour: { critical: [100, 200, 300] }, cost_per_record: [1, 2, 3], response_cost: [10, 20, 30], outage_hours: [1, 2, 3],
  control_effect: { critical: 1.5, low: 0.6 },
};
const MON = {
  adverse_media: true, outside_in: false, check_every_days: { critical: 30, low: 365 }, scan_every_days: { critical: 7, low: 90 },
  scan_points: { critical: 30, high: 15, medium: 6, low: 2 }, scan_category_cap: 40, grades: { A: 90, B: 80, C: 70, D: 55 },
};
const config = (): ConfigResp => ({
  weights: { data: 0.6, access: 0.4 }, thresholds: { critical: 75, high: 50, medium: 25 }, cadence_days: { critical: 90 },
  reminder_policy: { enabled: true, remind_before_days: 14, repeat_every_days: 7, escalate_after_days: 14, escalate_to: ['role:CISO'] },
  scoring_policy: { partial_credit: 0.5 },
  tier_policy: { critical: { template_ids: [3], evidence: ['pen_test'], approver_role: 'CISO', reassess_on: 'medium' }, low: { template_ids: [], evidence: [], approver_role: null, reassess_on: 'critical' } },
  quantification: QUANT as never, monitoring_policy: MON,
  customisation: { sections: [], builtin_sections: {}, builtin: {}, questions: [], section_roles: {}, factors: [{ key: 'c_brand', label: 'Brand' }], evidence: [], evidence_builtin: {} },
  defaults: {
    weights: { data: 0.5, access: 0.5 }, thresholds: { critical: 75, high: 50, medium: 25 }, cadence_days: { critical: 90 },
    reminder_policy: { enabled: true, remind_before_days: 30, repeat_every_days: 7, escalate_after_days: 14, escalate_to: [] }, scoring_policy: { partial_credit: 0.5 },
    tier_policy: { critical: { template_ids: [], evidence: [], approver_role: null, reassess_on: 'medium' } }, quantification: QUANT as never, monitoring_policy: MON,
  },
  meta: { factor_keys: ['data', 'access'], factor_labels: { data: 'Data', access: 'Access' }, tier_keys: ['critical', 'low'], cadence_keys: ['critical'] },
} as unknown as ConfigResp);

const fromServer = (): Draft => { const c = config(); return toDraft(c, c); };      // what the page edits: the config read from the server

test('every draft key is saved by exactly one section, and the sections are the seven of the nav', () => {
  const draft = fromServer();
  const owned = SECTIONS.flatMap((s) => Array.from(s.keys));
  assert.deepEqual(owned.slice().sort(), Object.keys(draft).sort());
  assert.equal(new Set(owned).size, owned.length, 'no key is saved by two sections');
  assert.deepEqual(SECTIONS.map((s) => s.id), Array.from(SECTION_IDS));
  assert.equal(SECTIONS.length, 7);
  assert.equal(sectionOf('nonsense').id, 'tiering', 'an unknown section opens the first');
  Object.values(PART_KEYS).forEach((keys) => keys.forEach((k) => assert.ok(k in draft, `part key ${k}`)));
});

test('the old addresses land on their new place and the ones that moved to Policy go there', () => {
  assert.equal(legacyTarget('#questions'), '/vendor-risk/settings?section=tiering#questions');
  assert.equal(legacyTarget('#exposure'), '/vendor-risk/settings?section=exposure#exposure');
  assert.equal(legacyTarget('#monitoring'), '/vendor-risk/settings?section=monitoring#monitoring');
  assert.equal(legacyTarget('#scan-scoring'), '/vendor-risk/settings?section=monitoring#scan-scoring');
  assert.equal(legacyTarget('#reminders'), '/vendor-risk/settings?section=reminders#reminders');
  assert.equal(legacyTarget('#tier-asks'), '/vendor-risk/settings?section=tiering#tier-asks');
  assert.equal(legacyTarget('#record'), '/vendor-risk/settings?section=records');
  assert.equal(legacyTarget('#emails'), '/vendor-risk/settings?section=emails');
  assert.equal(legacyTarget('#thresholds'), '/vendor-risk/policy#bands');
  assert.equal(legacyTarget('#cadence'), '/vendor-risk/policy#bands');
  assert.equal(legacyTarget('#alert-rules'), '/vendor-risk/policy#alert-rules');
  assert.equal(legacyTarget('#nothing'), null);
  assert.equal(legacyTarget(''), null);
  assert.equal(sectionOfAnchor('#factors'), 'tiering');
  assert.equal(sectionOfAnchor('#thresholds'), null, 'a moved setting has no section here');
  // every anchor the server still hands out resolves (tpra/alert_rules.py: settings#reminders, settings#tier-asks)
  ['reminders', 'tier-asks'].forEach((a) => assert.ok(legacyTarget(`#${a}`)));
});

test('a section saves only its own keys, and only what changed', () => {
  const saved = fromServer();
  const draft = JSON.parse(JSON.stringify(saved)) as Draft;
  draft.reminder_policy.remind_before_days = 21;
  draft.scoring_policy.partial_credit = 0.4;
  const dirty = dirtyKeys(draft, saved);
  assert.deepEqual(dirty.sort(), ['reminder_policy', 'scoring_policy']);
  assert.deepEqual(dirtyOf(sectionOf('reminders'), dirty), ['reminder_policy']);
  assert.deepEqual(dirtyOf(sectionOf('scoring'), dirty), ['scoring_policy']);
  assert.deepEqual(dirtyOf(sectionOf('tiering'), dirty), []);
  assert.deepEqual(bodyOf(['scoring_policy'], draft), { scoring_policy: { partial_credit: 0.4 } });
});

test('what the tiering section sends never carries a tier\'s approver role or reopen threshold', () => {
  const saved = fromServer();
  const draft = JSON.parse(JSON.stringify(saved)) as Draft;
  draft.tier_policy.critical.evidence = ['pen_test', 'dpa'];
  draft.tier_policy.critical.approver_role = 'Someone else';             // a stale copy of the Policy page's field
  draft.tier_policy.critical.reassess_on = 'low';
  draft.custom_factors = [...draft.custom_factors, { key: 'c_x', label: 'X' }];
  draft.weights = { data: 40, access: 40, c_x: 20 };
  const body = bodyOf(['tier_policy', 'custom_factors', 'weights'], draft) as { tier_policy: Record<string, object>; customisation: { factors: unknown[] }; weights: object };
  assert.deepEqual(body.tier_policy.critical, { template_ids: [3], evidence: ['pen_test', 'dpa'] });
  assert.deepEqual(Object.keys(body.tier_policy.low), ['template_ids', 'evidence']);
  assert.equal(body.customisation.factors.length, 2);
  assert.deepEqual(body.weights, { data: 40, access: 40, c_x: 20 });
});

test('the feeds and the scan scoring are sent together as one monitoring policy, the questions and evidence as one customisation', () => {
  const saved = fromServer();
  const draft = JSON.parse(JSON.stringify(saved)) as Draft;
  draft.monitoring_policy.outside_in = true;
  draft.scan_scoring.scan_category_cap = 30;
  const mon = bodyOf(['monitoring_policy', 'scan_scoring'], draft).monitoring_policy as Record<string, unknown>;
  assert.equal(mon.outside_in, true);
  assert.equal(mon.scan_category_cap, 30);
  assert.ok('scan_points' in mon && 'check_every_days' in mon);
  const custom = bodyOf(['custom_questions', 'custom_evidence', 'custom_factors'], draft).customisation as Record<string, unknown>;
  assert.deepEqual(Object.keys(custom).sort(), ['builtin', 'builtin_sections', 'evidence', 'evidence_builtin', 'factors', 'questions', 'section_roles', 'sections']);
  assert.deepEqual(bodyOf([], draft), {});
});

test('what stops a save is said in words, only for the section being saved', () => {
  const saved = fromServer();
  const draft = JSON.parse(JSON.stringify(saved)) as Draft;
  draft.weights = { data: 0, access: 0 };
  draft.reminder_policy.repeat_every_days = 0;
  draft.scan_scoring.scan_points = { critical: 5, high: 15, medium: 6, low: 2 };
  draft.scan_scoring.grades = { A: 70, B: 80, C: 70, D: 55 };
  draft.quantification.cost_per_record = [5, 2, 3];
  draft.custom_factors = [{ key: 'c_a', label: ' ' }];
  const tiering = problemsOf(sectionOf('tiering').keys, draft, ['Every question needs its wording']);
  assert.deepEqual(tiering, ['At least one risk factor needs a weight', 'Onboarding questions: Every question needs its wording', 'Every factor needs a name']);
  assert.deepEqual(problemsOf(sectionOf('reminders').keys, draft), ['Overdue reminders must repeat at least every day']);
  assert.deepEqual(problemsOf(sectionOf('monitoring').keys, draft), ['Scan scoring: a more severe finding must take off at least as many points', 'Scan scoring: each grade must start above the next']);
  assert.deepEqual(problemsOf(sectionOf('exposure').keys, draft), ['Exposure model: Cost for each record exposed']);
  assert.deepEqual(problemsOf(sectionOf('scoring').keys, draft), []);
  assert.deepEqual(problemsOf(sectionOf('records').keys, draft), []);
});

test('the exposure ranges are checked and said in words', () => {
  const q = JSON.parse(JSON.stringify(config().quantification));
  assert.deepEqual(exposureProblems(q), []);
  q.breach_per_year.critical = [0.5, 0.2, 0.4];
  assert.deepEqual(exposureProblems(q), ['Critical-tier supplier: how often a supplier exposes our data']);
  assert.equal(inWords('rate', [0.05, 0.1, 0.2], 'USD'), 'most likely about once every 10 years');
  assert.equal(inWords('money', [1, 5000, 9000], 'EUR'), 'most likely EUR 5,000');
});

test('evidence types in use are the built-in ones not hidden, renamed, plus your own that are not taken out', () => {
  const builtin = { assurance_report: 'Assurance report', pen_test: 'Penetration test' };
  const used = activeEvidence(builtin, { evidence_builtin: { pen_test: { hidden: true }, assurance_report: { label: 'SOC report' } }, evidence: [{ key: 'c_pci', label: 'PCI AOC' }, { key: 'c_old', label: 'Old', archived: true }] });
  assert.deepEqual(used, { assurance_report: 'SOC report', c_pci: 'PCI AOC' });
});

test('a number of days is said as a rhythm', () => {
  assert.deepEqual([0, 7, 14, 30, 90, 365, 730, 45].map(days), ['—', 'every week', 'every 2 weeks', 'every month', 'every 3 months', 'every year', 'every 2 years', 'every 45 days']);
});
