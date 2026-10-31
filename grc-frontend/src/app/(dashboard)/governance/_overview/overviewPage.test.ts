// node --test "src/app/(dashboard)/governance/_overview/overviewPage.test.ts"
// What the Governance Overview keeps and what it no longer does, pinned in the files that carry it (there is no React renderer here; behaviour is
// checked in a browser): the seven requests with their keys and endpoints (other pages share the keys), no failure swallowed into zeros, every section
// with its own loading and error state, the kit's rules in every file, the shared score dialogs and tuner, and the words for the two charts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('../page.tsx');
const files = { page, parts: read('./parts.tsx'), tiles: read('./Tiles.tsx'), attention: read('./Attention.tsx'), breakdown: read('./Breakdown.tsx'), charts: read('./Charts.tsx') };

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

test('a failed request is an error state of its own sections: nothing swallowed, no gate that waits for all seven', () => {
  assert.doesNotMatch(page, /\bcatch\b/, 'the scorecard\'s failure used to be caught and turned into "no data", which read as zeros');
  assert.doesNotMatch(page, /isLoading/, 'one skeleton for the whole page waited for every request');
  assert.equal((page.match(/retry: retryOverview/g) ?? []).length, 7);
  assert.match(files.parts, /export function FeedError/);
  assert.match(files.parts, /canRetry\(feed\.error\)/, 'Retry only where asking again can help');
  // every section draws a skeleton while it loads and an error row when it failed
  for (const [name, text] of Object.entries({ tiles: files.parts, attention: files.attention, breakdown: files.breakdown, charts: files.charts })) {
    assert.match(text, /Skeleton/, `${name}: a skeleton while it loads`);
    assert.match(text, /FeedError|ErrorState/, `${name}: an error row when it failed`);
  }
  assert.match(files.attention, /Unavailable/);
  assert.doesNotMatch(files.attention, /\?\? 0|\|\| 0/, 'a counter without an answer is never 0');
});

test('every file of the Overview follows the kit\'s rules: only the --ds tokens and arbitrary values, no legacy scope', () => {
  for (const [name, text] of Object.entries(files)) {
    assert.deepEqual(findViolations(text).map((v) => `${name}:${v.line} ${v.rule}: ${v.text}`), []);
    assert.doesNotMatch(text, /governance-light|docUi|DocPageHeader|PageLoader/, name);
    assert.doesNotMatch(text, /<(button|select|textarea|input)\b[^>]*className="[^"]*(bg-primary|bg-white)/, name);
  }
});

test('the head is the kit\'s, with the three actions of the page and their addresses', () => {
  assert.match(page, /<PageHeader\s+variant="page"/);
  assert.match(page, /titleFor\('\/governance'\)/, 'the heading is the registry\'s name for the page');
  assert.match(page, /<Button href="\/governance\/documents\/attestation"[^\n]*>Attestations<\/Button>/);
  assert.match(page, /<Button href="\/compliance\/statements"[^\n]*>Statements<\/Button>/);
  assert.match(page, /<Button href="\/governance\/documents" variant="primary"[^\n]*>Manage Documents<\/Button>/);
});

test('the score dialogs, the weight tuner and the scorecard\'s query are the shared ones; the shared breakdown card is left to the other modules', () => {
  assert.match(page, /import \{ SectionDetailModal, type OverviewSection \} from '@\/components\/dashboard\/score-kit'/);
  assert.match(page, /<SectionDetailModal section=\{openSection\} onClose=\{\(\) => setOpenSection\(null\)\} tuning=\{GOVERNANCE_TUNING\} \/>/);
  assert.match(files.breakdown, /import \{ SectionWeightTuner \} from '@\/components\/dashboard\/score-tuning'/);
  assert.match(files.breakdown, /<AnimatedModal isOpen=\{open\} onClose=\{close\}/);
  for (const [name, text] of Object.entries(files)) assert.doesNotMatch(text, /import[^;]*ScoreBreakdownCard/, `${name}: the shared card keeps its own palette and numerals for the other modules`);
});

test('each chart has its numbers in words and no keyboard layer of its own; every chart label is 12px', () => {
  assert.equal((files.charts.match(/role="img" aria-label=\{(postureSummary|trendSummary)\(rows\)\}/g) ?? []).length, 2);
  assert.equal((files.charts.match(/accessibilityLayer=\{false\}/g) ?? []).length, 2);
  const sizes = Array.from(files.charts.matchAll(/fontSize: (\d+)/g), (m) => Number(m[1]));
  assert.ok(sizes.length >= 3 && sizes.every((n) => n >= 12), `chart text sizes: ${sizes.join(', ')}`);
  assert.doesNotMatch(files.charts, /#(2563eb|60a5fa|10b981|3b82f6|bbf7d0)/i, 'no blue or emerald hex: the brand teal and the tone table');
});

test('a score is "No data" or a dash where there is none, never 0, and numbers are counted with the platform\'s formatter', () => {
  assert.doesNotMatch(files.tiles, /\?\? 0\)\}%|Math\.round\(complianceRate\)/);
  for (const [name, text] of Object.entries({ tiles: files.tiles, attention: files.attention })) assert.match(text, /formatCount/, name);
  assert.doesNotMatch(page, /toLocaleDateString|\.toLocaleString\(/);
  assert.doesNotMatch(files.charts, /toLocaleDateString/, 'a month is named from its text (monthLabel), not through a Date');
});

test('the collapsed score breakdown is a SectionCard with no content, which keeps no gap under its title row', () => {
  const card = read('../../../../components/ui/ds/SectionCard.tsx');
  assert.match(card, /children\?: ReactNode;/);
  assert.match(card, /Children\.toArray\(children\)\.length > 0 \? 'mb-\[12px\] ' : ''/);
});

test('the scorecard\'s answer is read as the shared cache holds it: null (the main dashboard\'s failed request) is an error here, never "no data"', () => {
  assert.match(files.parts, /data: query\.data \?\? undefined/);
  assert.match(read('./overviewModel.ts'), /if \(q\.data === null\) return 'error';/);
});
