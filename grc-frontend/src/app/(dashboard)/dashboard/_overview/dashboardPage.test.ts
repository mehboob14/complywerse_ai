// node --test "src/app/(dashboard)/dashboard/_overview/dashboardPage.test.ts"
// What the Performance Overview keeps and what it no longer does, pinned in the files that carry it (there is no React renderer here; behaviour is checked in a
// browser): the requests with their keys, endpoints and stale times, no failure swallowed into null, every section with its own loading and error state, the kit's
// rules in every file of the folder (the platform CSS repaints named utilities and gives a bare <p> 11.5px), one Tab stop per card, no chart that takes focus, the
// gates of the page, and that the unreachable workspace and the layout it stores are not touched by the live page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('../page.tsx');
const files = { parts: read('./parts.tsx'), tiles: read('./Tiles.tsx'), cards: read('./ModuleCards.tsx'), kpis: read('./CyberKpis.tsx') };
const models = { overview: read('./overviewModel.ts'), kpi: read('./kpiModel.ts') };
/** The live component of page.tsx: everything above it is the unreachable legacy code (audit section 8). */
const live = page.slice(page.indexOf('export default function MainDashboard()'));
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the nine module requests keep their endpoint, their cache key, their stale time and their gate; a failure is thrown, never swallowed into null', () => {
  const cards = strip(files.cards);
  assert.match(cards, /queryKey: m\.queryKey \?\? \['main-dashboard', m\.key\],/);
  assert.match(cards, /queryFn: async \(\) => \(await apiClient\.get\(m\.path\)\)\.data,/);
  assert.match(cards, /staleTime: 60_000,\s*enabled: !permsLoading,\s*retry: retryDashboard,/);
  assert.doesNotMatch(cards, /\bcatch\b/, 'the old queryFn caught every failure into null, which read as "No data yet"');
  assert.doesNotMatch(cards, /return null; \}\s*\}/);
  assert.match(cards, /queryKey: RISK_QUERY_KEY,\s*queryFn: async \(\) => \(await apiClient\.get\(RISK_PATH\)\)\.data,\s*staleTime: 60_000,\s*enabled: !permsLoading && canSeeRisk,\s*retry: retryDashboard,/);
  assert.match(models.overview, /export const RISK_PATH = '\/erm\/dashboard\/sections-overview';/);
  assert.match(models.overview, /export const RISK_PERMISSIONS = \['erm:risks:\*'\];/);
  assert.equal((cards.match(/useQuer(y|ies)\(/g) ?? []).length, 2, 'the module requests and the risk score: no request was added');
  assert.match(cards, /const canSeeRisk = isAdmin \|\| hasAnyPermission\(RISK_PERMISSIONS\);/);
  assert.match(cards, /visibleModules\(isAdmin, hasAnyPermission\)/, 'the old client gate, per module');
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

test('every section loads, fails and has nothing on its own: a skeleton, an error row with Retry where asking again can help, never a 0 that stands for a failure', () => {
  for (const [name, text] of Object.entries(files)) {
    if (name === 'parts') continue;
    assert.match(text, /Skeleton|loading|Loading/, `${name}: a state while it loads`);
  }
  assert.match(files.parts, /canRetry\(error\) \? onRetry : undefined/, 'Retry only where asking again can help (a refusal cannot be retried)');
  assert.match(files.parts, /Still loading\. This is taking longer than usual\./, 'a slow request says so');
  assert.match(files.cards, /FailedRow title=\{refused \? `You can't open the \$\{def\.label\} overview` : `Couldn't load \$\{def\.label\}`\}/);
  assert.match(files.tiles, /Couldn't load readiness/);
  assert.match(files.tiles, /Couldn't load overdue items/);
  assert.match(files.tiles, /No access/);
  assert.match(files.kpis, /Couldn't load the Cyber Security KPIs/);
  assert.doesNotMatch(files.cards, /\?\? 0\)\}%|isLoading \? .*:.*0/, 'no figure defaults to 0');
});

test('every file of the folder follows the kit\'s rules: only the --ds tokens and arbitrary values, 12px floor, no legacy scope, no native dialog, nothing hover-only', () => {
  const all: Record<string, string> = { ...files, 'overviewModel.ts': models.overview, 'kpiModel.ts': models.kpi };
  for (const [name, text] of Object.entries(all)) {
    assert.deepEqual(findViolations(text).map((v) => `${name}:${v.line} ${v.rule}: ${v.text}`), []);
    assert.doesNotMatch(strip(text), /governance-light|docUi|DocPageHeader|PageLoader|ScoreBreakdownCard|\bdash-card\b|\bdash-label\b|\bdash-value\b|className="dash /, name);
    assert.doesNotMatch(strip(text), /window\.(confirm|alert|prompt)|(^|[^.\w])(confirm|alert|prompt)\(/m, `${name}: no native dialog`);
    assert.doesNotMatch(text, /opacity-0[^"'`]*group-hover|group-hover[^"'`]*opacity-0/, `${name}: no action that appears on hover only`);
    assert.doesNotMatch(strip(text), /toLocaleDateString|\.toLocaleString\(/, `${name}: dates and numbers go through lib/format`);
    assert.doesNotMatch(strip(text), /fontSize: ?(\d(\.\d)?|1[01](\.\d)?)\b/, `${name}: no chart text under 12px`);
    assert.doesNotMatch(strip(text), /localStorage|sessionStorage/, `${name}: the live page keeps nothing in the browser (the workspace's saved layouts are not read, written or removed)`);
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

test('one Tab stop per card: the module\'s name is the link and covers the card; nothing inside it is a second stop but Retry, and no chart takes focus', () => {
  const cards = strip(files.cards);
  assert.match(cards, /const COVER = 'after:absolute after:inset-0 after:rounded-ds-card/);
  assert.equal((cards.match(/COVER\}/g) ?? []).length, 1, 'the cover link is drawn once, in the card');
  assert.match(cards, /<article aria-labelledby=\{headId\} className=\{`\$\{BOX\} relative flex flex-col/, 'the card is the cover\'s positioned box');
  assert.match(cards, /\{\.\.\.focusOff\}/, 'the chart and its Pie take the props that remove recharts\' keyboard layer');
  assert.equal((cards.match(/\{\.\.\.focusOff\}/g) ?? []).length, 2, 'the chart and its Pie');
  assert.match(cards, /<ChartFrame/, 'the donut has a title, a note and its numbers as a table');
  assert.match(cards, /pointer-events-none/, 'the picture takes no press, so the cover link gets it');
  assert.doesNotMatch(cards, /<Tooltip|RadarChart|BarChart|accessibilityLayer=\{true\}/, 'no hover tooltip, no chart that needs a hand to be read');
  assert.match(cards, /relative z-\[1\]/, 'Retry sits above the cover link');
  assert.match(strip(files.kpis), /<button\s+type="button"\s+onClick=\{onOpen\}\s+aria-haspopup="dialog"\s+aria-label=\{cardLabel\(k, pill\.label\)\}/, 'a KPI card is a named button that says it opens a dialog');
});

test('the colours of the donut come from the tone table, not from the server or a palette of its own', () => {
  const cards = strip(files.cards);
  assert.match(cards, /TONE\[/);
  assert.doesNotMatch(cards, /#2563eb|#7c3aed|#059669|#d97706|#dc2626|#64748b|\bcolor: s\.color|\.color\b/, 'the old segment colours (the server\'s and the blue/violet palette) are gone');
});

test('the page keeps its gates and its links: My Work for the same people, the head is the kit\'s, nothing else was added to the live component', () => {
  assert.match(page, /const canSeeMyWork = isAdmin \|\| hasAnyPermission\(\['compliance:frameworks:\*', 'controls:control_library:\*', 'evidence:evidence_library:\*'\]\);/);
  assert.match(live, /actions=\{canSeeMyWork \? <Button href="\/my-work" variant="primary" leftIcon=\{<Inbox aria-hidden \/>\}>My Work<\/Button> : undefined\}/);
  assert.match(live, /<PageHeader\s+variant="page"/);
  assert.match(live, /<ModuleOverview \/>\s*<CyberKpis \/>/);
  assert.match(live, /const SHOW_LEGACY_TABS = false;/, 'the switch is where the owner left it');
  assert.doesNotMatch(live.slice(0, live.indexOf('{SHOW_LEGACY_TABS')), /className="dash|-m-4|lg:-m-5/, 'the root no longer pulls itself out of the shell\'s padding (main scrolled sideways)');
  assert.match(page, /import \{ titleFor \} from '@\/lib\/navRegistry';/);
});

test('the unreachable workspace is left as it was, and the live page never touches the layouts it stores', () => {
  const workspace = read('../components/WidgetWorkspace.tsx');
  assert.match(workspace, /const storageKey = `dashboard_workspace_layout_\$\{tabKey\}_v4`;/, 'the key and its version are the ones saved layouts live under');
  assert.match(workspace, /window\.localStorage\.getItem\(storageKey\)/);
  for (const text of Object.values(files)) assert.doesNotMatch(text, /dashboard_workspace_layout/);
  // nothing in the live folder imports the unreachable files
  for (const text of Object.values(files)) assert.doesNotMatch(text, /components\/(WidgetWorkspace|ModuleSubWidgets|FrameworkComplianceCards)/);
});

test('the two components this folder replaced are gone and nothing imports them (the copies under cyber-assurance are another module\'s files)', () => {
  assert.equal(existsSync(new URL('../../../../components/dashboard/MainModuleCards.tsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('../../../../components/dashboard/CyberKpiPanel.tsx', import.meta.url)), false);
  const walk = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, dir)) : /\.tsx?$/.test(e.name) ? [new URL(e.name, dir).pathname] : []));
  const src = new URL('../../../../', import.meta.url);
  for (const file of walk(src)) {
    if (/cyber-assurance|\.test\.ts$/.test(file)) continue;
    assert.doesNotMatch(readFileSync(decodeURIComponent(file.replace(/^\/(?=[A-Za-z]:)/, '')), 'utf8'), /@\/components\/dashboard\/(MainModuleCards|CyberKpiPanel)/, file);
  }
});
