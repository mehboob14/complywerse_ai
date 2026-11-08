// node --test "src/components/assessments/workspace/workspaceRules.test.ts"
// The assessment workspace and its page are built on the design-system kit, so they follow its rules (components/ui/ds/kitRules.ts) and the reviewer's: no palette class, named text
// size, radius or shadow, no text under 12px, no bare outline-none; no native confirm/alert/prompt; no action that shows only on hover; a <p>, <td>, <th>, <h2>, <h3> with a size
// and colour of its own (the platform CSS gives a bare one 11.5px); nothing technical in a sentence a person reads (Rule U1); the three old detail screens are forwards; the lens
// registry is well formed and the NCA container is made by a POST, never by a GET.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { findViolations } from '../../ui/ds/kitRules.ts';

const DIR = 'src/components/assessments/workspace';
const PAGE = 'src/app/(dashboard)/assessments/a/[id]/page.tsx';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name).replace(/\\/g, '/');
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}
const FILES = [...walk(DIR), PAGE];
const src = (f: string) => readFileSync(f, 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('every file of the workspace and its page follows the kit rules', () => {
  assert.ok(FILES.length >= 28, 'the files are there');
  const bad = FILES.filter((f) => f.endsWith('.tsx')).flatMap((f) => findViolations(src(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native dialog, no hover-only action, no client-side download link to an API path', () => {
  for (const f of FILES) {
    const s = code(src(f));
    assert.doesNotMatch(s, /(?<![\w.])window\.(confirm|alert|prompt)\(|(?<![\w.])(alert|prompt)\(|(?<!await )(?<![\w.])confirm\(/, `${f}: a native dialog (the kit's useConfirm is awaited)`);
    assert.doesNotMatch(s, /opacity-0[^'"`]*group-hover|group-hover:opacity-100/, `${f}: an action that shows only on hover`);
    assert.doesNotMatch(s, /href=\{?[`'"]\/api\//, `${f}: a download is authedFetch or the api client, not a link to /api`);
  }
});

test('a <p>, <td>, <th>, <h2> or <h3> names its own text size (the platform gives a bare one 11.5px)', () => {
  const bad: string[] = [];
  for (const f of FILES.filter((x) => x.endsWith('.tsx'))) {
    for (const m of Array.from(code(src(f)).matchAll(/<(p|td|th|h2|h3)(\s[^>]*)?>/g))) if (!/text-ds-(title|section|body|label)|text-\[\d/.test(m[0])) bad.push(`${f}: ${m[0].slice(0, 80)}`);
  }
  assert.deepEqual(bad, []);
});

test('nothing technical reaches a screen: no id, hash, endpoint or HTTP word in the sentences', () => {
  const words = /\b(sha-?256|checksum|fingerprint|uuid|stack ?trace|endpoint|HTTP \d{3}|\/api\/)\b/i;
  for (const f of FILES.filter((x) => x.endsWith('.tsx'))) {
    const text = Array.from(code(src(f)).matchAll(/>\s*([A-Z][^<>{}]{12,})</g)).map((m) => m[1]).concat(Array.from(code(src(f)).matchAll(/(?:title|description|message|label|hint|info)=["']([^"']{12,})["']/g)).map((m) => m[1]));
    for (const t of text) assert.doesNotMatch(t, words, `${f}: "${t.slice(0, 60)}"`);
  }
});

test('the three older detail screens are server forwards that keep the query: nothing is drawn, nothing flashes', () => {
  for (const f of ['src/app/(dashboard)/compliance/assessments/[id]/page.tsx', 'src/app/(dashboard)/cyber-security/assessments/[id]/page.tsx']) {
    const s = src(f);
    assert.match(s, /redirect\(`\/assessments\/a\//, `${f} redirects to the workspace`);
    assert.match(s, /searchParams/, `${f} keeps the query`);
    assert.doesNotMatch(s, /'use client'|PageHeader/, `${f} draws nothing`);
  }
  const module = src('src/components/compliance/_redesign/ComplianceAssessmentsModule.tsx');
  assert.match(module, /router\.push\(`\/assessments\/a\/\$\{id\}`\)/, 'the board\'s card opens the workspace');
  assert.match(module, /router\.replace\(`\/assessments\/a\/\$\{inFramework\[0\]\.id\}`\)/, 'a type with data opens its assessment in the workspace');
});

test('the workspace page flags its heading in the registry and draws the kit head in its own failure state', () => {
  assert.match(src(PAGE), /<PageHeader variant="page"/);
});

test('the lens registry is well formed and says what each entry is for; the contract is the one file lens.ts', () => {
  const reg = src(`${DIR}/lensRegistry.tsx`);
  const keys = Array.from(reg.matchAll(/\{ key: '([a-z-]+)'/g)).map((m) => m[1]);
  assert.ok(keys.length >= 8);
  assert.equal(new Set(keys).size, keys.length, 'a key is registered once');
  for (const reserved of ['controls', 'remediation', 'scope', 'people', 'plan']) assert.ok(!keys.includes(reserved), `${reserved} is a built-in tab`);
  for (const f of readdirSync(`${DIR}/lenses`).filter((n) => /Lens\.tsx$/.test(n))) assert.match(src(`${DIR}/lenses/${f}`), /LensProps/, `${f} takes the contract's props`);
});

test('a GET never writes: the NCA container is read by GET and made by POST, and nothing here snapshots KPI history', () => {
  const api = src(`${DIR}/workspaceApi.ts`);
  assert.match(api, /ncaContainer: async[^\n]*apiClient\.get\('\/compliance\/nca\/container'\)/);
  assert.match(api, /createNcaContainer: async[^\n]*apiClient\.post\('\/compliance\/nca\/container'\)/);
  for (const f of FILES) assert.doesNotMatch(src(f), /kpi-live/, `${f}: this workspace shows no KPI history`);
});

test('the control edit travels as a JSON body, never in the query string', () => {
  const api = src(`${DIR}/workspaceApi.ts`);
  assert.match(api, /apiClient\.put\(`\$\{BASE\}\/items\/\$\{itemId\}`, patch\)/);
  assert.doesNotMatch(api, /params: patch/);
});
