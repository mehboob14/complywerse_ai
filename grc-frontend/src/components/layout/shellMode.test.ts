// node --test src/components/layout/shellMode.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { COLLAPSED_KEY, FULL_MIN, FULL_QUERY, RAIL_MIN, RAIL_QUERY, readCollapsed, shellModeFor, shellModeFromMatches, writeCollapsed } from './shellMode.ts';

test('the shell is full from 1280, a rail from 1024 to 1279, off-canvas below 1024', () => {
  for (const w of [1280, 1440, 1920, 2560]) assert.equal(shellModeFor(w), 'full', String(w));
  for (const w of [1024, 1100, 1279]) assert.equal(shellModeFor(w), 'rail', String(w));
  for (const w of [320, 390, 768, 1023]) assert.equal(shellModeFor(w), 'offcanvas', String(w));
});

test('the media queries decide the same: wide enough for full, else wide enough for the rail, else off-canvas', () => {
  assert.equal(shellModeFromMatches(true, true), 'full');
  assert.equal(shellModeFromMatches(false, true), 'rail');
  assert.equal(shellModeFromMatches(false, false), 'offcanvas');
  assert.equal(FULL_QUERY, `(min-width: ${FULL_MIN}px)`);
  assert.equal(RAIL_QUERY, `(min-width: ${RAIL_MIN}px)`);
});

test("the breakpoints are Tailwind's lg and xl, which the shell's responsive classes switch on (nothing overrides them)", () => {
  const screens = createRequire(import.meta.url)('tailwindcss/defaultTheme').screens as Record<string, string>;
  assert.equal(RAIL_MIN, parseInt(screens.lg, 10));
  assert.equal(FULL_MIN, parseInt(screens.xl, 10));
  assert.doesNotMatch(readFileSync('tailwind.config.ts', 'utf8'), /\bscreens\s*:/, 'tailwind.config.ts must not redefine the screens');
});

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

test('the collapsed sidebar is remembered and forgotten again', () => {
  const store = memory();
  assert.equal(readCollapsed(store), false);
  writeCollapsed(true, store);
  assert.equal(store.m.get(COLLAPSED_KEY), '1');
  assert.equal(readCollapsed(store), true);
  writeCollapsed(false, store);
  assert.equal(store.m.has(COLLAPSED_KEY), false);
  assert.equal(readCollapsed(store), false);
});

test('storage that is missing or throws (private window, blocked site data) is never an error: the sidebar is simply not collapsed', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(readCollapsed(broken), false);
  assert.doesNotThrow(() => writeCollapsed(true, broken));
  assert.doesNotThrow(() => writeCollapsed(false, broken));
  assert.equal(readCollapsed(), false, 'no window.localStorage here (node): not collapsed');
  assert.doesNotThrow(() => writeCollapsed(true));
});
