// The module is called "Comply AI Studio" on screen; code comments may still say "AI Studio".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/app/(dashboard)/governance', 'src/components/governance', 'src/lib/studio'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

test('every visible "AI Studio" is the Comply AI Studio', () => {
  const old: string[] = [];
  for (const f of ROOTS.flatMap(files)) {
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const code = line.replace(/\s\/\/ .*$/, '').trim();
      if (/^(\/\/|\*|\/\*|\{\/\*)/.test(code)) return;          // a comment line
      if (/(?<!Comply )AI Studio/.test(code)) old.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(old, []);
});
