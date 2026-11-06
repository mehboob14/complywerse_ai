// node --test src/components/shell/pinnedRecent.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LABEL_MAX, PINS_MAX, RECENT_MAX, cleanShortcut, isPinned, pinsKey, pushRecent, readList, recentKey, scopeOf, togglePin, unpin, writeList, type Shortcut, type Store,
} from './pinnedRecent.ts';

const memory = () => {
  const m = new Map<string, string>();
  const store: Store & { m: Map<string, string> } = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), m };
  return store;
};
const broken: Store = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => { throw new Error('blocked'); } };
const page = (n: number): Shortcut => ({ label: `Page ${n}`, href: `/p/${n}` });

test('the lists belong to the tenant and the person: two people on one browser keep two lists', () => {
  const a = scopeOf({ authenticated: true, user: { id: 7, primary_tenant_id: 1 }, tenant: { slug: 'cfsb' } });
  const b = scopeOf({ authenticated: true, user: { id: 8, primary_tenant_id: 1 }, tenant: { slug: 'cfsb' } });
  assert.equal(a, 'cfsb:7');
  assert.notEqual(pinsKey(a!), pinsKey(b!));
  assert.notEqual(pinsKey(a!), recentKey(a!));
  assert.equal(scopeOf(null), null);
  assert.equal(scopeOf({ authenticated: false, user: null }), null);
  assert.equal(scopeOf({ authenticated: true, user: {} }), null, 'no id: nothing is read or written');
  assert.equal(scopeOf({ authenticated: true, user: { id: 3, primary_tenant_id: 9 }, tenant: {} }), '9:3', 'no slug: the tenant id');
  assert.match(scopeOf({ authenticated: true, user: { id: 1 }, tenant: { slug: 'a b/c' } })!, /^[\w:.-]+$/, 'a key holds no odd character');
});

test('a stored value is trusted for nothing: only a short label and a path of this app survive', () => {
  assert.deepEqual(cleanShortcut({ label: ' Remote   Work Policy ', href: '/governance/documents/44', sub: ' Document ' }), { label: 'Remote Work Policy', href: '/governance/documents/44', sub: 'Document' });
  for (const href of ['https://evil.example/x', '//evil.example/x', '/\\evil', 'javascript:alert(1)', '', 'x', '/ok\t/x', '/a\nb']) assert.equal(cleanShortcut({ label: 'x', href }), null, href);
  assert.equal(cleanShortcut({ label: '', href: '/x' }), null);
  assert.equal(cleanShortcut({ label: '   ', href: '/x' }), null);
  assert.equal(cleanShortcut({ label: 5, href: '/x' }), null);
  assert.equal(cleanShortcut(null), null);
  assert.equal(cleanShortcut('/x'), null);
  const long = cleanShortcut({ label: 'L'.repeat(400), href: '/x' })!;
  assert.equal(long.label.length, LABEL_MAX, 'a 400-character name is cut (the full text is the title in the panel)');
  assert.ok(long.label.endsWith('…'));
  assert.equal(cleanShortcut({ label: 'a', href: '/x', sub: 'S'.repeat(200) })!.sub!.length, 60);
});

test('what is written is read back; an empty list removes the key; broken, foreign or oversized values read as nothing', () => {
  const s = memory();
  const key = pinsKey('cfsb:7');
  assert.deepEqual(readList(s, key, PINS_MAX), []);
  assert.equal(writeList(s, key, [page(1), page(2)]), true);
  assert.deepEqual(readList(s, key, PINS_MAX), [page(1), page(2)]);
  writeList(s, key, []);
  assert.equal(s.m.has(key), false);
  s.m.set(key, '{not json');
  assert.deepEqual(readList(s, key, PINS_MAX), []);
  s.m.set(key, '{"a":1}');
  assert.deepEqual(readList(s, key, PINS_MAX), [], 'an object is not a list');
  s.m.set(key, JSON.stringify([page(1), { label: 'x', href: 'https://evil.example' }, 7, null, page(1), page(3)]));
  assert.deepEqual(readList(s, key, PINS_MAX), [page(1), page(3)], 'bad rows and repeats are dropped');
  s.m.set(key, JSON.stringify(Array.from({ length: 40 }, (_, i) => page(i))));
  assert.equal(readList(s, key, PINS_MAX).length, PINS_MAX, 'a list longer than the cap is cut on reading');
});

test('storage that is missing or throws is never an error: nothing is remembered, the shell goes on', () => {
  assert.deepEqual(readList(broken, 'k', 5), []);
  assert.equal(writeList(broken, 'k', [page(1)]), false);
  assert.equal(writeList(broken, 'k', []), false);
  assert.deepEqual(readList(undefined, 'k', 5), [], 'no window.localStorage here (node)');
  assert.equal(writeList(undefined, 'k', [page(1)]), false);
});

test('recent: the page just opened goes first, opening it again moves it up, the oldest fall off, a bad value changes nothing', () => {
  let list: Shortcut[] = [];
  for (let i = 1; i <= RECENT_MAX + 3; i++) list = pushRecent(list, page(i));
  assert.equal(list.length, RECENT_MAX);
  assert.equal(list[0].href, `/p/${RECENT_MAX + 3}`);
  assert.ok(!list.some((x) => x.href === '/p/1'), 'the oldest are gone');
  const again = pushRecent(list, page(5));
  assert.equal(again[0].href, '/p/5');
  assert.equal(again.filter((x) => x.href === '/p/5').length, 1);
  assert.equal(again.length, list.length);
  assert.deepEqual(pushRecent(list, { label: 'x', href: 'https://evil.example' }), list);
  assert.deepEqual(pushRecent([], null), []);
});

test('pins: Pin this page pins it first, again unpins it, the oldest pin makes room at the cap, unpin removes one', () => {
  let list: Shortcut[] = [];
  const first = togglePin(list, page(1));
  assert.equal(first.pinned, true);
  list = first.list;
  assert.equal(isPinned(list, '/p/1'), true);
  assert.equal(isPinned(list, '/p/1?x=1'), false, 'a view with a filter is its own pin');
  const second = togglePin(list, page(1));
  assert.deepEqual(second, { list: [], pinned: false });
  for (let i = 1; i <= PINS_MAX + 2; i++) list = togglePin(list, page(i)).list;
  assert.equal(list.length, PINS_MAX);
  assert.equal(list[0].href, `/p/${PINS_MAX + 2}`);
  assert.deepEqual(unpin(list, list[0].href).length, PINS_MAX - 1);
  assert.deepEqual(togglePin(list, 'nope'), { list, pinned: false }, 'a value that is not a shortcut pins nothing');
});
