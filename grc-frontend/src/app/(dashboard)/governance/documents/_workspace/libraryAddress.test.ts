// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryAddress.test.ts"
// The library reads and writes its address on the kit's useAddressState with the SAME grammar as libraryModel.fromParams / toParams / withLibraryParams: every link that exists
// opens the same view, every saved view's query still applies, and what the page writes is what it always wrote (the order of the names apart). Foreign names are left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../../lib/addressState.ts';
import { LIBRARY_SCHEMA, addressOf, pageOf, type LibraryAddress } from './libraryAddress.ts';
import { PARAM_KEYS, fromParams, openFromParams, toParams, viewFromParams, withLibraryParams } from './libraryModel.ts';

const read = (qs: string) => pageOf(readAddress(LIBRARY_SCHEMA, qs) as LibraryAddress);
const entries = (qs: string) => Array.from(new URLSearchParams(qs).entries()).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));

const ADDRESSES = [
  '', 'q=access+control', 'q=%20%20', 'type=policy,standard', 'status=draft,pending_review', 'status=archived', 'status=archived,draft', 'status=draft,archived',
  'owner=2,none', 'dept=10,none', 'fw=1,2,none', 'fw=1e1', 'cls=internal,confidential', 'review=overdue,ok,nonsense', 'att=complete,none,nonsense', 'mine=1', 'mine=0', 'expiry=30d', 'expiry=7d',
  'attn=stuck', 'attn=late_approvals', 'attn=nonsense', 'waiting=1', 'sort=title:asc', 'sort=review:desc', 'sort=title', 'sort=nonsense:asc', 'sort=title:sideways', 'open=42', 'id=17', 'open=0', 'open=abc', 'open=-4',
  'view=folders', 'view=table', 'view=board', 'view=nonsense', 'q=data&status=published&dept=3&sort=updated:asc&open=9&view=folders&mine=1', 'type=a,,b,a', 'aiDraftTitle=Remote+work&q=x',
];

test('every address the library has ever had is read as libraryModel reads it', () => {
  for (const qs of ADDRESSES) {
    const old = fromParams(new URLSearchParams(qs));
    const now = read(qs);
    assert.deepEqual(now.state.filters, old.filters, qs);
    assert.deepEqual(now.state.sort, old.sort, qs);
    assert.equal(now.openId, openFromParams(new URLSearchParams(qs)), qs);
    assert.equal(now.view, viewFromParams(new URLSearchParams(qs)), qs);
  }
});

test('a name repeated in the address is read as one list (the kit reads a little more than the old code, never less)', () => {
  assert.deepEqual(read('type=policy&type=standard').state.filters.types, ['policy', 'standard']);
  assert.deepEqual(fromParams(new URLSearchParams('type=policy&type=standard')).filters.types, ['policy']);
});

test('what the page writes is what it always wrote, and a foreign name stays where it was', () => {
  for (const qs of ADDRESSES) {
    const page = read(qs);
    const written = writeAddress(LIBRARY_SCHEMA, qs, addressOf(page) as never);
    const old = withLibraryParams(new URLSearchParams(qs), page.state, page.openId, page.view).toString();
    assert.deepEqual(entries(written), entries(old), qs);
  }
  assert.ok(writeAddress(LIBRARY_SCHEMA, 'aiDraftTitle=Remote+work&q=x', addressOf(read('q=x')) as never).includes('aiDraftTitle=Remote'));
});

test('the legacy ?id= link is read as the open document and rewritten as ?open=', () => {
  const page = read('id=17&status=published');
  assert.equal(page.openId, 17);
  const written = writeAddress(LIBRARY_SCHEMA, 'id=17&status=published', addressOf(page) as never);
  assert.deepEqual(entries(written), entries('open=17&status=published'));
});

test('a saved view\'s query is applied by the same grammar (toParams -> address -> toParams)', () => {
  for (const qs of ADDRESSES) {
    const view = toParams(fromParams(new URLSearchParams(qs))).toString();
    assert.equal(toParams(read(view).state).toString(), view, qs);
  }
});

test('every name of the schema is a name of the library\'s own (the overview and the saved views know them as PARAM_KEYS)', () => {
  assert.deepEqual(Object.keys(LIBRARY_SCHEMA).sort(), PARAM_KEYS.slice().sort());
});

test('the defaults are the plain address', () => {
  assert.equal(writeAddress(LIBRARY_SCHEMA, '', addressOf(read('')) as never), '');
});
