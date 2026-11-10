// node --test "src/app/(dashboard)/vendor-risk/_lib/vendorRegisterDef.test.ts"
// The Vendors register's definition: the facets and chips count what the server decided (the next action, "tiered" = a score), the default order is the server's "risk" order, the board has a
// column for every stage and one for a vendor with no lifecycle, and every address the old register wrote still means what it meant.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRegister, indexRegister, sortRows, stateOf, appliedChips, type RegisterState } from '../../../../components/records/registerModel.ts';
import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { STAGES } from './lifecycleLogic.ts';
import {
  NONE, NOT_STARTED, VENDOR_SCHEMA, migrateAddress, piiWord, riskKey, stageProgress, tierWord, vendorDef, websiteHref, reviewIsLate, subline, type VendorRow,
} from './vendorRegisterDef.ts';

let id = 0;
const row = (over: Partial<VendorRow>): VendorRow => ({
  id: ++id, name: `Vendor ${id}`, tier: 'medium', status: 'active', vendor_type: null, industry: null, website: null, inherent_risk_score: null, residual_risk_score: null, risk_rating: null,
  data_access_level: null, contract_end_date: null, contract_value: null, next_reassessment_date: null, holds_personal_data: null, data_classification: null, owner_id: null, owner: null,
  business_unit: null, archived_at: null, next_action: null, grade: null, lifecycle: null, ...over,
});
const person = (n: number, name: string) => ({ owner_id: n, owner: { id: n, full_name: name } });
const life = (stage: string) => ({ assessment_id: 1, stage, version_no: 1, residual_rating: null, residual_score: null, open_findings: 0, open_critical: 0 });
const NOW = new Date('2026-11-10T12:00:00Z');

const rows: VendorRow[] = [
  row({ name: 'Alpha', tier: 'critical', inherent_risk_score: 80, ...person(2, 'Ada'), next_action: { code: 'reassessment_overdue', label: 'Reassessment overdue', link: '/x' }, lifecycle: life('findings'), holds_personal_data: true, data_classification: 'Restricted', business_unit: { id: 1, name: 'Retail' }, vendor_type: 'Software' }),
  row({ name: 'Bravo', tier: 'critical', inherent_risk_score: 70, next_action: { code: 'no_owner', label: 'No owner', link: '/y' }, lifecycle: life('monitoring'), holds_personal_data: false }),
  row({ name: 'Charlie', tier: 'medium', ...person(3, 'Ben'), next_action: { code: 'not_tiered', label: 'Needs tiering', link: '/z' } }),          // no score: not tiered whatever its tier column says
  row({ name: 'Delta', tier: 'low', inherent_risk_score: 10, ...person(2, 'Ada'), status: 'suspended', next_action: { code: 'suspended', label: 'Suspended', link: '/s' }, lifecycle: life('tiering') }),
  row({ name: 'Echo', tier: 'high', inherent_risk_score: 55, ...person(3, 'Ben'), vendor_type: 'Consulting' }),
];
const def = vendorDef({ me: 2 });
const state = (over: Partial<RegisterState> = {}): RegisterState => ({ q: '', quick: 'all', view: 'list', sort: def.defaultSort, page: 1, id: 0, chosen: Object.fromEntries(def.facets.map((f) => [f.key, [] as string[]])), ...over });
const names = (matches: readonly VendorRow[]) => matches.map((r) => r.name).sort();
const evaluate = (s: RegisterState) => evaluateRegister(def, indexRegister(def, rows), s, NOW);

test('a vendor is tiered when it has a score: a tier column on its own is a placeholder', () => {
  assert.equal(tierWord(rows[2]), 'not_tiered');
  assert.equal(tierWord(rows[0]), 'critical');
  const { result } = evaluate(state({ chosen: { ...state().chosen, tier: ['not_tiered'] } }));
  assert.deepEqual(names(result.matches), ['Charlie']);
});

test('the quick chips count what the server decided and what the person is', () => {
  const { quickCounts } = evaluate(state());
  assert.deepEqual(quickCounts, { all: 5, tiering: 1, overdue: 1, lifecycle: 3, noowner: 1, mine: 2 });          // Mine = Ada's two; No owner = Bravo
});

test('the facets and their words: next step, stage, personal data, classification (any case) and "none" for a vendor with no value', () => {
  const next = def.facets.find((f) => f.key === 'attention')!;
  assert.deepEqual(next.options(rows).map((o) => o.value), ['suspended', 'reassessment_overdue', 'not_tiered', 'awaiting_approval', 'response_to_review', 'documents_expired', 'weak_grade', 'no_owner', 'reassessment_due', 'offboarding', NONE]);
  assert.deepEqual(next.values(rows[4]), [NONE]);
  const stage = def.facets.find((f) => f.key === 'stage')!;
  assert.deepEqual(stage.options(rows).map((o) => o.value), [NOT_STARTED, ...STAGES.map((s) => s.key)]);
  assert.deepEqual(stage.values(rows[2]), [NOT_STARTED], 'no lifecycle is "not started", never a made-up stage');
  assert.deepEqual(stage.values(rows[0]), ['findings']);
  assert.equal(piiWord(rows[0]), 'yes');
  assert.equal(piiWord(rows[1]), 'no');
  assert.equal(piiWord(rows[2]), 'unknown');
  const cls = def.facets.find((f) => f.key === 'class')!;
  assert.deepEqual(cls.values(rows[0]), ['restricted']);
  assert.deepEqual(cls.options(rows).map((o) => o.value), ['public', 'internal', 'confidential', 'restricted', NONE]);
  const owner = def.facets.find((f) => f.key === 'owner')!;
  assert.deepEqual(owner.options(rows), [{ value: '2', label: 'Ada' }, { value: '3', label: 'Ben' }, { value: NONE, label: 'Unassigned' }]);
});

test('a filter can always reach a record: a status or type the lists do not name is still an option', () => {
  const odd = row({ status: 'paused', vendor_type: 'Telecom' });
  assert.ok(def.facets.find((f) => f.key === 'status')!.options([...rows, odd]).some((o) => o.value === 'paused' && o.label === 'Paused'));
  assert.ok(vendorDef({ me: 1, types: [{ value: 'Software', label: 'Software' }] }).facets.find((f) => f.key === 'type')!.options([odd]).some((o) => o.value === 'Telecom'));
});

test('the default order is the server\'s "risk" order: worst tier first, a vendor nobody tiered right after critical, the unowned first within a tier, then name', () => {
  const sorted = sortRows(def, rows, def.defaultSort).map((r) => r.name);
  assert.deepEqual(sorted, ['Bravo', 'Alpha', 'Charlie', 'Echo', 'Delta'], 'critical unowned (Bravo) before critical owned (Alpha); not tiered (Charlie) before high (Echo) and low (Delta)');
  assert.ok(riskKey(rows[1]) < riskKey(rows[0]));
  const byGrade = sortRows(def, [row({ name: 'G', grade: 'C' }), row({ name: 'H', grade: null }), row({ name: 'I', grade: 'A' })], { key: 'grade', dir: 'desc' }).map((r) => r.name);
  assert.deepEqual(byGrade, ['G', 'I', 'H'], 'an ungraded vendor is last either way');
});

test('the board has a column for every stage and one for a vendor with no lifecycle, and each vendor is in exactly one', () => {
  const cols = def.board!.columns;
  assert.deepEqual(cols.map((c) => c.id), [...STAGES.map((s) => s.key), NOT_STARTED], 'the stages in the order of the lifecycle, then the vendors that have not started');
  for (const r of rows) assert.equal(cols.filter((c) => c.test(r)).length, 1, r.name);
  assert.deepEqual(cols.map((c) => c.label).slice(0, 3), ['Intake', 'Tiering', 'Planning']);
});

test('the schema reads what the old register wrote, once migrated: the Overview\'s links keep landing on the same vendors', () => {
  assert.equal(migrateAddress('tier=critical&status=active'), null, 'nothing to change');
  assert.equal(migrateAddress('owner=me'), 'quick=mine');
  assert.equal(migrateAddress('owner=unassigned&q=acme'), 'owner=none&q=acme');
  assert.equal(migrateAddress('owner=17'), null, 'a person\'s id means the same');
  assert.equal(migrateAddress('pii=1&attention=not_tiered'), 'pii=yes&attention=not_tiered');
  assert.equal(migrateAddress('sort=name&dir=desc'), 'sort=name%3Adesc');
  assert.equal(migrateAddress('sort=risk'), 'sort=risk%3Aasc');
  assert.equal(migrateAddress('sort=bogus&dir=desc'), '', 'an unknown sort is dropped, not guessed');
  assert.equal(migrateAddress('archived=1&page=3'), null);
  const s = stateOf(def, readAddress(VENDOR_SCHEMA, `?${migrateAddress('attention=reassessment_overdue&attention=not_tiered&owner=unassigned&sort=next_reassessment&dir=desc&unit=3&type=Software&q=x&archived=1')}`));
  assert.deepEqual(s.chosen.attention, ['reassessment_overdue', 'not_tiered']);
  assert.deepEqual(s.chosen.owner, [NONE]);
  assert.deepEqual(s.chosen.unit, ['3']);
  assert.deepEqual(s.chosen.type, ['Software']);
  assert.deepEqual(s.sort, { key: 'next_reassessment', dir: 'desc' });
  assert.equal(s.q, 'x');
});

test('the plain address is the default state, and a state writes back to the address that reads as it', () => {
  assert.equal(writeAddress(VENDOR_SCHEMA, '?archived=1', readAddress(VENDOR_SCHEMA, '?archived=1')), 'archived=1', 'archived is the page\'s own: left alone');
  const s = readAddress(VENDOR_SCHEMA, '?tier=critical,high&quick=overdue&view=board&id=4');
  assert.deepEqual(stateOf(def, s).chosen.tier, ['critical', 'high']);
  assert.deepEqual([stateOf(def, s).quick, stateOf(def, s).view, stateOf(def, s).id], ['overdue', 'board', 4]);
});

test('the applied chips name each filter in words', () => {
  const chips = appliedChips(def, state({ quick: 'tiering', chosen: { ...state().chosen, attention: ['no_owner'], owner: [NONE] } }), (facet) => def.facets.find((f) => f.key === facet)!.options(rows));
  assert.deepEqual(chips.map((c) => c.label), ['Needs tiering', 'Next step: No owner', 'Business owner: Unassigned']);
});

test('what a row says: dates, websites, the sub-line, the lifecycle', () => {
  assert.equal(websiteHref('acme.test'), 'https://acme.test');
  assert.equal(websiteHref(' http://a.b '), 'http://a.b');
  assert.equal(websiteHref(''), null);
  assert.equal(subline({ vendor_type: 'Software', industry: ' Marketing ' }), 'Software · Marketing');
  assert.equal(subline({ vendor_type: null, industry: null }), '');
  assert.equal(reviewIsLate(row({ next_reassessment_date: '2026-11-09T00:00:00' }), NOW), true);
  assert.equal(reviewIsLate(row({ next_reassessment_date: '2026-11-10T00:00:00' }), NOW), false, 'today is not late');
  assert.equal(reviewIsLate(row({ next_reassessment_date: '2026-11-09T00:00:00', archived_at: '2026-01-01T00:00:00' }), NOW), false, 'nothing is expected of an archived vendor');
  assert.equal(reviewIsLate(row({}), NOW), false);
  assert.equal(stageProgress('dd_planning'), '3 of 11 · Planning');
  assert.equal(stageProgress(null), 'Not started');
});
