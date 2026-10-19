import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VIEW_KEY, creation, pluralType, rememberView, rememberedView } from './library.ts';

test('the breadcrumb names each type in its plural', () => {
  assert.deepEqual(['policy', 'standard', 'procedure', 'guideline', 'charter', 'framework'].map(pluralType),
    ['Policies', 'Standards', 'Procedures', 'Guidelines', 'Charters', 'Frameworks']);
  assert.equal(pluralType('memo'), 'Other documents');
});

test('the library opens on the view this browser chose last, Table otherwise', () => {
  const g = globalThis as { window?: unknown };
  assert.equal(rememberedView(), 'table');                                  // no browser storage at all
  const store = new Map<string, string>();
  g.window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } };
  try {
    assert.equal(rememberedView(), 'table');
    rememberView('tree');
    assert.equal(store.get(VIEW_KEY), 'tree');
    assert.equal(rememberedView(), 'tree');
    rememberView('board');
    assert.equal(rememberedView(), 'board');
    store.set(VIEW_KEY, 'cards');                                             // something else stored there: the default
    assert.equal(rememberedView(), 'table');
    g.window = { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } };
    assert.equal(rememberedView(), 'table');
    assert.doesNotThrow(() => rememberView('tree'));
  } finally {
    delete g.window;
  }
});

test('creating documents is offered only where the Comply AI Studio is on', () => {
  assert.equal(creation(true, true), 'buttons');
  assert.equal(creation(true, undefined), 'buttons');                       // not known yet (or an older server): as before
  assert.equal(creation(true, false), 'studio-off');
  assert.equal(creation(false, false), null);
  assert.equal(creation(false, true), null);
});
