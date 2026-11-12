// node --test "src/app/(dashboard)/governance/_overview/overviewPage.test.ts"
// What the Governance Overview keeps and how it is built (one page in three views: the Summary's five figures and cards, the Departments, the Board), pinned in the files that
// carry it (there is no React renderer here; behaviour is checked in a browser): the requests with their keys and endpoints (other pages share the scorecard's), no failure
// swallowed into zeros, every card with its own loading and error state, a refusal said as "No access", the work drawn from the shared inbox, the kit's rules in every file,
// the shared score dialog and tuner, the address that holds the scope, the view, the grouping and the columns, the way back to the same place, and every graphic opening its
// records. What each view shows, and that no measure is drawn twice, is sections.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const COMPONENTS = '../../../../components/overview';
const page = read('../page.tsx');
const files = {
  page, summary: read('./SummaryView.tsx'), departments: read('./DepartmentsView.tsx'), board: read('./BoardView.tsx'), parts: read('./parts.tsx'), groups: read('./Groups.tsx'),
  hero: read('./Hero.tsx'), charts: read('./Charts.tsx'), groupCharts: read('./GroupCharts.tsx'), dialog: read('./PerformanceDialog.tsx'),
  boardPanel: read('./docs/_BoardPanel.tsx'), table: read('./docs/_DepartmentTable.tsx'), exportMenu: read('./docs/_Export.tsx'), figure: read('./docs/_Figure.tsx'),
};
const model = read('./overviewModel.ts');
const api = read('./postureApi.ts');
const tsx = (dir: string): string[] => readdirSync(new URL(dir, import.meta.url)).filter((n) => n.endsWith('.tsx'));

test('the requests keep their keys and their endpoints (the scorecard key is shared with the main dashboard); the three that only fed the counters, the classification and nothing else went with them', () => {
  const asks: Array<[RegExp, RegExp]> = [
    [/queryKey: \['governance-expiring-soon'\]/, /governanceApi\.getExpiringSoon\(30\)/],
    [/queryKey: \[\.\.\.SCORECARD_QUERY_KEYS\.governance\]/, /governanceApi\.getDocumentsOverview\(\)/],
    [/queryKey: \['governance-trends'\]/, /governanceApi\.getTrends\(6\)/],
    [/queryKey: \['governance-policy-exceptions-summary'\]/, /policyExceptionApi\.getSummary\(\)/],
    [/queryKey: \['gov-doc-overview', dept\]/, /apiClient\.get\(ENDPOINT, \{ params: scopeParams\(dept\) \}\)/],
  ];
  for (const [key, call] of asks) { assert.match(page, key); assert.match(page, call); }
  assert.equal((page.match(/useQuery[<(]/g) ?? []).length, 5, 'the document figures, the expiry, the scorecard, the throughput and the exceptions');
  for (const gone of ['governance-pending-approvals', 'governance-overdue-reviews', 'governance-dashboard-summary']) assert.doesNotMatch(page, new RegExp(gone), `${gone}: no card reads it any more`);
  assert.match(page, /const GOVERNANCE_TUNING = \{ configBase: '\/governance\/dashboard', invalidateKey: \[\.\.\.SCORECARD_QUERY_KEYS\.governance\] as unknown\[\] \};/);
  assert.equal((page.match(/enabled: onSummary/g) ?? []).length, 4, 'the Summary asks only while it is open');
  assert.match(page, /const onSummary = view === 'summary';/);
});

test('the frameworks and the board are asked only while their view is open: one endpoint each, ten groups first then pages of a hundred', () => {
  assert.match(api, /apiClient\.get\('\/governance\/dashboard\/posture', \{ params: pageParam \}\)/);
  assert.match(api, /queryKey: \['governance-posture', by\]/);
  assert.match(api, /initialPageParam: \{ by, limit: FIRST_PAGE, offset: 0 \}/);
  assert.match(api, /retry: retryOverview/);
  assert.match(api, /enabled,/);
  assert.match(page, /const posture = usePosture\('framework', onDepartments\);/);
  assert.match(page, /const board = useBoard\(dept, group, CARDS_BOARD, view === 'board'\);/);
  assert.match(files.boardPanel, /queryKey: \['gov-doc-overview-board', dept, group, per\]/);
  assert.match(files.boardPanel, /apiClient\.get\(BOARD_ENDPOINT, \{ params: boardParams\(dept, group, per\) \}\)/);
  assert.match(files.boardPanel, /enabled,/);
});

test('the work is the shared inbox narrowed to Governance, in the slim card: the top bar\'s queries, not requests of its own', () => {
  assert.match(page, /useInbox\(\{ freshOnOpen: true \}\)/);
  assert.match(page, /workOf\(inbox, GOVERNANCE_SOURCES\)/);
  assert.match(model, /GOVERNANCE_SOURCES[^=]*= \['doc\.lifecycle', 'doc\.signoff'\]/, 'documents and sign-offs; assessment evidence belongs to Compliance, the requests the person sent are not theirs to do');
  assert.match(files.summary, /<MyWorkCard work=\{work\} onRetry=\{onRetryWork\} fetching=\{fetchingWork\} link=\{link\} \/>/);
  assert.match(read(`${COMPONENTS}/workList.ts`), /from '\.\.\/\.\.\/lib\/inbox\/buildInbox\.ts'/, 'the list is built from buildInbox\'s own items, order and kinds');
});

test('a failed request is an error state of its own card: nothing swallowed, no gate that waits for all of them', () => {
  assert.doesNotMatch(code(page), /\bcatch\b/, 'the scorecard\'s failure used to be caught and turned into "no data", which read as zeros');
  assert.doesNotMatch(page, /isLoading/, 'one skeleton for the whole page waited for every request');
  assert.equal((page.match(/retry: retryOverview/g) ?? []).length, 4);
  assert.match(page, /retry: retryDocs/);
  assert.match(files.parts, /export function FeedError/);
  assert.match(files.parts, /canRetry\(feed\.error\)/, 'Retry only where asking again can help');
  // a chart card is a ChartCard (loading, failed with Retry, no access, empty, ready: the kit's) whose state comes from the requests it rests on
  assert.equal((files.charts.match(/<ChartCard\b/g) ?? []).length, 9, 'nine cards: sections, status, type, reviews, waiting, departments, throughput, expiring, exceptions');
  assert.match(files.charts, /cardState\(\.\.\.feeds\)/);
  assert.match(files.charts, /canRetry\(f\.error\)/, 'Retry only where asking again can help');
  assert.match(files.groupCharts, /query\.isPending \? \(\{ state: 'loading' \}/);
  assert.match(files.hero, /loading=\{tile\.state === 'loading'\}/);
  assert.match(files.hero, /denied=\{tile\.state === 'denied'\}/);
  assert.match(files.hero, /value=\{tile\.state === 'ready' \? tile\.value : null\}/, 'a tile that is not ready has no figure: never 0');
  assert.match(files.departments, /doc\.load === 'loading'/);
  assert.match(files.departments, /title="Unavailable"/);
  assert.match(files.boardPanel, /query\.isPending\) return <BoardSkeleton \/>/);
  assert.match(files.boardPanel, /title="Board unavailable"/);
  assert.match(files.boardPanel, /canRetry\(query\.error\)/);
});

test('a request the server refused is "No access" where its numbers would be, and when the scorecard is refused that is said once and the work takes the Summary', () => {
  assert.match(files.parts, /export function Denied/);
  assert.match(files.parts, /export const refused = /);
  assert.match(files.departments, /refused\(doc\)/);
  assert.match(files.boardPanel, /statusOf\(query\.error\) === 403\) return <Denied what="the documents of the board" \/>/, 'the board says "No access" for a refusal');
  assert.match(files.groupCharts, /isRefused\(query\.error\)/, 'the framework graphic says "No access" for a refusal');
  assert.match(read('./visualsModel.ts'), /return 'denied'/, 'a card that rests on several requests is refused when any was');
  assert.match(files.summary, /if \(refused\(feeds\.scorecard\)\) \{/);
  assert.match(files.summary, /title="No access to the programme scores"/);
  const refusal = /if \(refused\(feeds\.scorecard\)\) \{[\s\S]*?\r?\n  \}\r?\n/.exec(code(files.summary))?.[0] ?? '';
  assert.match(refusal, /<Notice[\s\S]*<MyWorkCard/);
  assert.doesNotMatch(refusal, /<Hero|<ChartGrid/, 'the refusal draws the notice and the work, nothing else');
  assert.match(page, /NoAccessState title="Not your department"/);
  assert.match(page, /title="Department not found"/);
  assert.match(page, /Show mine/, 'a department that is not yours (or gone) is said once for the page, with one button to the own scope');
});

test('every file of the Overview follows the kit\'s rules: only the --ds tokens and arbitrary values, no legacy scope, no hex colour, no model or vendor named', () => {
  const everything = [...tsx('./').map((n) => [n, read(`./${n}`)]), ...tsx('./docs/').map((n) => [`docs/${n}`, read(`./docs/${n}`)]), ['page.tsx', page]] as Array<[string, string]>;
  assert.ok(everything.length >= 14, `${everything.length} files`);
  for (const [name, text] of everything) {
    assert.deepEqual(findViolations(text).map((v) => `${name}:${v.line} ${v.rule}: ${v.text}`), []);
    assert.doesNotMatch(text, /governance-light|docUi|DocPageHeader|PageLoader/, name);
    assert.doesNotMatch(text, /<(button|select|textarea|input)\b[^>]*className="[^"]*(bg-primary|bg-white)/, name);
    assert.doesNotMatch(code(text), /#[0-9a-fA-F]{3,8}\b/, `${name}: a colour is the palette's (components/overview/charts/palette.ts), not written here`);
    assert.doesNotMatch(text, /\b(gpt|openai|anthropic|claude)\b/i, name);
    assert.doesNotMatch(code(text), /from 'recharts'/, `${name}: the cards draw with the kit`);
  }
  for (const [name, text] of everything) assert.doesNotMatch(text, /toLocaleDateString|\.toLocaleString\(/, name);
});

test('the head is the kit\'s, with the scope, the three actions of the page and their addresses (two of them fold into "More" on a phone)', () => {
  assert.match(page, /<PageHeader\s+variant="page"/);
  assert.match(page, /titleFor\('\/governance'\)/, 'the heading is the registry\'s name for the page');
  assert.match(page, /<Button href=\{link\('\/governance\/documents\/attestation'\)\}[^\n]*>Attestations<\/Button>/);
  assert.match(page, /<Button href=\{link\('\/compliance\/statements'\)\}[^\n]*>Statements<\/Button>/);
  assert.match(page, /<Button href=\{link\('\/governance\/documents'\)\} variant="primary"[^\n]*>Manage Documents<\/Button>/);
  assert.match(page, /router\.push\(link\('\/governance\/documents\/attestation'\)\)/);
  assert.match(page, /router\.push\(link\('\/compliance\/statements'\)\)/);
  assert.match(page, /<Select aria-label="Scope"/, 'the scope picker has a name');
  assert.match(page, /scopeOptions\(choices\)/);
  assert.match(page, /setOffered\(doc\.data\.choices\)/, 'the picker keeps what it last offered, so a scope that is loading or has failed can still be changed');
  assert.match(page, /<ExportMenu data=\{doc\.data\} \/>/);
  assert.match(page, /doc\.data && !isEmpty\(doc\.data\)/, 'nothing to export from an empty scope or before the answer');
});

test('the scope, the view, the grouping and the columns are in the address, a view is a step Back undoes, and the page puts the scroll back once its data has rendered', () => {
  assert.match(page, /dept: text\(\)/);
  for (const piece of ['view: oneOf<ViewId>(VIEW_IDS, DEFAULT_VIEW)', 'group: oneOf<GroupId>(GROUP_IDS, DEFAULT_GROUP)', 'measure: oneOf<MeasureId>(TABLE_MEASURE_IDS, DEFAULT_MEASURE)']) assert.ok(page.includes(piece), piece);
  assert.match(page, /useAddressState\(ADDRESS\)/);
  assert.match(page, /<SegmentedControl<ViewId> label="View" name="overview-view"/);
  assert.match(page, /setAddress\(\{ view: next \}, \{ push: true \}\)/);
  assert.match(page, /setAddress\(\{ dept: e\.target\.value \}\)/);
  assert.match(page, /setAddress\(\{ measure: next \}\)/);
  assert.match(page, /setAddress\(\{ group: next \}\)/);
  assert.match(page, /export const dynamic = 'force-dynamic'/, 'like the library: the address is read on the client');
  assert.match(page, /import \{ useReturnToPlace \} from '@\/components\/overview\/useReturnToPlace';/);
  assert.match(page, /useReturnToPlace\(asked\.every\(\(q\) => !q\.isPending\)\);/, 'ready when the requests of the open view have answered');
  assert.match(page, /view === 'summary' \? \[doc, expiring, scorecard, trends, exceptions\] : view === 'departments' \? \[doc, posture\] : \[doc, board\]/);
  assert.match(files.board, /name="overview-group"/);
  assert.match(files.table, /<SegmentedControl label="Columns" name="overview-measure"/);
});

test('every link out of the Overview remembers the page it is on (?from=), so the shell keeps the Overview lit and in the trail on arrival; a link to a view of this page needs no memory of it', () => {
  assert.match(files.parts, /import \{ withFrom \} from '@\/components\/shell\/withFrom';/);
  assert.match(files.parts, /export const HERE = '\/governance';/);
  assert.match(files.parts, /export const link = \(href: string\): string => \(ownPage\(href\) \? href : withFrom\(href, HERE\)\);/);
  for (const [name, text] of Object.entries(files)) {
    if (name === 'parts') continue;
    const src = code(text);
    // no link is written as a bare path: a literal address is the argument of link(...) or comes from a model
    assert.doesNotMatch(src, /(href|to)=("|')\//, `${name}: a bare in-app address`);
    assert.doesNotMatch(src, /router\.push\(('|")\//, `${name}: a bare in-app address pushed`);
  }
  for (const name of ['summary', 'departments', 'board', 'charts', 'hero', 'groups', 'boardPanel'] as const) assert.match(files[name], /\blink\(|link=\{link\}|link: \(href: string\)/, `${name} draws its links through link()`);
});

test('every graphic opens the records it counts: the card\'s title is a link to the module\'s list, and every bar, slice, tile and cell is a link where the module can filter', () => {
  const cards = Array.from(code(files.charts).matchAll(/<ChartCard\s+id="([^"]+)"([\s\S]*?)>\s*\n/g), (m) => [m[1], /\bhref=/.test(m[2])] as const);
  assert.equal(cards.length, 9);
  assert.deepEqual(cards.filter(([, has]) => !has).map(([id]) => id).sort(), ['section-scores', 'waiting'], 'the two whose parts are the links: the section tiles and the request bars');
  assert.match(files.charts, /<AreaTiles label="Section scores"[^\n]*href: i\.href \? link\(i\.href\) : undefined/);
  assert.match(files.charts, /<BarList label="Documents by status"[^\n]*href: r\.href \? link\(r\.href\) : undefined/);
  assert.match(files.charts, /<DonutChart label="Documents by type"[^\n]*href: x\.href \? link\(x\.href\) : undefined/);
  assert.match(files.charts, /<DonutChart label="Documents by review state"[^\n]*href: x\.href \? link\(x\.href\) : undefined/);
  assert.match(files.charts, /categories=\{stack\.rows\.map\(\(r\) => \(\{ key: r\.key, label: r\.name, cells: r\.cells, href: r\.value \? link\(viewHref\(r\.value\)\) : undefined \}\)\)\}/);
  assert.match(files.groupCharts, /href=\{\(r, c\) => \{ const h = heat\.hrefs\[r\]\?\.\[c\]; return h \? link\(h\) : undefined; \}\}/);
  assert.match(files.hero, /href=\{tile\.href \? link\(tile\.href\) : undefined\}/);
  assert.match(files.hero, /linkLabel=\{tile\.linkLabel\}/, 'every tile link is named for where it goes');
});

test('the section scores are the kit\'s small tiles in their band colour, with the shared dialog and weight tuner behind "How scored"', () => {
  assert.match(files.charts, /<AreaTiles\b/);
  assert.match(files.charts, />How scored<\/Button>/);
  assert.match(files.charts, /aria-haspopup="dialog"/);
  assert.match(page, /<PerformanceDialog open=\{perfOpen\} onClose=\{\(\) => setPerfOpen\(false\)\} card=\{scorecard\.data\} tuning=\{GOVERNANCE_TUNING\} \/>/);
  assert.match(files.dialog, /import \{ SectionWeightTuner \} from '@\/components\/dashboard\/score-tuning'/);
  assert.match(files.dialog, /<AnimatedModal isOpen=\{open\} onClose=\{close\}/);
  for (const [name, text] of Object.entries(files)) assert.doesNotMatch(text, /import[^;]*ScoreBreakdownCard/, `${name}: the shared card keeps its own palette and numerals for the other modules`);
});

test('every chart is the kit\'s (a picture with its numbers as text, no keyboard layer of its own) and a number is counted with the platform\'s formatter', () => {
  for (const kind of ['AreaTiles', 'BarList', 'DonutChart', 'SegmentBar', 'StackedBars', 'TrendChart']) assert.match(files.charts, new RegExp(`<${kind}\\b`), `${kind} is used`);
  assert.match(files.groupCharts, /<Heatmap\b/);
  assert.match(files.hero, /<SegmentBar label="Needs attention, urgent and to follow up" parts=\{tile\.severity\} height=\{6\} legend=\{false\} \/>/, 'the one needs-attention tile has its thin severity bar; its word is the tile note');
  for (const name of ['hero', 'charts', 'groupCharts'] as const) assert.doesNotMatch(files[name], /useQuery|useInfiniteQuery|apiClient|(?<![A-Za-z])fetch\(/, `${name}: it draws what it is given`);
  for (const name of ['groups', 'charts'] as const) assert.match(files[name], /formatCount/, name);
  assert.match(read('./visualsModel.ts'), /formatCount/);
  assert.doesNotMatch(page, /toLocaleDateString|\.toLocaleString\(/);
});

test('a score is "No data" or a dash where there is none, never 0; the scorecard\'s answer is read as the shared cache holds it: null (the main dashboard\'s failed request) is an error here', () => {
  assert.match(files.parts, /data: query\.data \?\? undefined/);
  assert.match(model, /if \(q\.data === null\) return 'error';/);
});

test('the department table is the kit\'s RegisterTable with the columns of a measure, a card per department on a phone, and its names open the department\'s own view', () => {
  const table = code(files.table);
  assert.ok(table.includes('<RegisterTable<Item>') && table.includes('caption="Documents by department"') && table.includes('isRowHeader: true'));
  assert.ok(table.includes('cardTitle={(i) =>') && table.includes('card: \'meta\''), 'a phone shows each department as a card');
  assert.ok(table.includes('href={line.open}') && table.includes('matrixLines(data, columns, open)'));
  assert.ok(table.includes('TABLE_MEASURES') && table.includes('onChange={onMeasure}'), 'the columns are chosen from the measures');
  assert.ok(table.includes("viewHref(dept, 'departments', 'status', measure)"), 'opening a department stays in the Departments view and its columns');
  assert.ok(table.includes('figureHref(data, line.row.key)') && table.includes('data.scope.whole_organisation'), 'the total row is for the whole organisation only');
  assert.ok(/No departments/.test(table), 'an empty table says so');
});

test('the export is a menu of a PDF summary and two CSV files; the departments CSV is made from the figures on screen, the other two come from the server, and a failure says so with Retry', () => {
  const menu = code(files.exportMenu);
  assert.ok(menu.includes('<Menu') && menu.includes('label="Export"') && menu.includes('Departments (CSV)') && menu.includes('Documents (CSV)') && menu.includes('Summary (PDF)'));
  assert.ok(menu.includes('${EXPORT_ENDPOINT}/pdf') && menu.includes("'pdf'"), 'the PDF comes from the server and is named .pdf');
  assert.ok(menu.includes("matrixCsv(data, columnsFor('all', data))") && menu.includes('csvName('), 'every column, and a file name that says what and for what');
  assert.ok(menu.includes("responseType: 'blob'") && menu.includes('notify.error(e,') && menu.includes('retry:'));
  assert.ok(menu.includes('URL.revokeObjectURL'), 'the temporary address is let go');
  assert.doesNotMatch(menu, /At a glance/, 'the file is the Overview\'s');
});

test('the board is read-only: a card opens the document with where its attestation stands beside its flags, a column title opens the library on the column, the rest is "Show all"; lists are named', () => {
  const board = code(files.boardPanel);
  assert.ok(board.includes('href={link(cardHref(card))}') && board.includes('columnHref(answer, col)') && board.includes('showAllHref(answer, col)') && board.includes('Show all'));
  assert.ok(board.includes('aria-label={`${title}: ${columnNote(col)}`}') && board.includes('aria-label="Board columns"'));
  assert.ok(board.includes('<StatusPill') && board.includes('flagWords(card)'), 'what is wrong with a card is a word, not only a colour');
  assert.ok(board.includes('const line = attestationLine(card);') && board.includes('<AttestationLine card={card} />') && board.includes('{line.label}'), 'every card says where its attestation stands, as a line that wraps (a card from an older server says nothing)');
  assert.ok(board.includes('isAttention(col, answer.group)') && board.includes('documentStatus.label(card.status)'), 'in "Needs attention" each card says its own status');
  assert.ok(!/onDrag|draggable|useSortable/.test(board), 'moving a card would change a document\'s status: the board only shows');
  assert.ok(board.includes('Loading the board') && board.includes('No documents'));
});

test('the Overview reads and writes only what it did: it reads the endpoints below, and the one write is the score snapshot after the first successful read of the scorecard', () => {
  const all = [...Object.values(files), model].map(code).join('\n');
  assert.ok(!/\.(put|patch|delete)\(/.test(all), 'a read-only page, but for the snapshot');
  assert.ok(!/\.post\(/.test(all) && /snapshotDocumentsOverview\(\)/.test(all));
  assert.match(code(files.exportMenu), /apiClient\.get\(EXPORT_ENDPOINT/);
  assert.match(read('./docs/_model.ts'), /export const ENDPOINT = '\/governance\/document-overview'/);
  assert.match(read('./docs/_board.ts'), /BOARD_ENDPOINT = '\/governance\/document-overview\/board'/);
  assert.match(read('./docs/_board.ts'), /EXPORT_ENDPOINT = '\/governance\/document-overview\/export'/);
});
