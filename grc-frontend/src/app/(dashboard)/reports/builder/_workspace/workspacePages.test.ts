// node --test "src/app/(dashboard)/reports/builder/_workspace/workspacePages.test.ts"
// Source-text pins for the report workspace (the files rpt-builder wrote or rebuilt): the kit's rules in every one of them, no native dialog, nothing that appears only on hover, no vendor or model name on
// a screen, no bare <p>/<td>/<th> without a size, and the contracts a screenshot cannot show: the CSV goes through the escaping writer, a save goes to the server strictly and a refusal is said, the PDF tab
// opens before anything is awaited, the data pane says when the rows are only part of the register and when the server skipped a filter, and the six old overlays and the dead files are gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bareText, kitViolations, legacyLeftovers } from '../../../evidence/_kitScan.ts';

const REPORTS = fileURLToPath(new URL('../../', import.meta.url));
const at = (file: string) => `${REPORTS}${file}`;
const read = (file: string) => readFileSync(at(file), 'utf8');
const workspace = readdirSync(at('builder/_workspace')).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => `builder/_workspace/${f}`);

const TSX = [
  'builder/page.tsx', 'print/page.tsx', ...workspace.filter((f) => f.endsWith('.tsx')),
  '_reports/CalcColumnPanel.tsx', '_reports/ColumnPicker.tsx', '_reports/DashboardView.tsx', '_reports/FilterBuilder.tsx', '_reports/PivotChart.tsx', '_reports/ReportDataTable.tsx',
  '_reports/SelectedColumnList.tsx', '_reports/SummarizePanel.tsx',
];
const TS = [...workspace.filter((f) => f.endsWith('.ts')), '_reports/cellTone.ts', '_reports/csvReport.ts', '_reports/exporters.ts', '_reports/printPayload.ts', '_reports/reportData.ts'];
const ALL = [...TSX, ...TS].map(at);

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

test('the workspace folder is the page and its pieces (a new file is a decision: add it here)', () => {
  assert.deepEqual(workspace.map((f) => f.replace('builder/_workspace/', '')).sort(), [
    'AddFieldsSheet.tsx', 'DataPane.tsx', 'DefinitionRail.tsx', 'ReportWorkspace.tsx', 'SaveSheet.tsx', 'WorkspaceHead.tsx', 'builderModel.ts', 'notices.ts', 'useReportRows.ts',
  ]);
});

test('the files of the workspace follow the kit: no class the shell rewrites, nothing under 12px, no bare outline-none', () => {
  assert.ok(TSX.length > 15);
  assert.deepEqual(kitViolations(ALL), []);
});

test('no bare <p>, <td>, <th>, <h2> or <h3> without a text size (the platform CSS gives it 11.5px)', () => {
  assert.deepEqual(bareText(TSX.map(at)), []);
});

test('no native confirm, alert or prompt, no action that exists only on hover, no governance-light, no date or count written by the browser\'s locale', () => {
  assert.deepEqual(legacyLeftovers(ALL), []);
});

test('a screen never names a vendor, a model or a product: the words are the platform\'s', () => {
  for (const f of [...TSX, ...TS]) {
    const hit = visible(read(f), f.endsWith('.tsx')).find((s) => /\b(?:open\s?ai|gpt|anthropic|claude|metabase|qdrant|sql)\b/i.test(s));
    assert.equal(hit, undefined, `${f}: ${hit}`);
  }
});

test('the six hand-made overlays, the old single-file builder and the dead files are gone, and nothing imports them', () => {
  for (const gone of ['_reports/ReportBuilder.tsx', '_reports/BuilderToolbar.tsx', '_reports/reportTemplates.ts', '_reports/ReportGrid.tsx', '_reports/PivotTable.tsx', '_reports/ChartViewGallery.tsx', '_reports/ChartViewStrip.tsx', '_reports/COVERAGE_MATRIX.md']) {
    assert.equal(existsSync(at(gone)), false, gone);
  }
  const everything = [...TSX, ...TS, '_library/download.ts', '_library/ReportsLibrary.tsx', '_reports/DashboardTile.tsx'].map(read).join('\n');
  assert.doesNotMatch(everything, /ReportBuilder'|ChartViewStrip|BuilderToolbar|reportTemplates|ReportGrid|PivotTable|ChartViewGallery/);
  const workspaceSource = workspace.map(read).join('\n');
  assert.doesNotMatch(workspaceSource, /fixed inset-0|className="fixed|absolute bottom-0 right-0 top-0/, 'a panel that covers the rows is a Sheet of the kit');
});

test('a CSV goes through the escaping writer', () => {
  const exporters = read('_reports/exporters.ts');
  assert.match(exporters, /reportCsv\(cols, rows\)/);
  assert.doesNotMatch(exporters, /sheet_to_csv/, 'the unescaped writer is not used');
  assert.match(read('_reports/csvReport.ts'), /toSafeCsv\(/);
});

test('a save goes to the server strictly: a refusal is said with Retry, and a copy on this device is only ever the person\'s explicit choice', () => {
  const source = read('builder/_workspace/ReportWorkspace.tsx');
  assert.match(source, /await putSpec\(next\)/);
  assert.equal(source.split('persistSpec(').length - 1, 1, 'persistSpec (which keeps a local copy) is called in one place only');
  assert.match(source.slice(source.indexOf('const keepOnDevice')), /persistSpec\(next\)/, '... the explicit "Keep on this device"');
  assert.match(source, /failureWords\(f, 'save the report'\)/);
  assert.match(source, /Keep on this device/);
  assert.doesNotMatch(source, /localStorage/, 'the workspace stores nothing in the browser by itself');
  assert.match(source, /beforeunload/, 'leaving with unsaved changes asks');
  assert.match(source, /useConfirm\(\)/);
});

test('a download says what it wrote, says when the data is partial, and the PDF tab opens before anything is awaited', () => {
  const source = read('builder/_workspace/ReportWorkspace.tsx');
  const body = source.slice(source.indexOf('const download = async'));
  assert.ok(body.indexOf("window.open('/reports/print'") > 0 && body.indexOf("window.open('/reports/print'") < body.indexOf('await '), 'window.open comes first');
  assert.match(source, /downloadWords\(name, format, rows\.length, data\.partial\)/);
  assert.match(source, /notify\.error\(e,/);
  assert.match(source, /retry: \(\) => void download\(format\)/);
  assert.match(source, /import\('\.\.\/\.\.\/_reports\/exporters'\)/, 'the spreadsheet and Word writers are fetched when one is asked for');
});

test('the data pane and the data hook tell a person when the rows are only part of the register and when the server skipped a filter', () => {
  const pane = read('builder/_workspace/DataPane.tsx');
  assert.match(pane, /data\.partial\.partial/);
  assert.match(pane, /data\.skippedLines/);
  assert.match(pane, /data\.fallbackLine/);
  assert.match(pane, /onRetry=\{data\.refetch\}/, 'a failed load has Retry');
  const hook = read('builder/_workspace/useReportRows.ts');
  assert.match(hook, /coverage\(\{ serverMode: readInfo\.fromServer/);
  assert.match(hook, /skippedFilterLines\(readInfo\?\.skipped/);
  assert.match(hook, /summaryWarningLines\(serverAgg\?\.warnings/);
  assert.match(read('_reports/reportData.ts'), /skipped = page\.warnings\?\.skipped_filters/, 'the server\'s skipped filters travel with the rows');
  assert.match(read('print/page.tsx'), /coverage\(\{ serverMode/, 'the print view says it too');
});

test('the table is paged and its footer still describes every matching row', () => {
  const table = read('_reports/ReportDataTable.tsx');
  assert.match(table, /<Pager/);
  assert.match(table, /paged = true/);
  assert.match(table, /aggregate\(\{ \.\.\.c, agg: c\.agg \?\? 'sum' \}, rows\)/, 'the totals read all the rows, not the page');
  assert.match(read('print/page.tsx'), /paged=\{false\}/, 'the print view draws every row');
});

test('the print tab takes its report once and keeps it in its own storage', () => {
  const source = read('_reports/printPayload.ts');
  assert.match(source, /localStorage\.removeItem\(KEY\)/);
  assert.match(source, /sessionStorage\.setItem\(KEY/);
});
