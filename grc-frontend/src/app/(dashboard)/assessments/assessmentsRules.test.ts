// node --test "src/app/(dashboard)/assessments/assessmentsRules.test.ts"
// The Assessments Overview, All assessments and Types are built on the design-system kit, so they follow its rules (components/ui/ds/kitRules.ts) and the reviewer's: no palette class, named text
// size, radius or shadow, no text under 12px, no bare outline-none; no native confirm/alert/prompt; no action that shows only on hover; a <p>, <td>, <th>, <h2>, <h3> with a size and colour of its
// own; nothing technical in a sentence a person reads (Rule U1). The old addresses are forwards that draw nothing; a GET never writes; a workbook is uploaded under its kind's name; the SLA is
// saved once, not on every keystroke; the register is read whole (its true total says when it was cut).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { findViolations } from '../../../components/ui/ds/kitRules.ts';

const DIR = 'src/app/(dashboard)/assessments';
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name).replace(/\\/g, '/');
    if (statSync(p).isDirectory()) return name === 'a' ? [] : walk(p);                 // a/[id] is the assessment page: the workspace group's
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}
const FILES = walk(DIR);
const FORWARDS = [
  'src/app/(dashboard)/assessments/[framework]/page.tsx',
  'src/app/(dashboard)/compliance/assessments/page.tsx',
  'src/app/(dashboard)/compliance/assessments/approvals/page.tsx',
  'src/app/(dashboard)/cyber-security/page.tsx',
  'src/app/(dashboard)/nca/page.tsx',
];
const src = (f: string) => readFileSync(f, 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('every file of the three pages follows the kit rules', () => {
  assert.ok(FILES.length >= 20, 'the files are there');
  const bad = FILES.filter((f) => f.endsWith('.tsx')).flatMap((f) => findViolations(src(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native dialog, no hover-only action, no client-side download link to an API path', () => {
  for (const f of FILES) {
    const s = code(src(f));
    assert.doesNotMatch(s, /(?<![\w.])window\.(confirm|alert|prompt)\(|(?<![\w.])(alert|prompt)\(|(?<!await )(?<![\w.])confirm\(/, `${f}: a native dialog`);
    assert.doesNotMatch(s, /opacity-0[^'"`]*group-hover|group-hover:opacity-100/, `${f}: an action that shows only on hover`);
    assert.doesNotMatch(s, /href=\{?[`'"]\/api\//, `${f}: a link to /api`);
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
  const words = /\b(sha-?256|checksum|fingerprint|uuid|stack ?trace|endpoint|HTTP \d{3}|\/api\/|json)\b/i;
  for (const f of FILES.filter((x) => x.endsWith('.tsx'))) {
    const text = Array.from(code(src(f)).matchAll(/>\s*([A-Z][^<>{}]{12,})</g)).map((m) => m[1]).concat(Array.from(code(src(f)).matchAll(/(?:title|description|message|label|hint|info)=["']([^"']{12,})["']/g)).map((m) => m[1]));
    for (const t of text) assert.doesNotMatch(t, words, `${f}: "${t.slice(0, 60)}"`);
  }
});

test('the old addresses are forwards that draw nothing themselves', () => {
  for (const f of FORWARDS) {
    const s = src(f);
    assert.doesNotMatch(s, /'use client'/, `${f} is a server page: the redirect is sent before anything is drawn`);
    assert.match(s, /redirect\(/, `${f} redirects`);
    assert.ok(s.split('\n').length <= 30, `${f} is a forward, not a page`);
  }
  // the pages that look a kind up draw a skeleton or the failure, with the kit's head, and say what failed with Retry
  const fwd = src(`${DIR}/_forward/FormatForward.tsx`);
  assert.match(fwd, /<PageHeader variant="page"/);
  assert.match(fwd, /onRetry/);
  assert.match(fwd, /router\.replace\(/);
});

test('the pages and the data layer: whole list, board shared with the Performance Overview, no write on a read', () => {
  const data = src(`${DIR}/_data/assessmentData.ts`);
  assert.match(data, /params: \{ limit: REGISTER_LIMIT, summary: 0, all_formats: 1 \}/, 'the register is read whole, without the tenant-wide summary');
  assert.match(data, /board: \['assessments-board-overview'\]/, 'the key the Performance Overview card reads');
  assert.match(data, /my-work/);
  for (const f of FILES) {
    const s = code(src(f));
    assert.doesNotMatch(s, /kpi-live|nca\/container/, `${f}: nothing here snapshots KPI history or makes the NCA container`);
  }
  assert.match(data, /canRetry\(error\)/, 'a refusal is not retried');
});

test('a workbook is uploaded under its kind\'s name, and the new assessment opens', () => {
  const data = src(`${DIR}/_data/assessmentData.ts`);
  assert.match(data, /if \(format\) form\.append\('expected_format', format\)/);
  const dialog = src(`${DIR}/_types/UploadDialog.tsx`);
  assert.match(dialog, /api\.upload\(f, spec\.expectFormat\)/);
  assert.match(dialog, /router\.push\(id \? `\/assessments\/a\/\$\{id\}`/);
});

test('the SLA is saved once, with a Save, and checked before it is sent (not on every keystroke)', () => {
  const dialog = src(`${DIR}/_overview/SlaDialog.tsx`);
  assert.match(dialog, /api\.savePolicy\(policyOf\(draft\)\)/);
  assert.doesNotMatch(dialog, /onChange=\{[^}]*(mutate|savePolicy)/, 'typing sends nothing');
  assert.match(dialog, /policyProblem\(draft\)/);
  const parts = src(`${DIR}/_overview/OverviewParts.tsx`);
  assert.match(parts, /canTune && <Button/, 'Tune SLA is for the people the page gives it to');
});

test('the pages flag their heading in the registry: each draws the kit head (the register and Types through their component)', () => {
  assert.match(src(`${DIR}/page.tsx`), /<PageHeader[\s\S]{0,60}variant="page"/);
  assert.match(src(`${DIR}/_register/AssessmentsRegister.tsx`), /<PageHeader[\s\S]{0,60}variant="page"/);
  assert.match(src(`${DIR}/_types/TypesPage.tsx`), /<PageHeader[\s\S]{0,60}variant="page"/);
  for (const f of [`${DIR}/page.tsx`, `${DIR}/_register/AssessmentsRegister.tsx`, `${DIR}/_types/TypesPage.tsx`]) assert.match(src(f), /<AssessmentTabs \/>/, `${f}: the strip of tabs`);
});
