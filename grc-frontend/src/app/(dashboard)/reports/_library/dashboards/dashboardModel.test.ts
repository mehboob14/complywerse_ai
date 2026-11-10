// node --test "src/app/(dashboard)/reports/_library/dashboards/dashboardModel.test.ts"
// Dashboards: when there is something to save, the tile operations, the state a tile is in when it cannot draw, and the key that lets two tiles share one load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { UNTITLED, dashboardDirty, defaultWidth, measureChoice, moveTile, nameProblem, patchTile, removeTile, rowsKey, tileProblem, TILE_WORDS, type DashLike, type TileLike } from './dashboardModel.ts';

const tile = (id: string, extra: Partial<TileLike> = {}): TileLike => ({ id, reportId: `rep_${id}`, render: 'kpi', width: 1, ...extra });
const dash = (extra: Partial<DashLike> = {}): DashLike => ({ name: 'Board pack', shared: false, tiles: [tile('a'), tile('b'), tile('c')], ...extra });

test('there is something to save only when the person changed something: a name, sharing, a tile or its settings', () => {
  assert.equal(dashboardDirty(dash(), dash()), false);
  assert.equal(dashboardDirty(dash(), null), false);
  assert.equal(dashboardDirty(null, dash()), false);
  assert.equal(dashboardDirty(dash(), dash({ name: 'Board pack ' })), false, 'a trailing space is not a change');
  assert.equal(dashboardDirty(dash(), dash({ name: 'Board pack 2' })), true);
  assert.equal(dashboardDirty(dash(), dash({ shared: true })), true);
  assert.equal(dashboardDirty(dash(), dash({ shared: undefined })), false, 'not shared is not shared');
  assert.equal(dashboardDirty(dash(), dash({ tiles: removeTile(dash().tiles, 'b') })), true);
  assert.equal(dashboardDirty(dash(), dash({ tiles: patchTile(dash().tiles, 'a', { width: 3 }) })), true);
  assert.equal(dashboardDirty(dash(), dash({ tiles: patchTile(dash().tiles, 'a', { caption: 'Open now' }) })), true);
  assert.equal(dashboardDirty(dash(), dash({ tiles: moveTile(dash().tiles, 'a', 1) })), true);
  assert.equal(dashboardDirty(dash(), dash({ tiles: patchTile(dash().tiles, 'a', { title: '  ' }) })), false);
});

test('a tile moves one place, stops at the ends, and never changes the list it was given', () => {
  const tiles = dash().tiles;
  assert.deepEqual(moveTile(tiles, 'a', 1).map((t) => t.id), ['b', 'a', 'c']);
  assert.deepEqual(moveTile(tiles, 'c', -1).map((t) => t.id), ['a', 'c', 'b']);
  assert.deepEqual(moveTile(tiles, 'a', -1).map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(moveTile(tiles, 'c', 1).map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(moveTile(tiles, 'zzz', 1).map((t) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(tiles.map((t) => t.id), ['a', 'b', 'c']);
  assert.notEqual(moveTile(tiles, 'a', -1), tiles, 'a copy even when nothing moved');
});

test('a tile is patched or removed by id; a number is a quarter wide and anything else a half', () => {
  assert.deepEqual(patchTile(dash().tiles, 'b', { render: 'bar', width: 2 }).map((t) => [t.id, t.render, t.width]), [['a', 'kpi', 1], ['b', 'bar', 2], ['c', 'kpi', 1]]);
  assert.deepEqual(removeTile(dash().tiles, 'b').map((t) => t.id), ['a', 'c']);
  assert.equal(defaultWidth('kpi'), 1);
  assert.equal(defaultWidth('table'), 2);
  assert.equal(defaultWidth('donut'), 2);
});

test('a KPI shows the report measure the tile points at (the first when it names none, as tiles always did), or the number of rows (-1) when the report has none', () => {
  assert.equal(measureChoice(undefined, 2), 0);
  assert.equal(measureChoice(undefined, 0), -1);
  assert.equal(measureChoice(0, 2), 0);
  assert.equal(measureChoice(1, 2), 1);
  assert.equal(measureChoice(2, 2), -1, 'a measure the report no longer has');
  assert.equal(measureChoice(-1, 2), -1, 'the person chose the number of rows');
  assert.equal(measureChoice(-3, 2), -1);
});

test('a dashboard needs a name', () => {
  assert.equal(nameProblem('  '), 'Give the dashboard a name.');
  assert.equal(nameProblem('Board'), null);
  assert.equal(UNTITLED, 'Untitled dashboard');
});

test('why a tile cannot draw, in the order a person would check: loading, report missing, module not theirs, data failed', () => {
  const ok = { loading: false, hasReport: true, moduleKnown: true, moduleOpen: true, failed: false };
  assert.equal(tileProblem(ok), 'ok');
  assert.equal(tileProblem({ ...ok, loading: true, hasReport: false }), 'loading');
  assert.equal(tileProblem({ ...ok, hasReport: false }), 'missing');
  assert.equal(tileProblem({ ...ok, moduleOpen: false }), 'no_module');
  assert.equal(tileProblem({ ...ok, moduleKnown: false }), 'no_module');
  assert.equal(tileProblem({ ...ok, failed: true }), 'error');
  assert.equal(tileProblem({ ...ok, moduleOpen: false, failed: true }), 'no_module', 'no data was asked for, so no failure');
  assert.deepEqual(Object.keys(TILE_WORDS), ['missing', 'no_module', 'error']);
  for (const words of Object.values(TILE_WORDS)) assert.doesNotMatch(words, /\b(?:id|http|api|sql|metabase)\b/i);
});

test('two tiles on one client module share one load whatever their filters say; on a server module the filters are part of the key', () => {
  const base = { dataset: 'controls', serverMode: false, includes: ['risks'], fields: [] as string[], search: '', sorts: [] };
  assert.deepEqual(rowsKey({ ...base, rules: { logic: 'AND', conditions: [{ col: 'a' }] } }), rowsKey({ ...base, rules: { logic: 'OR', conditions: [] }, search: 'x' }));
  assert.notDeepEqual(rowsKey(base as never), rowsKey({ ...base, includes: [] } as never), 'a different set of links is a different load');
  const server = { ...base, dataset: 'risks', serverMode: true };
  assert.notDeepEqual(rowsKey({ ...server, rules: { logic: 'AND', conditions: [{ col: 'a' }] } }), rowsKey({ ...server, rules: { logic: 'AND', conditions: [] } }));
  assert.deepEqual(rowsKey({ ...server, rules: null }), rowsKey({ ...server, rules: null }));
  assert.notDeepEqual(rowsKey({ ...server, rules: null, search: 'a' }), rowsKey({ ...server, rules: null, search: 'b' }));
});
