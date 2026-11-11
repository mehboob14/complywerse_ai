// node --test "src/app/(dashboard)/vendor-risk/_lib/vendorShellGuard.test.ts"
// Source-text guard of what vendor-shell built (the layout, the strips, the Overview, Needs attention, Planned actions): the kit's rules (no class the platform CSS rewrites, no value outside
// the tokens), no native dialog, no hover-only action, no page-local kit (`_ui`), no heading that is not the kit's, no module header, and no raw id or code on a screen (Rule U1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const ROOT = 'src/app/(dashboard)/vendor-risk';
const FILES = [
  'layout.tsx', 'page.tsx', '_lib/VendorNav.tsx', '_lib/VendorActions.tsx', '_lib/actions/shared.tsx',
  '_overview/parts.tsx', '_overview/visuals.tsx', '_overview/chartsModel.ts', 'attention/page.tsx', 'attention/_sheets.tsx', 'actions/page.tsx',
];
const source = (file: string) => readFileSync(`${ROOT}/${file}`, 'utf8').replace(/\r\n/g, '\n');

test('every file vendor-shell built follows the rules of the kit', () => {
  const bad = FILES.flatMap((f) => findViolations(source(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native dialog, no action that appears only on hover, no older page theme, no page-local kit', () => {
  for (const f of FILES) {
    const src = source(f);
    assert.ok(!/window\.(confirm|alert|prompt)\(|\bconfirm\(|\balert\(|\bprompt\(/.test(src.replace(/const \{ confirm[^}]*\} = useConfirm\(\);|await confirm\(/g, '')), `${f}: a native dialog`);
    assert.ok(!/opacity-0[^"'`]*group-hover|group-hover[^"'`]*opacity-0/.test(src), `${f}: an action only on hover`);
    assert.ok(!/governance-light/.test(src), `${f}: the older Governance theme`);
    assert.ok(!/from '(\.\.\/)*_ui(\/[a-zA-Z]+)?'/.test(src), `${f}: imports the module's older kit (_ui)`);
  }
});

test('a page has the kit\'s page head and no heading of its own: one name on screen', () => {
  for (const f of ['page.tsx', 'attention/page.tsx', 'actions/page.tsx']) {
    const src = source(f);
    assert.match(src, /<PageHeader[\s\S]{0,80}variant="page"/, f);
    assert.ok(!/<h1/.test(src), `${f}: an h1 of its own`);
  }
  assert.ok(!/ModuleHeader|ModuleHead\b/.test(source('layout.tsx')), 'the module header is gone');
});

test('a bare paragraph is never left to the platform: every <p> carries its own size and colour', () => {
  for (const f of FILES) {
    const bare = Array.from(source(f).matchAll(/<p(\s[^>]*)?>/g)).filter((m) => !/className=/.test(m[1] ?? ''));
    assert.deepEqual(bare.map((m) => m[0]), [], `${f}: a <p> with no class`);
  }
});

test('nothing technical is on a screen: no id, code or key is printed as a name, and no "User 12" style fallback', () => {
  for (const f of FILES) {
    const src = source(f);
    assert.ok(!/`User \$\{|\bUser \d+\b|#\$\{[a-z.]*id\}/.test(src), `${f}: a person or record shown by its number`);
  }
});
