// node --test "src/components/compliance/overview/overviewPage.test.ts"
// What the Compliance Overview keeps and how it is built now (a worklist-first cockpit), pinned in the files that carry it (there is no React renderer here; behaviour is checked in a
// browser): the scorecard keeps its query key and endpoint (the main Dashboard reads the same key), no failure is swallowed into zeros, every card has its own loading and error state,
// the worklist is the shared inbox narrowed to Compliance, the weights are offered to administrators only, the kit's rules hold in every file, and the registry names the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../ui/ds/kitRules.ts';
import { ownHeadingSection, registryNamesPage, routeFor, titleFor } from '../../../lib/navRegistry.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const SOURCES = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((file) => ({ file, text: readFileSync(`${DIR}${file}`, 'utf8') }));
const TSX = SOURCES.filter((s) => s.file.endsWith('.tsx'));
const src = (file: string) => SOURCES.find((s) => s.file === file)!.text;
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const PAGE = readFileSync(fileURLToPath(new URL('../../../app/(dashboard)/compliance/page.tsx', import.meta.url)), 'utf8');
const LAYOUT = readFileSync(fileURLToPath(new URL('../../../app/(dashboard)/compliance/layout.tsx', import.meta.url)), 'utf8');

test('the folder is what the pins read, and the page is a thin shell around the cockpit', () => {
  assert.deepEqual(SOURCES.map((s) => s.file).sort(), ['Charts.tsx', 'ComplianceOverview.tsx', 'ComplianceStrip.tsx', 'OverviewParts.tsx', 'Tiles.tsx', 'graphModel.ts', 'overviewData.ts', 'overviewModel.ts']);
  assert.match(PAGE, /import ComplianceOverview from '@\/components\/compliance\/overview\/ComplianceOverview';/);
  assert.ok(PAGE.split('\n').length < 12);
  assert.doesNotMatch(PAGE, /ComplianceOverviewCards/, 'the old page is not mounted any more');
});

test('the five requests keep their keys and endpoints (the scorecard key is shared with the main Dashboard, the others with the pages that already ask)', () => {
  const data = code(src('overviewData.ts'));
  assert.match(data, /queryKey: \[\.\.\.SCORECARD_QUERY_KEYS\.compliance\],\s*queryFn: async \(\) => \(await complianceApi\.dashboard\.getSectionsOverview\(\)\)\.data as Scorecard/);
  assert.match(data, /queryKey: \['ev-ws-summary'\],\s*queryFn: async \(\) => \(await apiClient\.get\('\/evidence-mgmt\/items\/dashboard\/summary'\)\)\.data/);
  assert.match(data, /queryKey: \['certifications'\]/);
  assert.match(data, /certificationsApi\.getAll\(\)/);
  assert.match(data, /queryKey: \[\.\.\.ONBOARDING_KEYS\.register\]/);
  assert.match(data, /queryKey: \['compliance-trend', days\]/, 'the Frameworks hub reads the history under the same key and shape');
  assert.match(data, /complianceApi\.dashboard\.getComplianceTrend\(days\)/);
  assert.equal((data.match(/useQuery\(/g) ?? []).length, 5);
});

test('a failed request is an error state of its own card: nothing swallowed into zeros, no gate that waits for all of them', () => {
  const data = code(src('overviewData.ts'));
  const page = code(src('ComplianceOverview.tsx'));
  const parts = code(src('OverviewParts.tsx'));
  assert.doesNotMatch(data, /\bcatch\b/, 'the old page caught the scorecard\'s failure and drew a zero payload: "score -, nothing needs attention"');
  assert.doesNotMatch(page, /isLoading/, 'one skeleton for the whole page waited for every request');
  assert.equal((data.match(/retry: retryRead/g) ?? []).length, 5);
  assert.match(data, /canRetry\(error\)/, 'Retry only where asking again can help');
  assert.match(page, /failed: scorecard\.isError && !payload/);
  assert.match(page, /failed: evidence\.isError && !evidence\.data/);
  for (const part of ['PostureCard', 'FrameworkRows', 'OnboardingBody'] as const) assert.match(parts, new RegExp(`export function ${part}`), part);
  assert.match(parts, /SkeletonRows/);
  assert.match(parts, /function Failed\(/);
  assert.match(parts, /Couldn't load the compliance score/);
  assert.match(parts, /Couldn't load the framework journeys/);
  assert.match(parts, /Couldn't load framework onboarding/);
  assert.match(parts, /error=\{r\.state === 'error' \?/, 'a coverage row that failed says so with its own Retry');
});

test('the worklist is the shared inbox narrowed to Compliance (the top bar\'s queries, not requests of its own); the counters\' total is the model\'s sum', () => {
  const page = code(src('ComplianceOverview.tsx'));
  assert.match(page, /useInbox\(\{ freshOnOpen: true \}\)/);
  assert.match(page, /workOf\(inbox, COMPLIANCE_SOURCES\)/);
  assert.match(page, /const total = attentionTotal\(views\);/);
  assert.doesNotMatch(page, /attention_queue\??\.total|queue\??\.total/, 'the server\'s own total is the sum of four other buckets: the band adds the chips it shows');
  assert.doesNotMatch(page, /useQuery|apiClient/, 'the page composes; the requests are overviewData.ts');
});

test('every figure of a journey comes from the one model, and the page worked none out itself', () => {
  const model = code(src('overviewModel.ts'));
  assert.match(model, /from '\.\.\/\.\.\/\.\.\/lib\/journeyModel\.ts'/);
  for (const fn of ['journeyNumbers', 'portfolioNumbers', 'readinessBand', 'targetState']) assert.match(model, new RegExp(fn));
  for (const part of ['OverviewParts.tsx', 'ComplianceOverview.tsx']) assert.doesNotMatch(code(src(part)), /readiness_percentage|completion_percentage|implemented_count/, `${part}: no raw progress key`);
});

test('the weights are offered to administrators only (the server lets any signed-in person move them: a recorded gap)', () => {
  const page = code(src('ComplianceOverview.tsx'));
  assert.match(page, /const \{ isAdmin \} = usePermissions\(\);/);
  assert.match(page, /canTune=\{isAdmin\}/);
  const parts = code(src('OverviewParts.tsx'));
  assert.match(parts, /\{canTune && <div[^\r\n]*Adjust section weights<\/Button>/);
  assert.match(parts, /tuning=\{canTune \? TUNING : undefined\}/, 'the formulas dialog edits metric weights only for them too');
});

test('no native dialog, no hover-only action, no text under 12px, no platform-remapped utility, no legacy governance scope', () => {
  for (const { file, text } of SOURCES) {
    const c = code(text);
    assert.doesNotMatch(c, /window\.(confirm|alert|prompt)\s*\(/, file);
    assert.doesNotMatch(c, /(^|[^\w.$])(alert|prompt|confirm)\s*\(/m, `${file}: a bare alert(, prompt( or confirm(`);
  }
  for (const { file, text } of TSX) {
    const c = code(text);
    assert.doesNotMatch(c, /opacity-0[^'"`\n]*group-hover|group-hover[^'"`\n]*opacity-0/, `${file}: hover-only`);
    assert.doesNotMatch(c, /governance-light/, `${file}: the legacy scope`);
    const found = findViolations(text);
    assert.deepEqual(found, [], `${file}: ${found.map((v) => `${v.rule}@${v.line}`).join(', ')}`);
  }
});

test('no bare <p>, <td>, <th>, <h2>, <h3> or <h4>: each names its text size (the platform CSS gives a bare one 11.5px)', () => {
  const SIZE = /(?<![\w:-])!?text-(?:ds-(?:title|section|body|label)|\[\d)/;
  for (const { file, text } of TSX) {
    const c = code(text);
    const tag = /<(p|td|th|h2|h3|h4)(\s[^>]*?)?>/g;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(c)) !== null) {
      const open = c.slice(m.index, m.index + 400).split('>')[0] + '>';
      assert.match(open, SIZE, `${file}:${c.slice(0, m.index).split('\n').length} <${m[1]}> has no text size: ${open.slice(0, 90)}`);
    }
  }
});

test('the registry says the page draws its own head, and the page really renders the kit\'s page head with the registry\'s name', () => {
  assert.equal(routeFor('/compliance')?.ownHeading, true);
  assert.equal(registryNamesPage('/compliance'), true);
  assert.equal(ownHeadingSection('/compliance'), 'Compliance Management', 'the top bar names the section, the page names itself');
  assert.equal(titleFor('/compliance'), 'Compliance Overview');
  const page = src('ComplianceOverview.tsx');
  assert.match(page, /<PageHeader\s+variant="page"/);
  assert.match(page, /title=\{titleFor\('\/compliance'\) \?\? 'Compliance Overview'\}/);
  assert.match(LAYOUT, /pathname === '\/compliance'/, 'the area layout no longer draws a second heading over this page');
});

test('the strip links the Overview and the four pages that had no door: the page the person is on is aria-current', () => {
  const strip = code(src('ComplianceStrip.tsx'));
  assert.match(strip, /aria-current=\{open \? 'page' : undefined\}/);
  assert.match(strip, /<nav aria-label="Compliance pages"/);
  assert.match(code(src('ComplianceOverview.tsx')), /<ComplianceStrip current="overview" \/>/);
});

test("the page leads with the figures and the graphs: the cockpit's hero and visuals slots, drawn from the answers the page already has (no request of a chart's own)", () => {
  const page = code(src('ComplianceOverview.tsx'));
  assert.match(page, /hero=\{<Tiles /);
  assert.match(page, /visuals=\{<Charts /);
  assert.match(page, /useTrend\(HERO_DAYS\)/, "the tiles' shape is always the last 90 days");
  for (const file of ['Charts.tsx', 'Tiles.tsx', 'graphModel.ts']) assert.doesNotMatch(code(src(file)), /useQuery|apiClient|axios|(?<![\w.])fetch\(/, `${file}: the page asks, the graphs draw`);
  const charts = code(src('Charts.tsx'));
  assert.equal((charts.match(/<ChartCard\b/g) ?? []).length, 10, 'ten cards');
  assert.equal((charts.match(/\{\.\.\.shown\(/g) ?? []).length, 10, 'each card has its own loading, refused, failed and empty state');
  for (const kind of ['BarList', 'DonutChart', 'SegmentBar', 'StackedBars', 'TrendChart']) assert.match(charts, new RegExp(`<${kind}(?=[\\s>])`), kind);
  assert.match(code(src('Tiles.tsx')), /<KpiRow>/);
  assert.equal((code(src('Tiles.tsx')).match(/<KpiTile\b/g) ?? []).length, 6, 'six tiles');
});

test("no colour but the palette's, no percentage of the graphs' own: every Ready / Implemented figure is the journey model's, the scores are the server's", () => {
  for (const file of ['Charts.tsx', 'Tiles.tsx', 'graphModel.ts']) {
    const c = code(src(file));
    assert.doesNotMatch(c, /#[0-9a-fA-F]{3,8}\b/, `${file}: hex lives in palette.ts`);
    assert.doesNotMatch(c, /readiness_percentage|completion_percentage|implemented_count|approved_evidence_controls/, `${file}: no raw progress key`);
  }
  const graph = code(src('graphModel.ts'));
  for (const fn of ['journeyNumbers', 'readinessBand']) assert.match(graph, new RegExp(fn));
  assert.doesNotMatch(graph, /\/\s*(?:n|f\.n)\.(?:applicable|total)/, 'no division of its own: a percentage is the journey model\'s or the server\'s');
  assert.match(graph, /LEFT_OUT = new Set\(\['evidence:freshness'\]\)/, 'the stale-flag measure is not drawn beside the lapsed count');
});
