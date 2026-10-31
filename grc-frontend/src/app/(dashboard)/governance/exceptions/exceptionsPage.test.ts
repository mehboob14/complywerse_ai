// node --test "src/app/(dashboard)/governance/exceptions/exceptionsPage.test.ts"
// What the Policy exceptions page promises and a screenshot cannot hold for long (source-text tests, like settingsPage.test.ts): it is on the design-system
// kit, every write is reported by useReportedMutation and goes to the same endpoint it always did, a failed request is never replaced by another table's
// rows, the permission gates and the server's flags are still what decides, a reason is still required to reject, and AI still runs only when asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';
import { routeFor } from '../../../../lib/navRegistry.ts';

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir).filter((f) => /\.tsx$/.test(f));                       // page.tsx and the _Pieces.tsx it is made of
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8');
const src = Object.fromEntries(files.map((f) => [f, read(f)])) as Record<string, string>;
const all = files.map((f) => src[f]).join('\n');
const page = src['page.tsx'];

test('the page is made of the files this test knows about', () => {
  assert.deepEqual(files.sort(), ['_ColumnsMenu.tsx', '_Decision.tsx', '_ExceptionDetails.tsx', '_ExceptionForm.tsx', '_Suggest.tsx', '_Summary.tsx', 'page.tsx']);
});

test('the head is the kit\'s PageHeader with the registry\'s name for the page, and nothing of the legacy scope or head is left', () => {
  assert.match(page, /<PageHeader\s+variant="page"\s+title="Policy exceptions"/);
  assert.equal(routeFor('/governance/exceptions')?.label, 'Policy exceptions');
  assert.doesNotMatch(all, /DocPageHeader|docUi|PageLoader|governance-light|DataTable|RowActionsMenu/);
});

test('no file of the page uses a class the platform CSS rewrites, a hex colour, or a bare form control (kit rules)', () => {
  for (const f of files) {
    assert.deepEqual(findViolations(src[f]), [], f);
    assert.doesNotMatch(src[f], /#[0-9a-fA-F]{6}\b/, `${f}: colours are the --ds tokens and the status tones`);
    assert.doesNotMatch(src[f], /<(select|textarea|input)\b/, `${f}: the kit's Select, Textarea, TextInput and Checkbox`);
  }
  // the only bare buttons: the clear-search cross, the +N of the linked assets (both small, kit-ringed): everything else is Button, IconButton or Menu
  assert.equal((page.match(/<button\b/g) ?? []).length, 1);
  assert.equal((src['_ExceptionDetails.tsx'].match(/<button\b/g) ?? []).length, 1);
});

test('no native dialog: confirm(), alert() and prompt() are gone, and delete asks with the kit dialog', () => {
  assert.doesNotMatch(all, /window\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt)\(|(?<!await )(?<![.\w])confirm\(/);       // (the kit's `await confirm({...})` is the question box)
  assert.match(page, /useConfirm\(\)/);
  assert.match(page, /confirm\(\{ title: 'Delete this exception\?'[^}]*tone: 'danger'/);
});

test('all ten writes are reported by useReportedMutation: nothing is a bare useMutation any more', () => {
  assert.doesNotMatch(all, /\buseMutation\(/);
  const hooks = (all.match(/useReportedMutation\(\{/g) ?? []).length;
  assert.equal(hooks, 8);                                                               // submit, delete | create, update, draft | comment, promote | one decision hook for approve, reject, revoke
  for (const call of ['create', 'update', 'submit', 'approve', 'reject', 'revoke', 'delete', 'addComment', 'promoteToRisk', 'suggestContent']) {
    assert.match(all, new RegExp(`policyExceptionApi\\.${call}\\(`), call);
  }
  assert.match(all, /failure: /);
  assert.doesNotMatch(all, /\btoast\(/);                                                // no hand-made toast: useReportedMutation and useNotify say it
});

test('a create is never offered a Retry (a second try could make a second exception); the others are', () => {
  assert.match(src['_ExceptionForm.tsx'], /failure: 'Not created',\s*retryable: false/);
  assert.equal((all.match(/retryable: false/g) ?? []).length, 1);
});

test('the same endpoints and query keys as before, and a failed request is never replaced by another table\'s rows', () => {
  for (const key of ["['policy-exceptions', statusFilter, priorityFilter]", "['policy-exceptions-analytics']", "['governance-documents-list']", "['assets-for-exception-link']", "['exception-comments', e.id]"]) {
    assert.ok(all.includes(`queryKey: ${key}`) || all.includes(`commentsKey = ${key}`), key);
  }
  for (const call of ['getAll(params)', 'getAnalytics()', 'getComments(e.id)', 'suggestCandidates(params)']) assert.ok(all.includes(`policyExceptionApi.${call}`), call);
  assert.match(all, /governanceApi\.getDocuments\(\{ limit: 500 \}\)/);
  assert.match(all, /assetsApi\.getAll\(\{ limit: 500 \}\)/);
  assert.doesNotMatch(all, /governanceApi\.getExceptions|documentsApi|getTrend|metric-trend/);          // the Control-exceptions and legacy-documents fallbacks, and the trend nothing drew
  const keys = readFileSync(new URL('./_types.ts', dir), 'utf8');
  assert.match(keys, /\[\['policy-exceptions'\], \['policy-exceptions-summary'\], \['policy-exceptions-analytics'\]\]/);       // what a change refreshes: as it was, and now the analytics too
  assert.match(src['_ExceptionDetails.tsx'], /invalidate: \[\['policy-exceptions'\]\]/);                                         // promoting refreshed the list only, as before
});

test('the list asks for no limit and sends only status and priority, so the page reads the true total from the analytics', () => {
  assert.match(page, /if \(statusFilter\) params\.status = statusFilter;\s*if \(priorityFilter\) params\.priority = priorityFilter;/);
  assert.doesNotMatch(page, /params\.(limit|skip|offset)/);
  assert.match(page, /serverList\(loaded\.length, settled\.current, analytics\.data\)/);
  assert.match(page, /cutNotice\(/);
});

test('what a person may do is still the permission gate and the server\'s flags: create gated, the rest by rowActionKeys, never more', () => {
  assert.match(page, /hasPermission\('governance:policy_exceptions:create'\)/);
  assert.match(page, /rowActionKeys\(e\)/);
  assert.match(page, /hidden: !allowed\.includes\(i\.key\)/);
  assert.doesNotMatch(page, /hasPermission\('governance:policy_exceptions:(approve|edit|delete)'\)/);   // the server decides (can_decide, can_edit, can_delete), as it did
});

test('a reason is still required to reject, optional to approve or revoke; the server\'s refusal is shown, not swallowed', () => {
  const d = src['_Decision.tsx'];
  assert.match(d, /reject: \{[^}]*required: true/);
  assert.match(d, /approve: \{[^}]*required: false/);
  assert.match(d, /revoke: \{[^}]*required: false/);
  assert.match(d, /disabled=\{missing\}/);
  assert.match(d, /rejection_reason: text/);
  assert.match(d, /text \? \{ comments: text \} : undefined/);                          // what was sent is what was sent
  assert.match(d, /text \? \{ reason: text \} : undefined/);
});

test('AI runs only when asked: nothing in the Suggest dialog or the form fetches on open, and the dialog is only mounted when asked for', () => {
  assert.doesNotMatch(src['_Suggest.tsx'], /useEffect|useQuery/);
  assert.doesNotMatch(src['_ExceptionForm.tsx'], /useEffect/);
  assert.match(src['_Suggest.tsx'], /if \(target === ''\) return;/);
  assert.match(page, /\{suggesting && <SuggestDialog/);
});

test('both drawers ask before they discard typed input', () => {
  assert.match(src['_ExceptionForm.tsx'], /dirty=\{!sameForm\(form, initial\)\}/);
  assert.match(src['_Decision.tsx'], /dirty=\{text\.trim\(\) !== ''\}/);
});

test('dates go through the helpers that keep a day a day, and nothing formats one by hand', () => {
  assert.doesNotMatch(all, /toLocale(Date|Time)?String|new Date\(|toISOString|Intl\.DateTimeFormat/);
  assert.match(page, /dayText\(e\.expiry_date\)/);
  assert.match(page, /momentDay\(e\.created_at\)/);
});

test('the summary cards read the analytics, never the loaded rows, and each chart is also said in words', () => {
  const s = src['_Summary.tsx'];
  assert.match(s, /statusSlices\(a\.by_status\)/);
  assert.match(s, /agingBars\(a\.aging_buckets\)/);
  assert.equal((s.match(/role="img" aria-label=\{chartAlt\(/g) ?? []).length, 2);
  assert.doesNotMatch(s, /fontSize: 1[01]\b|fontSize: [0-9]\b/);                          // labels are at least 12px
});
