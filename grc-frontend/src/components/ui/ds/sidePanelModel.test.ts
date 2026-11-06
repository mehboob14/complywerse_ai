// node --test "src/components/ui/ds/sidePanelModel.test.ts"
// The rules of the SidePanel apart from React: the mode at a window width, the media queries behind it, which key presses a docked column takes, and
// where focus goes when the panel closes. The component's wiring (what it draws in each mode) is pinned in kit2Contract.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCK_FROM, PANEL_WIDTH, SHEET_BELOW, dockWidth, focusAfterClose, panelModeFor, panelModeFromMatches, panelQueries, panelTakesEscape, resolveFocusTarget,
} from './sidePanelModel.ts';

test('the three modes by window width: a sheet under 640, docked from 1440, an overlay between', () => {
  assert.equal(panelModeFor(390), 'sheet');
  assert.equal(panelModeFor(639), 'sheet');
  assert.equal(panelModeFor(640), 'overlay');
  assert.equal(panelModeFor(1024), 'overlay');
  assert.equal(panelModeFor(1439), 'overlay');
  assert.equal(panelModeFor(1440), 'docked');
  assert.equal(panelModeFor(2560), 'docked');
  assert.equal(SHEET_BELOW, 640);
  assert.equal(DOCK_FROM, 1440);
});

test('dockFrom moves the dock width; Infinity never docks; a dock width under 640 is clamped so a phone is never docked', () => {
  assert.equal(panelModeFor(1280, 1280), 'docked');
  assert.equal(panelModeFor(1279, 1280), 'overlay');
  assert.equal(panelModeFor(3000, Infinity), 'overlay');
  assert.equal(panelModeFor(500, Infinity), 'sheet');
  assert.equal(panelModeFor(500, 0), 'sheet');
  assert.equal(panelModeFor(640, 0), 'docked');                 // clamped to 640: from there the panel docks, below it is a sheet
  assert.equal(dockWidth(0), 640);
  assert.equal(dockWidth(NaN), 1440);
  assert.equal(dockWidth(), 1440);
  assert.equal(dockWidth(Infinity), Infinity);
});

test('the media queries are the same rule: the dock query is null when the panel never docks', () => {
  assert.deepEqual(panelQueries(), { dock: '(min-width: 1440px)', overlay: '(min-width: 640px)' });
  assert.deepEqual(panelQueries(1280), { dock: '(min-width: 1280px)', overlay: '(min-width: 640px)' });
  assert.deepEqual(panelQueries(Infinity), { dock: null, overlay: '(min-width: 640px)' });
  assert.equal(panelModeFromMatches(true, true), 'docked');
  assert.equal(panelModeFromMatches(false, true), 'overlay');
  assert.equal(panelModeFromMatches(false, false), 'sheet');
  for (const width of [390, 639, 640, 1000, 1439, 1440, 1800]) {
    const q = panelQueries(1440);
    const dock = width >= Number(/\d+/.exec(q.dock ?? '')?.[0]);
    const overlay = width >= Number(/\d+/.exec(q.overlay)?.[0]);
    assert.equal(panelModeFromMatches(dock, overlay), panelModeFor(width), `${width}px`);
  }
});

test('the widths: 360, 480 and 640', () => {
  assert.deepEqual({ ...PANEL_WIDTH }, { sm: 360, md: 480, lg: 640 });
});

test('a docked column takes Escape only when the page asked for it and focus is inside; an overlay and a sheet always take it', () => {
  assert.equal(panelTakesEscape({ mode: 'docked', escapeClosesDocked: false, focusInside: true }), false);
  assert.equal(panelTakesEscape({ mode: 'docked', escapeClosesDocked: true, focusInside: false }), false);
  assert.equal(panelTakesEscape({ mode: 'docked', escapeClosesDocked: true, focusInside: true }), true);
  assert.equal(panelTakesEscape({ mode: 'overlay', escapeClosesDocked: false, focusInside: false }), true);
  assert.equal(panelTakesEscape({ mode: 'sheet', escapeClosesDocked: false, focusInside: true }), true);
});

const el = (connected: boolean) => ({ isConnected: connected }) as unknown as HTMLElement;

test('after closing, focus goes to the named element, else to the opener, and only when focus was lost with the panel', () => {
  const named = el(true);
  const opener = el(true);
  assert.equal(focusAfterClose({ lost: true, named, opener }), named);
  assert.equal(focusAfterClose({ lost: true, named: null, opener }), opener);
  assert.equal(focusAfterClose({ lost: false, named, opener }), null);              // the person moved focus on purpose: it stays
  assert.equal(focusAfterClose({ lost: true, named: el(false), opener }), opener);   // the named row is gone: the opener
  assert.equal(focusAfterClose({ lost: true, named: el(false), opener: el(false) }), null);
  assert.equal(focusAfterClose({ lost: true, named: null, opener: null }), null);
});

test('a focus target is an element ref or a function that finds the element when the panel closes', () => {
  const found = el(true);
  assert.equal(resolveFocusTarget({ current: found }), found);
  assert.equal(resolveFocusTarget(() => found), found);
  assert.equal(resolveFocusTarget({ current: null }), null);
  assert.equal(resolveFocusTarget(() => null), null);
  assert.equal(resolveFocusTarget(undefined), null);
});
