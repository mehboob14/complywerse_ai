// node --test "src/app/(dashboard)/controls/_catalog/catalogSource.test.ts"
// What the Control Catalog, the Control Library and their strip / cards must keep, read from the SOURCE (there is no React renderer in this suite; the behaviour is driven in a browser): no native
// dialog (a confirmation is the kit's), the kit's rules on every file (no named text size or palette class, nothing under 12px, no bare outline), no action that appears only on hover, nothing technical
// or vendor-named in a screen, no first-N cut that is not said, the query keys other pages invalidate, the forwards of the pages that moved, and the one strip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const ROOT = 'src/app/(dashboard)';
const OWN = [`${ROOT}/controls`, `${ROOT}/control-library`];
const EXTRA = ['src/components/dashboard/ControlSurfaceTabs.tsx', 'src/components/dashboard/ControlAssuranceOverviewCards.tsx', 'src/lib/forwardTo.ts'];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p.replace(/\\/g, '/')] : [];
  });
}
const sources = [...OWN.flatMap(files), ...EXTRA].map((file) => ({ file, text: readFileSync(file, 'utf8') }));
const noComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/\s.*$/gm, '$1');
const read = (file: string) => readFileSync(file, 'utf8');

test('the folders exist and are read', () => {
  assert.ok(sources.length > 30, `${sources.length} files`);
  for (const f of ['controls/_catalog/CatalogPage.tsx', 'control-library/_library/LibraryPage.tsx', 'control-library/_library/DomainPage.tsx', 'control-library/_library/ReviewPage.tsx']) {
    assert.ok(sources.some((s) => s.file.endsWith(f)), f);
  }
});

test('no native confirm, alert or prompt: a confirmation is the kit\'s (useConfirm is called with an object)', () => {
  for (const { file, text } of sources) {
    const code = noComments(text);
    assert.doesNotMatch(code, /window\.(confirm|alert|prompt)\b/, file);
    assert.doesNotMatch(code, /(?<![\w.$])(alert|prompt)\(/, file);
    assert.doesNotMatch(code, /(?<![\w.$])confirm\((?!\s*\{)/, file);
  }
});

test('the kit\'s rules hold on every file: tokens and arbitrary values only, nothing under 12px, no bare outline-none', () => {
  for (const { file, text } of sources) assert.deepEqual(findViolations(text), [], file);
});

test('nothing appears only on hover', () => {
  for (const { file, text } of sources) assert.doesNotMatch(noComments(text), /opacity-0[^'"`\n]*group-hover|group-hover[^'"`\n]*opacity-0|hover:opacity-100/, file);
});

test('nothing technical, vendor-named or stored in the browser: no internal id in a sentence, no model name, no localStorage', () => {
  for (const { file, text } of sources) {
    const code = noComments(text);
    assert.doesNotMatch(code, /#\$\{|Risk #|User \$\{|\bUUID\b|\bSHA-?256\b|checksum|fingerprint/i, file);
    assert.doesNotMatch(code, /gpt-?\d|\bopenai\b|\banthropic\b|\bclaude\b/i, file);
    assert.doesNotMatch(code, /localStorage|sessionStorage/, file);
  }
});

test('no list is cut at a first N without saying it: the Catalog asks a page at a time, the old 500 / 600 limits are gone, and the picker that asks for 100 says "Showing N of M"', () => {
  for (const { file, text } of sources) {
    if (!file.includes('/controls/')) continue;
    assert.doesNotMatch(noComments(text), /limit=(500|600)|limit:\s*(500|600)/, file);
  }
  assert.match(read(`${ROOT}/controls/_catalog/CatalogSheets.tsx`), /Showing \$\{formatCount\(items\.length\)\} of \$\{formatCount\(list\.data\?\.total\)\}/);
  const data = read(`${ROOT}/controls/_catalog/catalogData.ts`);
  assert.match(data, /skip\/limit|catalogModel\.listQuery/, 'lists are asked with the model\'s paged query');
});

test('the query keys other pages invalidate are the ones the Catalog and the Library always used', () => {
  const catalog = ['controls/_catalog/catalogData.ts', 'controls/_catalog/ControlDrawer.tsx', 'controls/_catalog/SamplingTab.tsx', 'controls/_catalog/RisksTab.tsx', 'controls/_catalog/CatalogSheets.tsx'].map((f) => read(`${ROOT}/${f}`)).join('\n');
  for (const key of ["'wb-scope'", "'wb-overview'", "'wb-my-work'", "'wb-list'", "'wb-groups'", "'wb-detail'", "'wb-users'", "'wb-evidence-lib'", "'wb-risks'", "'wb-normalized'", "'wb-domains'"]) assert.ok(catalog.includes(key), key);
  const library = ['control-library/_library/libraryData.ts', 'control-library/_library/ReviewPage.tsx', 'control-library/_library/LibraryPage.tsx'].map((f) => read(`${ROOT}/${f}`)).join('\n');
  for (const key of ["'control-groups'", "'normalization-sessions'", "'auto-group-active'", "'cl-build-coverage'", "'control-group-categories'", "'control-group-domains'", "'review-queue'"]) assert.ok(library.includes(key), key);
});

test('the pages that moved forward to their new home with the query string', () => {
  const to: Record<string, string> = {
    'controls/workbench': '/controls', 'controls/overview': '/controls',
    'control-library/compare': '/control-library', 'control-library/coverage': '/control-library', 'control-library/evidence': '/control-library',
    'control-library/gaps': '/control-library', 'control-library/pipeline-lab': '/control-library', 'control-library/templates': '/control-library',
  };
  for (const [dir, target] of Object.entries(to)) {
    const text = noComments(read(`${ROOT}/${dir}/page.tsx`));
    assert.match(text, new RegExp(`redirect\\(forwardTo\\('${target}', searchParams\\)\\)`), dir);
    assert.doesNotMatch(text, /useEffect|useRouter/, `${dir}: the server answers the redirect`);
  }
  assert.equal(existsSync(`${ROOT}/controls/_shared`), false, 'the Workbench\'s shared file went with it');
});

test('one strip names the three surfaces once: Catalog, Library, Assurance, as links with aria-current', () => {
  const strip = read('src/components/dashboard/ControlSurfaceTabs.tsx');
  for (const [label, href] of [['Catalog', '/controls'], ['Library', '/control-library'], ['Assurance', '/control-library/assurance']]) assert.match(strip, new RegExp(`label: '${label}', href: '${href}'`));
  assert.match(strip, /aria-current=\{s\.id === active \? 'page' : undefined\}/);
  for (const f of ['controls/_catalog/CatalogPage.tsx', 'control-library/_library/LibraryPage.tsx', 'control-library/assurance/page.tsx']) assert.match(read(`${ROOT}/${f}`), /<ControlSurfaceTabs active="(catalog|library|assurance)"/, f);
});

test('Assurance says a failed read: an error with Retry, never a score of nothing', () => {
  const cards = noComments(read('src/components/dashboard/ControlAssuranceOverviewCards.tsx'));
  assert.match(cards, /<ErrorState/);
  assert.doesNotMatch(cards, /catch\s*\{\s*return null/, 'the read no longer swallows its failure');
});
