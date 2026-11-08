// node --test "src/app/(dashboard)/automation/soc2-controls/[code]/_workspace/testRunModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canConclude, concludeProblem, emptyQuick, emptyStart, inProgress, isQuickResult, parseItems, progress, quickBody, quickProblem, sampleProblem, signOffNote, sizeHint, startBody,
  startProblem, supported, testLine, type SampleRow, type TestRow,
} from './testRunModel.ts';

const S = (result: SampleRow['result'], seq = 1): SampleRow => ({ id: seq, seq, item_ref: `Item ${seq}`, result, note: null });

test('the samples support a rating only once every one has a result, as the server works it out', () => {
  assert.equal(supported([S('pass'), S(null, 2)], 0), null, 'one is still to do');
  assert.equal(supported([], 0), null);
  assert.equal(supported([S('pass'), S('pass', 2)], 0), 'effective');
  assert.equal(supported([S('pass'), S('exception', 2)], 0), 'ineffective', 'with no tolerance one exception is enough');
  assert.equal(supported([S('pass'), S('exception', 2)], 1), 'partially_effective');
  assert.equal(supported([S('exception'), S('exception', 2)], 1), 'ineffective');
  assert.equal(supported([S('not_applicable'), S('not_applicable', 2)], 0), null, 'all out of the count: nothing was tested');
  assert.equal(supported([S('not_applicable'), S('pass', 2)], 0), 'effective', 'not applicable items are out of the count');
});

test('progress counts what is done, what passed, what failed and what is open', () => {
  assert.deepEqual(progress([S('pass'), S('exception', 2), S(null, 3), S('not_applicable', 4)]), { done: 3, total: 4, exceptions: 1, passed: 1, open: 1 });
  assert.deepEqual(progress([]), { done: 0, total: 0, exceptions: 0, passed: 0, open: 0 });
});

test('a test can be concluded only while in progress with a result on every sample', () => {
  const t = (status: TestRow['status'], samples: SampleRow[]) => ({ status, samples });
  assert.equal(canConclude(t('in_progress', [S('pass'), S('pass', 2)])), true);
  assert.equal(canConclude(t('in_progress', [S('pass'), S(null, 2)])), false);
  assert.equal(canConclude(t('in_progress', [])), false);
  assert.equal(canConclude(t('completed', [S('pass')])), false);
});

test('concluding against the samples needs the tester\'s reason, in the server\'s words', () => {
  assert.match(concludeProblem(null, null, '') ?? '', /every sample first/);
  assert.equal(concludeProblem('effective', null, ''), null, 'accepting the rating needs no reason');
  assert.equal(concludeProblem('effective', 'effective', ''), null);
  assert.equal(concludeProblem('ineffective', 'partially_effective', 'A compensating check exists.'), null);
  assert.equal(concludeProblem('ineffective', 'partially_effective', ' '), 'The samples support “ineffective”. Say why you are concluding “partially effective” instead.');
});

test('an exception needs a note before it is recorded', () => {
  assert.equal(sampleProblem('exception', ''), 'Describe the exception before recording it.');
  assert.equal(sampleProblem('exception', 'Ticket 41 had no approval'), null);
  assert.equal(sampleProblem('pass', ''), null);
  assert.equal(sampleProblem('', ''), null, 'clearing a result needs nothing');
});

test('the test being sampled is the one to continue', () => {
  const tests = [{ id: 3, status: 'completed' }, { id: 2, status: 'in_progress' }, { id: 1, status: 'reviewed' }] as TestRow[];
  assert.equal(inProgress(tests)?.id, 2);
  assert.equal(inProgress([]), undefined);
});

test('signing off one\'s own test is allowed and said to be not independent', () => {
  assert.match(signOffNote({ tester_id: 7 }, 7) ?? '', /not independent/);
  assert.equal(signOffNote({ tester_id: 7 }, 8), null);
  assert.equal(signOffNote({ tester_id: 7 }, null), null);
  assert.equal(signOffNote({ tester_id: null }, null), null);
});

test('items typed one a line are trimmed and unique', () => {
  assert.deepEqual(parseItems(' INC-1 \r\nINC-2\n\nINC-1\n  \nINC-3'), ['INC-1', 'INC-2', 'INC-3']);
  assert.deepEqual(parseItems(''), []);
});

test('a sampled operating test needs a population, and a size or a frequency', () => {
  const f = { ...emptyStart(), frequency: 'quarterly' };
  assert.match(startProblem(f, 2) ?? '', /how many items/);
  assert.equal(startProblem({ ...f, count: '40' }, 2), null);
  assert.equal(startProblem({ ...f, populationMode: 'items', items: 'A\nB' }, 2), null);
  assert.equal(startProblem({ ...f, count: '40', frequency: '' }, null), 'Say how often the control operates, or give a sample size.');
  assert.equal(startProblem({ ...f, count: '40', frequency: '', size: '5' }, null), null, 'a size given makes the frequency unnecessary');
  assert.match(startProblem({ ...f, count: '40', size: '0' }, 2) ?? '', /at least 1/);
  assert.match(startProblem({ ...f, count: '40', tolerable: '-1' }, 2) ?? '', /0 to 100/);
  assert.equal(startProblem({ ...f, selection: 'judgmental' }, 2), null, 'a hand-picked sample needs no population');
});

test('a design test is one walkthrough and asks for no population', () => {
  assert.equal(startProblem({ ...emptyStart(), test_type: 'design' }, null), null);
  const body = startBody({ ...emptyStart(), test_type: 'design', count: '40' });
  assert.deepEqual(body, { test_type: 'design', selection_method: 'all', tolerable_exceptions: 0 });
});

test('the body sent to start a test carries only what was given', () => {
  assert.deepEqual(startBody({ ...emptyStart(), frequency: 'monthly', count: '120', tolerable: '1', description: ' tickets ' }),
    { test_type: 'operating', selection_method: 'random', tolerable_exceptions: 1, frequency: 'monthly', population_description: 'tickets', population_size: 120 });
  assert.deepEqual(startBody({ ...emptyStart(), populationMode: 'items', items: 'A\nB\nA', size: '2', selection: 'systematic' }),
    { test_type: 'operating', selection_method: 'systematic', tolerable_exceptions: 0, sample_size: 2, population_items: ['A', 'B'] });
});

test('the size hint says what is recommended, or how to get a recommendation', () => {
  assert.equal(sizeHint(25, 'Quarterly'), '25 items are recommended for a control that operates quarterly. Leave this empty to use that.');
  assert.equal(sizeHint(1, null), '1 item is recommended. Leave this empty to use that.');
  assert.match(sizeHint(null, null), /Choose how often/);
});

test('a quick result checks the numbers the server checks', () => {
  assert.equal(quickProblem(emptyQuick('quarterly')), null);
  assert.equal(quickProblem({ ...emptyQuick(null), sample: '10', exceptions: '11' }), 'Exceptions can’t exceed the sample size.');
  assert.equal(quickProblem({ ...emptyQuick(null), sample: '', exceptions: '3' }), null, 'no sample size recorded: nothing to exceed');
  assert.equal(quickProblem({ ...emptyQuick(null), sample: 'x' }), 'The sample size must be a whole number.');
  assert.deepEqual(quickBody({ ...emptyQuick('monthly'), sample: '', findings: ' none ' }), { test_type: 'operating', result: 'effective', sample_size: null, exceptions_found: 0, findings: 'none', frequency: 'monthly' });
});

test('a test with no samples is a quick result, corrected in place', () => {
  assert.equal(isQuickResult({ samples: [] }), true);
  assert.equal(isQuickResult({ samples: [S('pass')] }), false);
  assert.equal(testLine({ test_type: 'operating', sample_size: 25, exceptions_found: 2, samples: [] }), 'Operating test · 25 sampled · 2 exceptions');
  assert.equal(testLine({ test_type: 'design', sample_size: null, exceptions_found: 1, samples: [S('pass')] }), 'Design test · 1 sampled · 1 exception');
  assert.equal(testLine({ test_type: 'design', sample_size: null, exceptions_found: 0, samples: [] }), 'Design test');
});
