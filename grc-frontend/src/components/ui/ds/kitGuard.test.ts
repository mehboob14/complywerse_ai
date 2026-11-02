// node --test "src/components/ui/ds/kitGuard.test.ts"
// Source-text guard (like archive.test.ts): no file of the design-system kit may use a class the platform CSS rewrites or a value outside the tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { findViolations } from './kitRules.ts';

const DIR = 'src/components/ui/ds';

function kitFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return kitFiles(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'kitRules.ts' ? [p] : [];
  });
}

const rules = (src: string) => findViolations(src).map((v) => v.rule).sort();

test('the guard catches what the shell rewrites, and lets the tokens through', () => {
  assert.deepEqual(rules('<div className="text-sm bg-white">'), ['named-text-size', 'palette-class']);
  assert.deepEqual(rules('<div className="hover:bg-slate-50 text-gray-700">'), ['palette-class']);          // one finding per rule per line
  assert.deepEqual(rules('<div className="shadow-lg rounded-xl font-semibold">'), ['font-weight', 'named-radius', 'shadow']);
  assert.deepEqual(rules('<div className="px-4 py-5 gap-3 p-6">'), ['remapped-spacing']);
  assert.deepEqual(rules('<div className="px-[16px] py-2 gap-2 p-3 space-y-2">'), []);
  assert.deepEqual(rules('<span className="h-12 w-12 grid">'), ['remapped-size-pair']);
  assert.deepEqual(rules('<div className="text-[11px] bg-[#fff]">'), ['arbitrary-hex', 'small-text']);
  assert.deepEqual(rules('<button className="outline-none">'), ['bare-outline-none']);
  assert.deepEqual(rules(
    '<div className="bg-ds-surface text-ds-body text-ds-fg-muted border border-ds-border rounded-ds-card shadow-ds-pop px-[16px] py-2 gap-2 h-ds-control font-medium text-[12px]">'), []);
  assert.deepEqual(rules('<button className="outline-none focus-visible:shadow-ds-ring">'), []);
  assert.deepEqual(rules('// text-sm bg-white are what the shell rewrites\n/* shadow-lg\n rounded-xl */\nconst x = 1;'), []);
});

test('every file of the kit follows the rules', () => {
  const bad = kitFiles(DIR).flatMap((f) => findViolations(readFileSync(f, 'utf8')).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});
