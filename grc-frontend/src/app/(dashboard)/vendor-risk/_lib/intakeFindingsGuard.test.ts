// node --test "src/app/(dashboard)/vendor-risk/_lib/intakeFindingsGuard.test.ts"
// Source-text guard of what vendor-intake-findings built (Intake, the request page, the Findings register and its drawer, THE finding card and list, the finding sheets, the action plan): the kit's rules
// (no class the platform CSS rewrites, no value outside the tokens), no native dialog, no hover-only action, no page-local kit (`_ui`), the page head of the kit and no heading of its own, a person is
// never shown as a number and no record by its id (Rule U1), and the people come from the module's own list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const ROOT = 'src/app/(dashboard)/vendor-risk';
const list = (dir: string): string[] => readdirSync(`${ROOT}/${dir}`).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts')).map((f) => `${dir}/${f}`);
const FILES = [
  'intake/page.tsx', 'intake/[id]/page.tsx', ...list('intake/_components'), ...list('intake/_queue'), '_lib/intake/IntakeForm.tsx',
  'findings/page.tsx', ...list('findings/_register'),
  'vendors/[id]/_tpra/FindingCard.tsx', 'vendors/[id]/_tpra/FindingDialogs.tsx', 'vendors/[id]/_tpra/FindingList.tsx', 'vendors/[id]/_tpra/FindingsPanel.tsx', 'vendors/[id]/_tpra/ActionPlanPanel.tsx',
  'vendors/[id]/_tabs/FindingsTab.tsx',
];
const source = (file: string) => readFileSync(`${ROOT}/${file}`, 'utf8').replace(/\r\n/g, '\n');

test('every file vendor-intake-findings built follows the rules of the kit', () => {
  const bad = FILES.flatMap((f) => findViolations(source(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native dialog, no action that appears only on hover, no older page theme, no page-local kit (_ui), no text under 12px', () => {
  for (const f of FILES) {
    const src = source(f);
    assert.ok(!/window\.(confirm|alert|prompt)\(|(^|[^.\w])(confirm|alert|prompt)\(/m.test(src.replace(/await confirm\(/g, '')), `${f}: a native dialog`);
    assert.ok(!/opacity-0[^"'`]*group-hover|group-hover[^"'`]*opacity-0/.test(src), `${f}: an action only on hover`);
    assert.ok(!/governance-light/.test(src), `${f}: the older Governance theme`);
    assert.ok(!/from '(\.\.\/)*(\.\/)?_ui(\/[a-zA-Z]+)?'|vendor-risk\/_ui/.test(src), `${f}: imports the module's older kit (_ui)`);
    assert.ok(!/text-\[(?:[0-9]|10|11)(?:\.\d+)?px\]/.test(src), `${f}: text under 12px`);
  }
});

test('a page has the kit\'s page head and no heading of its own: one name on screen', () => {
  for (const f of ['intake/page.tsx', 'intake/[id]/page.tsx', 'findings/page.tsx']) {
    const src = source(f);
    assert.match(src, /<PageHeader[\s\S]{0,80}variant="page"/, f);
    assert.ok(!/<h1/.test(src), `${f}: an h1 of its own`);
  }
});

test('a bare paragraph is never left to the platform: every <p> carries its own size and colour', () => {
  for (const f of FILES) {
    const bare = Array.from(source(f).matchAll(/<p(\s[^>]*)?>/g)).filter((m) => !/className=/.test(m[1] ?? ''));
    assert.deepEqual(bare.map((m) => m[0]), [], `${f}: a <p> with no class`);
  }
});

test('nothing technical is on a screen: no "User 12", no "#12", no record shown by its number', () => {
  for (const f of FILES) {
    const src = source(f);
    assert.ok(!/`User \$\{|\bUser \d+\b|Issue #|Finding #|Request #|Vendor #|#\$\{[a-zA-Z.]*[iI]d\}/.test(src), `${f}: a person or record shown by its number`);
  }
});

test('the people to pick from are the module\'s own list, never the administrators\' list', () => {
  for (const f of FILES) {
    const src = source(f);
    assert.ok(!/adminApi|getUsers\(|\/admin\/users|admin-users-for-tpra-intake/.test(src), `${f}: reads the administrators' user list`);
  }
});

test('the three finding screens are one: the register drawer, the record\'s tab and the lifecycle\'s stage all draw FindingCard (through FindingList), and none keeps its own card', () => {
  assert.match(source('findings/_register/FindingDrawer.tsx'), /from '..\/..\/vendors\/\[id\]\/_tpra\/FindingCard'/);
  assert.match(source('vendors/[id]/_tpra/FindingList.tsx'), /import FindingCard/);
  assert.match(source('vendors/[id]/_tabs/FindingsTab.tsx'), /import FindingList/);
  assert.match(source('vendors/[id]/_tpra/FindingsPanel.tsx'), /import FindingList/);
  for (const f of ['vendors/[id]/_tabs/FindingsTab.tsx', 'vendors/[id]/_tpra/FindingsPanel.tsx', 'findings/page.tsx']) {
    assert.ok(!/function FindingCard|const FindingCard =/.test(source(f).replace(/import \{ FindingCard,/, '')) || f === 'findings/page.tsx', `${f}: a card of its own`);
  }
});

test('the Findings register loads the register whole, and every change to a finding refreshes it', () => {
  const data = source('findings/_register/findingData.ts');
  assert.match(data, /limit: PAGE/);
  assert.match(data, /scope: 'all'/);
  const api = readFileSync(`${ROOT}/_lib/findingsApi.ts`, 'utf8');
  assert.match(api, /'tprm-findings'/, 'refreshFindings refreshes the register');
  assert.match(api, /'tprm-dashboard'/, 'and the Overview');
});
