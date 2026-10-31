// node --test "src/app/(dashboard)/governance/_metrics/metricReport.test.ts"
// What the KPI / KRI report keeps and what it no longer does, pinned in the files that carry it (there is no React renderer here; behaviour is checked in
// a browser): the requests with their keys and endpoints, the permissions, every request reporting its own outcome, no native dialogs and no hover-only
// actions, the kit's rules in every file, and who imports the component (the KRIs page does not: it is its own page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('./MetricReport.tsx');
const files = { page, form: read('./MetricForm.tsx'), measure: read('./MeasureDialog.tsx'), spark: read('./Sparkline.tsx') };

test('the three requests the page makes keep their keys and endpoints (other screens read the same engine)', () => {
  assert.match(page, /const key = \['metric-report', kind\];/);
  assert.match(page, /queryKey: key,\s*\n\s*queryFn: \(\) => ermApi\.kris\.report\(90, kind\)/);
  assert.match(page, /queryKey: \['kri-metric-options'\], queryFn: \(\) => ermApi\.kris\.metricOptions\(\)/);
  assert.match(page, /queryKey: \['kri-templates'\], queryFn: \(\) => ermApi\.kris\.templates\(\)/);
  assert.equal((page.match(/useQuery\(/g) ?? []).length, 3);
});

test('the four writes keep their endpoints; each refreshes the report as before and says what happened only after the server answered', () => {
  assert.match(page, /ermApi\.kris\.create\(payload as unknown as RiskKRICreate\)/);
  assert.match(page, /ermApi\.kris\.update\(id, payload as unknown as RiskKRIUpdate\)/);
  assert.match(page, /ermApi\.kris\.measure\(id, payload\)/);
  assert.match(page, /ermApi\.kris\.delete\(m\.id\)/);
  assert.equal((page.match(/useReportedMutation\(/g) ?? []).length, 4, 'create, update, measure and delete');
  assert.doesNotMatch(page, /\buseMutation\(/, 'a bare mutation reports nothing: it used to fail with no message');
  assert.equal((page.match(/invalidate: \[key\]/g) ?? []).length, 4, 'the report is refreshed after each, nothing else is');
  assert.match(page, /success: `\$\{meta\.noun\} created`, failure: `Couldn't create the \$\{meta\.noun\}`, retryable: false/, 'a create is not offered again: a lost answer would make a second one');
  assert.match(page, /success: 'Measurement recorded', failure: "Couldn't record the measurement", retryable: false/, 'nor is a measurement');
  assert.doesNotMatch(page, /finally/, 'the old save() was try/finally with no catch: an error was an unhandled rejection');
});

test('a measurement and a metric go out as they always did (the pure builders are tested in metricModel.test.ts)', () => {
  assert.match(page, /onSubmit=\{\(payload\) => \(editing \? update\.mutate\(\{ id: editing\.id, payload \}\) : create\.mutate\(payload\)\)\}/);
  assert.match(files.form, /onSubmit\(toPayload\(form, source, kind\)\)/);
  assert.match(files.measure, /onSubmit\(measurePayload\(input\)\)/);
  assert.match(read('./metricModel.ts'), /review_status: 'approved'/, 'a manual measurement is recorded as approved at once: a workflow question, kept');
});

test('permissions are the same: erm:kris:create or erm:kris:edit changes anything, nothing else is asked', () => {
  assert.match(page, /const canEdit = hasPermission\('erm:kris:create'\) \|\| hasPermission\('erm:kris:edit'\);/);
  assert.deepEqual(Array.from(page.matchAll(/hasPermission\('([^']+)'\)/g), (m) => m[1]), ['erm:kris:create', 'erm:kris:edit']);
  assert.match(page, /\.\.\.\(canEdit \? \[\{/, 'the Actions column exists only for someone who may change');
  assert.match(page, /actions=\{canEdit \? <Button variant="primary"/);
});

test('no native dialog, no action hidden until hover, no hand-rolled overlay, no developer text on screen', () => {
  for (const [name, text] of Object.entries(files)) {
    assert.doesNotMatch(text, /\bwindow\.(confirm|alert|prompt)\(|(^|[^.\w])(alert|prompt)\(|\bif \(!?confirm\(/m, `${name}: a native dialog (the kit's confirm() is awaited and comes from useConfirm)`);
    assert.doesNotMatch(text, /opacity-0|group-hover/, `${name}: an action that is invisible until hover (and for ever on touch and keyboard)`);
    assert.doesNotMatch(text, /fixed inset-0|aria-modal/, `${name}: a hand-rolled overlay: the kit's drawer and dialog take focus, name themselves and guard typed input`);
    assert.doesNotMatch(text, /backend may need a restart|expose the endpoints/, `${name}: developer text`);
  }
  assert.match(page, /const \{ confirm, confirmDialog \} = useConfirm\(\);/);
  assert.match(page, /tone: 'danger'/);
  assert.match(page, /\{confirmDialog\}/);
});

test('the drawer and the dialog are the kit\'s and guard typed input', () => {
  assert.match(files.form, /<RightSlidePanel\s+isOpen\s+onClose=\{onClose\}\s+dirty=\{dirty\}/);
  assert.match(files.measure, /<AnimatedModal\s+isOpen\s+onClose=\{onClose\}\s+dirty=\{measureDirty\(input\)\}/);
  for (const text of [files.form, files.measure]) assert.match(text, /<FormField/);
  assert.match(files.form, /formDirty\(opened, \{ form, source \}\)/);
});

test('every state is said: loading, failed (with the server\'s words, and "no access" for a refusal), empty for the first time, nothing matches', () => {
  assert.match(page, /<ErrorState title=\{`Couldn't load the \$\{meta\.plural\}`\} message=\{errorMessage\(report\.error\)\} onRetry=/);
  assert.match(page, /<NoAccessState title=\{`You don't have access to these \$\{meta\.plural\}`\} reason=\{errorMessage\(report\.error\)\}/);
  assert.match(page, /statusOf\(report\.error\) === 403/);
  assert.match(page, /<EmptyState bare kind="firstUse"/);
  assert.match(page, /<EmptyState bare kind="noMatches"[^>]*onClearFilters=\{clearFilters\}/);
  assert.match(page, /TilesSkeleton/);
  assert.match(page, /loading=\{loading\}/);
  assert.doesNotMatch(page, /\?\? 0\b|\|\| 0\b/, 'a failed or empty answer is never read as a zero');
  assert.match(page, /report\.isError && !report\.data/, 'a refetch that fails keeps what was shown');
  assert.match(files.form, /Couldn't load the platform metrics/);
  assert.match(files.form, /Couldn't load the templates/);
});

test('the count is the server\'s: the page asks for the total, not for the length of what loaded', () => {
  assert.match(page, /const total = summary\?\.total \?\? metrics\.length;/);
  assert.match(page, /rowCountText\(\{ shown: matches\.length, total, noun: meta\.noun, plural: meta\.plural \}\)/);
  assert.match(page, /<Pager page=\{range\.page\} pageSize=\{pageSize\} total=\{matches\.length\}/);
  assert.match(page, /\{ value: 'all', label: `All\$\{counted\(summary\.total\)\}` \}/);
});

test('status and dates: the registry\'s words, the platform\'s formatter, a day is a day', () => {
  assert.match(page, /statusPill\(rag, ragOf\(m\.current_status\)\)/);
  assert.match(page, /formatDate\(m\.next_due_date, \{ calendar: true \}\)/);
  assert.match(page, /isDue\(m\.next_due_date, m\.is_live\)/);
  for (const [name, text] of Object.entries(files)) {
    assert.doesNotMatch(text, /toLocaleDateString|toLocaleString|new Date\(/, `${name}: the platform's formatter writes dates and numbers (a naive-UTC string parsed here shifts)`);
  }
  assert.match(page, /NOT_SET/);
});

test('the sparkline is an image with its numbers in words', () => {
  assert.match(files.spark, /role="img" aria-label=\{words\}/);
  assert.match(files.spark, /<title>\{words\}<\/title>/);
});

test('the head is the kit\'s, named by the registry; the report keeps its two tiles of kind and the filter by status', () => {
  assert.match(page, /<PageHeader\s+variant="page"/);
  assert.match(page, /titleFor\('\/governance\/kpi-report'\)/);
  assert.match(page, /View only/);
  assert.match(page, /<SegmentedControl label=\{`Show \$\{meta\.plural\} by status`\}/);
});

test('every file of the report follows the kit\'s rules: only the --ds tokens and arbitrary values, no legacy scope, no legacy buttons', () => {
  for (const [name, text] of Object.entries(files)) {
    assert.deepEqual(findViolations(text).map((v) => `${name}:${v.line} ${v.rule}: ${v.text}`), []);
    assert.doesNotMatch(text, /governance-light|docUi|DocPageHeader|PageLoader/, name);
    assert.doesNotMatch(text, /<(button|select|textarea|input)\b[^>]*className="[^"]*(bg-primary|bg-white)/, name);
  }
});

/** every .ts / .tsx under src, so the test can say who imports the component */
function sources(dir: URL, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const url = new URL(name, dir);
    const stat = statSync(url);
    if (stat.isDirectory()) sources(new URL(`${name}/`, dir), found);
    else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name)) found.push(url.pathname);
  }
  return found;
}

test('only the KPI Report page imports the report; /erm/kris is its own page and shares the engine, not the component', () => {
  const importers = sources(new URL('../../../../', import.meta.url)).filter((f) => /from '[^']*\bMetricReport'/.test(readFileSync(f.replace(/^\/(\w:)/, '$1'), 'utf8')) && !/_metrics\/MetricReport\.tsx$/.test(f));
  assert.deepEqual(importers.map((f) => f.replace(/^.*\/src\//, '')), ['app/(dashboard)/governance/kpi-report/page.tsx']);
  assert.match(read('../kpi-report/page.tsx'), /<MetricReport kind="kpi" \/>/);
  assert.doesNotMatch(read('../../erm/kris/page.tsx'), /MetricReport/);
});
