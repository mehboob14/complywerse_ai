// node --test "src/app/(dashboard)/governance/documents/overview/overviewPage.test.ts"
// What the At a glance page promises, read from its sources (the repo's habit for pages, like libraryKit.test.ts): it stays on the design-system kit and holds
// its token rules, every number is a Figure (a link to the library, or text) with a name a screen reader can read, a chart is a picture with its numbers as a table,
// a wait is a skeleton and a failure is "Unavailable" with Retry (never a 0), the scope, the view, the grouping and the columns are in the address and have names,
// the four views and the export are there, and no screen names a model or a vendor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const DIR = new URL('./', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const files = readdirSync(DIR).filter((n) => /\.tsx?$/.test(n) && !/\.test\.ts$/.test(n));
const tsx = files.filter((n) => n.endsWith('.tsx'));
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const idx = (src: string, piece: string) => { const i = src.indexOf(piece); assert.ok(i >= 0, `missing: ${piece}`); return i; };

test('the page is on the kit: its files hold the token rules (no named text size, palette colour, hex, named shadow or radius, no text under 12px)', () => {
  const found: string[] = [];
  for (const name of tsx) for (const v of findViolations(read(name))) found.push(`${name}:${v.line} ${v.rule} ${v.text}`);
  assert.deepEqual(found, []);
});

test('the page has left the legacy governance scope, and no screen names a model or a vendor', () => {
  for (const name of files) {
    assert.ok(!/governance-light/.test(read(name)), name);
    assert.ok(!/\b(gpt|openai|anthropic|claude)\b/i.test(read(name)), name);
  }
});

test('no two files differ only in their case: on Windows and macOS an import of one would open the other (_Matrix.tsx and _matrix.ts)', () => {
  const names = files.map((n) => n.replace(/\.tsx?$/, '').toLowerCase());
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

test('every number is a Figure; the cards and the table draw no bare count of their own', () => {
  const drawn = ['_Sections.tsx', '_DepartmentTable.tsx', '_Charts.tsx'].map((n) => code(read(n))).join('\n');
  const figures = drawn.match(/<Figure\b[^>]*>/g) ?? [];
  assert.ok(figures.length >= 12, `${figures.length} figures`);
  for (const tag of figures) assert.ok(/\bnoun=/.test(tag) && /\bvalue=/.test(tag) && /\bhref=/.test(tag), tag);       // each says what it counts, and where it opens (or null: text)
  assert.ok(!/>\s*\{(?:data|row|b|r|i|step|stage|item)\.[A-Za-z_.]*(?:count|pending|overdue|in_force|inForce|dueSoon|documents)\}\s*</.test(drawn), 'a count printed as text, without a Figure');
  const figure = code(read('_Figure.tsx'));
  assert.ok(figure.includes('figureName(value, noun)') && figure.includes('formatCount(value)'));
  assert.ok(figure.includes("value === 0 ? 'text-ds-fg-muted'"), 'a zero is quiet');
  assert.ok(figure.includes('focus-visible:shadow-ds-ring'), 'a link shows where the keyboard is');
});

test('the tiles are the kit\'s StatTile: a skeleton while loading, a link on every figure, and the two that jump point at sections of the page', () => {
  const tiles = code(read('_Tiles.tsx'));
  assert.ok(tiles.includes('<StatTile') && tiles.includes('loading') && tiles.includes('link={t.href ?'));
  assert.ok(tiles.includes('tileLinkName(t)'));
  const sections = code(read('_Sections.tsx'));
  for (const id of ['status', 'waiting', 'reviews', 'issues']) assert.ok(sections.includes(`id="${id}"`), id);
  assert.ok(code(read('_DepartmentTable.tsx')).includes('id="departments"') && code(read('_Layouts.tsx')).includes('id="board"'));
});

test('the lists are the kit\'s: the steps waiting longest are a RegisterTable (cards below 768px) whose rows open the document in the library', () => {
  const sections = code(read('_Sections.tsx'));
  assert.ok(sections.includes('<RegisterTable<WaitingRow>') && sections.includes('caption="Steps waiting longest"'));
  assert.ok(sections.includes('openHref(r.document_id)'));
  assert.ok(sections.includes('isRowHeader: true'));
  for (const name of tsx) assert.ok(!/<table\b|<th\b|<thead\b|<td\b/.test(code(read(name))), `${name}: no bare table elements, the kit's primitives`);
  assert.ok(sections.includes('Nothing is late'), 'an empty list says so');
});

test('the department table is the kit\'s RegisterTable with the columns of a measure, a card per department on a phone, and its names open the department\'s own view', () => {
  const table = code(read('_DepartmentTable.tsx'));
  assert.ok(table.includes('<RegisterTable<Item>') && table.includes('caption="Documents by department"') && table.includes('isRowHeader: true'));
  assert.ok(table.includes('cardTitle={(i) =>') && table.includes('card: \'meta\''), 'a phone shows each department as a card');
  assert.ok(table.includes('href={line.open}') && table.includes('matrixLines(data, columns, open)'));
  assert.ok(table.includes('<SegmentedControl label="Columns" name="overview-measure"') && table.includes('TABLE_MEASURES'), 'the columns are chosen from the measures');
  assert.ok(table.includes('viewHref(dept, view, group, measure)'), 'opening a department stays in the same view and columns');
  assert.ok(table.includes('figureHref(data, line.row.key)') && table.includes('data.scope.whole_organisation'), 'the total row is for the whole organisation only');
  assert.ok(/No departments/.test(table), 'an empty table says so');
});

test('the summary is the mix: figures, graphs, the table, a strip of the board, then the lists; the table only when there is more than one department', () => {
  const layouts = code(read('_Layouts.tsx'));
  assert.ok(layouts.includes('byDepartment && <MatrixCard') && layouts.includes('hasDepartmentTable(data)'), 'a unit with nothing under it has no table');
  const order = ['<Tiles data={data} />', '<StackChart', '<TypeChart', '<MatrixCard', '<BoardPanel', '<ByStatus', '<Waiting', '<ReviewsCard', '<IssuesCard'].map((p) => idx(layouts, p));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the top-to-bottom order: figures, graphs, the table, the board, the lists');
  assert.ok(layouts.includes('per={CARDS_SUMMARY} compact') && layouts.includes('viewHref(data.scope.value, \'board\')'), 'the strip opens the whole board');
  assert.ok(layouts.includes('<StatusChart data={data} />'), 'a unit without sub-departments gets the status chart in place of the department chart');
});

test('the graph view is the graphs alone, the board view the board with its grouping, and each view has a place in the page', () => {
  const layouts = code(read('_Layouts.tsx'));
  const graph = layouts.slice(idx(layouts, 'export function GraphView'), idx(layouts, 'export function BoardView'));
  assert.equal((graph.match(/<StackChart/g) ?? []).length, 3, 'status, type and waiting on people by department');
  assert.ok(graph.includes('<StatusChart') && graph.includes('<TypeChart') && !graph.includes('<Tiles') && !graph.includes('<MatrixCard'));
  const board = layouts.slice(idx(layouts, 'export function BoardView'));
  assert.ok(board.includes('<SegmentedControl label="Group the board by" name="overview-group"') && board.includes('per={CARDS_BOARD}'));
  const page = code(read('page.tsx'));
  for (const piece of ["view === 'summary' && <Summary", "view === 'table' && <MatrixCard", "view === 'graph' && <GraphView", "view === 'board' && <BoardView"]) assert.ok(page.includes(piece), piece);
});

test('a chart is a picture with its numbers as a table: a ChartFrame, the keyboard layer off, its colours from _chart.ts and never written in a component', () => {
  const charts = code(read('_Charts.tsx'));
  assert.equal((charts.match(/<ChartFrame\b/g) ?? []).length, 3);
  for (const data of ['data={stackTable(stack)}', "data={sliceTable(bars, 'Status')}", "data={sliceTable(slices, 'Type')}"]) assert.ok(charts.includes(data), data);
  assert.ok((charts.match(/\{\.\.\.focusOff\}/g) ?? []).length >= 4, 'on every chart and on the Pie');
  assert.ok(!/<Legend\b/.test(charts) && !/<table\b/.test(charts));
  assert.ok(charts.includes('<Figure') && charts.includes('typeLines(data)'), 'the donut\'s list is the keyboard\'s way to the same links');
  for (const name of tsx) assert.ok(!/#[0-9a-fA-F]{6}\b/.test(code(read(name))), `${name}: a hex colour belongs in _chart.ts`);
  assert.ok(read('_chart.ts').includes("export const INK = '#"));
});

test('a bar is only a picture: hidden from a screen reader, the numbers beside it are what is read', () => {
  const sections = code(read('_Sections.tsx'));
  const bars = sections.split('\n').filter((l) => /style=\{\{ width:/.test(l));
  assert.ok(bars.length >= 1, `${bars.length} bars`);                                                                // a review state's segment
  for (const l of bars) assert.ok(!/role="progressbar"/.test(l));
  assert.ok((sections.match(/aria-hidden className="mb-\[12px\] flex/g) ?? []).length >= 1, 'their container is aria-hidden');
});

test('a wait is a skeleton and a failure is "Unavailable" with Retry, never a 0; a refusal says so and offers the way out', () => {
  const page = code(read('page.tsx'));
  assert.ok(page.includes('query.isPending') && page.includes('<TilesSkeleton />') && page.includes('<CardsSkeleton />'));
  assert.ok(page.includes('<ErrorState title="Unavailable"') && page.includes('onRetry={canRetry(query.error)'));
  assert.ok(page.includes('<NoAccessState title="No access"') && page.includes('title="Not your department"') && page.includes('title="Department not found"'));
  assert.ok(page.includes('Show mine'), 'a department that is not yours (or gone) is left with one button to the own scope');
  assert.ok(page.includes('What is shown may be out of date.'), 'a refresh that failed says the figures may be old');
  assert.ok(page.includes('<EmptyState kind="firstUse"') && page.includes('Open library'), 'an empty scope has one button to the library');
  assert.ok(code(read('_Tiles.tsx')).includes('loading />') || code(read('_Tiles.tsx')).includes(' loading '), 'the tiles say they are loading');
  assert.ok(!/\?\?\s*0\b|\|\|\s*0\b/.test(page), 'the page never turns a missing answer into 0');
  const board = code(read('_BoardPanel.tsx'));
  assert.ok(board.includes('query.isPending') && board.includes('<BoardSkeleton />') && board.includes('title="Board unavailable"') && board.includes('canRetry(query.error)'), 'the board has its own states');
  assert.ok(board.includes('Loading the board') && board.includes('No documents'));
});

test('the scope, the view, the grouping and the columns are in the address and have names: ?dept= &view= &group= &measure=, a picker that names every department by its path', () => {
  const page = code(read('page.tsx'));
  assert.ok(page.includes('dept: text()') && page.includes('useAddressState(ADDRESS)') && page.includes('setAddress({ dept: e.target.value })'));
  for (const piece of ['view: oneOf<ViewId>(VIEW_IDS, DEFAULT_VIEW)', 'group: oneOf<GroupId>(GROUP_IDS, DEFAULT_GROUP)', 'measure: oneOf<MeasureId>(TABLE_MEASURE_IDS, DEFAULT_MEASURE)']) assert.ok(page.includes(piece), piece);
  assert.ok(page.includes('<Select aria-label="Scope"'), 'the picker has a name');
  assert.ok(page.includes('<SegmentedControl label="View" name="overview-view"') && page.includes('{ push: true }'), 'a view is a step Back undoes');
  assert.ok(page.includes('scopeOptions(choices)') && page.includes('setOffered(data.choices)'));
  assert.ok(page.includes("export const dynamic = 'force-dynamic'"), 'like the library: the address is read on the client');
  assert.ok(page.includes('<PageHeader') && page.includes('variant="page"'));
  assert.ok(page.includes("routeFor('/governance/documents/overview')"), 'the title is the registry\'s name');
});

test('the export is a menu of two CSV files; the departments one is made from the figures on screen, the documents one comes from the server, and a failure says so with Retry', () => {
  const menu = code(read('_Export.tsx'));
  assert.ok(menu.includes('<Menu') && menu.includes('label="Export"') && menu.includes('Departments (CSV)') && menu.includes('Documents (CSV)'));
  assert.ok(menu.includes("matrixCsv(data, columnsFor('all', data))") && menu.includes('csvName('), 'every column, and a file name that says what and for what');
  assert.ok(menu.includes("responseType: 'blob'") && menu.includes('notify.error(e,') && menu.includes('retry:'));
  assert.ok(menu.includes('URL.revokeObjectURL'), 'the temporary address is let go');
  assert.ok(code(read('page.tsx')).includes('data && !isEmpty(data) && <ExportMenu data={data} />'), 'nothing to export from an empty scope or before the answer');
});

test('the board is read-only: a card opens the document, a column title opens the library on the column, the rest is "Show all"; lists are named', () => {
  const board = code(read('_BoardPanel.tsx'));
  assert.ok(board.includes('href={cardHref(card)}') && board.includes('columnHref(answer, col)') && board.includes('showAllHref(answer, col)') && board.includes('Show all'));
  assert.ok(board.includes('aria-label={`${title}: ${columnNote(col)}`}') && board.includes('aria-label="Board columns"'));
  assert.ok(board.includes('<StatusPill') && board.includes('flagWords(card)'), 'what is wrong with a card is a word, not only a colour');
  assert.ok(!/onDrag|draggable|useSortable/.test(board), 'moving a card would change a document\'s status: the board only shows');
});

test('only the server\'s numbers are shown: the page reads three endpoints (the figures, the board, the export) and the library; it writes nothing', () => {
  const all = files.map((n) => code(read(n))).join('\n');
  assert.ok(!/\.(post|put|patch|delete)\(/.test(all), 'a read-only page');
  assert.equal((all.match(/apiClient\.get\(/g) ?? []).length, 3);
  assert.ok(code(read('page.tsx')).includes('apiClient.get(ENDPOINT') && code(read('_BoardPanel.tsx')).includes('apiClient.get(BOARD_ENDPOINT') && code(read('_Export.tsx')).includes('apiClient.get(EXPORT_ENDPOINT'));
  assert.ok(code(read('_model.ts')).includes("export const ENDPOINT = '/governance/document-overview'"));
  assert.ok(code(read('_board.ts')).includes("BOARD_ENDPOINT = '/governance/document-overview/board'") && code(read('_board.ts')).includes("EXPORT_ENDPOINT = '/governance/document-overview/export'"));
});
