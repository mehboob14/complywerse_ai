// node --test "src/app/(dashboard)/automation/soc2-controls/[code]/_workspace/workspaceModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TABS, TAB_ALIASES, arrival, controlAddress, initialOpen, scrollTarget, feedIsCut, feedOf, groupCounts, levelWords, maturityGap, nextStep, runReport, suggestedLevel, testOverdue,
  type StepInput,
} from './workspaceModel.ts';

test('every tab of the old page still opens something: its own name, or the tab that holds its content now', () => {
  const OLD = ['overview', 'fields', 'assurance', 'evidence', 'tests', 'artifacts', 'risks', 'assets', 'links', 'regulatory', 'requirements', 'history'];
  for (const old of OLD) {
    const tab = arrival(old).tab;
    assert.ok((TABS as readonly string[]).includes(tab), `${old} -> ${tab}`);
  }
  assert.equal(arrival('tests').tab, 'testing');
  assert.equal(arrival('assurance').tab, 'testing');
  assert.equal(arrival('evidence').tab, 'evidence');
  assert.equal(arrival('links').tab, 'links');
  assert.equal(arrival('history').tab, 'activity');
  assert.equal(arrival('artifacts').tab, 'evidence');
  assert.deepEqual(Object.keys(TAB_ALIASES).filter((k) => (TABS as readonly string[]).includes(k)), [], 'an alias never shadows a tab');
});

test('an unknown or empty ?tab= opens the Summary, in any letter case', () => {
  assert.equal(arrival(null).tab, 'summary');
  assert.equal(arrival('').tab, 'summary');
  assert.equal(arrival('nonsense').tab, 'summary');
  assert.equal(arrival('TESTS').tab, 'testing');
});

test('a link from the Overview or Connections opens the work it was about', () => {
  assert.deepEqual(arrival('tests'), { tab: 'testing', open: ['plan', 'automated'] });
  assert.deepEqual(arrival('assurance'), { tab: 'testing', open: ['results'] });
  assert.deepEqual(arrival('risks'), { tab: 'links', open: ['risks'] });
  assert.deepEqual(arrival('artifacts'), { tab: 'evidence', open: ['documents'] });
  assert.deepEqual(arrival('summary'), { tab: 'summary', open: [] });
});

test('a section named in the address wins, but only a section of that tab', () => {
  assert.deepEqual(arrival('testing', 'sampling'), { tab: 'testing', open: ['sampling'] });
  assert.deepEqual(arrival('tests', 'procedures'), { tab: 'testing', open: ['procedures'] });
  assert.deepEqual(arrival('links', 'regulatory'), { tab: 'links', open: ['regulatory'] });
  assert.deepEqual(arrival('testing', 'regulatory'), { tab: 'testing', open: ['results', 'plan'] }, 'a section of another tab is ignored');
});

test('the address of a control and its tab is the one the old links used', () => {
  assert.equal(controlAddress('IAC-06'), '/automation/soc2-controls/IAC-06');
  assert.equal(controlAddress('IAC-06', 'testing', 'results'), '/automation/soc2-controls/IAC-06?tab=testing&section=results');
  assert.equal(controlAddress('CUS/01 a', 'evidence'), '/automation/soc2-controls/CUS%2F01%20a?tab=evidence');
  assert.equal(controlAddress('IAC-06', 'summary'), '/automation/soc2-controls/IAC-06');
});

const BASE: StepInput = {
  overall_status: 'passed', checks_count: 2, applicable: true, has_owner: true, pending_request: false, can_decide: false, can_assign: true, can_run: true,
  test_overdue: false, tested: true, evidence_missing: 0, evidence_failing: 0,
};

test('the next step is one rule, in order: a decision, a failing test, no owner, a late test, evidence, a source, a first test', () => {
  assert.equal(nextStep(BASE), null, 'nothing needs anyone');
  assert.equal(nextStep({ ...BASE, pending_request: true, can_decide: true, overall_status: 'failed', has_owner: false })?.id, 'decide');
  assert.equal(nextStep({ ...BASE, pending_request: true, can_decide: false })?.id, undefined, 'a request the person cannot rule on is not their next step');
  assert.equal(nextStep({ ...BASE, overall_status: 'failed', has_owner: false })?.id, 'fix');
  assert.equal(nextStep({ ...BASE, has_owner: false, test_overdue: true })?.id, 'owner');
  assert.equal(nextStep({ ...BASE, test_overdue: true, evidence_missing: 2 })?.id, 'overdue');
  assert.equal(nextStep({ ...BASE, evidence_missing: 2 })?.id, 'evidence');
  assert.equal(nextStep({ ...BASE, evidence_failing: 1 })?.id, 'evidence');
  assert.equal(nextStep({ ...BASE, overall_status: 'connect_one' })?.id, 'connect');
  assert.equal(nextStep({ ...BASE, tested: false })?.id, 'test');
});

test('a control that does not apply asks for nothing (except a pending decision)', () => {
  assert.equal(nextStep({ ...BASE, applicable: false, overall_status: 'failed', has_owner: false, tested: false }), null);
  assert.equal(nextStep({ ...BASE, applicable: false, pending_request: true, can_decide: true })?.id, 'decide');
});

test('the step names a button the person can press, or sends them to read', () => {
  const fail = nextStep({ ...BASE, overall_status: 'failed', can_run: false });
  assert.deepEqual(fail?.go, { tab: 'testing', section: 'automated' });
  assert.equal(fail?.action, 'See the tests');
  const run = nextStep({ ...BASE, overall_status: 'failed' });
  assert.deepEqual(run?.go, { act: 'run' });
  assert.equal(nextStep({ ...BASE, has_owner: false, can_assign: false })?.action, null, 'a step the person cannot take has no button');
  assert.equal(nextStep({ ...BASE, evidence_missing: 1 })?.text, '1 piece of required evidence needs attention.');
  assert.equal(nextStep({ ...BASE, evidence_missing: 3 })?.text, '3 pieces of required evidence need attention.');
});

test('a test is overdue only once its date has passed', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  assert.equal(testOverdue('2026-11-07T00:00:00', now), true);
  assert.equal(testOverdue('2026-11-08', now), true, 'a date with no time is its midnight');
  assert.equal(testOverdue('2026-12-01T00:00:00', now), false);
  assert.equal(testOverdue(null, now), false);
  assert.equal(testOverdue('not a date', now), false);
});

test('Run tests always reports: how many ran, how many could not, and why', () => {
  assert.deepEqual(runReport([]).tone, 'warning');
  const allOk = runReport([{ title: 'A', ok: true, status: 'passed' }, { title: 'B', ok: true, status: 'passed' }]);
  assert.equal(allOk.tone, 'success');
  assert.equal(allOk.message, '2 of 2 tests ran.');
  const someFailing = runReport([{ title: 'A', ok: true, status: 'passed' }, { title: 'B', ok: true, status: 'failed' }]);
  assert.equal(someFailing.message, '2 of 2 tests ran, 1 did not pass.');
  const partial = runReport([{ title: 'A', ok: true, status: 'passed' }, { title: 'AWS check', ok: false, error: 'Connect AWS first.' }]);
  assert.equal(partial.tone, 'warning');
  assert.equal(partial.title, '1 test could not run');
  assert.match(partial.message, /1 of 2 tests ran\. AWS check: Connect AWS first\./);
  const none = runReport([{ title: 'A', ok: false, error: 'You need the right to run scans.' }]);
  assert.deepEqual(none, { tone: 'error', title: 'No test could run', message: 'You need the right to run scans.' });
  assert.equal(runReport([{ title: 'A', ok: false }]).message, 'The tests could not be started. Try again.', 'a failure with no words still says something');
});

test('the feed is newest first, one sentence a row, and never a bare user id', () => {
  const rows = feedOf([
    { id: 1, summary: 'Assigned an owner', actor_name: 'Ana', created_at: '2026-11-01T10:00:00' },
    { id: 2, action: 'procedure_update', actor_name: null, created_at: '2026-11-03T10:00:00' },
    { id: 3, summary: '  ', action: null, actor_name: '  ', created_at: null },
  ]);
  assert.deepEqual(rows.map((r) => r.what), ['Procedure update', 'Assigned an owner', 'A change']);
  assert.deepEqual(rows.map((r) => r.who), ['Someone', 'Ana', 'Someone']);
  assert.equal(feedOf([{ summary: 'a', created_at: '2026-11-01T00:00:00' }, { summary: 'b', created_at: '2026-11-02T00:00:00' }], 1)[0].what, 'b');
  assert.equal(JSON.stringify(rows).includes('User '), false);
});

test('a full feed says it was cut', () => {
  assert.equal(feedIsCut(new Array(99).fill(0)), false);
  assert.equal(feedIsCut(new Array(100).fill(0)), true);
});

test('maturity is said in SCF words and the gap in a sentence', () => {
  assert.equal(levelWords(3), 'Level 3 · Well defined');
  assert.equal(levelWords(null), null);
  assert.equal(levelWords(9), null);
  assert.equal(maturityGap(null, 3), null);
  assert.equal(maturityGap(3, 3), 'At or above the target.');
  assert.equal(maturityGap(2, 3), '1 level below the target.');
  assert.equal(maturityGap(0, 3), '3 levels below the target.');
  assert.equal(suggestedLevel('satisfactory'), 3);
  assert.equal(suggestedLevel('deficient'), 1);
  assert.equal(suggestedLevel('not_assessed'), null);
  assert.equal(suggestedLevel('toString'), null, 'a word the map does not own is not a rating');
});

test('framework counts read as a short line', () => {
  assert.equal(groupCounts([{ label: 'SOC 2', count: 4 }, { label: 'ISO 27001', count: 12 }]), 'SOC 2 (4), ISO 27001 (12)');
  assert.equal(groupCounts([1, 2, 3, 4, 5].map((n) => ({ label: `F${n}`, count: n }))), 'F1 (1), F2 (2), F3 (3) and 2 more');
});

test('the first time a working tab is reached by its tab it opens what people read first; a link that names the work opens that, and the other tabs keep their defaults', () => {
  const plain = initialOpen(arrival('summary'));
  assert.deepEqual(plain.sort(), ['linked', 'plan', 'required', 'requirements', 'results', 'risks']);
  const tests = initialOpen(arrival('tests'));
  assert.ok(tests.includes('automated') && tests.includes('plan') && !tests.includes('results'), 'testing opens as the link asked');
  assert.ok(tests.includes('required') && tests.includes('requirements'), 'the other tabs keep their defaults');
  const named = initialOpen(arrival('testing', 'sampling'));
  assert.ok(named.includes('sampling') && !named.includes('results'));
});

test('an address scrolls only to work that is not at the top of its tab', () => {
  assert.equal(scrollTarget('assurance'), 'results', 'the Results are below the Plan');
  assert.equal(scrollTarget('risks'), 'risks');
  assert.equal(scrollTarget('requirements'), null, 'the Requirements are the first section of Links');
  assert.equal(scrollTarget('tests'), null, 'the Plan is the first section of Testing');
  assert.equal(scrollTarget('testing'), null, 'a plain tab stays at the top');
  assert.equal(scrollTarget('testing', 'sampling'), 'sampling', 'a named section is scrolled to');
  assert.equal(scrollTarget('summary', 'sampling'), null);
  assert.equal(scrollTarget(null), null);
});
