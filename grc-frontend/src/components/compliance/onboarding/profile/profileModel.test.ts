// node --test "src/components/compliance/onboarding/profile/profileModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  afterSave, batchToSend, fieldMap, isWide, keyOf, mergeRefs, mirrorsOrganisation, nextStage, openingStage, profileLookup, refsOfCheck, refusalOf, SAVE_WORDS, saveState,
  stageProgress, stillNeeded, valueAt, visibleFields,
} from './profileModel.ts';
import { whenHolds } from '../fieldModel.ts';

const f = (key: string, type: string, level: string, extra: Record<string, unknown> = {}) => ({ key, label: key.replace(/_/g, ' '), type, level, note: 'n', ...extra }) as never;
const REG_COLS = [{ key: 'regulator', label: 'Regulator', type: 'text', required: true }, { key: 'country', label: 'Country', type: 'country', required: true }];
const GROUPS = [
  { key: 'entities_sites', label: 'Entities and sites', source: null, fields: [f('legal_entity', 'text', 'required', { maps_to: 'tenant.legal_entity' }), f('headcount', 'number', 'required'), f('units', 'departments_derived', 'advised'), f('notes', 'longtext', 'optional')] },
  { key: 'regulators_obligations', label: 'Regulators and obligations', source: null, fields: [
    f('regulators', 'table', 'required', { columns: REG_COLS, min_rows: 1, when: { field: 'regulators_obligations.no_regulator', ne: true } }),
    f('no_regulator', 'bool', 'optional'),
    f('regulator_note', 'text', 'advised', { when: { field: 'regulators_obligations.regulators', truthy: true } }),
  ] },
] as never[];
const CHECKS = [
  { key: 'regulators_or_none', label: 'Regulators listed, or none declared', level: 'required', hint: 'List the authorities, or tick that there are none.', check: { type: 'any_filled', fields: ['regulators_obligations.regulators', 'regulators_obligations.no_regulator'] } },
  { key: 'units_defined', label: 'Units defined', level: 'advised', hint: '', check: { type: 'count_at_least', field: 'entities_sites.units', n: 1 } },
] as never[];
const EVAL = {
  complete: false,
  groups: {
    entities_sites: { label: 'Entities and sites', required_total: 2, required_ok: 1, advised_open: 1, complete: false, reviewed: false },
    regulators_obligations: { label: 'Regulators and obligations', required_total: 1, required_ok: 0, advised_open: 0, complete: false, reviewed: false },
  },
  checks: [
    { key: 'regulators_or_none', label: 'Regulators listed, or none declared', ok: false, required: true, hint: 'List the authorities, or tick that there are none.' },
    { key: 'units_defined', label: 'Units defined', ok: false, required: false, hint: '' },
  ],
  missing: [{ group: 'entities_sites', field: 'headcount', label: 'headcount' }, { group: 'regulators_obligations', field: 'regulators', label: 'regulators' }],
} as never;

test('a stage says how many required fields are done, and nothing when it asks for none', () => {
  assert.deepEqual(stageProgress((EVAL as never as { groups: Record<string, never> }).groups.entities_sites), { done: 1, total: 2, text: '1 of 2', complete: false, reviewed: false });
  assert.equal(stageProgress({ label: 'x', required_total: 0, required_ok: 0, advised_open: 3, complete: true, reviewed: true }).text, '');
  assert.equal(stageProgress({ label: 'x', required_total: 7, required_ok: 7, advised_open: 0, complete: true, reviewed: true }).reviewed, true);
  assert.deepEqual(stageProgress(undefined), { done: 0, total: 0, text: '', complete: false, reviewed: false });
});

test('the page opens on the stage in the address, else the first with required fields open, else the first', () => {
  assert.equal(openingStage(GROUPS, 'regulators_obligations', EVAL), 'regulators_obligations');
  assert.equal(openingStage(GROUPS, 'nonsense', EVAL), 'entities_sites');
  assert.equal(openingStage(GROUPS, '', undefined), 'entities_sites');
  const done = { ...(EVAL as object), groups: { entities_sites: { ...(EVAL as { groups: Record<string, object> }).groups.entities_sites, complete: true }, regulators_obligations: (EVAL as { groups: Record<string, object> }).groups.regulators_obligations } } as never;
  assert.equal(openingStage(GROUPS, '', done), 'regulators_obligations');
  assert.equal(nextStage(GROUPS, 'entities_sites'), 'regulators_obligations');
  assert.equal(nextStage(GROUPS, 'regulators_obligations'), null);
});

test('typed values are read over the server\'s, and "org." in front of a reference is allowed', () => {
  const values = { entities_sites: { legal_entity: 'Old name' } };
  assert.equal(valueAt(values, {}, 'entities_sites.legal_entity'), 'Old name');
  assert.equal(valueAt(values, { 'entities_sites.legal_entity': 'New' }, 'org.entities_sites.legal_entity'), 'New');
  assert.equal(valueAt(values, {}, 'regulators_obligations.regulators'), undefined);
  assert.equal(Object.keys(fieldMap(GROUPS)).length, 7);
  assert.equal(keyOf('a', 'b'), 'a.b');
});

test('ticking "none" hides the list, and typing it back brings it back', () => {
  const g = GROUPS[1] as never as { key: string; fields: unknown[] };
  assert.deepEqual(visibleFields(g as never, GROUPS, {}).map((x) => x.key), ['regulators', 'no_regulator']);
  assert.deepEqual(visibleFields(g as never, GROUPS, { regulators_obligations: { no_regulator: true } }).map((x) => x.key), ['no_regulator']);
  assert.deepEqual(visibleFields(g as never, GROUPS, { regulators_obligations: { no_regulator: true } }, { 'regulators_obligations.no_regulator': false }).map((x) => x.key), ['regulators', 'no_regulator']);
});

test('a field that depends on a list is asked once the list has a complete row, and not while the list is hidden', () => {
  const g = GROUPS[1] as never;
  const row = { id: 'a', regulator: 'SBP', country: 'Pakistan' };
  assert.deepEqual(visibleFields(g, GROUPS, { regulators_obligations: { regulators: [row] } }).map((x) => x.key), ['regulators', 'no_regulator', 'regulator_note']);
  assert.deepEqual(visibleFields(g, GROUPS, { regulators_obligations: { regulators: [row], no_regulator: true } }).map((x) => x.key), ['no_regulator']);
  assert.equal(whenHolds({ field: 'regulators_obligations.no_regulator', ne: true }, profileLookup(GROUPS, {})), true);
});

test('a short field shares the row, a long one takes it; two fields mirror the organisation record', () => {
  assert.deepEqual(GROUPS.flatMap((g) => (g as never as { fields: never[] }).fields).map((x) => isWide(x)), [false, false, true, true, true, false, false]);
  assert.equal(mirrorsOrganisation(f('a', 'text', 'required', { maps_to: 'tenant.industry' })), true);
  assert.equal(mirrorsOrganisation(f('a', 'text', 'required')), false);
});

test('a check says which fields it reads, with or without "org."', () => {
  assert.deepEqual(refsOfCheck({ type: 'any_filled', fields: ['a.b', 'a.c'] }), ['a.b', 'a.c']);
  assert.deepEqual(refsOfCheck({ type: 'count_at_least', field: 'org.a.b', n: 1 }), ['a.b']);
  assert.deepEqual(refsOfCheck({ type: 'before', first: 'a.d1', second: 'a.d2' }), ['a.d1', 'a.d2']);
  assert.deepEqual(refsOfCheck(undefined), []);
});

test('still needed: required first (a failing check replaces the field it names), advice after, each with its stage', () => {
  const { required, advice } = stillNeeded(GROUPS, EVAL, CHECKS, {});
  assert.deepEqual(required.map((n) => [n.label, n.stage]), [['headcount', 'entities_sites'], ['Regulators listed, or none declared', 'regulators_obligations']]);
  assert.deepEqual(advice.map((n) => n.label), ['Units defined']);
  assert.equal(advice[0].stage, 'entities_sites');
  assert.equal(required[1].field, 'regulators');
});

test('still needed: an advised field with no answer is advice, and goes when answered or when it is not asked', () => {
  const values = { regulators_obligations: { regulators: [{ id: 'a', regulator: 'SBP', country: 'Pakistan' }] } };
  const some = stillNeeded(GROUPS, EVAL, CHECKS, values);
  assert.ok(some.advice.some((n) => n.key === 'regulators_obligations.regulator_note'));
  const answeredNote = stillNeeded(GROUPS, EVAL, CHECKS, values, { 'regulators_obligations.regulator_note': 'Annual filing' });
  assert.ok(!answeredNote.advice.some((n) => n.key === 'regulators_obligations.regulator_note'));
  assert.ok(!stillNeeded(GROUPS, EVAL, CHECKS, {}).advice.some((n) => n.key === 'regulators_obligations.regulator_note'), 'not asked while the list is empty');
  assert.deepEqual(stillNeeded(GROUPS, undefined, CHECKS, {}), { required: [], advice: [] });
});

test('a refusal puts each message under its field; one about no field, or about a removed row, is said once at the top', () => {
  const known = fieldMap(GROUPS);
  const field = refusalOf({ status: 422, message: 'Some answers could not be saved.', errors: [{ field: 'entities_sites.headcount', message: 'Enter 1 or more.' }, { field: 'x.y', message: 'Unknown field.' }], locked: [], usedBy: [], checks: [], code: null, onboardingId: null, state: null }, known);
  assert.deepEqual(field, { byField: { 'entities_sites.headcount': 'Enter 1 or more.' }, general: null });
  const general = refusalOf({ status: 422, message: 'Some answers could not be saved.', errors: [{ field: 'x.y', message: 'Unknown field.' }], locked: [], usedBy: [], checks: [], code: null, onboardingId: null, state: null }, known);
  assert.equal(general.general, 'Unknown field.');
  const used = refusalOf({ status: 409, message: 'A completed onboarding uses a row you removed.', errors: [{ field: 'rows', message: 'A completed onboarding uses a row you removed.' }], locked: [], usedBy: ['ISO 27001', 'SOC 2'], checks: [], code: null, onboardingId: null, state: null }, known);
  assert.equal(used.general, 'A completed onboarding uses a row you removed. Used by ISO 27001, SOC 2.');
  const net = refusalOf({ status: null, message: 'Something went wrong. Try again.', errors: [], locked: [], usedBy: [], checks: [], code: null, onboardingId: null, state: null }, known);
  assert.equal(net.general, 'Something went wrong. Try again.');
});

test('the status says nothing until a change, "Saving…" from the first key stroke, "Saved" after, "Not saved" when refused', () => {
  const s = (pending: boolean, saving: boolean, failed: boolean, saved: boolean) => SAVE_WORDS[saveState({ pending, saving, failed, saved })];
  assert.equal(s(false, false, false, false), '');
  assert.equal(s(true, false, false, false), 'Saving…');
  assert.equal(s(false, true, false, false), 'Saving…');
  assert.equal(s(false, false, false, true), 'Saved');
  assert.equal(s(true, false, true, true), 'Not saved');
});

test('only what the server has not refused is sent again; what was typed while saving stays pending', () => {
  const pending = { 'a.x': 'one', 'a.y': 'two', 'a.z': null };
  assert.deepEqual(batchToSend(pending, {}), pending);
  assert.deepEqual(batchToSend(pending, { 'a.x': JSON.stringify('one') }), { 'a.y': 'two', 'a.z': null });
  assert.deepEqual(batchToSend({ 'a.x': 'one!' }, { 'a.x': JSON.stringify('one') }), { 'a.x': 'one!' }, 'a changed value is tried again');
  assert.deepEqual(afterSave(pending, { 'a.x': 'one', 'a.y': 'two' }), { 'a.z': null });
  assert.deepEqual(afterSave({ 'a.x': 'one and more' }, { 'a.x': 'one' }), { 'a.x': 'one and more' });
  assert.deepEqual(afterSave({}, { 'a.x': 'one' }), {});
});

test('names picked on the page go over the server\'s, key by key', () => {
  const base = { users: { '1': 'A' }, assets: { '5': { name: 'Core banking', asset_type: 'application', criticality: 'high' } }, vendors: {}, departments: {} };
  const merged = mergeRefs(base, { users: { '2': 'B' }, vendors: { '9': 'Acme' } });
  assert.deepEqual(merged.users, { '1': 'A', '2': 'B' });
  assert.equal(merged.vendors['9'], 'Acme');
  assert.equal(merged.assets['5'].name, 'Core banking');
});
