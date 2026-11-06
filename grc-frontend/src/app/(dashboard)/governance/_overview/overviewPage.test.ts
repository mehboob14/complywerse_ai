// node --test "src/app/(dashboard)/governance/_overview/overviewPage.test.ts"
// What the Governance Overview keeps and how it is built now (a worklist-first cockpit), pinned in the files that carry it (there is no React renderer here;
// behaviour is checked in a browser): the seven requests with their keys and endpoints (other pages share the keys), the eighth (the posture aggregate), no
// failure swallowed into zeros, every card with its own loading and error state, a refusal said as "No access", the worklist drawn from the shared inbox, the
// kit's rules in every file, the shared score dialogs and tuner, the old anchors, and the words for the chart.
// A pin that had to change when the page became a cockpit says in its title what contract it now holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('../page.tsx');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const COMPONENTS = '../../../../components/overview';
const files = {
  page, parts: read('./parts.tsx'), library: read('./Library.tsx'), throughput: read('./Throughput.tsx'), posture: read('./Posture.tsx'), groups: read('./Groups.tsx'),
  dialog: read('./PerformanceDialog.tsx'), cockpit: read(`${COMPONENTS}/Cockpit.tsx`), band: read(`${COMPONENTS}/CounterBand.tsx`), workCard: read(`${COMPONENTS}/WorkListCard.tsx`),
};
const model = read('./overviewModel.ts');
const api = read('./postureApi.ts');

test('the seven requests keep their keys and their endpoints (the scorecard key is shared with the main dashboard)', () => {
  const asks: Array<[RegExp, RegExp]> = [
    [/queryKey: \['governance-dashboard-summary'\]/, /governanceApi\.getDashboardSummary\(\)/],
    [/queryKey: \['governance-pending-approvals'\]/, /governanceApi\.getDashboardPendingApprovals\(\)/],
    [/queryKey: \['governance-expiring-soon'\]/, /governanceApi\.getExpiringSoon\(30\)/],
    [/queryKey: \['governance-overdue-reviews'\]/, /governanceApi\.getDashboardOverdueReviews\(\)/],
    [/queryKey: \[\.\.\.SCORECARD_QUERY_KEYS\.governance\]/, /governanceApi\.getDocumentsOverview\(\)/],
    [/queryKey: \['governance-trends'\]/, /governanceApi\.getTrends\(6\)/],
    [/queryKey: \['governance-policy-exceptions-summary'\]/, /policyExceptionApi\.getSummary\(\)/],
  ];
  for (const [key, call] of asks) { assert.match(page, key); assert.match(page, call); }
  assert.equal((page.match(/useQuery\(/g) ?? []).length, 7);
  assert.match(page, /const GOVERNANCE_TUNING = \{ configBase: '\/governance\/dashboard', invalidateKey: \[\.\.\.SCORECARD_QUERY_KEYS\.governance\] as unknown\[\] \};/);
});

test('the eighth request is the posture aggregate: one endpoint, ten groups first then pages of a hundred, the other grouping only when asked for', () => {
  assert.match(api, /apiClient\.get\('\/governance\/dashboard\/posture', \{ params: pageParam \}\)/);
  assert.match(api, /queryKey: \['governance-posture', by\]/);
  assert.match(api, /initialPageParam: \{ by, limit: FIRST_PAGE, offset: 0 \}/);
  assert.match(api, /retry: retryOverview/);
  assert.match(page, /const groups = usePosture\(by\);/, 'one grouping at a time: the page asks for the one it shows');
  assert.equal((page.match(/usePosture\(/g) ?? []).length, 1);
});

test('the worklist is the shared inbox narrowed to Governance: the top bar\'s queries, not requests of its own', () => {
  assert.match(page, /useInbox\(\{ freshOnOpen: true \}\)/);
  assert.match(page, /workOf\(inbox, GOVERNANCE_SOURCES\)/);
  assert.match(model, /GOVERNANCE_SOURCES[^=]*= \['doc\.lifecycle', 'doc\.signoff'\]/, 'documents and sign-offs; assessment evidence belongs to Compliance, the requests the person sent are not theirs to do');
  for (const name of ['cockpit', 'band', 'workCard'] as const) {
    assert.doesNotMatch(files[name], /useQuery|useInfiniteQuery|apiClient|fetch\(/, `${name}: the frame draws what it is given and asks for nothing`);
  }
  assert.match(read(`${COMPONENTS}/workList.ts`), /from '\.\.\/\.\.\/lib\/inbox\/buildInbox\.ts'/, 'the list is built from buildInbox\'s own items, order and kinds');
});

test('a failed request is an error state of its own card: nothing swallowed, no gate that waits for all of them', () => {
  assert.doesNotMatch(page, /\bcatch\b/, 'the scorecard\'s failure used to be caught and turned into "no data", which read as zeros');
  assert.doesNotMatch(page, /isLoading/, 'one skeleton for the whole page waited for every request');
  assert.equal((page.match(/retry: retryOverview/g) ?? []).length, 7);
  assert.match(files.parts, /export function FeedError/);
  assert.match(files.parts, /canRetry\(feed\.error\)/, 'Retry only where asking again can help');
  // every card draws a skeleton while it loads and an error row when it failed
  for (const name of ['library', 'throughput', 'posture', 'groups', 'workCard'] as const) {
    assert.match(files[name], /Skeleton/, `${name}: a skeleton while it loads`);
    assert.match(files[name], /FeedError|ErrorState/, `${name}: an error row when it failed`);
  }
  assert.match(files.band, /error=\{c\.state === 'error' \? \{ onRetry: c\.onRetry \} : null\}/, 'a counter that failed says so with its own Retry');
  assert.match(files.band, /loading=\{c\.state === 'loading'\}/);
  assert.doesNotMatch(files.band, /\?\? 0|\|\| 0/, 'a counter without an answer is never 0');
  assert.match(files.band, /count=\{c\.state === 'ready' \? c\.value \?\? null : null\}/, 'only a counter that answered has a number; the rest are a dash, never 0');
});

test('a request the server refused is "No access" where its numbers would be, and when the scorecard is refused that is said once and the work takes the page', () => {
  assert.match(files.parts, /export function Denied/);
  assert.match(files.parts, /export const refused = /);
  for (const name of ['library', 'throughput', 'groups'] as const) assert.match(files[name], /Denied|refused\(feed\)/, `${name}: a refusal is not an error`);
  assert.match(page, /const programmeRefused = refused\(feeds\.scorecard\);/);
  assert.match(page, /layoutOf\(\{ refused: programmeRefused,/);
  assert.match(page, /title="No access to the programme scores"/);
  const workOnly = /if \(mode === 'work-only'\) \{[\s\S]*?\n  \}\n/.exec(code(files.cockpit))?.[0] ?? '';
  assert.match(workOnly, /\{refusal\}[\s\S]*\{work\}/);
  assert.doesNotMatch(workOnly, /band|posture|breakdowns/, 'in work-only mode the frame draws the refusal and the work, nothing else');
});

test('every file of the Overview and of the cockpit frame follows the kit\'s rules: only the --ds tokens and arbitrary values, no legacy scope', () => {
  for (const [name, text] of Object.entries(files)) {
    assert.deepEqual(findViolations(text).map((v) => `${name}:${v.line} ${v.rule}: ${v.text}`), []);
    assert.doesNotMatch(text, /governance-light|docUi|DocPageHeader|PageLoader/, name);
    assert.doesNotMatch(text, /<(button|select|textarea|input)\b[^>]*className="[^"]*(bg-primary|bg-white)/, name);
  }
});

test('the head is the kit\'s, with the three actions of the page and their addresses (two of them fold into "More" on a phone)', () => {
  assert.match(page, /<PageHeader\s+variant="page"/);
  assert.match(page, /titleFor\('\/governance'\)/, 'the heading is the registry\'s name for the page');
  assert.match(page, /<Button href=\{link\('\/governance\/documents\/attestation'\)\}[^\n]*>Attestations<\/Button>/);
  assert.match(page, /<Button href=\{link\('\/compliance\/statements'\)\}[^\n]*>Statements<\/Button>/);
  assert.match(page, /<Button href=\{link\('\/governance\/documents'\)\} variant="primary"[^\n]*>Manage Documents<\/Button>/);
  assert.match(page, /router\.push\(link\('\/governance\/documents\/attestation'\)\)/);
  assert.match(page, /router\.push\(link\('\/compliance\/statements'\)\)/);
});

test('every link out of the Overview remembers the page it is on (?from=), so the shell keeps the Overview lit and in the trail on arrival', () => {
  const parts = read('./parts.tsx');
  assert.match(parts, /import \{ withFrom \} from '@\/components\/shell\/withFrom';/);
  assert.match(parts, /export const HERE = '\/governance';/);
  assert.match(parts, /export const link = \(href: string\): string => withFrom\(href, HERE\);/);
  for (const [name, text] of Object.entries(files)) {
    if (name === 'parts') continue;
    const src = code(text);
    // no link is written as a bare path: a literal address is the argument of link(...) or comes from a model
    assert.doesNotMatch(src, /(href|to)=("|')\//, `${name}: a bare in-app address`);
    assert.doesNotMatch(src, /router\.push\(('|")\//, `${name}: a bare in-app address pushed`);
  }
  for (const name of ['library', 'groups', 'posture'] as const) assert.match(files[name], /\blink\(/, `${name} draws its links through link()`);
  assert.match(files.workCard, /href=\{link\(r\.href\)\}/);
  assert.match(files.workCard, /action=\{\{ label: r\.action\.label, href: link\(r\.action\.href\) \}\}/);
  assert.match(files.workCard, /href=\{link\(seeAllHref\(chosen\)\)\}/);
  assert.match(files.workCard, /href=\{link\(r\.extraLink\.href\)\}/);
});

test('all eight counters are on the band, each with the address and tone the model gives it', () => {
  assert.match(page, /ATTENTION\.map\(\(def\) => \(\{ def, counter: counterFor\(def, sources\) \}\)\)/);
  assert.match(page, /key: def\.key, label: def\.label, href: link\(def\.href\), tone: def\.tone,/);
  assert.match(page, /title="Programme needs attention"/);
  assert.match(page, /id="attention"/);
});

test('the score dialogs, the weight tuner and the scorecard\'s query are the shared ones; a section\'s weights are reached from its opened row', () => {
  assert.match(page, /import \{ SectionDetailModal, type OverviewSection \} from '@\/components\/dashboard\/score-kit'/);
  assert.match(page, /<SectionDetailModal section=\{openSection\} onClose=\{\(\) => setOpenSection\(null\)\} tuning=\{GOVERNANCE_TUNING\} \/>/);
  assert.match(page, /onAdjust=\{\(key\) => setOpenSection\(feeds\.scorecard\.data\?\.sections\?\.\[key\] \?\? null\)\}/);
  assert.match(files.dialog, /import \{ SectionWeightTuner \} from '@\/components\/dashboard\/score-tuning'/);
  assert.match(files.dialog, /<AnimatedModal isOpen=\{open\} onClose=\{close\}/);
  assert.match(files.posture, />Adjust weights<\/Button>/);
  for (const [name, text] of Object.entries(files)) assert.doesNotMatch(text, /import[^;]*ScoreBreakdownCard/, `${name}: the shared card keeps its own palette and numerals for the other modules`);
});

test('the old anchors still land on something: #attention, #posture, #breakdown, #throughput; and the skip link reaches the work', () => {
  assert.match(page, /id="attention"/);
  assert.match(files.posture, /id="posture"/);
  assert.match(files.posture, /id="breakdown"/);
  assert.match(page, /id: 'throughput'/);
  assert.match(page, /id="work"/);
  assert.match(files.cockpit, /export function SkipToWork\(\{ href = '#work' \}/);
  assert.match(files.cockpit, /Skip to my work/);
  assert.match(page, /<SkipToWork \/>/);
});

test('the posture is bars with a target tick and the number beside each bar: no radar, and nothing that needs a hover', () => {
  assert.doesNotMatch(files.posture, /recharts|RadarChart/);
  assert.match(files.posture, /function ScoreBar/);
  assert.match(files.posture, /aria-expanded=\{open\}/, 'a section opens in place from a button');
  assert.match(files.posture, /aria-controls=\{panelId\}/);
  assert.match(files.posture, /aria-label=\{`Open \$\{row\.label\}`\}/, 'every section has an arrow to its page, named');
  for (const [name, text] of Object.entries(files)) assert.doesNotMatch(code(text), /opacity-0[^'"`\n]*group-hover|group-hover[^'"`\n]*opacity-0/, `${name}: nothing appears only on hover`);
});

test('the throughput chart has its numbers in words and no keyboard layer of its own; every chart label is 12px', () => {
  assert.equal((files.throughput.match(/role="img" aria-label=\{trendSummary\(rows\)\}/g) ?? []).length, 1);
  assert.equal((files.throughput.match(/accessibilityLayer=\{false\}/g) ?? []).length, 1);
  const sizes = Array.from(files.throughput.matchAll(/fontSize: (\d+)/g), (m) => Number(m[1]));
  assert.ok(sizes.length >= 3 && sizes.every((n) => n >= 12), `chart text sizes: ${sizes.join(', ')}`);
  assert.doesNotMatch(files.throughput, /#(2563eb|60a5fa|10b981|3b82f6|bbf7d0)/i, 'no blue or emerald hex: the brand teal and the tone table');
  assert.match(files.posture, /role="img" aria-label=\{trendAlt\(points\)\}/, 'the sparkline is words too');
});

test('a score is "No data" or a dash where there is none, never 0, and numbers are counted with the platform\'s formatter', () => {
  assert.doesNotMatch(files.library, /\?\? 0\)\}%|Math\.round\(complianceRate\)/);
  for (const name of ['library', 'groups', 'workCard'] as const) assert.match(files[name], /formatCount/, name);
  assert.doesNotMatch(page, /toLocaleDateString|\.toLocaleString\(/);
  assert.doesNotMatch(files.throughput, /toLocaleDateString/, 'a month is named from its text (monthLabel), not through a Date');
});

test('the scorecard\'s answer is read as the shared cache holds it: null (the main dashboard\'s failed request) is an error here, never "no data"', () => {
  assert.match(files.parts, /data: query\.data \?\? undefined/);
  assert.match(model, /if \(q\.data === null\) return 'error';/);
});

test('the cockpit frame\'s rules live in the model, and the page only passes them to the frame', () => {
  assert.match(page, /import \{ layoutOf, workRowLimit \} from '@\/components\/overview\/cockpitModel'/);
  assert.match(code(files.cockpit), /import type \{ CockpitMode \} from '\.\/cockpitModel'/);
  assert.match(files.band, /foldCounters\(orderCounters\(counters\)/);
});
