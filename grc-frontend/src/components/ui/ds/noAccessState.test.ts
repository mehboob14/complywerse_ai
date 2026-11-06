// node --test "src/components/ui/ds/noAccessState.test.ts"
// Source-text contract for NoAccessState (like displayContract.test.ts: there is no React renderer in this repo): it is a status and never an
// alert, it always draws a title, the reason and the action appear only when given, and both barrels export it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (url: string): string => readFileSync(new URL(url, import.meta.url), 'utf8');
const code = (name: string): string => read(`./${name}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

test('NoAccessState is a status, not an alert: nobody failed, the person was turned away', () => {
  const state = code('NoAccessState.tsx');
  assert.match(state, /role="status"/);
  assert.doesNotMatch(state, /role="alert"|aria-live/);
});

test('NoAccessState always says what happened; the reason and the action are drawn only when given', () => {
  const state = code('NoAccessState.tsx');
  assert.match(state, /title = "You don't have access to this page"/);                    // overridable, never empty by default
  assert.match(state, /\{reason && <p /);
  assert.match(state, /\{action && <div /);
  assert.match(state, /<span aria-hidden /);                                                // the padlock is decoration; the words carry the meaning
  assert.doesNotMatch(state, /#[0-9a-f]{3,8}\b/i);                                          // colours are the tokens'
});

test('both barrels export NoAccessState', () => {
  for (const barrel of ['./index.ts', '../index.ts']) {
    assert.match(read(barrel), /export \{ NoAccessState, type NoAccessStateProps \} from '\.\/(?:ds\/)?NoAccessState'/, barrel);
  }
});
