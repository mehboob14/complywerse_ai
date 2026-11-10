// node --test "src/app/(dashboard)/reports/_trends/trendsPages.test.ts"
// Source-text pins for the Trends board and the Analytics launcher (the files rpt-trends-analytics wrote): the kit's rules (no class the shell rewrites, nothing under 12px, no bare outline-none), no native dialogs,
// nothing that appears only on hover, no product, vendor or setting name on a screen, and the few contracts a screenshot cannot show: a chart always has its table, a read never captures a snapshot, a target is never
// sent before the person has confirmed, the launcher opens its tab inside the click and never asks for a group.
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

const FILES = [...walk('_trends'), ...walk('_analytics'), 'trends/page.tsx', 'analytics/page.tsx', '_reports/trends.ts'];

test('the Trends and Analytics files follow the kit\'s rules: no class the shell rewrites, nothing under 12px, no bare outline-none', () => {
  assert.ok(FILES.length >= 12);
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native confirm, alert or prompt, no action that exists only on hover, no hand-made overlay, no governance-light', () => {
  for (const f of FILES) {
    const source = read(f);
    assert.doesNotMatch(source, /\bwindow\.(?:confirm|alert|prompt)\(|(?<![\w.])(?:alert|prompt)\(/, `${f}: a native dialog`);
    if (!/useConfirm/.test(source)) assert.doesNotMatch(source, /(?<![\w.])confirm\(/, `${f}: a native confirm (the kit's is useConfirm)`);
    assert.doesNotMatch(source, /opacity-0[^'"`]*group-hover|group-hover:opacity|hover:opacity-100/, `${f}: hover-only`);
    assert.doesNotMatch(source, /fixed inset-0|role="dialog"/, `${f}: a hand-made overlay (the kit's is Sheet)`);
    assert.doesNotMatch(source, /governance-light/, f);
  }
});

test('a screen never names a vendor, a model, a product, a setting or an address: the words are the platform\'s', () => {
  for (const f of FILES) {
    const hit = visible(read(f), f.endsWith('.tsx')).find((s) => /\b(?:open\s?ai|gpt|anthropic|claude|metabase|qdrant|sql|jwt|sso|mailhog|smtp|env|deploy|reporting_\w+|restart)\b/i.test(s));
    assert.equal(hit, undefined, `${f}: ${hit}`);
  }
});

test('chart text is 12px or more, and every chart is a ChartFrame (a named figure with its numbers as a table)', () => {
  const charts = read('_trends/TrendCharts.tsx');
  const sizes = Array.from(charts.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]));
  assert.ok(sizes.length >= 3, 'the ticks and the reference-line labels set their size');
  for (const size of sizes) assert.ok(size >= 12, `a chart text of ${size}px`);
  assert.equal((charts.match(/<ResponsiveContainer/g) ?? []).length, (charts.match(/<ChartFrame/g) ?? []).length, 'a chart outside a ChartFrame has no table');
  assert.match(charts, /\{\.\.\.focusOff\}/, 'the chart gives up the keyboard layer the frame turns off');
  const sheet = read('_trends/TrendSheet.tsx');
  assert.match(sheet, /<ValuesTable card=\{card\} \/>/, 'the line chart has a visible table of its values');
  assert.match(sheet, /sliceRows\(breakdown\.data\.series\)/, 'the breakdown has a visible table that lists every slice');
  assert.doesNotMatch(sheet, /aria-hidden[^>]*>\s*<Table/, 'the visible tables are not hidden from anyone');
});

test('a status is never colour alone: a card and a row carry the status pill with its words, and a movement says better or worse', () => {
  const cards = read('_trends/TrendCards.tsx');
  assert.ok((cards.match(/<StatusPill/g) ?? []).length >= 2, 'the card and the row both draw the pill');
  assert.match(cards, /d\.verdict/, 'the movement says its verdict in words');
  assert.doesNotMatch(cards, /style=\{\{\s*color/, 'text takes a token class, not an inline colour');
});

test('reading never captures a snapshot: the capture is a button, a mutation, and nothing else calls it', () => {
  const page = read('_trends/TrendsPage.tsx');
  assert.match(page, /useReportedMutation\(\{\s*mutationFn: \(\) => trendsApi\.snapshot\(\)/, 'the capture is a reported mutation');
  for (const f of walk('_trends')) if (f !== '_trends/TrendsPage.tsx') assert.doesNotMatch(read(f), /trendsApi\.snapshot/, `${f} captures`);
  assert.doesNotMatch(page, /queryFn:[^\n]*snapshot/, 'a query never captures');
  assert.doesNotMatch(page + read('_trends/TrendSheet.tsx'), /\bdaily\b|each night|automatically|every night/i, 'nothing promises a capture that nothing makes');
});

test('a target is confirmed before it is sent, a reset too, and a person is never asked what a figure\'s colour means for them alone: it says it is for everyone', () => {
  const source = read('_trends/TargetPanel.tsx');
  assert.ok(source.indexOf('await confirm(') > 0 && source.indexOf('await confirm(') < source.indexOf('save.mutate(check)'), 'Save asks first');
  const reset = source.slice(source.indexOf('const askReset'));
  assert.ok(reset.indexOf('await confirm(') > 0 && reset.indexOf('await confirm(') < reset.indexOf('reset.mutate()'), 'Reset asks first');
  assert.match(source, /everyone in your organisation/);
  assert.match(source, /if \(check\.error\) return;/, 'a target that is not valid is never sent');
  assert.doesNotMatch(source, /Number\(target\)|Number\(warn\)/, 'what is sent comes from checkTarget, never a bare Number()');
});

test('the Sheet is the kit\'s, closes through the address, and its range is the board\'s until another is chosen', () => {
  const sheet = read('_trends/TrendSheet.tsx');
  assert.match(sheet, /<Sheet open onClose=\{onClose\}/);
  assert.match(sheet, /enabled: !sameRange/, 'the board\'s card is the answer for the board\'s range: no second request');
  const page = read('_trends/TrendsPage.tsx');
  assert.match(page, /set\(\{ metric: c\.key \}, \{ push: true \}\)/, 'opening a figure adds a history entry: Back closes it');
  assert.match(page, /onClose=\{\(\) => set\(\{ metric: '' \}\)\}/);
});

test('the launcher opens its tab inside the click, never asks for a group or a role, has no setup tools, and says a failed status read with Retry', () => {
  const source = read('_analytics/AnalyticsPage.tsx');
  const opener = source.slice(source.indexOf('const openTool'));
  assert.ok(opener.indexOf("window.open('about:blank'") > 0 && opener.indexOf("window.open('about:blank'") < opener.indexOf('await '), 'window.open comes before the first await');
  assert.match(source, /sso\(\{ return_to: returnTo \}\)/);
  assert.doesNotMatch(source, /groups/, 'the launcher never asks for a group');
  assert.doesNotMatch(source, /ensureViews|view_catalog|reporting_views|subscriptions|site_url|licence_note|mailhog|configure_script/, 'the setup tools and the deployment keys are Administration\'s');
  assert.match(source, /onRetry=\{\(\) => \{ void statusQuery\.refetch\(\); \}\}/, 'a failed status read has Retry');
  assert.match(source, /<iframe title=\{embedded\.title\}/, 'the embedded view is named');
});
