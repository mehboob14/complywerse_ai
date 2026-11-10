// node --test "src/app/(dashboard)/admin/connections/connectionsSource.test.ts"
// What the Connected systems folder must never do again, read from its source (there is no React renderer here; the behaviour is looked at in a browser): a native confirm / alert, a JSON box for
// credentials, a credential put back into a field, a technical setting name on a screen, a named utility the platform CSS repaints, text under 12px, and the three old addresses that must keep forwarding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';
import { legacyTarget, sectionOfPath } from '../../../../lib/adminSections.ts';

const HERE = new URL('./', import.meta.url);
const read = (rel: string, base: URL = HERE): string => readFileSync(new URL(rel, base), 'utf8');
const files = readdirSync(HERE).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
const tsx = files.filter((f) => f.endsWith('.tsx'));
const sheets = tsx.filter((f) => /Sheet/.test(f));

/** the source without comments, so a sentence that explains a rule is not read as the thing it forbids */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/\s.*$/, '$1')).join('\n');

test('the folder has the page and a sheet for each kind', () => {
  assert.ok(tsx.includes('page.tsx'));
  for (const f of ['_ScannerSheets.tsx', '_CloudSheets.tsx', '_ToolSheets.tsx', '_CatalogueSheet.tsx']) assert.ok(tsx.includes(f), f);
});

test('no native confirm, alert or prompt: a question is the kit\'s confirmation, a result a notice or a toast', () => {
  // (the kit's own `confirm({ title … })` from useConfirm is the allowed one: it is always called with an object)
  for (const f of tsx) assert.doesNotMatch(code(read(f)), /\bwindow\.(?:confirm|alert|prompt)\s*\(|(?<![\w.])(?:alert|prompt)\s*\(|(?<![\w.])confirm\s*\((?!\s*\{)/, f);
  assert.doesNotMatch(code(read('components/integrations/IdentityProvidersCard.tsx', new URL('../../../../', import.meta.url))), /\bconfirm\s*\((?!\s*\{)/, 'the identity card asks through useConfirm');
});

test('the kit rules hold for every screen of the folder (no named size, palette, shadow or radius; no text under 12px)', () => {
  for (const f of tsx) assert.deepEqual(findViolations(read(f)), [], f);
});

test('credentials are write-only: secrets are typed into masked boxes, never put back, never typed as JSON', () => {
  for (const f of sheets) {
    const src = code(read(f));
    assert.doesNotMatch(src, /Credentials \(JSON\)|JSON\.parse\(creds|credsJson|credentials_template\b.*stringify/, `${f}: no JSON credentials box`);
    assert.doesNotMatch(src, /value=\{(?:conn|existing|c|saved)\.(?:password|secret|token|access_key|secret_key|client_secret|credentials)\b/, `${f}: a saved credential is never a field's value`);
    assert.doesNotMatch(src, /defaultValue=/, `${f}: no uncontrolled field prefilled from the server`);
  }
  assert.ok((code(read('_ScannerSheets.tsx')).match(/type="password"/g) ?? []).length >= 4, 'the scanner keys and passwords are masked boxes');
  assert.match(code(read('_CloudSheets.tsx')), /type=\{f\.secret \? 'password' : 'text'\}/, 'a cloud secret field is masked');
  assert.match(code(read('_parts.tsx')), /\[-webkit-text-security:disc\]/, 'a pasted key file is masked');
  assert.match(code(read('_ToolSheets.tsx')), /isSecretField\(f\)/, 'a tool\'s secret fields are decided by the catalogue');
});

test('no setting name, vendor tool or technical word is on a screen (rule U1)', () => {
  for (const f of tsx) {
    const src = code(read(f));
    for (const word of ['CONNECTOR_MASTER_KEY', 'PREFIX_ACCESS_KEY', 'PREFIX_SECRET_KEY', 'LANGSMITH', 'base64', 'Fernet', 'Env vars']) assert.ok(!src.includes(word), `${f} says ${word}`);
  }
});

test('nothing is hidden until hover and nothing is kept in the browser: every action is a button', () => {
  for (const f of tsx) {
    const src = code(read(f));
    assert.doesNotMatch(src, /opacity-0[^'"`]*group-hover|group-hover:opacity-100/, f);
    assert.doesNotMatch(src, /localStorage|sessionStorage/, f);
  }
});

test('the page draws the kit head with the section\'s name, keeps the links that already exist and follows them once', () => {
  const page = code(read('page.tsx'));
  assert.match(page, /<PageHeader[\s\S]{0,60}variant="page"[\s\S]{0,40}title="Connected systems"/);
  assert.match(page, /address\.provider/);
  assert.match(page, /address\.connector/);
  assert.match(page, /safeReturn\(address\.return\)/);
  assert.match(page, /followed\.current\.provider/);
});

test('the three old addresses forward to the register with their kind and keep the rest of the query', () => {
  const pages: Array<[string, string, string]> = [
    ['cloud-connectors/page.tsx', 'cloud-connectors', 'cloud'], ['connectors/page.tsx', 'connectors', 'tools'], ['../integrations/connections/page.tsx', 'integrations', 'scanners'],
  ];
  const ADMIN = new URL('../', import.meta.url);
  for (const [file, tab, kind] of pages) {
    const src = read(file, ADMIN);
    assert.match(src, /redirect\(legacyTarget\(\{ \.\.\.searchParams, tab: '[a-z-]+' \}\)\.href\)/, file);
    assert.ok(src.includes(`tab: '${tab}'`), `${file} forwards the ${tab} tab`);
    assert.equal(legacyTarget({ tab, provider: 'aws_inspector', q: 'x' }).href, `/admin/connections?kind=${kind}&provider=aws_inspector&q=x`, file);
  }
  assert.equal(legacyTarget({ tab: 'evidence-collectors', connector: 'github', return: '/automation/soc2-controls/IAC-06' }).href, '/admin/connections?kind=evidence&connector=github&return=%2Fautomation%2Fsoc2-controls%2FIAC-06');
  assert.equal(sectionOfPath('/admin/connectors')?.id, 'connections', 'the old address still lights the section');
  assert.equal(sectionOfPath('/admin/evidence-collectors'), undefined, 'the Controls Automation page stays outside the Administration layout');
});

test('the Controls Automation page keeps its kit head and no longer pretends to be embedded', () => {
  const src = code(read('../evidence-collectors/page.tsx'));
  assert.match(src, /<PageHeader variant="page" title=\{title\}/);
  assert.doesNotMatch(src, /standalone|usePathname/);
});

test('the three shared components keep the 12px floor and the old addresses are not linked from them any more', () => {
  const base = new URL('../../../../components/integrations/', import.meta.url);
  for (const f of ['IdentityProvidersCard.tsx', 'IntegrationPlatformsCard.tsx', 'SqlDbForm.tsx', 'BrandLogo.tsx']) {
    const src = read(f, base);
    assert.doesNotMatch(src, /text-\[(?:9|10|11)px\]/, f);
  }
  const platforms = read('IntegrationPlatformsCard.tsx', base);
  assert.doesNotMatch(platforms, /router\.push\(`\/admin\?tab=|router\.push\('\/integrations\/connections'\)/);
  assert.match(platforms, /\/admin\/connections\?kind=cloud&provider=/);
  assert.match(read('BrandLogo.tsx', base), /Math\.max\(12,/);
  assert.doesNotMatch(read('IdentityProvidersCard.tsx', base), /AADSTS|backend log|Role #/, 'no program-error code, log hint or role number on screen');
});
