// node --test "src/app/(dashboard)/dashboard/_overview/dashboardPage.test.ts"
// What the Performance Overview keeps and what it no longer does, pinned in the files that carry it (there is no React renderer here; behaviour is checked in a browser): the requests
// with their keys and stale times, no failure swallowed into null, every section with its own loading and error state, the kit's rules in every file of the folder (the platform CSS
// repaints named utilities and gives a bare <p> 11.5px), the Overview v2 rules (posture first, no list of counts, no table, my work slim and last, every graphic a link with a name,
// Back returns to the same place), the gates of the page, and that the ~10,100 unreachable lines are gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('../page.tsx');
const files = {
  parts: read('./parts.tsx'), perf: read('./PerfOverview.tsx'), posture: read('./Posture.tsx'), other: read('./OtherAreas.tsx'),
  hero: read('./Hero.tsx'), bars: read('./Bars.tsx'), scoreBars: read('./ScoreBars.tsx'), trends: read('./Trends.tsx'),
  hook: read('./usePerfFeeds.ts'), kpis: read('./CyberKpis.tsx'),
};
const models = { overview: read('./overviewModel.ts'), perf: read('./perfModel.ts'), charts: read('./perfCharts.ts'), kpi: read('./kpiModel.ts') };
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the requests come from lib/perf/moduleFeeds.ts under the module pages\' keys, with the stale time and the retry they had; a failure is thrown, never swallowed into null', () => {
  const hook = strip(files.hook);
  assert.match(hook, /queryKey: feed\.queryKey,/);
  assert.match(hook, /const data = \(await apiClient\.get\(feed\.path, feed\.params \? \{ params: feed\.params \} : undefined\)\)\.data;\s*return key === 'journeys' \? journeyList\(data\) : data;/);
  assert.match(hook, /staleTime: 60_000,\s*enabled,\s*retry: retryDashboard,/);
  assert.doesNotMatch(hook, /\bcatch\b/, 'the old queryFn caught every failure into null, which read as "No data yet"');
  assert.equal((hook.match(/useQuer(y|ies)\(/g) ?? []).length, 1, 'one useQueries for every feed: no request is made anywhere else');
  const perf = strip(files.perf);
  assert.match(perf, /const areas = areasFor\(isAdmin, hasAnyPermission\);\s*const feedKeys = feedsFor\(areas\);\s*const feeds = usePerfFeeds\(feedKeys, !permsLoading\);/, 'a request only for a feed an area that is shown reads, after the permissions are known');
  assert.doesNotMatch(perf, /apiClient|useQueries\(/, 'the page itself asks for nothing');
});

test('the KPI card keeps its three requests, its key and its stale time; only the live values may fail without hiding the rows, and then it says so', () => {
  const kpis = strip(files.kpis);
  assert.match(kpis, /queryKey: \['main-kpi-live'\],/);
  assert.match(kpis, /apiClient\.get\('\/compliance\/assessments', \{ params: \{ limit: 50, assessment_format: KPI_FORMAT \} \}\)/);
  assert.match(kpis, /apiClient\.get\(`\/compliance\/assessments\/\$\{arr\[0\]\.id\}`\)\.then\(\(r\) => r\.data\)/);
  assert.match(kpis, /apiClient\.get\('\/compliance\/assessments\/kpi-live'\)\.then\(\(r\) => r\.data\)\.catch\(\(\) => \{ liveFailed = true; return \{ metrics: \{\} \}; \}\)/);
  assert.equal((kpis.match(/\.catch\(/g) ?? []).length, 1, 'the one catch records that the live values failed: it does not hide it');
  assert.match(kpis, /staleTime: 60_000,\s*retry: retryDashboard,/);
  assert.match(kpis, /panelState\(loadOf\(query\), query\.data\)/);
  assert.match(kpis, /panel\.state === 'error'/);
  assert.match(kpis, /panel\.liveFailed/);
  assert.match(kpis, /The live values could not be loaded/, 'a failed live feed is said, never drawn as zeros');
  assert.doesNotMatch(kpis, /if \(!data \|\| !data\.items\.length\) return null/, 'a failed list used to hide the whole panel');
});

test('every section loads, fails and has nothing on its own: a skeleton, an error with Retry where asking again can help, never a 0 that stands for a failure', () => {
  for (const [name, text] of Object.entries(files)) {
    if (name === 'parts' || name === 'hook' || name === 'bars') continue;   // the bar list draws what the cards give it: the states are the cards'
    assert.match(text, /Skeleton|loading|Loading|state=\{/, `${name}: a state while it loads`);
  }
  assert.match(files.parts, /Still loading\. This is taking longer than usual\./, 'a slow request says so');
  assert.match(strip(files.perf), /useSlow\(rows\.some\(\(r\) => r\.state === 'loading'\)\)/);
  assert.match(files.other, /onRetry\(t\.key\)/, 'a tile that failed asks again for its own request');
  assert.match(files.other, /role="status" aria-busy="true"/, 'a tile that waits says so');
  assert.match(files.scoreBars, /Couldn't load the scored areas/);
  assert.match(files.scoreBars, /Leaves out \$\{nameList\(view\.leftOut\)\}/, 'the score picture says which areas it leaves out');
  assert.match(files.posture, /state=\{state\}/, "the ring card has the kit's five states (loading, failed, refused, empty, ready)");
  assert.match(files.trends, /No history yet\./, 'a history that has not grown says so');
  assert.match(files.trends, /deniedText=/, 'a refused history is its own state');
  assert.match(files.hero, /loading: overall\.state === 'loading'/, 'a tile waits for its answer');
  assert.match(files.hero, /error: view\.state === 'error'/);
  assert.match(models.charts, /line: "Couldn't load"/, 'a tile of an area that failed says so');
  for (const [name, text] of Object.entries(files)) assert.doesNotMatch(strip(text), /\?\? 0\)\}%|isLoading \? .*:.*\b0\b/, `${name}: no figure defaults to 0`);
  assert.match(strip(models.perf), /export function rowOf\(area: Area, feed: Feed \| undefined\): AreaRow \{/);
});

test('every file of the folder follows the kit\'s rules: only the --ds tokens and arbitrary values, 12px floor, no legacy scope, no native dialog, nothing hover-only', () => {
  const all: Record<string, string> = { ...files, 'overviewModel.ts': models.overview, 'perfModel.ts': models.perf, 'perfCharts.ts': models.charts, 'kpiModel.ts': models.kpi };
  for (const [name, text] of Object.entries(all)) {
    assert.deepEqual(findViolations(text).map((v) => `${name}:${v.line} ${v.rule}: ${v.text}`), []);
    assert.doesNotMatch(strip(text), /governance-light|docUi|DocPageHeader|PageLoader|ScoreBreakdownCard|\bdash-card\b|\bdash-label\b|\bdash-value\b|className="dash /, name);
    assert.doesNotMatch(strip(text), /window\.(confirm|alert|prompt)|(^|[^.\w])(confirm|alert|prompt)\(/m, `${name}: no native dialog`);
    assert.doesNotMatch(text, /opacity-0[^"'`]*group-hover|group-hover[^"'`]*opacity-0/, `${name}: no action that appears on hover only`);
    assert.doesNotMatch(strip(text), /toLocaleDateString|\.toLocaleString\(/, `${name}: dates and numbers go through lib/format`);
    assert.doesNotMatch(strip(text), /fontSize: ?(\d(\.\d)?|1[01](\.\d)?)\b/, `${name}: no chart text under 12px`);
    assert.doesNotMatch(strip(text), /localStorage|sessionStorage/, `${name}: the page keeps nothing in the browser itself (useReturnToPlace keeps the scroll position)`);
    assert.doesNotMatch(strip(text), /#[0-9a-fA-F]{6}\b/, `${name}: no hex outside palette.ts`);
  }
});

test('a bare <p>, <td>, <th>, <h2> or <h3> gets 11.5px and dark text from the platform CSS: every one in the folder names its size', () => {
  const SIZE = /(?<![\w:\-[])!?text-(?:ds-(?:title|section|body|label)|\[\d[^\]]*\])(?![\w-])/;
  let scanned = 0;
  for (const [name, raw] of Object.entries(files)) {
    const src = strip(raw);
    for (const tag of ['p', 'td', 'th', 'h2', 'h3']) {
      for (const m of Array.from(src.matchAll(new RegExp(`<${tag}(?=[\\s>])`, 'g')))) {
        const start = m.index ?? 0;
        let depth = 0; let quote = ''; let end = -1;
        for (let i = start + 1 + tag.length; i < src.length; i++) {
          const c = src[i];
          if (quote) { if (c === quote && src[i - 1] !== '\\') quote = ''; continue; }
          if (c === '"' || c === "'" || c === '`') quote = c; else if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) { end = i; break; }
        }
        const opening = src.slice(start, end + 1);
        scanned++;
        assert.match(opening, SIZE, `${name}:${src.slice(0, start).split('\n').length} <${tag}> names no text size: ${opening.slice(0, 90)}`);
      }
    }
  }
  assert.ok(scanned >= 4, `the scan found ${scanned} elements: the check reads the files`);
});

test('R6: every bar, count, tile, ring and card title opens what it summarises, from a real link whose name says where it goes', () => {
  const bars = strip(files.bars);
  assert.match(bars, /<Link href=\{r\.href\} title=\{r\.linkName \?\? r\.label\} aria-label=\{r\.linkName\}/, "each bar's name opens its area and is named with its score");
  const sb = strip(files.scoreBars);
  assert.match(sb, /linkName: barName\(b\)/);
  assert.match(sb, /<Link href=\{b\.attention\.href\} aria-label=\{`Open \$\{b\.label\}: \$\{b\.attention\.text\}`\}/, "the count under a name opens the records it counts");
  assert.match(strip(files.other), /<Link href=\{t\.href\} title=\{t\.name\} aria-label=\{t\.name\}/, 'a tile of the other areas opens its records (the area when nothing is counted)');
  const posture = strip(files.posture);
  assert.match(posture, /href="#scores"/, 'the ring opens the bars of the areas behind the number');
  assert.match(posture, /hrefLabel="Open the score of each area"/);
  const hero = strip(files.hero);
  assert.match(hero, /href: overall\.state === 'ready' \? '#scores' : undefined/, 'the first tile opens the bars it counts');
  assert.match(hero, /href: view\.state === 'ready' \? \(hasScored \? '#scores' : '#areas'\) : undefined/, 'the Needs attention tile opens the first card that shows the counts');
  assert.match(hero, /href: '\/governance'/);
  assert.match(hero, /href: figure\.state === 'value' && panel\.state === 'ready' \? reportHref\(panel\.workbook\) : undefined/, 'the KPI tile opens the KPI report');
  const trends = strip(files.trends);
  assert.match(trends, /href="\/governance"\s*hrefLabel="Open Governance"/);
  assert.match(trends, /href="\/tasks"\s*hrefLabel="Open Task Management"/);
  const kpis = strip(files.kpis);
  assert.match(kpis, /const open = \{ href, hrefLabel: 'Open the KPI report' \} as const;/, "the card's title opens the report it reads");
  assert.match(kpis, /href \}\)\)\}/, 'the legend of the standing bar opens the report');
  assert.match(kpis, /<Link href=\{f\.href\} aria-label=\{name\}/, 'a KPI row opens the module that owns the number, and says which KPI and how far it is');
  for (const id of ['id="scores"', 'id="areas"', 'id="posture"']) assert.ok([files.scoreBars, files.other, files.posture].some((t) => t.includes(id)), `${id} is the target of an anchor`);
  const everything = Object.values(files).map(strip).join('\n');
  assert.doesNotMatch(everything, /from 'recharts'|<ResponsiveContainer|ChartFrame/, "every picture is the chart kit's (components/overview/charts): each has its numbers as a table or a list for a screen reader");
});

test('R2/R4: no counter band, no list or table of counts, no "Where to act first", no 17-row table: the page is figures, cards and one slim work card', () => {
  const everything = Object.values(files).map(strip).join('\n');
  assert.doesNotMatch(everything, /CounterBand|CountRow|RegisterTable|Needs attention"|Nothing counted|Where to act first|By area/, 'the band, the chip box, the ranked list of counts and the table are gone');
  for (const gone of ['ActFirst.tsx', 'Attention.tsx', 'Modules.tsx']) assert.equal(existsSync(new URL(`./${gone}`, import.meta.url)), false, `${gone} is gone`);
  const hero = strip(files.hero);
  assert.match(hero, /label: 'Needs attention',/, 'the one Needs attention tile');
  assert.match(hero, /<SegmentBar label="Areas by their worst count"[^>]*height=\{8\}[^>]*legend=\{false\}/, 'a thin severity bar under one number');
  assert.equal((everything.match(/label: 'Needs attention'/g) ?? []).length, 1, 'one tile, not a wall');
});

test('R3: my work is one slim card, the last thing on the page, from the shared inbox (the same list as the badge and Needs my action)', () => {
  const perf = strip(files.perf);
  assert.match(perf, /import \{ MyWorkCard \} from '@\/components\/overview\/MyWorkCard';/);
  assert.match(perf, /const work = workOf\(inbox, ALL_SOURCES\);/);
  assert.match(perf, /<\/ChartGrid>[\s\S]*<MyWorkCard work=\{work\} onRetry=\{\(source\) => refetchInbox\(source\)\} fetching=\{fetchingSource\} link=\{\(href\) => withFrom\(href, HERE\)\} \/>\s*<\/>/, 'after the charts, never first, with a retry for a failed source');
  assert.doesNotMatch(perf, /limit=/, 'the card\'s own length (three rows) is not overridden');
  assert.match(perf, /const \{ inbox, refetch: refetchInbox, fetchingSource \} = useInbox\(\);/, "the top bar's own requests (same keys): no source added, no fresh-on-open");
  assert.match(perf, /Skip to my work/);
  assert.doesNotMatch(perf, /waiting for you|waitingOf|waitingText|My requirements|\/my-work/, 'the button that said the same count in the head is gone; My requirements stays in Task Management > My work');
});

test('R7: the page puts the person back where they were: useReturnToPlace once the requests have answered (there is nothing on this page that changes what it shows, so nothing to keep in the address)', () => {
  const perf = strip(files.perf);
  assert.match(perf, /import \{ useReturnToPlace \} from '@\/components\/overview\/useReturnToPlace';/);
  assert.match(perf, /const ready = !permsLoading && rows\.every\(\(r\) => r\.state !== 'loading'\) && !kpi\.isPending && work\.state !== 'loading';\s*useReturnToPlace\(ready\);/);
  assert.doesNotMatch(perf, /useState\(|useAddressState/, 'no view, scope or toggle on this page');
});

test("the figures and charts read what the requests already hold: no request is added for a chart, and the KPI tile reads the card's own query", () => {
  const hero = strip(files.hero);
  assert.match(hero, /const query = useKpiLive\(\);/, "the card's query, under its key: a cache hit, nothing asked twice");
  const others = Object.entries(files).filter(([k]) => k !== 'hook' && k !== 'kpis').map(([, v]) => strip(v)).join('\n');
  assert.doesNotMatch(others, /apiClient|useQueries\(/, 'only usePerfFeeds and the KPI card ask for anything');
  assert.match(strip(files.kpis), /export function useKpiLive\(\) \{\s*return useQuery\(\{\s*queryKey: \['main-kpi-live'\],/);
  const perf = strip(files.perf);
  assert.match(perf, /<Trends rows=\{rows\} payloads=\{\{ governance: feeds\.governance\?\.data, tasks: feeds\.tasks\?\.data \}\}/, 'the histories are in the answers of the Governance scorecard and the tasks summary');
  assert.match(perf, /<Hero rows=\{rows\} overall=\{overall\} governance=\{feeds\.governance\?\.data\}/);
});

test('the page: the kit\'s head named by the registry, the areas by the sidebar\'s rights, the KPI card inside the grid', () => {
  const perf = strip(files.perf);
  assert.match(perf, /<PageHeader\s+variant="page"/);
  assert.match(perf, /title=\{titleFor\('\/dashboard'\) \?\? 'Performance Overview'\}/, 'the heading is the registry\'s name for the page');
  assert.match(perf, /import \{ titleFor \} from '@\/lib\/navRegistry';/);
  assert.match(perf, /const areas = areasFor\(isAdmin, hasAnyPermission\);/);
  assert.match(perf, /<Cell span=\{hasScored \? 5 : 12\}><CyberKpis \/><\/Cell>/);
  assert.match(strip(page), /return <PerfOverview \/>;/);
  assert.ok(page.split('\n').length < 40, 'the route file is a few lines: the legacy workspace is gone');
  assert.doesNotMatch(strip(page), /className="dash|-m-4|lg:-m-5|SHOW_LEGACY_TABS|WidgetWorkspace|CyberKpis/);
});

test('one band vocabulary and the server\'s target: no 85 and no strong / fair / weak in the page\'s files, the grade is the registry\'s, the target comes from the answer', () => {
  const body = [files.perf, files.posture, files.other, files.hero, files.scoreBars, files.trends, models.perf, models.charts].map(strip).join('\n');
  assert.doesNotMatch(body, /\b85\b/, 'the target is the server\'s (moduleFeeds reads it), never a literal here');
  assert.doesNotMatch(body, /scoreBand|score-kit|bandStatus|riskPosture|\bposture\(|Strong|Weak\b/, 'the 80 / 60 words and the Low / Moderate / Elevated words are gone from this page');
  assert.match(body, /gradeStatus/);
  const feeds = strip(read('../../../../lib/perf/moduleFeeds.ts'));
  assert.equal((feeds.match(/\b85\b/g) ?? []).length, 1, 'the only 85 in code: GRADE_LINES, the server\'s cut (the Assessments Overview\'s own target is imported, not typed)');
});

test('the ~10,100 lines nothing reached are gone: the workspace, the tab components, the legacy part of page.tsx, the insights panel, the two older tile and card files', () => {
  const root = new URL('../', import.meta.url);
  assert.equal(existsSync(new URL('components', root)), false, 'dashboard/components/** (16 files, 7,655 lines)');
  assert.equal(existsSync(new URL('./Tiles.tsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('./ModuleCards.tsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../../../components/dashboard/AIInsightsPanel.tsx', import.meta.url)), false);
  assert.deepEqual(readdirSync(root).sort(), ['_overview', 'page.tsx']);
  const walk = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : /\.tsx?$/.test(e.name) ? [new URL(e.name, dir).pathname] : []));
  const src = new URL('../../../../', import.meta.url);
  for (const file of walk(src)) {
    if (/cyber-assurance|\.test\.ts$/.test(file)) continue;
    const text = readFileSync(decodeURIComponent(file.replace(/^\/(?=[A-Za-z]:)/, '')), 'utf8');
    assert.doesNotMatch(text, /dashboard_workspace_layout|dashboard\/components\/(WidgetWorkspace|ModuleSubWidgets|FrameworkComplianceCards)|@\/components\/dashboard\/AIInsightsPanel/, file);
  }
});

test('the two components the first revamp replaced stay gone and nothing imports them (the copies under cyber-assurance are another module\'s files)', () => {
  assert.equal(existsSync(new URL('../../../../components/dashboard/MainModuleCards.tsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../../../components/dashboard/CyberKpiPanel.tsx', import.meta.url)), false);
  const walk = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : /\.tsx?$/.test(e.name) ? [new URL(e.name, dir).pathname] : []));
  const src = new URL('../../../../', import.meta.url);
  for (const file of walk(src)) {
    if (/cyber-assurance|\.test\.ts$/.test(file)) continue;
    assert.doesNotMatch(readFileSync(decodeURIComponent(file.replace(/^\/(?=[A-Za-z]:)/, '')), 'utf8'), /@\/components\/dashboard\/(MainModuleCards|CyberKpiPanel)/, file);
  }
});
