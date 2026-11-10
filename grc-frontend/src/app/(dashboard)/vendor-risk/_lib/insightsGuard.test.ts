// node --test "src/app/(dashboard)/vendor-risk/_lib/insightsGuard.test.ts"
// The source pins of Insights and Setup (vendor-insights-setup, 2026-11-10): Risks, Comply analyses, Reports, Roster, Policy and Settings are built on the kit and stay so. The kit's own rules (no named text
// size, palette class, named shadow or radius, remapped spacing, text under 12px, bare outline-none), no native dialog, no hand-built overlay, no bare <p>/<td>/<th> (11.5px in the shell), no `_ui`, no
// older toast, no bare mutation, no permission key or record number in visible words, the pages draw the kit head and their strip, and the old addresses keep forwarding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const root = fileURLToPath(new URL('..', import.meta.url));                       // .../vendor-risk/
const src = fileURLToPath(new URL('../../../../', import.meta.url));              // .../src/
const read = (abs: string): string => readFileSync(abs, 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = `${dir}${name}`;
    return statSync(p).isDirectory() ? walk(`${p}/`) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}
const rel = (abs: string): string => abs.replace(root, '').replace(src, 'src/');
const abs = (file: string): string => (file.startsWith('src/') ? `${src}${file.slice(4)}` : `${root}${file}`);

/** `_Questions.tsx` is the questionnaire group's (the onboarding editor, still drawn inside Settings > Tiering until it moves to Questionnaires > Tiering): not held to these rules here. */
const NOT_OURS = ['settings/_Questions.tsx'];
const SOURCES: Array<[string, string]> = [
  ...['risk-360/', 'comply-analysis/', 'reports/', 'policy/', 'settings/', '_lib/fair/'].flatMap((d) => walk(`${root}${d}`)),
  `${root}roster/page.tsx`, `${root}_lib/vendorNames.ts`, `${root}_lib/useLeaveGuard.ts`, `${root}_lib/useDebounced.ts`,
  `${src}components/vendor-risk/ReportView.tsx`, `${src}lib/statuses/vendorInsights.ts`,
].map((abs): [string, string] => [rel(abs), read(abs)]).filter(([f]) => !NOT_OURS.includes(f));
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the folders of the six pages are all covered, and the onboarding editor is the one file left out', () => {
  const names = SOURCES.map(([f]) => f);
  for (const f of ['risk-360/page.tsx', 'risk-360/_risks/RiskRegister.tsx', 'comply-analysis/page.tsx', 'comply-analysis/[id]/page.tsx', 'reports/page.tsx', 'reports/[id]/page.tsx', 'reports/_reports/ReportsRegister.tsx',
    'roster/page.tsx', 'policy/page.tsx', 'policy/_AlertRules.tsx', 'settings/page.tsx', 'settings/_sections/Tiering.tsx', 'settings/_Lists.tsx', 'settings/_Exposure.tsx', 'src/components/vendor-risk/ReportView.tsx']) assert.ok(names.includes(f), f);
  assert.ok(SOURCES.length > 40);
  assert.ok(!names.includes('settings/_Questions.tsx'));
});

test('the kit\'s rules hold in every file: no named text size, palette class, hex colour class, named shadow or radius, remapped spacing, text under 12px, bare outline-none', () => {
  for (const [file, code] of SOURCES) {
    const found = findViolations(code);
    assert.deepEqual(found.map((v) => `${v.rule}:${v.line}`), [], `${file}: ${found.map((v) => `${v.rule} (${v.text})`).join('; ')}`);
  }
});

test('no native dialog, no hand-built overlay, no hover-only action, no bare mutation, no older toast, no `_ui` import', () => {
  for (const [file, source] of SOURCES) {
    const code = strip(source);
    assert.ok(!/window\.(confirm|alert|prompt)|(^|[^.\w])(confirm|alert|prompt)\(/.test(code.replace(/useConfirm|confirm\(\{/g, '')), `${file}: a native dialog`);
    assert.ok(!/fixed inset-0/.test(code), `${file}: a hand-built overlay (use Sheet / SidePanel / ConfirmDialog)`);
    assert.ok(!/opacity-0[^"']*group-hover|group-hover[^"']*opacity-0/.test(code), `${file}: an action only a hover shows`);
    assert.ok(!/\buseMutation\(/.test(code), `${file}: a bare mutation (use useReportedMutation: it reports the answer, and a failure stays on screen)`);
    assert.ok(!/ToastProvider|useToast\b/.test(code), `${file}: the older toast (use useNotify / useReportedMutation)`);
    for (const m of Array.from(code.matchAll(/from '(\.[^']*)'/g))) {
      const target = new URL(m[1], `file:///${abs(file).replace(/\\/g, '/')}`).pathname;
      assert.ok(!/\/vendor-risk\/_ui(\/|$)/.test(target), `${file}: imports the older _ui kit (${m[1]})`);      // the module's own kit; settings/_ui.tsx is Settings' own and is fine
    }
  }
});

test('a paragraph and a table cell carry their own size and colour: a bare <p>, <td> or <th> is 11.5px in the shell', () => {
  for (const [file, source] of SOURCES) {
    const code = strip(source);
    const bare = Array.from(code.matchAll(/<(p|td|th)(\s[^>]*)?>/g)).filter((m) => !/className\s*=/.test(m[2] ?? ''));
    assert.deepEqual(bare.map((m) => m[0].slice(0, 40)), [], `${file}: a bare ${bare[0]?.[1]}`);
  }
});

test('browser date parsing is left out: server times go through lib/format.ts (the quarters of the Generate sheet are calendar days and say so)', () => {
  const CALENDAR = ['reports/_reports/reportsModel.ts'];
  for (const [file, source] of SOURCES) {
    if (CALENDAR.includes(file)) continue;
    assert.ok(!/new Date\(/.test(strip(source).replace(/new Date\(\)/g, '')), `${file}: new Date( on a stored value (use lib/format.ts: server times are naive UTC)`);
    assert.ok(!/toLocale(Date|Time)String\(/.test(strip(source)), `${file}: toLocaleDateString / toLocaleTimeString (use lib/format.ts)`);
  }
});

test('Rule U1: no permission key, record number, id or file name on a screen', () => {
  for (const [file, source] of SOURCES) {
    const code = strip(source);
    assert.ok(!/>[^<{]*(?:vendor_risk|erm):[a-z_*]+:[a-z*]+[^<{]*</.test(code), `${file}: a permission key in visible text`);
    assert.ok(!/(?:Risk|Vendor|Report|Analysis|Alert) #|Vendor \$\{|Risk \$\{|User \$\{/.test(code), `${file}: a record number in words`);
    assert.ok(!/content_hash|sha-?256|\bchecksum\b/i.test(code), `${file}: a hash`);
  }
});

test('each page draws the kit head and, under it, its strip; the records draw a head with a way back', () => {
  for (const page of ['risk-360', 'comply-analysis', 'reports', 'roster', 'policy', 'settings']) {
    const s = read(`${root}${page}/page.tsx`);
    assert.match(s, /<PageHeader[\s\S]{0,80}variant="page"/, `${page}: the page head`);
    assert.match(s, /<VendorTabs \/>/, `${page}: the strip of its entry`);
  }
  for (const page of ['comply-analysis/[id]', 'reports/[id]']) {
    const s = read(`${root}${page}/page.tsx`);
    assert.match(s, /variant="page"/, `${page}: the page head`);
    assert.match(s, /back=\{BACK\}/, `${page}: a link back to the list`);
  }
});

test('the three registers are the one wiring of the explorer (RegisterFrame) and a failed read is never drawn as an empty list', () => {
  for (const file of ['risk-360/_risks/RiskRegister.tsx', 'comply-analysis/_analyses/AnalysisRegister.tsx', 'reports/_reports/ReportsRegister.tsx']) {
    const s = read(`${root}${file}`);
    assert.match(s, /<RegisterFrame/, file);
    assert.match(s, /error=\{q\.isError && !q\.data \? q\.error : undefined\}/, `${file}: a failed first read is an error state`);
    assert.match(s, /refreshError=/, `${file}: a failed refresh says the list may be out of date`);
  }
});

test('Policy saves in ONE request (the reopen thresholds go with it), Settings saves one section at a time, and an old address still lands', () => {
  const policy = read(`${root}policy/page.tsx`);
  assert.match(policy, /savePatch\(/);
  assert.ok(!/saveReopen/.test(policy), 'no second request');
  const settings = read(`${root}settings/page.tsx`);
  assert.match(settings, /dirtyOf\(current, dirty\)/, 'a section sends only its own keys');
  assert.match(settings, /sectionOfAnchor\(/, 'an old #anchor opens its section');
  assert.match(settings, /useLeaveGuard\(/);
  assert.match(read(`${root}settings/emails/page.tsx`), /redirect\(`\/vendor-risk\/settings\?\$\{query\.toString\(\)\}`\)/);
  assert.match(read(`${root}settings/emails/page.tsx`), /searchParams/, 'the forward keeps the query');
  assert.ok(!/'use client'/.test(read(`${root}settings/emails/page.tsx`)), 'a server redirect, no page flash');
  assert.match(read(`${root}settings/alert-rules/page.tsx`), /policy#alert-rules/);
  assert.match(read(`${root}comply-analysis/page.tsx`), /params\?\.get\('vendor'\)/, 'the supplier\'s Exposure tab still opens New analysis for it');
});
