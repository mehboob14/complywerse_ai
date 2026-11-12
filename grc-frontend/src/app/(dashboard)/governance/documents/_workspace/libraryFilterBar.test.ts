// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryFilterBar.test.ts"
// The library has no row of quick chips and no Board layout (the owner, 2026-11-12: "these can be accomplished from the filters the platform supports"). Nothing a chip did became impossible:
// each retired chip is a filter of the filter bar (a check, or a group with that value), the Views menu keeps only the compound views, and an old address or a saved view that asks for the Board
// opens the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { RAIL_ORDER, railOptions } from './libraryFacets.ts';
import { BUILT_IN_VIEWS, LIBRARY_VIEWS, NO_FILTERS, layoutOf, viewFromParams, type FacetKey, type Filters } from './libraryModel.ts';
import { WORKSPACE_VIEWS } from './libraryViews.ts';

const workspace = readFileSync(new URL('./DocumentsWorkspace.tsx', import.meta.url), 'utf8');
const code = workspace.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const CHECKS = ['mine', 'waiting'];

test('every retired chip is a filter of the bar: Mine and Waiting for me are checks beside it, the rest are groups that offer the value (Review, Status, Owner, Framework)', () => {
  const offered = railOptions({ docs: [], people: [], departments: [], frameworks: {} });
  assert.ok(BUILT_IN_VIEWS.length >= 8);
  for (const view of BUILT_IN_VIEWS) {
    for (const key of Object.keys(view.state.filters) as (keyof Filters)[]) {
      const value = view.state.filters[key];
      if (JSON.stringify(value) === JSON.stringify(NO_FILTERS[key])) continue;                       // not what the view is about
      if (CHECKS.includes(key)) { assert.ok(code.includes(`checked={filters.${key}}`), `${view.id}: no check for ${key}`); continue; }
      assert.ok((RAIL_ORDER as readonly string[]).includes(key), `${view.id}: ${key} is not a group of the filter bar`);
      for (const v of value as string[]) assert.ok(offered[key as FacetKey].some((o) => o.value === v), `${view.id}: ${key} does not offer ${v}`);
    }
  }
});

test('the chip row is gone: the explorer is given no chips, and the Views menu lists the compound views and the person\'s own only', () => {
  assert.ok(code.includes('quick={NO_QUICK}') && !code.includes('QUICK.map') && !/const onQuick\b/.test(code) && code.includes('onQuick={noQuick}'));
  assert.ok(code.includes('[...WORKSPACE_VIEWS, ...saved]') && !code.includes('...BUILT_IN_VIEWS'));
  assert.ok(code.includes('<Menu label={activeView ? `Views: '));                                                  // the Views menu is in the toolbar, and says which view the page is on
});

test('the layouts are List, Folders, Calendar and Tracker; the Board is not one, nothing in the library draws it, and its files are gone', () => {
  assert.deepEqual([...LIBRARY_VIEWS], ['table', 'folders', 'calendar', 'tracker']);
  assert.ok(!/board/i.test(code));
  assert.equal(existsSync(new URL('./libraryBoard.ts', import.meta.url)), false);
  assert.ok(WORKSPACE_VIEWS.every((v) => (LIBRARY_VIEWS as readonly string[]).includes(v.layout)));
});

test('an old ?view=board, a saved view or a remembered layout on the board opens the list; a name that was never a layout is still ignored', () => {
  assert.equal(layoutOf('board'), 'table');
  assert.equal(viewFromParams(new URLSearchParams('view=board&status=published')), 'table');
  assert.equal(layoutOf('nonsense'), null);
  assert.equal(layoutOf(undefined), null);
  assert.equal(viewFromParams(new URLSearchParams('view=in-force')), null);                              // a view id was never a layout: the page opens as it always did
  for (const name of LIBRARY_VIEWS) assert.equal(layoutOf(name), name);
});
