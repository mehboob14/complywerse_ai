// node --test "src/app/(dashboard)/vendor-risk/_lib/vendorRegisterGuard.test.ts"
// Source-text guard of what vendor-register built (the Vendors register and its drawer, the Add / Edit vendor sheet, Import, Contracts and its drawer, Check-ins, the board's forward): the
// kit's rules (no class the platform CSS rewrites, no value outside the tokens), no native dialog, no action that appears only on hover, no older page theme, no page-local kit (`_ui`), no
// heading that is not the kit's, and nothing technical on a screen (Rule U1: no id, hash or raw code). The register must keep its address contract and its server calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const ROOT = 'src/app/(dashboard)/vendor-risk';
const FILES = [
  'vendors/page.tsx', 'vendors/_register/VendorRegister.tsx', 'vendors/_register/VendorDetail.tsx', 'vendors/_register/VendorCells.tsx', 'vendors/_register/useVendorActions.tsx',
  'vendors/_register/vendorData.ts', 'vendors/_components/VendorFormDialog.tsx', 'vendors/_ImportVendors.tsx', 'assessments/page.tsx',
  'contracts/page.tsx', '_lib/contracts/ContractDrawer.tsx', '_lib/contracts/ContractParts.tsx', 'reviews/page.tsx',
].filter((f) => existsSync(`${ROOT}/${f}`));
const source = (file: string) => readFileSync(`${ROOT}/${file}`, 'utf8').replace(/\r\n/g, '\n');

test('every file vendor-register built follows the rules of the kit', () => {
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
    assert.ok(!/\bfixed inset-0\b/.test(src), `${f}: a hand-built modal`);
    assert.ok(!/toLocale(Date|Time)?String\(/.test(src), `${f}: a date written by the viewer's browser locale (use lib/format)`);
  }
});

test('the pages have the kit\'s page head and no heading of their own: one name on screen', () => {
  assert.match(source('vendors/_register/VendorRegister.tsx'), /<PageHeader[\s\S]{0,80}variant="page"/);
  for (const f of ['contracts/page.tsx', 'reviews/page.tsx'].filter((x) => existsSync(`${ROOT}/${x}`))) {
    const src = source(f);
    assert.match(src, /<PageHeader[\s\S]{0,80}variant="page"/, f);
    assert.ok(!/<h1/.test(src), `${f}: an h1 of its own`);
  }
});

test('the register keeps its server calls and its address: one complete lean load, the old addresses migrated, no page-by-page request', () => {
  const data = source('vendors/_register/vendorData.ts');
  assert.match(data, /lean: 1/);
  assert.match(data, /archived_only: true/);
  assert.match(data, /limit: LIMIT/, 'the register is read whole, not page by page');
  assert.match(source('vendors/_register/VendorRegister.tsx'), /migrateAddress\(search\)/);
  assert.match(source('vendors/_register/VendorRegister.tsx'), /get\('archived'\) === '1'/);
});

test('nothing technical on a screen: no id, hash or code in the words a person reads (Rule U1)', () => {
  for (const f of FILES.filter((x) => x.endsWith('.tsx'))) {
    const src = source(f);
    assert.ok(!/>\s*#\{[^}]*\bid\b[^}]*\}\s*</.test(src), `${f}: an id drawn as #id`);
    assert.ok(!/(Vendor|User|Finding|Contract|Evidence) #\d+/.test(src), `${f}: a numbered record in words`);
    assert.ok(!/\b(sha-?256|checksum|fingerprint|uuid)\b/i.test(src.replace(/\/\/.*$/gm, '')), `${f}: a technical word`);
  }
});

test('the vendor sheet asks for the tier only of a vendor that was tiered', () => {
  const src = source('vendors/_components/VendorFormDialog.tsx');
  assert.match(src, /!add && tiered && show\('tier'\)/, 'the Tier select is for a tiered vendor');
  assert.match(src, /dirty=\{dirty\}/, 'typed input is guarded');
});
