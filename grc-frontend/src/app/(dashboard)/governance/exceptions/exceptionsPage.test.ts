// node --test "src/app/(dashboard)/governance/exceptions/exceptionsPage.test.ts"
// What the Policy exceptions page promises and a screenshot cannot hold for long (source-text tests, like settingsPage.test.ts): it is on the design-system
// kit, every write is reported by useReportedMutation and goes to the same endpoint it always did, a failed request is never replaced by another table's
// rows, the permission gates and the server's flags are still what decides, a reason is still required to reject, and AI still runs only when asked.
// Since approval rules (Governance > Settings > Exception approvals): what the page adds for an exception under a rule, and that one without is untouched.
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
  assert.deepEqual(files.sort(), ['_ApprovalPanel.tsx', '_ColumnsMenu.tsx', '_Decision.tsx', '_ExceptionDetails.tsx', '_ExceptionForm.tsx', '_Suggest.tsx', '_Summary.tsx', 'page.tsx']);
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

test('all the writes are reported by useReportedMutation: nothing is a bare useMutation any more', () => {
  assert.doesNotMatch(all, /\buseMutation\(/);
  const hooks = (all.match(/useReportedMutation\(\{/g) ?? []).length;
  assert.equal(hooks, 9);                                                               // submit, delete, withdraw | create, update, draft | comment, promote | one decision hook for approve, ask for changes, reject, revoke
  for (const call of ['create', 'update', 'submit', 'approve', 'requestChanges', 'reject', 'revoke', 'withdraw', 'delete', 'addComment', 'promoteToRisk', 'suggestContent']) {
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

// ── an exception under an approval rule ────────────────────────────────────────────────────────────────────────────────────

test('what a row and the details offer under a rule is the server\'s: rowActionKeys for the menu, my_step for the buttons, can_withdraw for Withdraw', () => {
  assert.match(page, /\{ key: 'changes', label: 'Ask for changes'[^}]*setDeciding\(\{ kind: 'changes'/);
  assert.match(page, /\{ key: 'withdraw', label: 'Withdraw'/);
  const panel = src['_ApprovalPanel.tsx'];
  assert.match(panel, /decisionOptions\(a\.my_step\)/);
  assert.match(panel, /live && e\.can_decide \? decisionOptions/);
  for (const option of ['approve', 'changes', 'reject']) assert.match(panel, new RegExp(`options\\.includes\\('${option}'\\)`), option);
  assert.match(panel, /live && e\.can_withdraw/);
  assert.doesNotMatch(panel, /hasPermission|usePermissions/);                           // the server says who may; the panel never guesses from a role
});

test('Withdraw asks first, goes to the server\'s withdraw and refreshes what a change refreshes; the decision dialog for asking for changes needs its comment', () => {
  assert.match(page, /confirm\(\{ title: 'Withdraw this exception\?'/);
  assert.match(page, /mutationFn: \(e: ExceptionItem\) => policyExceptionApi\.withdraw\(e\.id\),[\s\S]*?invalidate: \[\.\.\.LIST_KEYS, \['exception-comments'\]\]/);
  const d = src['_Decision.tsx'];
  assert.match(d, /changes: \{[^}]*required: true/);
  assert.match(d, /invalidate: \[\.\.\.LIST_KEYS, \['exception-comments'\]\]/);                  // the open details show the line a decision adds to the comments
  assert.match(d, /policyExceptionApi\.requestChanges\(id, \{ comment: text \}\)/);
  assert.match(d, /reject: \{[^}]*required: true/);
});

test('a refusal to submit stays a toast, and is said in full under the header when the server\'s sentence is longer than a toast keeps; the exception stays a draft', () => {
  assert.match(page, /failure: 'Not submitted',[\s\S]*?onSuccess: \(\) => setRefusal\(null\),\s*onError: \(error\) => setRefusal\(longRefusal\(error\)\)/);
  assert.match(page, /\{refusal && <Notice tone="danger" title="Not submitted"/);
});

test('the status says the step and who it waits for from the server\'s approval, never from the loaded rows', () => {
  assert.match(page, /function StatusCell/);
  assert.match(page, /statusDetail\(e\)/);
  assert.match(page, /cell: \(e\) => <StatusCell exception=\{e\} \/>/);
  assert.match(src['_ApprovalPanel.tsx'], /aria-live="polite"/);                       // who it waits for is a live region: a decision is heard
});

test('"Waiting for me" is the server\'s list (never cut), shown only when something waits, narrowed by the status and priority filters, and cleared with the others', () => {
  assert.match(page, /queryKey: \['policy-exceptions', 'waiting-for-me'\]/);              // it starts with 'policy-exceptions': every change that refreshes the list refreshes it
  assert.match(page, /policyExceptionApi\.waitingForMe\(\)/);
  assert.match(page, /waitingOnly \? waitingRows\(waiting\.data \?\? \[\], filters\) : list\.data \?\? \[\]/);
  assert.match(page, /\(waiting\.data\?\.length \|\| waitingOnly\)/);                      // an organisation with no rules never sees it
  assert.match(page, /<SegmentedControl label="Show"/);
  assert.match(page, /setWaitingOnly\(false\)/);
  assert.match(page, /!priorityFilter && !waitingOnly/);                                 // none waiting is not "no exceptions yet"
});

test('an alert\'s link opens the exception it names, fetched by its id when its row is not loaded, and an id that cannot be had says the server\'s sentence', () => {
  assert.match(page, /openIdOf\(useSearchParams\(\)\?\.toString\(\)\)/);
  assert.match(page, /window\.history\.replaceState\(null, '', window\.location\.pathname \+ withoutOpen\(window\.location\.search\) \+ window\.location\.hash\)/);
  assert.match(page, /policyExceptionApi\.getById\(shownId as number\)/);
  assert.match(page, /enabled: shownId !== null,\s*initialData: viewing \?\? undefined/);
  assert.match(page, /const linkFailed = wanted !== null && viewing === null && shown === null && one\.isError/);
  assert.match(page, /Couldn't open exception \$\{wanted\}/);
  assert.match(page, /\{errorMessage\(one\.error\)\}/);                                    // the server's own sentence, never a blank screen
  assert.match(page, /<Notice tone="danger"/);
  assert.match(page, /onClose=\{closeDetails\}/);
});

test('the form has a Department that is optional, says it defaults to the policy\'s, and is locked with the priority and the policy while it waits under a rule', () => {
  const f = src['_ExceptionForm.tsx'];
  assert.match(f, /<FormField label="Department" optional info="Defaults to the policy's department\./);
  assert.match(f, /<DepartmentSelect label="Department"/);
  assert.match(f, /const locked = exception !== null && isRuled\(exception\)/);
  assert.equal((f.match(/disabled=\{locked\}/g) ?? []).length, 3);                      // the policy, the department, the priority
  assert.match(f, /<Notice>Priority, department, type and policy are locked while it waits for approval\./);
});

test('the form has a Type from the organisation\'s list: optional, the one the exception holds stays choosable after it is removed, locked while it waits under a rule', () => {
  const f = src['_ExceptionForm.tsx'];
  assert.match(f, /<FormField label="Type" optional info="What kind of exception it is\./);
  assert.match(f, /queryKey: TYPES_KEY, queryFn: async \(\) => \(await exceptionRulesApi\.types\(\)\)\.data/);
  assert.match(f, /typeChoices\(types\.data\?\.types \?\? \[\], form\.exception_type \? \[form\.exception_type\] : \[\]\)/);
  assert.match(f, /disabled=\{locked \|\| \(types\.isError && !form\.exception_type\)\}/);
  assert.match(f, /typeChoiceLabel\(t\)/);
  assert.match(src['_ExceptionDetails.tsx'], /<Fact label="Type">\{e\.exception_type_label \|\| e\.exception_type \|\| <Muted>\{NOT_SET\}<\/Muted>\}<\/Fact>/);
  assert.match(src['page.tsx'], /key: 'type', header: 'Type', priority: 3, sortable: true/);
  assert.match(src['page.tsx'], /TOGGLEABLE = \['policy', 'status', 'priority', 'type', 'requester', 'created', 'expiry'\]/);
});

test('the details show the department path (and that it comes from the policy) and draw the approval only when the server sent one', () => {
  const d = src['_ExceptionDetails.tsx'];
  assert.match(d, /<Fact label="Department">/);
  assert.match(d, /\{e\.approval && \(\s*<ApprovalPanel exception=\{e\} approval=\{e\.approval\}/);
});

test('the approval panel is on the kit: no bare form control, no named colour or size, steps and decisions are lists, earlier rounds open on request', () => {
  const panel = src['_ApprovalPanel.tsx'];
  assert.doesNotMatch(panel, /<(select|textarea|input|button)\b/);
  assert.match(panel, /<ol aria-label="Approval steps"/);
  assert.match(panel, /aria-current=\{live && s\.state === 'active' \? 'step' : undefined\}/);
  assert.match(panel, /enabled: open,/);                                                // the earlier rounds are asked of the server only when they are opened
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.doesNotMatch(panel, /new Date\(|toLocale/);
});
