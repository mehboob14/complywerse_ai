// node --test "src/app/(dashboard)/governance/exceptions/exceptionsPage.test.ts"
// What the Exceptions page promises and a screenshot cannot hold for long (source-text tests, like settingsPage.test.ts): it is on the design-system
// kit, every write is reported by useReportedMutation and goes to the same endpoint it always did, a failed request is never replaced by another table's
// rows, the permission gates and the server's flags are still what decides, a reason is still required to reject, and AI still runs only when asked.
// Since approval rules (Governance > Settings > Exception approvals): what the page adds for an exception under a rule, and that one without is untouched.
// Since D62: the page is called Exceptions, has three views kept in the address (List, By unit, By document), a Unit and a Document column with filters,
// a document picker for every kind of document, a form without the two long risk and control boxes, and the owner's AI helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';
import { routeFor } from '../../../../lib/navRegistry.ts';
import { NARROW_HIDDEN } from './_logic.ts';

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir).filter((f) => /\.tsx$/.test(f));                       // page.tsx and the _Pieces.tsx it is made of
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8');
const src = Object.fromEntries(files.map((f) => [f, read(f)])) as Record<string, string>;
const all = files.map((f) => src[f]).join('\n');
const page = src['page.tsx'];
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

test('the page is made of the files this test knows about', () => {
  assert.deepEqual(files.sort(), [
    '_ApprovalPanel.tsx', '_ColumnsMenu.tsx', '_Decision.tsx', '_DocumentPicker.tsx', '_DocumentTree.tsx', '_ExceptionDetails.tsx', '_ExceptionForm.tsx', '_Suggest.tsx', '_Summary.tsx',
    '_UnitTree.tsx', '_assistOwner.tsx', '_chips.tsx', 'page.tsx',
  ]);
});

test('the head is the kit\'s PageHeader with the registry\'s name for the page, and nothing of the legacy scope or head is left', () => {
  assert.match(page, /<PageHeader\s+variant="page"\s+title="Exceptions"/);
  assert.equal(routeFor('/governance/exceptions')?.label, 'Exceptions');
  assert.doesNotMatch(all, /DocPageHeader|docUi|PageLoader|governance-light|DataTable|RowActionsMenu/);
});

test('"Policy exceptions" is "Exceptions" on the page (labels only): the title, the table\'s name, the file the CSV downloads as; the route and the rights keep theirs', () => {
  assert.match(page, /caption="Exceptions"/);
  assert.match(page, /downloadCsv\('exceptions'/);
  for (const f of files) assert.doesNotMatch(src[f], /title="Policy exceptions"|caption="Policy exceptions"|label="Policy exceptions"|'Policy exceptions'|>Policy exceptions</, f);
  assert.match(page, /hasPermission\('governance:policy_exceptions:create'\)/);                // the permission key is not a label
  assert.match(page, /policyExceptionApi\.getAll\(/);                                          // nor is the API path
});

test('no file of the page uses a class the platform CSS rewrites, a hex colour, or a bare form control (kit rules)', () => {
  for (const f of files) {
    assert.deepEqual(findViolations(src[f]), [], f);
    assert.doesNotMatch(src[f], /#[0-9a-fA-F]{6}\b/, `${f}: colours are the --ds tokens and the status tones`);
    assert.doesNotMatch(src[f], /<(select|textarea|input)\b/, `${f}: the kit's Select, Textarea, TextInput and Checkbox`);
  }
  // the only bare buttons: the clear-search cross, the +N of the linked assets (both small, kit-ringed), the presses of the two trees (a unit, a count, an exception,
  // a folder) and a document in the picker's list; everything else is Button, IconButton or Menu
  assert.equal(count(page, /<button\b/g), 1);
  assert.equal(count(src['_ExceptionDetails.tsx'], /<button\b/g), 1);
  assert.equal(count(src['_UnitTree.tsx'], /<button\b/g), 2);
  assert.equal(count(src['_DocumentTree.tsx'], /<button\b/g), 2);
  assert.equal(count(src['_DocumentPicker.tsx'], /<button\b/g), 1);
});

test('no native dialog: confirm(), alert() and prompt() are gone, and delete asks with the kit dialog', () => {
  assert.doesNotMatch(all, /window\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt)\(|(?<!await )(?<![.\w])confirm\(/);       // (the kit's `await confirm({...})` is the question box)
  assert.match(page, /useConfirm\(\)/);
  assert.match(page, /confirm\(\{ title: 'Delete this exception\?'[^}]*tone: 'danger'/);
});

test('all the writes are reported by useReportedMutation: nothing is a bare useMutation any more', () => {
  assert.doesNotMatch(all, /\buseMutation\(/);
  // the hooks of the files the page itself is made of: submit, delete, withdraw | create, update | the owner's three AI helpers (the details and the decision have theirs)
  assert.equal(count(page, /useReportedMutation\(\{/g), 3);
  assert.equal(count(src['_ExceptionForm.tsx'], /useReportedMutation\(\{/g), 2);
  assert.equal(count(src['_assistOwner.tsx'], /useReportedMutation\(\{/g), 3);
  for (const call of ['create', 'update', 'submit', 'approve', 'requestChanges', 'reject', 'revoke', 'withdraw', 'delete', 'addComment', 'promoteToRisk', 'aiDraft', 'aiSchedule', 'aiAssets']) {
    assert.match(all, new RegExp(`policyExceptionApi\\.${call}\\(`), call);
  }
  assert.match(all, /failure: /);
  assert.doesNotMatch(all, /\btoast\(/);                                                // no hand-made toast: useReportedMutation and useNotify say it
});

test('a create is never offered a Retry (a second try could make a second exception); the others are', () => {
  assert.match(src['_ExceptionForm.tsx'], /failure: 'Not created',\s*retryable: false/);
  assert.equal(count(all, /retryable: false/g), 1);
});

test('the same endpoints and query keys as before, and a failed request is never replaced by another table\'s rows', () => {
  for (const key of ["['policy-exceptions', 'list', statusFilter, priorityFilter, unitFilter, docTypeFilter]", "['policy-exceptions-analytics']", "['governance-documents-list']", "['assets-for-exception-link']", "['exception-comments', e.id]"]) {
    assert.ok(all.includes(`queryKey: ${key}`) || all.includes(`commentsKey = ${key}`), key);
  }
  for (const call of ['getAll(listParams(filters))', 'getAnalytics()', 'getComments(e.id)', 'suggestCandidates(params)', 'getByUnit()', 'getByDocument()']) assert.ok(all.includes(`policyExceptionApi.${call}`), call);
  assert.match(all, /governanceApi\.getDocuments\(\{ limit: 500 \}\)/);
  assert.match(all, /assetsApi\.getAll\(\{ limit: 500 \}\)/);
  assert.doesNotMatch(all, /governanceApi\.getExceptions|documentsApi|getTrend|metric-trend/);          // the Control-exceptions and legacy-documents fallbacks, and the trend nothing drew
  const keys = readFileSync(new URL('./_types.ts', dir), 'utf8');
  assert.match(keys, /\[\['policy-exceptions'\], \['policy-exceptions-summary'\], \['policy-exceptions-analytics'\]\]/);       // what a change refreshes: as it was, and now the analytics too
  assert.match(src['_ExceptionDetails.tsx'], /invalidate: \[\['policy-exceptions'\]\]/);                                         // promoting refreshed the list only, as before
});

test('the list asks for no limit and sends only the filters that are set, so the page reads the true total from the analytics', () => {
  assert.match(page, /policyExceptionApi\.getAll\(listParams\(filters\)\)/);
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

test('AI runs only when asked: nothing in the Suggest dialog, the form or the owner\'s helpers fetches on open, and the dialog is only mounted when asked for', () => {
  assert.doesNotMatch(src['_Suggest.tsx'], /useEffect|useQuery/);
  assert.doesNotMatch(src['_ExceptionForm.tsx'], /useEffect/);
  assert.doesNotMatch(src['_assistOwner.tsx'], /useEffect|useQuery/);
  assert.match(src['_Suggest.tsx'], /if \(target === ''\) return;/);
  assert.match(page, /\{suggesting && <SuggestDialog/);
  const assist = src['_assistOwner.tsx'];
  for (const call of ['draft.mutate(basis)', 'ask.mutate(basis)']) assert.match(assist, new RegExp(`onClick=\\{\\(\\) => ${call.replace(/[().]/g, '\\$&')}\\}`), call);       // only a press asks
  assert.equal(count(assist, /\.mutate\(/g), 3);
});

test('both drawers ask before they discard typed input', () => {
  assert.match(src['_ExceptionForm.tsx'], /dirty=\{!sameForm\(form, initial\)\}/);
  assert.match(src['_Decision.tsx'], /dirty=\{text\.trim\(\) !== ''\}/);
});

test('dates go through the helpers that keep a day a day, and nothing formats one by hand', () => {
  assert.doesNotMatch(all, /toLocale(Date|Time)?String|new Date\(|toISOString|Intl\.DateTimeFormat/);
  assert.match(page, /dayText\(e\.expiry_date\)/);
  assert.match(page, /momentDay\(e\.created_at\)/);
  assert.match(src['_DocumentTree.tsx'], /dayText\(e\.expiry_date\)/);
});

test('the summary cards read the analytics, never the loaded rows, and each chart is also said in words', () => {
  const s = src['_Summary.tsx'];
  assert.match(s, /statusSlices\(a\.by_status\)/);
  assert.match(s, /agingBars\(a\.aging_buckets\)/);
  assert.equal(count(s, /role="img" aria-label=\{chartAlt\(/g), 2);
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

test('"Waiting for me" is the server\'s list (never cut), shown only when something waits, narrowed by the filters, and cleared with the others; a row says Decide or Implement', () => {
  assert.match(page, /queryKey: \['policy-exceptions', 'waiting-for-me'\]/);              // it starts with 'policy-exceptions': every change that refreshes the list refreshes it
  assert.match(page, /policyExceptionApi\.waitingForMe\(\)/);
  assert.match(page, /waitingOnly \? waitingRows\(waiting\.data \?\? \[\], filters\) : list\.data \?\? \[\]/);
  assert.match(page, /\(waiting\.data\?\.length \|\| waitingOnly\)/);                      // an organisation with no rules never sees it
  assert.match(page, /<SegmentedControl label="Show"/);
  assert.match(page, /waiting\.data\?\.length \?\? 0/);                                    // the count on the tab is everything that waits: to decide and to implement
  assert.match(page, /waiting: false/);                                                  // Clear filters clears it with the others
  assert.match(page, /const firstUse = loaded\.length === 0 && !anyFilter;/);             // none waiting is not "no exceptions yet"
  assert.match(page, /<WaitingChip kind=\{e\.waiting_kind\} \/>/);
  assert.match(src['_DocumentTree.tsx'], /<WaitingChip kind=\{e\.waiting_kind\} \/>/);
});

test('an alert\'s link opens the exception it names, fetched by its id when its row is not loaded, and an id that cannot be had says the server\'s sentence', () => {
  assert.match(page, /openIdOf\(useSearchParams\(\)\?\.toString\(\)\)/);
  assert.match(page, /window\.history\.replaceState\(null, '', window\.location\.pathname \+ withoutOpen\(window\.location\.search\) \+ window\.location\.hash\)/);
  assert.match(page, /policyExceptionApi\.getById\(shownId as number\)/);
  assert.match(page, /enabled: shownId !== null,\s*initialData: viewing \?\? undefined/);
  assert.match(page, /const linkFailed = wanted !== null && viewing === null && shown === null && one\.isError/);
  assert.match(page, /title="Couldn't open that exception"/);                              // never the number of the exception (UX rule U1)
  assert.doesNotMatch(page, /\$\{wanted\}/);
  assert.match(page, /\{errorMessage\(one\.error\)\}/);                                    // the server's own sentence, never a blank screen
  assert.match(page, /<Notice tone="danger"/);
  assert.match(page, /onClose=\{closeDetails\}/);
});

test('the form has a Unit that is optional, says it defaults to the document\'s, and is locked with the priority and the document while it waits under a rule', () => {
  const f = src['_ExceptionForm.tsx'];
  assert.match(f, /<FormField label="Unit" optional info="Defaults to the document's unit\./);
  assert.match(f, /<DepartmentSelect label="Unit"/);
  assert.match(f, /placeholder=\{unitHint\}/);                                           // and says which unit it will follow
  assert.match(f, /const locked = exception !== null && isRuled\(exception\)/);
  assert.equal(count(f, /disabled=\{locked\}/g), 3);                                      // the document, the unit, the priority
  assert.match(f, /<Notice>Priority, unit, type and document are locked while it waits for approval\./);
  assert.match(f, /\{!locked && <PeriodAssist/);                                          // Suggest period writes the priority, which is locked
});

test('the form has a Type from the organisation\'s list: optional, the one the exception holds stays choosable after it is removed, locked while it waits under a rule', () => {
  const f = src['_ExceptionForm.tsx'];
  assert.match(f, /<FormField label="Type" optional info="What kind of exception it is\./);
  assert.match(f, /queryKey: TYPES_KEY, queryFn: async \(\) => \(await exceptionRulesApi\.types\(\)\)\.data/);
  assert.match(f, /typeChoices\(types\.data\?\.types \?\? \[\], form\.exception_type \? \[form\.exception_type\] : \[\]\)/);
  assert.match(f, /disabled=\{locked \|\| \(types\.isError && !form\.exception_type\)\}/);
  assert.match(f, /typeChoiceLabel\(t\)/);
  assert.match(src['_ExceptionDetails.tsx'], /<Fact label="Type">\{e\.exception_type_label \|\| e\.exception_type \|\| <Muted>\{NOT_SET\}<\/Muted>\}<\/Fact>/);
  assert.match(page, /key: 'type', header: 'Type', priority: 3, sortable: true/);
  assert.match(page, /TOGGLEABLE = \['document', 'unit', 'status', 'priority', 'type', 'requester', 'created', 'expiry'\]/);
  for (const id of NARROW_HIDDEN) assert.match(page, new RegExp(`key: '${id}'`), id);          // the columns a narrow window leaves out are columns of the table
  assert.match(page, /const hiddenCols = hiddenColumns\(pickedCols, useAtLeast\(WIDE_WINDOW\)\);/);
  assert.match(page, /setPickedCols\(toggleHidden\(hiddenCols, key\)\)/);                       // the first tick in the menu is the person's own choice from then on
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

// ── D62: the views, the columns, the filters ─────────────────────────────────────────────────────────────────────────────

test('the view is a switch of List | By unit | By document that lives in the address, and each tree is asked for only when it is shown', () => {
  assert.match(page, /useAddressState\(ADDRESS\)/);
  assert.match(page, /<SegmentedControl label="View" name="exceptions-view" value=\{view\} options=\{VIEW_OPTIONS\} onChange=\{\(v\) => setAddress\(\{ view: v \}, \{ push: true \}\)\} \/>/);
  assert.match(page, /queryKey: BY_UNIT_KEY,[\s\S]*?policyExceptionApi\.getByUnit\(\)[\s\S]*?enabled: view === 'unit'/);
  assert.match(page, /queryKey: BY_DOCUMENT_KEY,[\s\S]*?policyExceptionApi\.getByDocument\(\)[\s\S]*?enabled: view === 'document'/);
  assert.match(page, /enabled: view === 'list',\s*placeholderData: keepPreviousData/);          // the list is not asked for while a tree is shown
  assert.match(page, /\{view === 'unit' && <UnitTree query=\{byUnit\} onOpen=\{openUnit\} \/>\}/);
  assert.match(page, /\{view === 'document' && <DocumentTree query=\{byDocument\} onOpen=\{openById\} \/>\}/);
  assert.match(page, /\{inList && \(\s*<>\s*<TextInput/);                                     // the search, the filters, the Columns and the CSV belong to the list
});

test('a press on a unit shows the list of that unit and everything under it, and a press on an exception of By document opens it as an alert\'s link does', () => {
  assert.match(page, /setAddress\(\{ view: 'list', unit: String\(id\),[^}]*\}, \{ push: true \}\)/);
  assert.match(page, /const openById = \(id: number\) => \{ setViewing\(null\); setWanted\(id\); \};/);
  assert.match(page, /focusResults\.current = true;/);                                    // the tree it came from is gone: focus goes to the list
  assert.match(page, /tabIndex=\{-1\}/);
  assert.match(src['_UnitTree.tsx'], /onClick=\{\(\) => onOpen\(unit\.department_id\)\}/);
  assert.match(src['_DocumentTree.tsx'], /onClick=\{\(\) => onOpen\(e\.id\)\}/);
  assert.match(src['_UnitTree.tsx'], /answer\.no_unit\.counts\.total > 0/);                 // the exceptions of no unit have a row, and it is not a press
  assert.match(src['_UnitTree.tsx'], /answer\.totals\.total > 0/);                           // and the table ends with the totals
});

test('the list has a Unit and a Document column, in the Columns menu and in the CSV, and a Unit and a Document type filter that are in the address and go to the server', () => {
  assert.match(page, /key: 'document', header: 'Document', priority: 3, sortable: true/);
  assert.match(page, /key: 'unit', header: 'Unit', priority: 3, sortable: true/);
  assert.match(page, /<DepartmentSelect label="Unit" value=\{unitFilter\} onChange=\{\(v\) => setAddress\(\{ unit: v \}\)\} first=\{\{ label: 'All units' \}\} keep=\{unitFilter \? \[Number\(unitFilter\)\] : \[\]\} \/>/);
  assert.match(page, /<Select aria-label="Document type" placeholder="All document types" value=\{docTypeFilter\}/);
  assert.match(page, /DOC_TYPES\.map\(/);
  assert.match(page, /unitChipText\(unitName\)/);                                          // the removable chip: "Unit: Support and below"
  assert.match(page, /onClick=\{\(\) => setAddress\(\{ unit: '' \}\)\}/);
  assert.match(page, /columns\.filter\(\(c\) => c\.key in DATA_COLS && !\(pickedCols \?\? \[\]\)\.includes\(c\.key\)\)/);        // the CSV is the columns the person did not switch off (a narrow window does not shorten the file), and the new ones carry data
  assert.match(page, /function DocumentCell/);
  assert.match(page, /function UnitCell/);
  assert.match(page, /From the document/);                                                // the unit says when it is its document's
});

test('a document the person may not open is named so and never numbered, anywhere on the page', () => {
  assert.doesNotMatch(all, /Policy #|Document #|Doc #|Exception #/);                          // no "#12"
  assert.doesNotMatch(all, />\s*\{[^}]*\bdocument_id\b[^}]*\}\s*</);                          // and no number drawn as a text (a React key is not text)
  assert.match(page, /documentOf\(e\)/);
  assert.match(src['_DocumentTree.tsx'], /documentGroupName\(doc\)/);                          // by its title, else "A document you cannot open" or "No document" (_logic.ts)
  assert.match(src['_DocumentPicker.tsx'], /HIDDEN_DOCUMENT/);
});

// ── D62: the form ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the form has no boxes for the potential risks and the compensating controls and never sends them; it has a business impact', () => {
  const f = src['_ExceptionForm.tsx'];
  assert.doesNotMatch(f, /Potential risks|Compensating controls|risk_assessment|compensating_controls/);
  assert.match(f, /<FormField label="Business impact" optional info=/);
  assert.match(f, /set\(\{ business_impact: e\.target\.value \}\)/);
  assert.doesNotMatch(f, /suggestContent/);                                                // the older helper that also filled the two long boxes is not used by the form
  assert.match(f, /payloadOf\(form, true\)/);
  assert.match(f, /payloadOf\(form, false\)/);
});

test('the document picker offers every kind of document: a Type filter, a chip on each result, the server\'s search once words are typed, and a list while none are', () => {
  const p = src['_DocumentPicker.tsx'];
  assert.match(p, /<Select aria-label="Document type" placeholder="All types"/);
  assert.match(p, /DOC_TYPES\.map\(/);
  assert.match(p, /policyExceptionApi\.searchPolicies\(term, PICKER_LIMIT, type \|\| undefined\)/);
  assert.match(p, /enabled: term !== '',/);                                                // nothing is asked of the server until words are typed
  assert.match(p, /browseDocuments\(documents\.data \?\? \[\], type\)/);
  assert.match(p, /uniqueDocuments\(/);
  assert.match(p, /<TypeChip type=\{row\.type\} \/>/);
  assert.doesNotMatch(src['page.tsx'], /doc_type \|\| ''\)\.toLowerCase\(\) === 'policy'/);    // exceptions are no longer raised against policies only
  assert.match(page, /itemsOf<DocumentOption>\(\(await governanceApi\.getDocuments\(\{ limit: 500 \}\)\)\.data\)\s*,/);
});

test('the owner\'s AI helpers draft, never save: the server\'s own sentence is what a failure says, and nothing is invented when AI is not there', () => {
  const a = src['_assistOwner.tsx'];
  for (const [call, failure] of [['aiDraft', "Couldn't draft the details"], ['aiSchedule', "Couldn't suggest a period"], ['aiAssets', "Couldn't suggest assets"]]) {
    assert.match(a, new RegExp(`policyExceptionApi\\.${call}\\(`), call);
    assert.ok(a.includes(`failure: "${failure}"`), failure);
  }
  assert.doesNotMatch(a, /fallback:|template|catch \(|policyExceptionApi\.(create|update)\(/);        // no made-up text, and nothing is saved by a helper
  assert.match(a, /draftPatch\(prev, answer\)/);                                          // AI Assist keeps what the person wrote
  assert.match(a, /schedulePatch\(answer\)/);
  assert.match(a, /stillSuggested\(form, suggestion\)/);                                  // the reason stays under the dates only while they are the suggested ones
  assert.match(a, /aria-label=\{`Add \$\{a\.name\}`\}/);                                   // a suggested asset is added only by its own Add
  assert.match(a, /toast: 'errors'/);                                                     // the suggestions under the button are their own confirmation
});
