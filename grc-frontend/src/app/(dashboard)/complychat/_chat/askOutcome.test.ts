// node --test "src/app/(dashboard)/complychat/_chat/askOutcome.test.ts"
// What each answer or failure of a request to Comply Agent is read as: a refusal by the data-protection guard is an answer in plain words (never "rephrase"),
// a failure says why in words and whether Retry can help, no status code or server text reaches the person, and a vendor name is masked.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { failureFor, readAnswer, REFUSED_HEADLINE, resultFor } from './askOutcome.ts';

const GUARD = 'AI was not used because the request still contained a secret or an account number.';

test('a plain answer is read with its sources and its paging; the missing parts have safe defaults', () => {
  const r = resultFor({ status: 200, body: { answer: '## Risks', sources: [{ entity_type: 'risks', kind: 'live_data' }, 7, null], has_more: true, total_count: 55, current_offset: 0, timestamp: 'x' } });
  assert.equal(r.kind, 'answer');
  if (r.kind !== 'answer') return;
  assert.deepEqual(r.data, { answer: '## Risks', outcome: 'answer', reason: undefined, sources: [{ entity_type: 'risks', kind: 'live_data' }], hasMore: true, totalCount: 55, currentOffset: 0 });
  assert.deepEqual(readAnswer({ answer: 'x' }), { answer: 'x', outcome: 'answer', reason: undefined, sources: [], hasMore: false, totalCount: undefined, currentOffset: undefined });
});

test('an answer from a server that does not know outcome (an older one) is an answer', () => {
  const data = readAnswer({ answer: 'Old server', sources: [], framework_filter: null, timestamp: 't', has_more: false, total_count: 0, current_offset: 0 });
  assert.equal(data?.outcome, 'answer');
});

test('an empty or missing answer is a failure the person can retry, never "No response received"', () => {
  for (const body of [{ answer: '' }, { answer: '   ' }, {}, null, 'text', { answer: 5 }]) {
    const r = resultFor({ status: 200, body });
    assert.equal(r.kind, 'failed');
    if (r.kind === 'failed') assert.deepEqual([r.failure.code, r.failure.retry], ['empty', true]);
  }
});

test('the server\'s refusal comes through as a refusal with the guard\'s own sentence, in a 200', () => {
  const r = resultFor({ status: 200, body: { answer: REFUSED_HEADLINE, outcome: 'blocked', blocked: { code: 'secret_survived', reason: GUARD }, sources: [] } });
  assert.equal(r.kind, 'answer');
  if (r.kind !== 'answer') return;
  assert.equal(r.data.outcome, 'blocked');
  assert.equal(r.data.answer, 'This question includes information that is not sent to the AI.');
  assert.equal(r.data.reason, GUARD);
});

test('a 403 from the guard\'s own handler is the same refusal, and a plain 403 is not', () => {
  const guard = resultFor({ status: 403, body: { detail: GUARD, code: 'ai_blocked', reason: 'secret_survived' } });
  assert.equal(guard.kind, 'answer');
  if (guard.kind === 'answer') assert.deepEqual([guard.data.outcome, guard.data.answer, guard.data.reason], ['blocked', REFUSED_HEADLINE, GUARD]);
  const plain = resultFor({ status: 403, body: { detail: 'Forbidden' } });
  assert.equal(plain.kind, 'failed');
  if (plain.kind === 'failed') assert.deepEqual([plain.failure.code, plain.failure.retry], ['forbidden', false]);
});

test('no refusal text ever tells the person to rephrase', () => {
  const words = [REFUSED_HEADLINE, GUARD, failureFor('ask', { status: 500 }).message, failureFor('ask', { status: 503 }).message];
  for (const w of words) assert.doesNotMatch(w, /rephras/i);
});

test('every way a request can end has words and a Retry decision, and none shows a status code', () => {
  const cases: [Parameters<typeof failureFor>[1], string, boolean][] = [
    [{ stopped: true }, 'stopped', true],
    [{ timedOut: true }, 'timeout', true],
    [{}, 'network', true],
    [{ status: 401 }, 'signin', false],
    [{ status: 403 }, 'forbidden', false],
    [{ status: 429 }, 'busy', true],
    [{ status: 503 }, 'unavailable', true],
    [{ status: 500 }, 'server', true],
    [{ status: 502 }, 'server', true],
    [{ status: 422 }, 'refusedInput', false],
    [{ status: 404 }, 'refusedInput', false],
  ];
  for (const [input, code, retry] of cases) {
    const f = failureFor('ask', input);
    assert.deepEqual([f.code, f.retry], [code, retry], JSON.stringify(input));
    assert.ok(f.message.length > 10 && !/\b\d{3}\b/.test(f.message), `${code}: ${f.message}`);
  }
  assert.equal(failureFor('ask', { stopped: true, timedOut: true, status: 500 }).code, 'stopped', 'Stop beats everything');
});

test('the server\'s technical text never reaches the person when asking; for an upload or a delete its plain sentence does', () => {
  const body = { detail: 'Traceback (most recent call last): File "x.py", line 1\nValueError: SQL grc_users failed' };
  assert.equal(failureFor('ask', { status: 500, body }).message.includes('Traceback'), false);
  assert.equal(failureFor('ask', { status: 422, body: { detail: [{ loc: ['body', 'message'], msg: 'field required' }] } }).message, 'Comply Agent could not take that.');
  assert.equal(failureFor('upload', { status: 400, body: { detail: "model.xlsx can't be attached. Use a text, Markdown, CSV, PDF, Word (.docx) or PowerPoint (.pptx) file." } }).message,
    "model.xlsx can't be attached. Use a text, Markdown, CSV, PDF, Word (.docx) or PowerPoint (.pptx) file.");
  assert.equal(failureFor('upload', { status: 413, body: { detail: 'big.csv is larger than 10 MB.' } }).message, 'big.csv is larger than 10 MB.');
  assert.equal(failureFor('delete', { status: 503, body: { detail: 'The files of this chat could not be removed from search yet. Nothing was deleted: try again in a moment.' } }).retry, true);
  assert.match(failureFor('delete', { status: 503, body: { detail: 'The files of this chat could not be removed from search yet. Nothing was deleted: try again in a moment.' } }).message, /Nothing was deleted/);
  assert.match(failureFor('delete', { status: 503 }).message, /Nothing was deleted/);
  assert.match(failureFor('delete', {}).message, /delete this chat/);
});

test('a vendor or model name in a server sentence is masked, as everywhere else', () => {
  const f = failureFor('upload', { status: 400, body: { detail: 'OpenAI rejected gpt-4o-mini input' } });
  assert.equal(/openai|gpt/i.test(f.message), false);
});
