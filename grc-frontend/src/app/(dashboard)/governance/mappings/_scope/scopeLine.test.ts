import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { scopeLine } from './scopeLine.ts';

test("in a document's Mappings view its editors (the owner among them) run and link, as the server allows, whatever the mapping rights", () => {
  const page = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes("const canCreate = canEdit ?? hasPermission('governance:mappings:create');"));
  assert.ok(page.includes("const canDelete = canEdit ?? hasPermission('governance:mappings:delete');"));
});

test('a refused run or link is told as a sentence, never a raw `detail` (a 422 list blanks the page)', () => {
  for (const f of ['../page.tsx', './MappingScope.tsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/set\w*Error\(\s*\w+\??\.response\?\.data\?\.detail/.test(src), `raw detail put on the page in ${f}`);
  }
});

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
