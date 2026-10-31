// node --test "src/components/ui/ds/reportOutcome.test.ts"
// The words and the rules of the feedback standard (see reportOutcome.ts), and the order things happen in when a mutation runs under it
// (checked on React Query's own MutationObserver, so the lifecycle is the real one).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import {
  canRetry, confirmationToast, errorMessage, errorToast, reportOutcome, reportedMutationOptions, statusOf,
  ERROR_TITLE, SUCCESS_MS, type ReportedMutationConfig,
} from './reportOutcome.ts';

// ── fakes of what axios throws ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const http = (status: number, detail?: unknown) => ({ isAxiosError: true, message: `Request failed with status code ${status}`, response: { status, data: { detail } } });
const noAnswer = (code = 'ERR_NETWORK') => ({ isAxiosError: true, code, message: 'Network Error' });

// ── the words of a failure ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a failure says what the server said, cleaned', () => {
  assert.equal(errorMessage(http(409, 'The document is locked by Rana.')), 'The document is locked by Rana.');
  assert.equal(errorMessage(http(422, [{ loc: ['body', 'title'], msg: 'Field required' }])), 'Title: Field required.');
  assert.equal(errorMessage(http(502, '<html><body><h1>502 Bad Gateway</h1></body></html>')), '502 Bad Gateway');
  assert.equal(errorMessage(http(500, 'Import failed: duplicate key\n[SQL: INSERT INTO t VALUES (1)]\n[parameters: {}]')), 'Import failed: duplicate key');
  assert.equal(errorMessage(http(500, 'x'.repeat(1000))).length, 240);
});

test('a string is taken as the message, cleaned the same way', () => {
  assert.equal(errorMessage('Pick at least one document'), 'Pick at least one document');
  assert.equal(errorMessage('<b>Pick</b> one'), 'Pick one');
  assert.equal(errorMessage('   ', 'Nothing was selected'), 'Nothing was selected');
});

test('with nothing usable from the server the caller\'s fallback is said, else a plain line', () => {
  assert.equal(errorMessage(http(500), 'Failed to load users'), 'Failed to load users');
  assert.equal(errorMessage(http(500, { code: 'x' }), 'Failed to load users'), 'Failed to load users');
  assert.equal(errorMessage(http(500, 'Traceback (most recent call last):\n  File "/a.py", line 1, in x'), 'Failed to load users'), 'Failed to load users');
  assert.equal(errorMessage(http(500)), 'Please try again.');
  assert.equal(errorMessage(new Error('boom')), 'Please try again.');                 // an Error's own text is code talk: not shown
  assert.equal(errorMessage(undefined), 'Please try again.');
  assert.equal(errorMessage(null, ''), 'Please try again.');
});

test('a request that got no answer says the server could not be reached, unless the caller said better', () => {
  for (const code of ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT']) {
    assert.equal(errorMessage(noAnswer(code)), "Couldn't reach the server. Check your connection and try again.");
  }
  assert.equal(errorMessage(noAnswer(), 'Failed to load users'), 'Failed to load users');
  assert.equal(errorMessage({ isAxiosError: true, code: 'ERR_BAD_OPTION', message: 'bad' }), 'Please try again.');          // no answer, but not a network failure
  assert.equal(errorMessage(new TypeError('Cannot read properties of undefined')), 'Please try again.');                     // a bug is not "the server"
});

test('an error message is never empty and never longer than 240 characters', () => {
  for (const e of [undefined, null, '', 0, {}, [], new Error(''), http(500, ''), http(500, []), http(400, '<br/>'), 'y'.repeat(5000)]) {
    const m = errorMessage(e);
    assert.ok(m.length > 0 && m.length <= 240, JSON.stringify(e)?.slice(0, 40));
  }
});

// ── Retry ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Retry helps when the server could not be reached or had a problem, not when it refused the request', () => {
  assert.equal(statusOf(http(409)), 409);
  assert.equal(statusOf(noAnswer()), null);
  assert.equal(statusOf(new Error('x')), null);
  for (const status of [500, 502, 503, 504, 408, 425, 429]) assert.equal(canRetry(http(status)), true, String(status));
  for (const status of [400, 401, 403, 404, 409, 413, 422]) assert.equal(canRetry(http(status)), false, String(status));
  assert.equal(canRetry(noAnswer()), true);
  assert.equal(canRetry(new Error('x')), true);
  assert.equal(canRetry(undefined), true);
});

// ── notify.* → toast ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a confirmation is a short line that goes by itself after 3 seconds', () => {
  assert.equal(SUCCESS_MS, 3000);
  assert.deepEqual(confirmationToast('success', 'Document archived'), { title: 'Document archived', type: 'success', duration: 3000, action: undefined });
  assert.equal(confirmationToast('success', 'Saved', { duration: 8000 }).duration, 8000);
  assert.equal(confirmationToast('success', 'Saved', { duration: 0 }).duration, 0);
});

test('a warning or info keeps the toast default time; a title turns the line into its detail', () => {
  assert.equal(confirmationToast('warning', 'Two reviewers were not notified').duration, undefined);
  assert.equal(confirmationToast('info', 'Syncing').duration, undefined);
  assert.deepEqual(confirmationToast('warning', '2 of 5 files skipped', { title: 'Imported with warnings' }),
    { title: 'Imported with warnings', message: '2 of 5 files skipped', type: 'warning', duration: undefined, action: undefined });
  const undo = { label: 'Undo', onClick: () => {} };
  assert.equal(confirmationToast('info', 'Archived', { action: undo }).action, undo);
});

test('an error stays until dismissed, with a headline, the cleaned server words and, when given one, a Retry', () => {
  const retry = () => {};
  const t = errorToast(http(409, 'The document is locked by Rana.'), { title: "Couldn't archive the document", retry });
  assert.equal(t.type, 'error');
  assert.equal(t.duration, 0);
  assert.equal(t.title, "Couldn't archive the document");
  assert.equal(t.message, 'The document is locked by Rana.');
  assert.equal(t.action?.label, 'Retry');
  assert.equal(t.action?.onClick, retry);
  const plain = errorToast(http(500));
  assert.equal(plain.title, ERROR_TITLE);
  assert.equal(plain.message, 'Please try again.');
  assert.equal(plain.action, undefined);
  assert.equal(errorToast('Pick one', { title: '  ' }).title, ERROR_TITLE);
  assert.equal(errorToast(http(500), { fallback: 'Failed to load users' }).message, 'Failed to load users');
});

// ── what is said about a finished mutation ───────────────────────────────────────────────────────────────────────────────────────────────

const config = { success: 'Saved', failure: "Couldn't save" };

test('a success says the given words, or the function of what the server returned', () => {
  assert.deepEqual(reportOutcome({ ok: true, data: 1, variables: 2 }, config), { kind: 'success', message: 'Saved' });
  const count = { success: (d: { n: number }, v: { ids: number[] }) => `Archived ${d.n} of ${v.ids.length} documents`, failure: 'x' };
  assert.equal(reportOutcome({ ok: true, data: { n: 2 }, variables: { ids: [1, 2, 3] } }, count).message, 'Archived 2 of 3 documents');
});

test('wording that fails or says nothing never turns a saved record into a failure', () => {
  const throws = { success: (d: { items: unknown[] }) => `Archived ${d.items.length}`, failure: 'x' };
  assert.deepEqual(reportOutcome({ ok: true, data: {} as { items: unknown[] }, variables: 0 }, throws), { kind: 'success', message: 'Done' });
  assert.equal(reportOutcome({ ok: true, data: 0, variables: 0 }, { success: '', failure: 'x' }).message, 'Done');
  assert.equal(reportOutcome({ ok: true, data: 0, variables: 0 }, { success: () => '   ', failure: 'x' }).message, 'Done');
  assert.equal(reportOutcome({ ok: true, data: 0, variables: 0 }, { success: () => 5 as unknown as string, failure: 'x' }).message, 'Done');
});

test('a failure is never reported as a success, whatever went wrong and whatever the wording does', () => {
  const wording = { success: () => { throw new Error('must not be asked'); }, failure: "Couldn't save" };
  for (const error of [undefined, null, 'oops', 0, {}, new Error('x'), http(500, 'x'), http(422, []), noAnswer(), { response: {} }]) {
    const r = reportOutcome({ ok: false, error, variables: 1 }, wording);
    assert.equal(r.kind, 'error');
    assert.equal(r.title, "Couldn't save");
    assert.ok(r.message.length > 0);
  }
});

test('the failure headline falls back when the caller gave none', () => {
  assert.equal(reportOutcome({ ok: false, error: http(500), variables: 1 }, { success: 'x', failure: '  ' }).title, ERROR_TITLE);
  assert.equal(reportOutcome({ ok: false, error: http(500), variables: 1 }, { success: 'x' } as unknown as typeof config).title, ERROR_TITLE);
});

test('Retry runs the request again with the SAME variables, and is offered only when it can help', () => {
  const variables = { id: 7, data: { title: 'A' } };
  const reruns: unknown[] = [];
  const rerun = (v: unknown) => { reruns.push(v); };
  const r = reportOutcome({ ok: false, error: noAnswer(), variables }, config, rerun);
  assert.equal(typeof r.retry, 'function');
  r.retry?.();
  r.retry?.();
  assert.equal(reruns.length, 2);
  assert.equal(reruns[0], variables);                      // the very object, not a copy
  assert.equal(reruns[1], variables);
  assert.equal(typeof reportOutcome({ ok: false, error: http(503), variables }, config, rerun).retry, 'function');
  assert.equal(reportOutcome({ ok: false, error: http(409, 'locked'), variables }, config, rerun).retry, undefined);        // the same request would be refused again
  assert.equal(reportOutcome({ ok: false, error: http(422, []), variables }, config, rerun).retry, undefined);
  assert.equal(reportOutcome({ ok: false, error: noAnswer(), variables }, { ...config, retryable: false }, rerun).retry, undefined);          // not safe to repeat
  assert.equal(reportOutcome({ ok: false, error: noAnswer(), variables }, { ...config, retryable: true }, rerun).retry !== undefined, true);
  assert.equal(reportOutcome({ ok: false, error: noAnswer(), variables }, config).retry, undefined);                          // nothing to run it with
});

// ── a mutation under the standard, on React Query's real lifecycle ──────────────────────────────────────────────────────────────────────

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

function run<D, V>(overrides: Partial<ReportedMutationConfig<D, V>> & Pick<ReportedMutationConfig<D, V>, 'mutationFn'>) {
  const log: string[] = [];
  const retries: Array<(() => void) | undefined> = [];
  const observer: MutationObserver<D, Error, V> = new MutationObserver<D, Error, V>(new QueryClient(), reportedMutationOptions<D, V>(
    { success: 'Saved', failure: "Couldn't save", ...overrides },
    {
      notifySuccess: (m) => log.push(`success: ${m}`),
      notifyError: (m, o) => { log.push(`error: ${o.title} | ${m}${o.retry ? ' | retry' : ''}`); retries.push(o.retry); },
      invalidate: (key) => log.push(`invalidate ${JSON.stringify(key)}`),
      rerun: (v) => { observer.mutate(v).catch(() => {}); },
    },
  ));
  return { observer, log, retries, mutate: (v: V) => observer.mutate(v).catch(() => 'failed') };
}

test('nothing is said until the server has answered, then the confirmation is said exactly once', async () => {
  const server = deferred<string>();
  const m = run<string, number>({ mutationFn: () => server.promise });
  const done = m.mutate(1);
  await settle();
  assert.deepEqual(m.log, []);                               // the request is in flight: no "Saved" yet
  server.resolve('ok');
  await done;
  assert.deepEqual(m.log, ['success: Saved']);
});

test('a failure is said once and stays reported; the confirmation is never said and nothing is refreshed', async () => {
  const m = run<string, number>({ mutationFn: async () => { throw http(409, 'The document is locked by Rana.'); }, invalidate: [['documents']] });
  assert.equal(await m.mutate(1), 'failed');
  await settle();
  assert.deepEqual(m.log, ["error: Couldn't save | The document is locked by Rana."]);          // 409: no Retry
});

test('Retry after a failure runs the mutation again with the same variables and then confirms', async () => {
  const seen: unknown[] = [];
  let attempts = 0;
  const m = run<string, { id: number }>({
    mutationFn: async (v) => { seen.push(v); attempts += 1; if (attempts === 1) throw noAnswer(); return 'ok'; },
    invalidate: [['documents'], ['summary', 1]],
  });
  const variables = { id: 42 };
  await m.mutate(variables);
  assert.deepEqual(m.log, ["error: Couldn't save | Couldn't reach the server. Check your connection and try again. | retry"]);
  m.retries[0]?.();                                            // the person presses Retry
  await settle();
  assert.equal(seen.length, 2);
  assert.equal(seen[1], variables);                            // the same object
  assert.deepEqual(m.log.slice(1), ['success: Saved', 'invalidate ["documents"]', 'invalidate ["summary",1]']);
});

test('the confirmation comes first, then the refresh, then the page\'s own work; a failure is said before the page\'s own handler', async () => {
  const order: string[] = [];
  const ok = run<number, number>({ mutationFn: async (v) => v, invalidate: [['a']], onSuccess: (d, v) => { order.push(`page ${d} ${v}`); } });
  await ok.mutate(5);
  assert.deepEqual([...ok.log, ...order], ['success: Saved', 'invalidate ["a"]', 'page 5 5']);
  const bad = run<number, number>({ mutationFn: async () => { throw http(500, 'down'); }, onError: () => { order.push('page error'); } });
  await bad.mutate(1);
  assert.deepEqual(bad.log, ["error: Couldn't save | down | retry"]);
  assert.equal(order.at(-1), 'page error');
});

test('a page handler that throws after the server confirmed neither reports a failure nor offers a Retry that would write twice', async () => {
  const quiet = mock.method(console, 'error', () => {});
  try {
    let writes = 0;
    const m = run<string, number>({ mutationFn: async () => { writes += 1; return 'ok'; }, onSuccess: () => { throw new Error('page bug'); } });
    assert.equal(await m.mutate(1), 'ok');
    await settle();
    assert.deepEqual(m.log, ['success: Saved']);
    assert.equal(writes, 1);
    assert.equal(quiet.mock.callCount(), 1);                   // logged for the developer
  } finally {
    quiet.mock.restore();
  }
});

test('retryable: false offers no Retry even when the server could not be reached', async () => {
  const m = run<string, number>({ mutationFn: async () => { throw noAnswer(); }, retryable: false });
  await m.mutate(1);
  assert.deepEqual(m.log, ["error: Couldn't save | Couldn't reach the server. Check your connection and try again."]);
  assert.deepEqual(m.retries, [undefined]);
});

test('a mutation that returns nothing and takes no variables works the same', async () => {
  const m = run<void, void>({ mutationFn: async () => {}, success: 'Submitted' });
  await m.mutate(undefined);
  assert.deepEqual(m.log, ['success: Submitted']);
});
