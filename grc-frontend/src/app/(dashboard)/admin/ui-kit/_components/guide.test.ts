// node --test "src/app/(dashboard)/admin/ui-kit/_components/guide.test.ts"
// The style guide's own contract: it follows the kit rules it documents, it fetches nothing, it is reachable by administrators only and by no link,
// every card it draws has documentation and every documented component has a card, and its section list matches its sections.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';
import { flattenLeaves, navPermissions, navigation } from '../../../../../components/layout/navAccess.ts';
import { DOCS } from './docs.ts';

const DIR = 'src/app/(dashboard)/admin/ui-kit';
const SRC = join(DIR, '_components');
const files = [join(DIR, 'page.tsx'), ...readdirSync(SRC).filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)).map((n) => join(SRC, n))];
const text = (f: string): string => readFileSync(f, 'utf8');
const all = files.map((f) => ({ f, src: text(f) }));

test('the guide follows the kit rules it documents: tokens and arbitrary values only', () => {
  const bad = all.flatMap(({ f, src }) => findViolations(src).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('static fixtures only: nothing here calls the API, reads a secret or fetches', () => {
  const bad = all.flatMap(({ f, src }) => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    return [/from '@\/lib\/api'/, /from 'axios'/, /auth-fetch/, /\bfetch\(/, /localStorage|sessionStorage|process\.env/].filter((re) => re.test(code)).map((re) => `${f}: ${re}`);
  });
  assert.deepEqual(bad, []);
});

test('administrators only, and no sidebar entry: an unlisted page needs what nobody but an administrator holds', () => {
  assert.deepEqual(navPermissions('/admin/ui-kit'), []);
  assert.ok(!flattenLeaves(navigation).some((item) => item.href.includes('ui-kit')));
  assert.ok(!text('src/components/layout/navAccess.ts').includes('ui-kit'));
  const page = text(join(DIR, 'page.tsx'));
  assert.match(page, /<PermissionGuard required=\{navPermissions\(PATH\)\} fallback=\{<Blocked \/>\}>/);        // the page guards itself: nothing in the shell does
  assert.match(page, /<NoAccessState /);
});

test('every card the guide draws has documentation, and every documented component has a card', () => {
  const used = all.flatMap(({ src }) => Array.from(src.matchAll(/<Spec name="([^"]+)"/g), (m) => m[1]));
  assert.deepEqual(used.filter((n) => !(n in DOCS)), [], 'a card with no documentation');
  assert.deepEqual(Object.keys(DOCS).filter((n) => !used.includes(n)), [], 'documentation with no card');
  assert.equal(new Set(used).size, used.length, 'a component drawn twice');
});

test('the section list and the sections agree', () => {
  const page = text(join(DIR, 'page.tsx'));
  const listed = Array.from(page.matchAll(/\{ id: '([a-z]+)', label: '[^']+' \}/g), (m) => m[1]);
  const drawn = all.flatMap(({ src }) => Array.from(src.matchAll(/<GuideSection id="([a-z]+)"/g), (m) => m[1]));
  assert.ok(listed.length >= 10);
  assert.deepEqual(listed.slice().sort(), drawn.slice().sort());
});

test('every helper lib/format.ts exports is documented and shown', () => {
  const exported = Array.from(text('src/lib/format.ts').matchAll(/^export (?:function|const) (\w+)/gm), (m) => m[1]);
  const documented = DOCS.Formatting.imports ?? [];
  assert.deepEqual(exported.filter((n) => !documented.includes(n)), [], 'a helper with no documentation');
  const shown = text(join(SRC, 'FormatSection.tsx'));
  for (const name of exported) assert.ok(new RegExp(`\\b${name}\\b`).test(shown), `${name} is not demonstrated`);
});
