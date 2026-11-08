// node --test "src/components/assessments/workspace/workspaceModel.test.ts"
// The workspace's decisions: the address, the tabs of each kind of assessment, the one grade system, who is offered what.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { actionsFor, answeredShare, defaultTabFor, entryOf, gradeOf, headFacts, idOfParam, readOnlyFor, scoreView, tabsFor, workspaceHref, type TabInput } from './workspaceModel.ts';
import type { LensDef } from './lens.ts';
import type { OverviewResult } from './types.ts';

const lens = (key: string, label: string, slot: LensDef['slot'] = 'tab'): LensDef => ({ key, label, slot, appliesTo: () => true, Component: (() => null) as unknown as LensDef['Component'] });
const base: TabInput = { scoped: false, phase: null, totalItems: 280, openGaps: 14, controls: null, lensTabs: [] };

test('the address: a positive whole number is an assessment, anything else is not', () => {
  assert.equal(workspaceHref(12), '/assessments/a/12');
  assert.equal(idOfParam('12'), 12);
  assert.equal(idOfParam(['7']), 7);
  for (const bad of ['0', '-1', '1.5', 'abc', '12abc', '', undefined, '99999999999']) assert.equal(idOfParam(bad as string | undefined), null, String(bad));
});

test('tabs of an uploaded assessment: Controls and Remediation, then the lens tabs; a lens may rename Controls', () => {
  assert.deepEqual(tabsFor(base), [{ key: 'controls', label: 'Controls', count: 280 }, { key: 'remediation', label: 'Remediation', count: 14 }]);
  assert.deepEqual(tabsFor({ ...base, controls: lens('maturity', 'Capabilities', 'controls'), lensTabs: [lens('artifacts', 'Artifacts')] }).map((t) => t.label), ['Capabilities', 'Remediation', 'Artifacts']);
  assert.deepEqual(tabsFor({ ...base, openGaps: null })[1], { key: 'remediation', label: 'Remediation' }, 'a board that does not count it gives no number, never 0');
});

test('tabs of a scoped assessment: a draft shows its stages with the controls waiting; once started they follow the controls', () => {
  const draft = tabsFor({ ...base, scoped: true, phase: 'scoping', totalItems: 0 });
  assert.deepEqual(draft.map((t) => [t.key, !!t.disabled]), [['scope', false], ['people', false], ['plan', false], ['controls', true]]);
  const started = tabsFor({ ...base, scoped: true, phase: 'in_progress' });
  assert.deepEqual(started.map((t) => t.key), ['controls', 'remediation', 'scope', 'people', 'plan']);
  assert.equal(defaultTabFor({ scoped: true, phase: 'scoping' }), 'scope');
  assert.equal(defaultTabFor({ scoped: true, phase: 'in_progress' }), 'controls');
  assert.equal(defaultTabFor({ scoped: false, phase: null }), 'controls');
});

test('one grade system: 85, 70, 50; no score, no grade', () => {
  assert.deepEqual([100, 85, 84.9, 70, 69.9, 50, 49.9, 0].map(gradeOf), ['excellent', 'excellent', 'good', 'good', 'fair', 'fair', 'poor', 'poor']);
  assert.equal(gradeOf(null), null);
  assert.equal(gradeOf(undefined), null);
  assert.equal(gradeOf(Number.NaN), null);
});

const RESULT: OverviewResult = {
  as_of: '2026-03-01T00:00:00',
  categories: [{ category: 'Cyber Security', assessments: [{ id: 5, name: 'ASVS', format: 'asvs_checklist', family: 'asvs', item_noun: 'requirements', status: 'in_progress', n_items: 280, content: 62.4, sla: 64, sla_counts: { gaps: 14, closed: 2, open: 12, overdue: 3 } }] }],
};

test('the score is the board\'s entry for this assessment; an assessment the board does not count says so instead of reading 0', () => {
  assert.equal(entryOf(RESULT, 5)?.name, 'ASVS');
  assert.equal(entryOf(RESULT, 6), null);
  assert.equal(entryOf({ as_of: '', categories: [] }, 5), null);
  assert.equal(entryOf(null, 5), null);
  assert.deepEqual(scoreView(entryOf(RESULT, 5)), { counted: true, score: 62.4, grade: 'fair', sla: 64 });
  assert.deepEqual(scoreView(null), { counted: false, score: null, grade: null, sla: null });
  assert.deepEqual(scoreView({ ...RESULT.categories[0].assessments[0], content: null, sla: null }), { counted: true, score: null, grade: null, sla: null }, 'counted but nothing answered');
});

test('who is offered what: a scoped draft starts and is discarded; a started or uploaded assessment completes, reopens, exports, refreshes (uploads only); a read-only person is offered nothing that writes', () => {
  const draft = actionsFor({ phase: 'scoping', status: 'draft', scoped: true, readOnly: false, format: 'asvs_checklist' });
  assert.deepEqual([draft.start, draft.discard, draft.complete, draft.remove, draft.exportFile, draft.addControl], [true, true, false, false, false, false]);
  const upload = actionsFor({ phase: null, status: 'draft', scoped: false, readOnly: false, format: 'standard' });
  assert.deepEqual([upload.start, upload.complete, upload.reopen, upload.refresh, upload.remove, upload.exportFile, upload.addControl], [false, true, false, true, true, true, true]);
  const done = actionsFor({ phase: null, status: 'completed', scoped: false, readOnly: false, format: 'standard' });
  assert.deepEqual([done.complete, done.reopen], [false, true]);
  const started = actionsFor({ phase: 'in_progress', status: 'in_progress', scoped: true, readOnly: false, format: 'asvs_checklist' });
  assert.equal(started.refresh, false, 'its questions were copied from the template: there is no workbook to read again');
  assert.equal(actionsFor({ phase: null, status: 'draft', scoped: false, readOnly: false, format: 'nca_container' }).refresh, false);
  const look = actionsFor({ phase: null, status: 'in_progress', scoped: false, readOnly: true, format: 'standard' });
  assert.deepEqual([look.start, look.discard, look.complete, look.reopen, look.editDetails, look.refresh, look.remove, look.addControl, look.exportFile], [false, false, false, false, false, false, false, false, true], 'export only reads');
  assert.equal(readOnlyFor(true), false);
  assert.equal(readOnlyFor(false), true);
});

test('heading facts and the answered share', () => {
  assert.deepEqual(headFacts({ assessment_format: 'asvs_checklist', phase: 'in_progress', status: 'in_progress' }), { kind: 'OWASP ASVS', category: 'Cyber Security', lifecycle: 'in_progress' });
  assert.equal(headFacts({ assessment_format: 'asvs_checklist', phase: 'scoping', status: 'draft' }).lifecycle, 'scoping');
  assert.deepEqual(answeredShare({ total_items: 40, in_progress_count: 12 }), { answered: 28, total: 40 });
  assert.deepEqual(answeredShare({ total_items: null, in_progress_count: null }), { answered: 0, total: 0 });
});
