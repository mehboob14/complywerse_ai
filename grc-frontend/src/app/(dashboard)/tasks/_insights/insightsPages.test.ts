// node --test "src/app/(dashboard)/tasks/_insights/insightsPages.test.ts"
// Source-text pins for the Insights tab and the AI sheets (tasks/_insights, _ReportsView.tsx, _AiPriorities.tsx). The kit rules, bare text, native dialogs and hover-only actions are pinned for the
// whole tasks folder by tasksPages.test.ts; these hold what is specific here: the tab reads the register's load and opens All tasks, the switch lives in the address, every AI answer opens in a sheet that
// says what the AI read, nothing shows an id, and the old export and calls are where the page expects them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = 'src/app/(dashboard)/tasks';
const read = (file: string) => readFileSync(`${ROOT}/${file}`, 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const FILES = ['_insights/Insights.tsx', '_insights/DrillBars.tsx', '_insights/Trend.tsx', '_insights/AiSheets.tsx', '_insights/SuggestionRows.tsx', '_AiPriorities.tsx', '_ReportsView.tsx'];

test('the Reports tab keeps its export, and the page that imports it is untouched', () => {
  assert.match(code(read('_ReportsView.tsx')), /export function ReportsView\(\)/);
  assert.match(code(read('page.tsx')), /import \{ ReportsView \} from '\.\/_ReportsView';/);
  assert.match(code(read('page.tsx')), /\{tab === 'reports' && <ReportsView \/>\}/);
  assert.match(code(read('_AiPriorities.tsx')), /export function AiPriorities\(\)/, 'the register mounts this one');
});

test('the tab counts the tasks the register loads and every number opens All tasks on an address the register reads', () => {
  const tab = code(read('_insights/Insights.tsx'));
  assert.match(tab, /useLeanTasks\(\)/);
  assert.match(tab, /useAddressState\(INSIGHTS_SCHEMA\)/, 'the switch is in the address: ?documents=off');
  assert.match(tab, /linksOf\(counted, includeDocuments\)/);
  assert.match(tab, /insightsOf\(counted, now\)/);
  assert.match(tab, /Include document requests/);
  for (const link of ['links.all', 'links.overdue', 'links.done', 'links.active', 'links.status', 'links.priority', 'links.source', 'links.category', 'links.owner', 'links.oldest']) assert.ok(tab.includes(link), link);
  assert.doesNotMatch(tab, /reportsSummary|criticalTasksApi/, 'no request of its own: the register\'s one load');
  assert.match(tab, /Only part of the tasks is loaded/, 'a load cut at the ceiling is said');
  assert.match(tab, /Couldn't load the task reports/);
  assert.match(tab, /onRetry=\{canRetry\(q\.error\)/);
});

test('every AI answer opens in the kit\'s sheet and says what the AI read', () => {
  const sheets = code(read('_insights/AiSheets.tsx'));
  const prio = code(read('_AiPriorities.tsx'));
  assert.match(sheets, /<Sheet /);
  assert.match(sheets, /Written by AI/);
  assert.doesNotMatch(sheets + prio, /AnimatedModal/, 'no dialog over the page: a sheet beside it');
  assert.match(sheets, /aiReach\('predict'/);
  assert.match(sheets, /aiReach\('balance'/);
  assert.match(prio, /aiReach\('prioritize'/);
  for (const text of [sheets, prio]) {
    assert.match(text, /<AiShell/);
    assert.match(text, /onRetry=/, 'a failed answer has Retry');
  }
  assert.match(sheets, /Reassign \$\{taskCount\(todo\.length\)\}\?/, 'reassigning every suggestion asks first, as it always did');
});

test('a suggestion is applied one row at a time or all at once, through useReportedMutation, and each row says what happened', () => {
  const rows = code(read('_insights/SuggestionRows.tsx'));
  assert.match(rows, /useReportedMutation/);
  assert.match(rows, /Applied/);
  assert.match(rows, /Not applied:/);
  assert.match(rows, /if \(items\.length > 0 && Object\.keys\(result\)\.every/, 'when nothing could be written the failure is the mutation\'s, with the server\'s words and Retry');
  assert.doesNotMatch(rows, /useMutation\b/);
});

test('nothing shows an id or an internal word: tasks are named by title, links are words', () => {
  for (const f of FILES) {
    const src = code(read(f));
    assert.doesNotMatch(src, />\s*#\{|Task #|#\$\{|`#/, `${f}: an id on screen`);
    assert.doesNotMatch(src, /\bUUID\b|\bhash\b|Python|stack trace|model_used/i, `${f}: an internal word`);
    assert.doesNotMatch(src, /localStorage|sessionStorage/, `${f}: state that matters is in the address or on the server`);
  }
});

test('the drill rows are one link each with a name that says where it goes, and a row with no address is text, not a dead link', () => {
  const bars = code(read('_insights/DrillBars.tsx'));
  assert.match(bars, /Open them in All tasks/);
  assert.match(bars, /r\.href\s*\?/);
  assert.match(bars, /aria-expanded=\{all\}/, 'Show all says whether it is open');
});

test('the trend says its year and keeps its numbers in a table', () => {
  const trend = code(read('_insights/Trend.tsx'));
  assert.match(trend, /m\.short === 'Jan'/);
  assert.match(trend, /<caption className="sr-only">Tasks created and completed in each of the last 12 months<\/caption>/);
});
