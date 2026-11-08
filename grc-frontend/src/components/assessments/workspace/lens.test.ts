// node --test "src/components/assessments/workspace/lens.test.ts"
// The lens contract of the assessment workspace: which lens draws which assessment, the rules a registry must keep.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BUILT_IN_TABS, registryProblem, resolveLenses, type LensContext, type LensDef } from './lens.ts';

const nothing = (() => null) as unknown as LensDef['Component'];
const def = (key: string, slot: LensDef['slot'], formats: string[]): LensDef => ({ key, label: key.toUpperCase(), slot, appliesTo: (c) => formats.includes(c.format), Component: nothing });
const ctx = (format: string, scoped = false, phase: LensContext['phase'] = null): LensContext => ({ format, scoped, phase });

const DEFS = [def('asvs', 'controls', ['asvs_checklist']), def('maturity', 'controls', ['xlsx_maturity', 'asvs_checklist']), def('artifacts', 'tab', ['asvs_checklist', 'standard']), def('workbook', 'tab', ['xlsx_maturity'])];

test('the first lens of the controls slot that applies wins, every tab lens that applies is added in registry order', () => {
  const asvs = resolveLenses(DEFS, ctx('asvs_checklist'));
  assert.equal(asvs.controls?.key, 'asvs', 'asvs is listed before maturity, which also applies');
  assert.deepEqual(asvs.tabs.map((t) => t.key), ['artifacts']);
  const maturity = resolveLenses(DEFS, ctx('xlsx_maturity'));
  assert.equal(maturity.controls?.key, 'maturity');
  assert.deepEqual(maturity.tabs.map((t) => t.key), ['workbook']);
});

test('an assessment no lens is made for gets the built-in controls and no extra tab', () => {
  assert.deepEqual(resolveLenses(DEFS, ctx('pdpl_assessment_toolkit')), { controls: null, tabs: [] });
  assert.deepEqual(resolveLenses([], ctx('asvs_checklist')), { controls: null, tabs: [] });
  assert.deepEqual(resolveLenses(DEFS, ctx('standard')).tabs.map((t) => t.key), ['artifacts'], 'a tab lens alone leaves the controls built in');
  assert.equal(resolveLenses(DEFS, ctx('standard')).controls, null);
});

test('a scoped draft has no questions yet, so no lens draws it; once started the lens applies', () => {
  assert.deepEqual(resolveLenses(DEFS, ctx('asvs_checklist', true, 'scoping')), { controls: null, tabs: [] });
  assert.equal(resolveLenses(DEFS, ctx('asvs_checklist', true, 'in_progress')).controls?.key, 'asvs');
});

test('registryProblem: keys are unique tab-shaped words and never a built-in tab', () => {
  assert.equal(registryProblem(DEFS), '');
  assert.equal(registryProblem([]), '');
  assert.match(registryProblem([def('asvs', 'tab', []), def('asvs', 'tab', [])]), /twice/);
  for (const reserved of BUILT_IN_TABS) assert.match(registryProblem([def(reserved, 'tab', [])]), /built-in/, reserved);
  assert.match(registryProblem([def('Not Ok', 'tab', [])]), /lower case/);
  assert.match(registryProblem([{ ...def('x', 'tab', []), label: ' ' }]), /no label/);
});
