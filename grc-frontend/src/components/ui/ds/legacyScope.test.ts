// node --test src/components/ui/ds/legacyScope.test.ts
// The platform CSS (app/globals.css) has a legacy scope, `.governance-light`, whose rules restyle every input, select, textarea, button, table
// and heading inside it: 12px text on buttons, a 1.3:1 input border, a mint focus border, zebra rows. The kit is written against the design
// tokens, not against that scope, so a page leaves the scope as it moves to the kit (and keeps nothing that needed it). A page file that
// imports the kit and still opens the scope fails here; widening the exception means editing this test, on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return pages(p);
    return /\.tsx$/.test(name) ? [p] : [];
  });
}

const importsKit = /from\s+['"]@\/components\/ui\/ds(\/[^'"]*)?['"]/;

test('no file that imports the design-system kit opens the legacy .governance-light scope', () => {
  const both = pages('src/app').filter((f) => {
    const text = readFileSync(f, 'utf8');
    return importsKit.test(text) && /governance-light/.test(text);
  });
  assert.deepEqual(both.map((f) => f.replace(/\\/g, '/')), []);
});
