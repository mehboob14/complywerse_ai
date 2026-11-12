// node --test "src/app/(dashboard)/governance/documents/_workspace/folders/foldersAddress.test.ts"
// The Properties popup's address and where the old Directory's addresses go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { readAddress, writeAddress } from '../../../../../../lib/addressState.ts';
import { PROPS_SCHEMA, directoryQuery } from './foldersAddress.ts';

test('the old Directory address forwards to the library\'s Folders layout; ?unit= is the Department filter (the folder you were in)', () => {
  assert.equal(directoryQuery({}), '?view=folders');
  assert.equal(directoryQuery(undefined), '?view=folders');
  assert.equal(directoryQuery({ unit: '1' }), '?view=folders&dept=1');
  assert.equal(directoryQuery({ unit: ['4', '5'] }), '?view=folders&dept=4', 'the first one');
});

test('?open=<unit>&tab=<tab> is the Properties popup of the library: ?props=...&tab=...', () => {
  assert.equal(directoryQuery({ unit: '1', open: '2', tab: 'access' }), '?view=folders&dept=1&props=2&tab=access');
  assert.equal(directoryQuery({ open: '2', tab: 'approvals' }), '?view=folders&props=2&tab=approvals');
  assert.equal(directoryQuery({ open: '2' }), '?view=folders&props=2', 'the first tab is the default');
  assert.equal(directoryQuery({ open: '2', tab: 'details' }), '?view=folders&props=2');
  assert.equal(directoryQuery({ open: 'org', tab: 'exceptions' }), '?view=folders&props=org&tab=exceptions');
  assert.equal(directoryQuery({ open: 'ORG' }), '?view=folders&props=org');
  assert.equal(directoryQuery({ unit: '1', open: '2', tab: 'Access' }), '?view=folders&dept=1&props=2&tab=access', 'any case');
});

test('what is not usable is left out: an id that is not a number, an unknown tab, a tab with no popup, the view of the old page and every other name', () => {
  assert.equal(directoryQuery({ unit: 'x' }), '?view=folders');
  assert.equal(directoryQuery({ unit: '1.5', open: '-2' }), '?view=folders');
  assert.equal(directoryQuery({ open: '2', tab: 'nonsense' }), '?view=folders&props=2');
  assert.equal(directoryQuery({ tab: 'access' }), '?view=folders', 'a tab with no popup');
  assert.equal(directoryQuery({ view: 'details', unit: '3', q: 'x', status: 'draft' }), '?view=folders&dept=3');
  assert.equal(directoryQuery({ unit: '12345678901234' }), '?view=folders');
});

test('the popup\'s two names are a schema of their own: they round-trip and the library\'s own names are left alone', () => {
  const read = (qs: string) => readAddress(PROPS_SCHEMA, qs);
  assert.deepEqual(read('props=2&tab=access'), { props: '2', tab: 'access' });
  assert.deepEqual(read(''), { props: '', tab: 'details' });
  assert.deepEqual(read('tab=nonsense'), { props: '', tab: 'details' });
  assert.equal(writeAddress(PROPS_SCHEMA, 'view=folders&dept=1&open=9', { props: '2', tab: 'people' }), 'view=folders&dept=1&open=9&props=2&tab=people');
  assert.equal(writeAddress(PROPS_SCHEMA, 'view=folders&props=2&tab=people&open=9', { props: '', tab: 'details' }), 'view=folders&open=9', 'closing it leaves the library as it was, a document\'s details included');
});

test('the old route is a server redirect that uses this mapping, and nothing else of the Directory page is left on the route', () => {
  const page = readFileSync(new URL('../../directory/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes("import { redirect } from 'next/navigation'") && page.includes('redirect(`/governance/documents${directoryQuery(searchParams)}`)'));
  assert.ok(!page.includes("'use client'"), 'a server redirect: no flash of an empty page');
  assert.ok(page.includes("export const dynamic = 'force-dynamic'"));
});
