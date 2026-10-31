// node --test "src/lib/dsTokens.test.ts"
// The design tokens (styles/tokens.css, --ds-*) are the one place the new kit's colours live, so the contrast of every pair a component
// can draw is asserted here: 4.5:1 for words, 3:1 for control outlines, the focus ring and a filled button against its surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { contrast } from './contrast.ts';

const css = readFileSync('styles/tokens.css', 'utf8');
const tokens = new Map<string, string>();
for (const m of css.matchAll(/--(ds-[a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
const hex = (name: string): string => {
  const v = tokens.get(name);
  assert.ok(v && /^#[0-9a-f]{3,6}$/i.test(v), `--${name} is not a hex colour (${v})`);
  return v;
};

// [words/mark, background, minimum ratio]
const TEXT = 4.5;
const CONTROL = 3;
const PAIRS: Array<[string, string, number]> = [
  ['ds-fg', 'ds-surface', TEXT], ['ds-fg', 'ds-bg', TEXT], ['ds-fg', 'ds-surface-subtle', TEXT], ['ds-fg', 'ds-surface-hover', TEXT],
  ['ds-fg-body', 'ds-surface', TEXT], ['ds-fg-body', 'ds-bg', TEXT], ['ds-fg-body', 'ds-surface-hover', TEXT],
  ['ds-fg-muted', 'ds-surface', TEXT], ['ds-fg-muted', 'ds-bg', TEXT], ['ds-fg-muted', 'ds-surface-subtle', TEXT], ['ds-fg-muted', 'ds-surface-hover', TEXT],
  ['ds-on-primary', 'ds-primary', TEXT], ['ds-on-primary', 'ds-primary-hover', TEXT], ['ds-on-primary', 'ds-primary-active', TEXT],
  ['ds-primary-text', 'ds-surface', TEXT], ['ds-primary-text', 'ds-primary-soft', TEXT], ['ds-primary-text', 'ds-surface-hover', TEXT], ['ds-primary-text', 'ds-bg', TEXT],
  ['ds-danger', 'ds-surface', TEXT], ['ds-danger', 'ds-danger-soft', TEXT], ['ds-on-danger', 'ds-danger', TEXT], ['ds-on-danger', 'ds-danger-hover', TEXT],
  ['ds-warning', 'ds-surface', TEXT], ['ds-warning', 'ds-warning-soft', TEXT],
  ['ds-success', 'ds-surface', TEXT], ['ds-success', 'ds-success-soft', TEXT],
  ['ds-info', 'ds-surface', TEXT], ['ds-info', 'ds-info-soft', TEXT],
  // controls: an input's outline, the focus ring and a filled button must be seen against what they sit on
  ['ds-border-control', 'ds-surface', CONTROL], ['ds-border-control', 'ds-bg', CONTROL],
  ['ds-focus', 'ds-surface', CONTROL], ['ds-focus', 'ds-bg', CONTROL],
  ['ds-primary', 'ds-surface', CONTROL], ['ds-primary', 'ds-bg', CONTROL],
];

test('every pair the kit can draw keeps its contrast (words 4.5:1, controls 3:1)', () => {
  const failures = PAIRS.map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrast(hex(fg), hex(bg)) })).filter((p) => p.ratio < p.min);
  assert.deepEqual(failures.map((f) => `${f.fg} on ${f.bg}: ${f.ratio.toFixed(2)} < ${f.min}`), []);
});

test('the contrast helper agrees with the published WCAG values', () => {
  assert.equal(contrast('#000', '#fff').toFixed(1), '21.0');
  assert.equal(contrast('#fff', '#fff').toFixed(1), '1.0');
  assert.equal(contrast('#777', '#fff').toFixed(2), '4.48');          // the classic "just fails AA" grey
  assert.equal(contrast('#767676', '#fff').toFixed(2), '4.54');       // and the lightest grey that passes
  assert.throws(() => contrast('teal', '#fff'));
});

test('the brand is deep teal with white words on a filled control', () => {
  assert.equal(hex('ds-primary').toLowerCase(), '#0f766e');
  assert.equal(hex('ds-on-primary').toLowerCase(), '#ffffff');
});

test('type tokens keep the 12px floor and the agreed scale', () => {
  const px = (n: string) => parseFloat(String(tokens.get(n)));
  assert.equal(px('ds-text-title'), 20);
  assert.equal(px('ds-text-section'), 15);
  assert.equal(px('ds-text-body'), 13);
  assert.ok(px('ds-text-label') >= 12);
  for (const n of ['ds-text-body', 'ds-text-section', 'ds-text-title']) assert.ok(px(n) >= 12, n);
});

test('every token the Tailwind theme reads is defined, and every colour token is reachable', () => {
  const config = readFileSync('tailwind.config.ts', 'utf8');
  const used = new Set([...config.matchAll(/var\(--(ds-[a-z0-9-]+)\)/g)].map((m) => m[1]));
  const missing = [...used].filter((n) => !tokens.has(n));
  assert.deepEqual(missing, []);
  const inCss = new Set([...css.matchAll(/var\(--(ds-[a-z0-9-]+)\)/g)].map((m) => m[1]));    // a token another token is built from (the ring uses the focus colour)
  const unused = [...tokens.keys()].filter((n) => !used.has(n) && !inCss.has(n));
  assert.deepEqual(unused, [], 'a token nobody can reach through the theme');
});
