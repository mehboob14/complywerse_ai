// node --test "src/lib/cssVars.test.ts"
// A CSS custom property read with no fallback (`var(--x)`) must be defined somewhere, otherwise the declaration that reads it is invalid at
// computed-value time: a hover background that never paints, a shadow that is `none`, a gap of 0 (the July 2026 design-system audit listed seven
// of these as known debt and they stayed broken; this test keeps the list at zero). `var(--x, fallback)` is exempt: it is optional by design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// defined at run time, not in a stylesheet: the next/font variables set on <html> (src/app/layout.tsx)
const RUNTIME = new Set(['font-poppins', 'font-mono']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const all = [...files('src'), ...files('styles')];
const defined = new Set<string>(RUNTIME);
const used = new Map<string, string>();      // name -> first file that reads it without a fallback
for (const f of all) {
  const text = readFileSync(f, 'utf8');
  for (const m of Array.from(text.matchAll(/(?:^|[\s;{(,])--([a-zA-Z0-9_-]+)\s*:/gm))) defined.add(m[1]);                 // `--x: value` in CSS or a style string
  for (const m of Array.from(text.matchAll(/['"`]--([a-zA-Z0-9_-]+)['"`]/g))) defined.add(m[1]);                          // style={{ '--x': ... }}, setProperty('--x', ...)
  for (const m of Array.from(text.matchAll(/var\(\s*--([a-zA-Z0-9_-]+)\s*\)/g))) if (!used.has(m[1])) used.set(m[1], f);
}

test('every CSS variable read without a fallback is defined', () => {
  const dangling = Array.from(used.entries()).filter(([name]) => !defined.has(name)).map(([name, file]) => `--${name} (read in ${file.replace(/\\/g, '/')})`);
  assert.deepEqual(dangling, []);
});

test('the platform variables the repaint rules and the header read are defined in styles/tokens.css', () => {
  const tokens = readFileSync('styles/tokens.css', 'utf8');
  for (const name of ['color-hover', 'color-text-muted', 'color-text-secondary', 'color-surface-muted', 'color-primary', 'color-base-hover', 'space-3', 'shadow-sm', 'shadow-lg']) {
    assert.match(tokens, new RegExp(`--${name}\\s*:`), `--${name}`);
  }
});
