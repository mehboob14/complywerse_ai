import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PREFS, loadPrefs, loadViews, newViewId, prefsKey, savePrefs, saveViews, viewsKey, type KeyValueStore } from './libraryPrefs.ts';
import { DEFAULT_STATE, NO_FILTERS, type SavedView } from './libraryModel.ts';

const memory = (): KeyValueStore & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
};
const key = prefsKey(7);

test('with no storage the page gets the defaults and saving does nothing', () => {
  assert.deepEqual(loadPrefs(null, key), DEFAULT_PREFS);
  assert.doesNotThrow(() => savePrefs(null, key, DEFAULT_PREFS));
  const broken: KeyValueStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(loadPrefs(broken, key), DEFAULT_PREFS);
  assert.doesNotThrow(() => savePrefs(broken, key, DEFAULT_PREFS));
});

test('columns, density and page size come back as they were saved; nonsense is replaced by the defaults', () => {
  const s = memory();
  savePrefs(s, key, { hidden: ['version', 'owner'], density: 'compact', pageSize: 50 });
  assert.deepEqual(loadPrefs(s, key), { hidden: ['version', 'owner'], density: 'compact', pageSize: 50 });
  s.data[key] = JSON.stringify({ hidden: ['title', 'actions', 'version', 7], density: 'huge', pageSize: 13 });
  assert.deepEqual(loadPrefs(s, key), { hidden: ['version'], density: 'comfortable', pageSize: 25 });      // title and actions can never be hidden
  s.data[key] = '{not json';
  assert.deepEqual(loadPrefs(s, key), DEFAULT_PREFS);
});

test('what one person chose is not what another sees', () => {
  const s = memory();
  savePrefs(s, prefsKey(1), { hidden: [], density: 'compact', pageSize: 10 });
  assert.deepEqual(loadPrefs(s, prefsKey(2)), DEFAULT_PREFS);
  assert.notEqual(prefsKey(1), prefsKey(null));
});

test('saved views keep their filters and sort, and the built-in ones are never stored', () => {
  const s = memory();
  const mine: SavedView = { id: 'mine-1', name: ' Overdue policies ', state: { filters: { ...NO_FILTERS, types: ['policy'], review: ['overdue'] }, sort: { key: 'review', dir: 'asc' } } };
  const builtIn: SavedView = { id: 'all', name: 'All documents', builtIn: true, state: DEFAULT_STATE };
  saveViews(s, viewsKey(7), [builtIn, mine]);
  const back = loadViews(s, viewsKey(7));
  assert.equal(back.length, 1);
  assert.deepEqual(back[0], { ...mine, name: 'Overdue policies' });
  s.data[viewsKey(7)] = JSON.stringify([{ id: 5, name: 'x' }, { id: 'ok', name: '  ' }, { id: 'fine', name: 'Fine', query: 'review=overdue,zzz' }]);
  assert.deepEqual(loadViews(s, viewsKey(7)).map((v) => [v.id, v.state.filters.review]), [['fine', ['overdue']]]);
  assert.deepEqual(loadViews(null, viewsKey(7)), []);
});

test('a new view gets an id no other view has', () => {
  const v = (id: string): SavedView => ({ id, name: id, state: DEFAULT_STATE });
  assert.equal(newViewId([]), 'mine-1');
  assert.equal(newViewId([v('mine-1')]), 'mine-2');
  assert.equal(newViewId([v('mine-2')]), 'mine-3');          // one deleted before: still not taken
});
