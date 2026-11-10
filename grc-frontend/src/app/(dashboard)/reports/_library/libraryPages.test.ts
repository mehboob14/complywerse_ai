// node --test "src/app/(dashboard)/reports/_library/libraryPages.test.ts"
// Source-text pins for the Reports library and the dashboards (the files rpt-library wrote): the kit's rules (no named utilities the shell rewrites, nothing under 12px, no bare outline-none), no
// native dialogs, nothing that appears only on hover, no vendor or model name on a screen, and the few contracts that a screenshot cannot show: a refused save is never kept as a hidden local copy,
// a CSV goes through the escaping writer, the PDF tab opens before anything is awaited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const REPORTS = fileURLToPath(new URL('../', import.meta.url));
const read = (file: string) => readFileSync(`${REPORTS}${file}`, 'utf8');
const walk = (dir: string): string[] => (readdirSync(`${REPORTS}${dir}`, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => `${dir}/${f}`);

/** The words a person can read in a source file (the reading of lib/uxContent.test.ts): JSX text and string literals that hold a space; comments are dropped first. */
function visible(source: string, jsx: boolean): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const out: string[] = [];
  if (jsx) {
    let stripped = code;
    for (let before = ''; before !== stripped; ) { before = stripped; stripped = stripped.replace(/\{(?:[^{}<>]|=>)*\}/g, ' '); }
    for (const m of Array.from(stripped.matchAll(/>([^<>]+)</g))) if (!/=>|===|;|\b(?:return|const|import|export|new)\b/.test(m[1])) out.push(m[1]);
  }
  for (const m of Array.from(code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g))) out.push(m[2]);
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.includes(' '));
}

const FILES = [
  ...walk('_library'),
  'layout.tsx', 'page.tsx', 'saved/page.tsx', 'dashboards/page.tsx', 'builder/page.tsx',
  '_reports/DashboardTile.tsx', '_reports/savedReports.ts', '_reports/dashboards.ts', '_reports/rowCoverage.ts',
];

test('the rpt-library files follow the kit\'s rules: no class the shell rewrites, nothing under 12px, no bare outline-none', () => {
  assert.ok(FILES.length > 20);
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native confirm, alert or prompt, no action that exists only on hover, no governance-light', () => {
  for (const f of FILES) {
    const source = read(f);
    assert.doesNotMatch(source, /\bwindow\.(?:confirm|alert|prompt)\(|(?<![\w.])(?:alert|prompt)\(/, `${f}: a native dialog`);
    if (!/useConfirm/.test(source)) assert.doesNotMatch(source, /(?<![\w.])confirm\(/, `${f}: a native confirm (the kit's is useConfirm)`);
    assert.doesNotMatch(source, /opacity-0[^'"`]*group-hover|group-hover:opacity|hover:opacity-100/, `${f}: hover-only`);
    assert.doesNotMatch(source, /governance-light/, f);
  }
});

test('a screen never names a vendor, a model or a product: the words are the platform\'s', () => {
  for (const f of FILES) {
    const hit = visible(read(f), f.endsWith('.tsx')).find((s) => /\b(?:open\s?ai|gpt|anthropic|claude|metabase|qdrant|sql)\b/i.test(s));
    assert.equal(hit, undefined, `${f}: ${hit}`);
  }
});

test('the library saves strictly: putSpec, dropSpec and retrySpec throw when the server does not take it and keep no hidden local copy of a report that lives on the server', () => {
  const source = read('_reports/savedReports.ts');
  const body = (name: string) => source.slice(source.indexOf(`export async function ${name}`), source.indexOf('\n}\n', source.indexOf(`export async function ${name}`)));
  assert.doesNotMatch(body('putSpec'), /saveLocal|catch/, 'putSpec lets the failure through');
  assert.doesNotMatch(body('dropSpec').replace(/catch \(e\) \{[^}]*\}/, ''), /saveLocal/);
  assert.match(body('dropSpec'), /!== 404\) throw e/, 'a report that is already gone counts as deleted, any other failure is thrown');
  assert.match(body('persistSpec'), /markRefused\(spec\.id/, 'the builder\'s save still keeps a local copy, but a refusal is recorded now');
  assert.match(source, /toResend\(local, serverIds, refusedMap\(\)\)/, 'a refused copy is not sent again on every list');
  const dashboards = read('_reports/dashboards.ts');
  assert.doesNotMatch(dashboards, /saveLocal|persistDashboard|removeDashboard/, 'the dashboards keep no local shadow and the silent writers are gone');
  assert.match(dashboards, /toResend\(local, ids, refusedMap\(\)\)/);
});

test('a CSV from the library goes through the escaping writer, and the PDF tab opens before anything is awaited', () => {
  const source = read('_library/download.ts');
  assert.match(source, /toSafeCsv\(/);
  assert.doesNotMatch(source, /sheet_to_csv|exportCSV/, 'the unescaped writer is not used');
  assert.ok(source.indexOf("window.open('/reports/print'") > 0 && source.indexOf("window.open('/reports/print'") < source.indexOf('await '), 'window.open comes first');
  assert.match(source, /import\('\.\.\/_reports\/exporters'\)/, 'the spreadsheet and Word writers are fetched when one is asked for');
});

test('the dashboards edit with a Save bar and the kit confirm, the tiles say why they cannot draw, and a tile never reads the report by itself', () => {
  const page = read('_library/dashboards/DashboardsPage.tsx');
  assert.match(page, /<SaveBar/);
  assert.match(page, /useConfirm\(\)/);
  assert.match(page, /beforeunload/);
  const tile = read('_reports/DashboardTile.tsx');
  assert.doesNotMatch(tile, /getSpec/, 'the report comes from the dashboard\'s one list, not a request for every tile');
  assert.match(tile, /TILE_WORDS\.missing/);
  assert.match(tile, /TILE_WORDS\.no_module/);
  assert.match(tile, /rowsKey\(/);
});
