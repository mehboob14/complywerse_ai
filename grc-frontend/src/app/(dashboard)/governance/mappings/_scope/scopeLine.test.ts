import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scopeLine } from './scopeLine.ts';

const base = { running: false, error: '', saved: 0, picked: 0, last: null };

test('one line at a time: a run first, then the error, then nothing to map against, then the last run', () => {
  assert.equal(scopeLine({ ...base, running: true, error: 'x' }), 'running');
  // a pick not saved yet, and the run refused for want of statements: only the error, not "no frameworks" as well
  assert.equal(scopeLine({ ...base, picked: 1, error: 'This document has no statements yet.' }), 'error');
  assert.equal(scopeLine(base), 'none');
  assert.equal(scopeLine({ ...base, picked: 1 }), null);                       // the button says it: Save & run mapping
  assert.equal(scopeLine({ ...base, saved: 2, last: { status: 'completed', statements: 4 } }), 'completed');
  assert.equal(scopeLine({ ...base, saved: 2, last: { status: 'failed' } }), 'failed');
  assert.equal(scopeLine({ ...base, saved: 2, last: { status: 'skipped', message: 'Already running' } }), 'skipped');
  assert.equal(scopeLine({ ...base, saved: 2, last: { status: 'idle' } }), null);
});
