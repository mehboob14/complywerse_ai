// node --test "src/app/(dashboard)/dashboard/_overview/dashboardPage.test.ts"
// What the Performance Overview keeps and what it no longer does, pinned in the files that carry it (there is no React renderer here; behaviour is checked in a browser): the requests
// with their keys and stale times, no failure swallowed into null, every section with its own loading and error state, the kit's rules in every file of the folder (the platform CSS
// repaints named utilities and gives a bare <p> 11.5px), one Tab stop per row, the gates of the page, and that the ~10,100 unreachable lines are gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('../page.tsx');
const files = {
  parts: read('./parts.tsx'), perf: read('./PerfOverview.tsx'), posture: read('./Posture.tsx'), actFirst: read('./ActFirst.tsx'), modules: read('./Modules.tsx'),
  hook: read('./usePerfFeeds.ts'), kpis: read('./CyberKpis.tsx'),
};
const models = { overview: read('./overviewModel.ts'), perf: read('./perfModel.ts'), kpi: read('./kpiModel.ts') };
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the requests come from lib/perf/moduleFeeds.ts under the module pages\' keys, with the stale time and the retry they had; a failure is thrown, never swallowed into null', () => {
  const hook = strip(files.hook);
  assert.match(hook, /queryKey: feed\.queryKey,/);
  assert.match(hook, /queryFn: async \(\) => \(await apiClient\.get\(feed\.path, feed\.params \? \{ params: feed\.params \} : undefined\)\)\.data,/);
  assert.match(hook, /staleTime: 60_000,\s*enabled,\s*retry: retryDashboard,/);
  assert.doesNotMatch(hook, /\bcatch\b/, 'the old queryFn caught every failure into null, which read as "No data yet"');
  assert.equal((hook.match(/useQuer(y|ies)\(/g) ?? []).length, 1, 'one useQueries for every feed: no request is made anywhere else');
  const perf = strip(files.perf);
  assert.match(perf, /const areas = areasFor\(isAdmin, hasAnyPermission\);\s*const feedKeys = feedsFor\(areas\);\s*const feeds = usePerfFeeds\(feedKeys, !permsLoading\);/, 'a request only for a feed an area that is shown reads, after the permissions are known');
  assert.doesNotMatch(perf, /apiClient|useQuer/, 'the page itself asks for nothing');
});

test('the KPI panel keeps its three requests, its key and its stale time; only the live values may fail without hiding the rows, and then it says so', () => {
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
  assert.doesNotMatch(kpis, /if \(!data \|\| !data\.items\.length\) return null/, 'a failed list used to hide the whole panel');
});

test('every section loads, fails and has nothing on its own: a skeleton, an error with Retry where asking again can help, never a 0 that stands for a failure', () => {
  for (const [name, text] of Object.entries(files)) {
    if (name === 'parts' || name === 'hook') continue;
    assert.match(text, /Skeleton|loading|Loading/, `${name}: a state while it loads`);
  }
  assert.match(files.parts, /canRetry\(error\) \? onRetry : undefined/, 'Retry only where asking again can help (a refusal cannot be retried)');
  assert.match(files.parts, /Still loading\. This is taking longer than usual\./, 'a slow request says so');
  assert.match(files.modules, /Couldn&apos;t load/, 'a row that failed says so in its score cell');
  assert.match(files.modules, /No access/, 'a refused row says so');
  assert.match(files.modules, /onClick=\{\(\) => onRetry\(row\.area\.key\)\}/, 'a failed row asks again for its own request');
  assert.match(files.modules, /Still loading\. This is taking longer than usual\./);
  assert.match(files.perf, /Couldn't load what needs attention/, 'every area failed is said once, over the band');
  assert.match(files.actFirst, /Couldn't load the scored areas/);
  assert.match(files.actFirst, /Every scored area is at or above its target\./, 'nothing below target is said in words, not drawn as an empty box');
  assert.match(files.posture, /Loading overall readiness/);
  for (const [name, text] of Object.entries(files)) assert.doesNotMatch(strip(text), /\?\? 0\)\}%|isLoading \? .*:.*\b0\b/, `${name}: no figure defaults to 0`);
  assert.match(strip(models.perf), /export function rowOf\(area: Area, feed: Feed \| undefined\): AreaRow \{/);
});

test('every file of the folder follows the kit\'s rules: only the --ds tokens and arbitrary values, 12px floor, no legacy scope, no native dialog, nothing hover-only', () => {
  const all: Record<string, string> = { ...files, 'overviewModel.ts': models.overview, 'perfModel.ts': models.perf, 'kpiModel.ts': models.kpi };
  for (const [name, text] of Object.entries(all)) {
    assert.deepEqual(findViolations(text).map((v) => `${name}:${v.line} ${v.rule}: ${v.text}`), []);
    assert.doesNotMatch(strip(text), /governance-light|docUi|DocPageHeader|PageLoader|ScoreBreakdownCard|\bdash-card\b|\bdash-label\b|\bdash-value\b|className="dash /, name);
    assert.doesNotMatch(strip(text), /window\.(confirm|alert|prompt)|(^|[^.\w])(confirm|alert|prompt)\(/m, `${name}: no native dialog`);
    assert.doesNotMatch(text, /opacity-0[^"'`]*group-hover|group-hover[^"'`]*opacity-0/, `${name}: no action that appears on hover only`);
    assert.doesNotMatch(strip(text), /toLocaleDateString|\.toLocaleString\(/, `${name}: dates and numbers go through lib/format`);
    assert.doesNotMatch(strip(text), /fontSize: ?(\d(\.\d)?|1[01](\.\d)?)\b/, `${name}: no chart text under 12px`);
    assert.doesNotMatch(strip(text), /localStorage|sessionStorage/, `${name}: the page keeps nothing in the browser`);
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
  assert.ok(scanned >= 10, `the scan found ${scanned} elements: the check reads the files`);
});

test('one Tab stop per row: a work row is its title link and its Open; a table row is the area\'s name, its top counter and its toggle; the band\'s chips are one target each', () => {
  const rows = strip(files.actFirst);
  assert.match(rows, /<WorkRow[\s\S]*href=\{w\.href\}[\s\S]*action=\{\{ label: 'Open', href: w\.href \}\}/, 'the kit\'s row: the title is the stretched link, the action sits above it');
  const modules = strip(files.modules);
  assert.match(modules, /<RegisterTable[\s\S]*expand=\{\{ open, onChange: setOpen, label: \(r\) => `Details of \$\{r\.area\.label\}`/, 'the toggle names its row and says "Details"');
  assert.match(modules, /<TitleLink href=\{r\.area\.href\} title=\{r\.area\.label\}/);
  assert.match(modules, /<CountRow key=\{c\.key\} label=\{c\.label\} count=\{c\.value\} href=\{c\.href\} tone=\{c\.tone\} \/>/, 'an opened row\'s counters are the kit\'s: a number, a word and one target');
  assert.match(strip(files.perf), /<CounterBand\s+id="attention"/);
  assert.match(strip(files.perf), /href="#work"/, 'a keyboard skips the band to where to act first');
  assert.match(files.actFirst, /id="work"/);
  assert.match(files.modules, /id="modules"/);
  assert.match(files.posture, /href="#modules"/);
  assert.doesNotMatch(Object.values(files).map(strip).join('\n'), /recharts|<ResponsiveContainer|ChartFrame/, 'no picture to read by hand: every number is in words');
});

test('the page: the kit\'s head named by the registry, "N waiting for you" from the shared inbox in place of My requirements, the areas by the sidebar\'s rights, the KPI strip below', () => {
  const perf = strip(files.perf);
  assert.match(perf, /<PageHeader\s+variant="page"/);
  assert.match(perf, /title=\{titleFor\('\/dashboard'\) \?\? 'Performance Overview'\}/, 'the heading is the registry\'s name for the page');
  assert.match(perf, /import \{ titleFor \} from '@\/lib\/navRegistry';/);
  assert.match(perf, /const \{ inbox \} = useInbox\(\);/, 'the top bar\'s own requests (same keys): no source added, no fresh-on-open');
  assert.match(perf, /<Button href="\/needs-my-action" variant="primary"/);
  assert.doesNotMatch(perf, /My requirements|\/my-work|canSeeMyWork/, 'My requirements stays in Task Management > My work');
  assert.match(perf, /const areas = areasFor\(isAdmin, hasAnyPermission\);/);
  assert.match(strip(page), /<PerfOverview \/>\s*<CyberKpis \/>/);
  assert.ok(page.split('\n').length < 40, 'the route file is a few lines: the legacy workspace is gone');
  assert.doesNotMatch(strip(page), /className="dash|-m-4|lg:-m-5|SHOW_LEGACY_TABS|WidgetWorkspace/);
});

test('one band vocabulary and the server\'s target: no 85 and no strong / fair / weak in the page\'s files, the grade is the registry\'s, the target comes from the answer', () => {
  const body = [files.perf, files.posture, files.actFirst, files.modules, models.perf].map(strip).join('\n');
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
