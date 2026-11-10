// node --test "src/app/(dashboard)/vendor-risk/_alerts/monitoringGuard.test.ts"
// The source pins of Monitoring (vendor-monitoring, 2026-11-10): the Alerts register, Security ratings and Dependencies are built on the kit and stay so. No native dialog, no hand-built overlay,
// no text under 12px, no named utility the platform stylesheet repaints, no palette class, no `_ui`, no bare mutation; the pages draw the head and the strip; the forwards keep the query string.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string): string => readFileSync(`${root}${rel}`, 'utf8');
const folder = (dir: string): Array<[string, string]> =>
  readdirSync(`${root}${dir}`).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).map((f) => [`${dir}/${f}`, read(`${dir}/${f}`)]);

const SOURCES: Array<[string, string]> = [
  ...folder('_alerts'), ...folder('_ratings'), ...folder('_dependencies'),
  ['monitoring/page.tsx', read('monitoring/page.tsx')], ['security/page.tsx', read('security/page.tsx')], ['dependencies/page.tsx', read('dependencies/page.tsx')],
  ['alerts/page.tsx', read('alerts/page.tsx')], ['technology/page.tsx', read('technology/page.tsx')], ['concentration/page.tsx', read('concentration/page.tsx')],
];
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('there is a register, a model and a drawer for each of the three pages', () => {
  const names = SOURCES.map(([f]) => f);
  for (const f of ['_alerts/AlertRegister.tsx', '_alerts/AlertDrawer.tsx', '_alerts/alertModel.ts', '_ratings/RatingsRegister.tsx', '_ratings/ratingsModel.ts', '_dependencies/DependenciesViews.tsx', '_dependencies/dependenciesModel.ts']) assert.ok(names.includes(f), f);
});

test('no native dialog, no hand-built overlay, no hover-only action', () => {
  for (const [file, src] of SOURCES) {
    const code = strip(src);
    assert.ok(!/window\.(confirm|alert|prompt)|(^|[^.\w])(confirm|alert|prompt)\(/.test(code.replace(/useConfirm|confirm\(\{/g, '')), `${file}: a native dialog`);
    assert.ok(!/fixed inset-0/.test(code), `${file}: a hand-built overlay (use Sheet / SidePanel / ConfirmDialog)`);
    assert.ok(!/opacity-0[^"']*group-hover|group-hover[^"']*opacity-0/.test(code), `${file}: an action only a hover shows`);
  }
});

test('no text under 12px, no named text size, no palette class, no named shadow, no bare outline-none', () => {
  for (const [file, src] of SOURCES) {
    const code = strip(src);
    assert.ok(!/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/.test(code), `${file}: text under 12px`);
    assert.ok(!/\btext-(xs|sm|base|lg|xl|2xl|3xl)\b/.test(code), `${file}: a named text size (the platform stylesheet repaints it; use text-ds-body / text-ds-label)`);
    assert.ok(!/\b(?:bg|text|border|ring|divide|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|rose|amber|orange|yellow|emerald|green|teal|sky|blue|indigo|violet|purple|primary)-\d{2,3}\b/.test(code), `${file}: a palette class (use the ds tokens)`);
    assert.ok(!/\bbg-white\b|\bshadow-(sm|md|lg|xl)\b|\brounded-(sm|md|lg|xl|2xl)\b/.test(code), `${file}: a named utility`);
    assert.ok(!/\bfont-(bold|semibold|medium)\b/.test(code), `${file}: font-bold / semibold / medium (write font-[600])`);
    assert.ok(!/(^|[\s"'`])outline-none(?!\w)/.test(code.replace(/focus-visible:outline-none/g, '')), `${file}: a bare outline-none`);
  }
});

test('the pages are on the kit: no _ui import, no legacy toast, no bare mutation, no browser date parsing, every external link says noopener', () => {
  for (const [file, src] of SOURCES) {
    const code = strip(src);
    assert.ok(!/from '\.\.?(\/\.\.)*\/_ui[/']|\/_ui'/.test(code), `${file}: imports the older _ui kit`);
    assert.ok(!/ToastProvider|useToast\b/.test(code), `${file}: the older toast (use useNotify / useReportedMutation)`);
    assert.ok(!/\buseMutation\(/.test(code), `${file}: a bare mutation (use useReportedMutation: it reports the answer, and a failure stays on screen)`);
    assert.ok(!/new Date\(/.test(code), `${file}: new Date( on a stored value (use lib/format.ts: server times are naive UTC)`);
    for (const m of Array.from(code.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g))) assert.match(m[0], /rel="noopener|rel="noreferrer/, `${file}: ${m[0].slice(0, 60)}`);
  }
});

test('Rule U1: nothing technical on a screen: no id, key name or code word in the words a person reads', () => {
  for (const [file, src] of SOURCES) {
    const code = strip(src);
    assert.ok(!/>[^<{]*(?:vendor_risk|erm):[a-z_*]+:[a-z*]+[^<{]*</.test(code), `${file}: a permission key in visible text`);
    assert.ok(!/>[^<{]*#\{?[a-z.]*id\b/i.test(code), `${file}: an id in visible text`);
    assert.ok(!/Vendor #|Alert #|Signal #|Risk #/.test(code), `${file}: a record number in words`);
  }
});

test('each page draws the kit head and the Monitoring strip; the forwards keep every param', () => {
  for (const page of ['monitoring/page.tsx', 'security/page.tsx', 'dependencies/page.tsx']) {
    const src = read(page);
    assert.match(src, /<PageHeader[\s\S]{0,80}variant="page"/, `${page}: the page head`);
    assert.match(src, /<VendorTabs \/>/, `${page}: the strip of its entry`);
  }
  for (const page of ['alerts/page.tsx', 'technology/page.tsx', 'concentration/page.tsx']) {
    const src = read(page);
    assert.match(src, /redirect\(/, `${page}: forwards`);
    assert.match(src, /searchParams/, `${page}: keeps the query`);
    assert.ok(!/'use client'/.test(src), `${page}: a server redirect, no page flash`);
  }
  assert.match(read('alerts/page.tsx'), /registerAddress/, 'the old ?alert=<id> link of e-mails and reminders');
  assert.match(read('concentration/page.tsx'), /view: 'platforms'/);
});

test('the register is the one wiring of the explorer (RegisterFrame), the signal writes keep their endpoints, and a failed read is never drawn as an empty list', () => {
  const reg = read('_alerts/AlertRegister.tsx');
  assert.match(reg, /<RegisterFrame/);
  assert.match(reg, /error=\{list\.isError && !list\.data \? list\.error : undefined\}/);
  const api = read('_alerts/alertsApi.ts');
  assert.match(api, /kinds: 'all'/);
  assert.match(api, /alerts\/\$\{v\.id\}\/move/);
  assert.match(api, /signals\/\$\{id\}\/dismiss/);
  assert.match(read('_ratings/RatingsRegister.tsx'), /<RegisterFrame/);
});
