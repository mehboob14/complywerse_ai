// node --test "src/components/compliance/onboarding/register/registerModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionOf, countsOf, familiesOf, filterRows, journeyWords, knownFamily, progressPercent, progressWords, sortValue, startRefusalWords, underwayWords, workspaceHref } from './registerModel.ts';

const row = (over: Record<string, unknown>) => ({
  uploaded_framework_id: 1, name: 'ISO/IEC 27001:2022', version: '2022', slug: 'iso_27001', family: 'iso_management', family_label: 'ISO management systems', label: 'ISO 27001',
  onboarding_id: null, state: 'not_started', journey: null, progress: null, updated_at: null, underway: null, ...over,
}) as Parameters<typeof actionOf>[0] & Parameters<typeof filterRows>[0][number];

const rows = [
  row({ uploaded_framework_id: 1 }),
  row({ uploaded_framework_id: 2, label: 'ISO 22301', name: 'ISO 22301', state: 'draft', onboarding_id: 7, progress: { done: 12, total: 30 } }),
  row({ uploaded_framework_id: 3, label: 'SOC 2', name: 'SOC 2 Type II', family: 'attestation', family_label: 'Attestation', state: 'complete', onboarding_id: 8, progress: { done: 20, total: 20 } }),
  row({ uploaded_framework_id: 4, label: 'PCI DSS', name: 'PCI DSS v4', family: 'payments', family_label: 'Payments', state: 'underway', onboarding_id: 9, journey: { id: 5, status: 'in_progress' }, underway: { kind: 'Other', at: null, legacy: true } }),
  row({ uploaded_framework_id: 5, label: 'Custom', name: 'My standard', family: 'general', family_label: 'Other frameworks', state: 'ready', onboarding_id: 10, progress: { done: 3, total: 3 } }),
];

test('a row has one action: Start, Continue or Open, and a link only once an onboarding exists', () => {
  assert.deepEqual(rows.map((r) => actionOf(r).label), ['Start', 'Continue', 'Open', 'Open', 'Open']);
  assert.deepEqual(rows.map((r) => actionOf(r).starts), [true, false, false, false, false]);
  assert.equal(workspaceHref(7), '/frameworks/onboarding/7');
});

test('the filters combine, and a chip counts what pressing it shows', () => {
  assert.equal(filterRows(rows, { state: 'all', family: '', q: '' }).length, 5);
  assert.deepEqual(filterRows(rows, { state: 'draft', family: '', q: '' }).map((r) => r.uploaded_framework_id), [2]);
  assert.deepEqual(filterRows(rows, { state: 'all', family: 'attestation', q: '' }).map((r) => r.uploaded_framework_id), [3]);
  assert.deepEqual(filterRows(rows, { state: 'all', family: '', q: '  iso ' }).map((r) => r.uploaded_framework_id), [1, 2]);
  assert.deepEqual(filterRows(rows, { state: 'all', family: '', q: 'type ii' }).map((r) => r.uploaded_framework_id), [3]);                // the library's own name
  assert.deepEqual(filterRows(rows, { state: 'draft', family: 'payments', q: '' }), []);
  assert.deepEqual(countsOf(rows, { family: '', q: '' }), { all: 5, not_started: 1, draft: 1, ready: 1, complete: 1, underway: 1 });
  assert.deepEqual(countsOf(rows, { family: '', q: 'iso' }), { all: 2, not_started: 1, draft: 1, ready: 0, complete: 0, underway: 0 });
});

test('families are listed by name, the general one last, and an unknown one in the address is no filter', () => {
  assert.deepEqual(familiesOf(rows).map((f) => [f.key, f.count]), [['attestation', 1], ['iso_management', 2], ['payments', 1], ['general', 1]]);
  assert.equal(knownFamily(rows, 'payments'), 'payments');
  assert.equal(knownFamily(rows, 'nonsense'), '');
  assert.equal(knownFamily(rows, ''), '');
});

test('progress and journey are said in words, never as nothing', () => {
  assert.deepEqual([progressWords(null), progressWords({ done: 12, total: 30 }), progressWords({ done: 0, total: 0 })], ['—', '12 of 30', 'Nothing required']);
  assert.deepEqual([progressPercent(null), progressPercent({ done: 12, total: 30 }), progressPercent({ done: 3, total: 3 }), progressPercent({ done: 9, total: 3 }), progressPercent({ done: 0, total: 0 })], [null, 40, 100, 100, 100]);
  assert.deepEqual([journeyWords(null), journeyWords({ id: 1, status: 'in_progress' }), journeyWords({ id: 1, status: 'on_hold' }), journeyWords({ id: 1, status: 'under_review' })], ['No journey', 'In progress', 'On hold', 'Under review']);
  assert.equal(underwayWords(null), '');
  assert.equal(underwayWords({ kind: 'Other', at: null, legacy: true }), 'Journey existed before onboarding');
  assert.equal(underwayWords({ kind: 'Regulator-mandated start', at: null, legacy: false }), 'Regulator-mandated start');
});

test('columns sort by state order, name and progress', () => {
  const sorted = [...rows].sort((a, b) => (sortValue(a, 'state') as number) - (sortValue(b, 'state') as number)).map((r) => r.state);
  assert.deepEqual(sorted, ['not_started', 'draft', 'ready', 'complete', 'underway']);
  assert.equal(sortValue(rows[0], 'name'), 'iso 27001');
  assert.equal(sortValue(rows[0], 'progress'), null);
  assert.equal(sortValue(rows[1], 'progress'), 40);
});

test('a refused start says who can do it, and a 404 says the framework is gone', () => {
  assert.match(startRefusalWords(403, 'Forbidden'), /right to edit frameworks/);
  assert.match(startRefusalWords(404, 'x'), /no longer in the library/);
  assert.equal(startRefusalWords(500, 'Something went wrong. Try again.'), 'Something went wrong. Try again.');
});
