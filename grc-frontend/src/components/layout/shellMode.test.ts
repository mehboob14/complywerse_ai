// node --test src/components/layout/shellMode.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { DOCK_MIN, DOCK_QUERY, RAIL_MIN, RAIL_QUERY, RAIL_WIDTH, placementOf, shellModeFor, shellModeFromMatches } from './shellMode.ts';

test('the shell docks its panel from 1440, is a rail from 1024 to 1439, and a drawer below 1024', () => {
  for (const w of [1440, 1536, 1920, 2560]) assert.equal(shellModeFor(w), 'docked', String(w));
  for (const w of [1024, 1100, 1280, 1439]) assert.equal(shellModeFor(w), 'rail', String(w));
  for (const w of [320, 390, 768, 1023]) assert.equal(shellModeFor(w), 'drawer', String(w));
});

test('the media queries decide the same: wide enough to dock, else wide enough for the rail, else a drawer', () => {
  assert.equal(shellModeFromMatches(true, true), 'docked');
  assert.equal(shellModeFromMatches(false, true), 'rail');
  assert.equal(shellModeFromMatches(false, false), 'drawer');
  assert.equal(DOCK_QUERY, `(min-width: ${DOCK_MIN}px)`);
  assert.equal(RAIL_QUERY, `(min-width: ${RAIL_MIN}px)`);
});

test('the panel is docked in a docked shell, an overlay beside the rail, a sheet in the drawer\'s window', () => {
  assert.equal(placementOf('docked'), 'dock');
  assert.equal(placementOf('rail'), 'overlay');
  assert.equal(placementOf('drawer'), 'sheet');
});

test("the rail's width is Tailwind's lg, which the shell's responsive classes switch on (nothing overrides it)", () => {
  const screens = createRequire(import.meta.url)('tailwindcss/defaultTheme').screens as Record<string, string>;
  assert.equal(RAIL_MIN, parseInt(screens.lg, 10));
  assert.doesNotMatch(readFileSync('tailwind.config.ts', 'utf8'), /\bscreens\s*:/, 'tailwind.config.ts must not redefine the screens');
  assert.ok(RAIL_WIDTH >= 56 && RAIL_WIDTH <= 96, 'a rail wide enough for the short names and narrow enough for the page');
});
