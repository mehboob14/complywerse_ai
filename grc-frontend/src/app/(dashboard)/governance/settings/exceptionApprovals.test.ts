// node --test "src/app/(dashboard)/governance/settings/exceptionApprovals.test.ts"
// What Governance > Settings > Exception approvals promises and a screenshot cannot hold for long (source-text tests, like settingsPage.test.ts): the card sits
// after the Departments card on every state of the page, it is on the design-system kit, the server's `can_edit` decides who sees a control, a refusal is the
// server's sentence, a rule is asked about before it is deleted, and the tester asks only when something is picked; the last tests are the implementer (D62)
// and the words ("Document type", "exception"). (What a rule says and checks is in lib/exceptionRules.ts and tested in exceptionRules.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const FILES = ['./_ExceptionApprovalsSection.tsx', './_RuleDrawer.tsx', './_RuleTester.tsx', './_TypesDrawer.tsx'] as const;
const src = Object.fromEntries(FILES.map((f) => [f, read(f)])) as Record<(typeof FILES)[number], string>;
const section = src['./_ExceptionApprovalsSection.tsx'];
const drawer = src['./_RuleDrawer.tsx'];
const tester = src['./_RuleTester.tsx'];
const types = src['./_TypesDrawer.tsx'];
const page = read('./page.tsx');
const api = read('../../../../lib/api.ts');

test('the card follows the Departments card in the page and in the page that cannot load the lifecycle settings, with one import', () => {
  assert.equal((page.match(/import \{ ExceptionApprovalsSection \} from '\.\/_ExceptionApprovalsSection';/g) ?? []).length, 1);
  assert.equal((page.match(/<ExceptionApprovalsSection \/>/g) ?? []).length, 2);
  assert.equal((page.match(/<DepartmentsSection \/>\s*<ExceptionApprovalsSection \/>/g) ?? []).length, 2);
  assert.match(page, /function WithDepartments[\s\S]*?<ExceptionApprovalsSection \/>[\s\S]*?\{children\}/);              // errors and "approvals are not switched on" still show it
  assert.match(section, /<SectionCard\s+id="exception-approvals"\s+title="Exception approvals"/);
});

test('no file is off the design-system kit: no class the shell rewrites, no hex colour, no bare form control, no native dialog', () => {
  for (const f of FILES) {
    assert.deepEqual(findViolations(src[f]), [], f);
    assert.doesNotMatch(src[f], /#[0-9a-fA-F]{6}\b/, `${f}: colours are the --ds tokens`);
    assert.doesNotMatch(src[f], /<(select|textarea|input|button)\b/, `${f}: the kit's Select, TextInput, Checkbox, Button and IconButton`);
    assert.doesNotMatch(src[f], /window\.(confirm|alert|prompt)\(|\buseMutation\(|\btoast\(/, f);
  }
  assert.match(section, /<RegisterTable<ExceptionRule>/);
  assert.match(section, /useConfirm\(\)/);
  assert.match(section, /confirm\(\{ title: 'Delete this rule\?'[\s\S]*?tone: 'danger'/);
});

test('who may change the rules is the server\'s answer (`can_edit`): a reader gets the table and "View only", no Add, no menu, no tester', () => {
  assert.match(section, /const canEdit = !!answer\.data\?\.can_edit/);
  assert.doesNotMatch(section, /usePermissions|hasPermission/);
  assert.match(section, /\.\.\.\(canEdit \? \[\{ key: 'actions'/);                                                // the Actions column exists only for an editor
  assert.match(section, /if \(!canEdit\) return null;/);
  assert.match(section, /canEdit \? \(failed \? undefined : <>\{typesButton\}\{!empty && add\}<\/>\)/);
  assert.match(section, /<ReadOnlyNote>\s*View only/);
  assert.match(section, /\{canEdit && rules\.length > 0 && <RuleTester/);
});

test('every state is said: loading rows, a failure with the sentence the server gave and a Retry, and "No rules" with the Add button and a note', () => {
  assert.match(section, /loading=\{answer\.isLoading\}/);
  assert.match(section, /error=\{failed \? \{ message: errorMessage\(answer\.error\), onRetry: \(\) => \{ void answer\.refetch\(\); \} \} : null\}/);       // Retry with every failure, a refusal included
  assert.match(section, /retry: \(n, e\) => n < 2 && canRetry\(e\)/);
  assert.match(section, /title="No rules" info=\{RULE_NOTES\.none\} action=\{canEdit \? add : undefined\}/);
});

test('the card and the editor explain themselves in (i) notes: which rule wins, when a rule applies, who decides', () => {
  assert.match(section, /info=\{RULE_NOTES\.card\}/);
  assert.match(drawer, /<InfoTip text=\{RULE_NOTES\.submitted\}/);
  assert.match(drawer, /info=\{RULE_NOTES\.decides\}/);
  assert.match(drawer, /<InfoTip text=\{RULE_NOTES\.inTurn\}/);
  assert.match(tester, /<InfoTip text=\{RULE_NOTES\.tester\}/);
});

test('the rules go to the server\'s endpoints, a switch sends the whole rule, and a refusal is the server\'s sentence above the Save button with everything typed kept', () => {
  for (const call of ['list', 'create', 'update', 'remove', 'preview']) assert.match(`${section}${drawer}${tester}`, new RegExp(`exceptionRulesApi\\.${call}\\(`), call);
  assert.match(api, /apiClient\.get<RulesAnswer>\('\/governance\/exception-approval-rules'\)/);
  assert.match(api, /apiClient\.post<PreviewAnswer>\('\/governance\/exception-approval-rules\/preview'/);
  assert.match(api, /apiClient\.put<ExceptionRule>\(`\/governance\/exception-approval-rules\/\$\{id\}`/);
  assert.match(section, /exceptionRulesApi\.update\(r\.id, payloadOfRule\(r, !r\.is_active\)\)/);
  assert.match(section, /failure: 'Not changed'/);
  assert.match(drawer, /toast: 'success',/);                                                                          // one message per failure: the sentence in the drawer
  assert.match(drawer, /onError: \(e\) => setSaid\(errorMessage\(e, /);
  assert.match(drawer, /\{problem && <p role="alert"/);
  assert.match(drawer, /invalidate: \[RULES_KEY\]/);
  assert.match(section, /queryKey: RULES_KEY/);
});

test('the drawer asks "Discard changes?" before it throws typed input away, and shows errors only after a save was tried', () => {
  assert.match(drawer, /dirty=\{!sameRuleForm\(form, initial\)\}/);
  assert.match(drawer, /const errors = tried \? ruleErrors\(form\) : NO_ERRORS/);
  assert.match(drawer, /if \(hasRuleErrors\(ruleErrors\(form\)\)\) return;/);
  assert.match(drawer, /save\.mutate\(payloadOf\(form\)\)/);
});

test('steps can be added (before the last, the approval), moved and removed, from the keyboard, each button named for its step', () => {
  for (const label of ['Move step ${n} up', 'Move step ${n} down', 'Remove step ${n}']) assert.ok(drawer.includes(`label={\`${label}\`}`), label);
  assert.match(drawer, /<ol aria-label="Steps"/);
  assert.match(drawer, /role="group" aria-labelledby=\{heading\}/);
  assert.match(drawer, /disabled=\{form\.steps\.length >= MAX_STEPS\}/);
  assert.match(drawer, /\[\.\.\.form\.steps\.slice\(0, -1\), blankStep\('review'\), form\.steps\[form\.steps\.length - 1\]\]/);
  assert.match(drawer, /onChange=\{\(kind\) => onChange\(\{ kind, allow_reject: kind === 'approval' \}\)\}/);        // a review starts unable to reject, an approval able
  assert.match(drawer, /disabled=\{inTurn\}/);                                                                        // one after another is always everyone
});

test('the tester asks only once something is picked, as the choice changes, refreshes with the rules, says the answer in a live region and warns in the server\'s words', () => {
  assert.match(tester, /enabled: asked,/);
  assert.match(tester, /queryKey: \[\.\.\.RULES_KEY, 'preview', department, priority, kind, type\]/);
  assert.match(tester, /exception_type: type \|\| null/);
  assert.match(tester, /<div aria-live="polite"/);
  assert.match(tester, /answer\.data\.problems\.map\(\(problem, i\) => <Notice key=\{i\} tone="warning">\{problem\}<\/Notice>\)/);
  assert.match(tester, /errorMessage\(answer\.error\)/);
});

test('nothing here names a model or a vendor', () => {
  for (const f of FILES) assert.doesNotMatch(src[f], /\b(gpt|openai|claude|anthropic)\b/i, f);
});

test('the Types drawer (D59): the organisation\'s own list, for an editor only; Save sends the whole list; a refusal is the server\'s sentence with everything kept', () => {
  assert.match(section, /const typesButton = <Button leftIcon=\{<Tags aria-hidden \/>\} onClick=\{\(\) => setTyping\(true\)\}/);
  assert.match(section, /\{typing && <TypesDrawer types=\{types\} onClose=\{\(\) => setTyping\(false\)\} \/>\}/);
  assert.match(section, /const types = answer\.data\?\.exception_types \?\? \[\]/);
  assert.match(section, /conditionChips\(r, types, universe\)/);
  assert.match(types, /exceptionRulesApi\.setTypes\(rows\)/);
  assert.match(types, /invalidate: \[RULES_KEY, TYPES_KEY\]/);                                                         // the card, the rule editor and the exceptions form read the new list
  assert.match(types, /dirty=\{!sameTypes\(drafts, initial\) \|\| adding\.trim\(\) !== ''\}/);
  assert.match(types, /const problem = said \?\? \(tried \? typeProblem\(drafts\) : ''\)/);
  assert.match(types, /onError: \(e\) => setSaid\(errorMessage\(e, /);
  assert.match(types, /\{problem && <p role="alert"/);
  assert.match(types, /aria-label="Type name"/);
  assert.match(types, /label=\{`Remove \$\{d\.label \|\| 'type'\}`\}/);                                                    // each button is named for its type
  assert.match(types, /Bring back/);
  assert.match(drawer, /<MultiSelect label="Exception type" options=\{typeOptions\}/);
  assert.match(drawer, /typeChoices\(types, rule\?\.exception_types \?\? \[\]\)/);                                            // a type the rule names stays choosable after it is removed
  assert.match(tester, /exception_type: type \|\| null/);
  assert.match(api, /apiClient\.get<TypesAnswer>\('\/governance\/exception-approval-rules\/types'\)/);
  assert.match(api, /apiClient\.put<TypesAnswer>\('\/governance\/exception-approval-rules\/types', \{ types \}\)/);
});

// ── the implementer moved to the exception (D67), a long rule in a cell, and the words ──

test('the rule drawer has no implementer: who carries an approved exception out is chosen on the exception, not by the rule', () => {
  assert.doesNotMatch(drawer, /implementer/i);
  assert.doesNotMatch(drawer, /Add implementer|Remove implementer|Days to implement/);
  assert.doesNotMatch(section, /[^a-z]r.implementer/);                                                          // the table reads no implementer of a rule
  assert.doesNotMatch(tester, /implementer|Asked to implement/i);
  assert.ok(drawer.includes('<ol aria-label="Steps"'), 'the steps are still the last block of the editor');
  assert.ok(drawer.indexOf('</ol>') > drawer.indexOf('<ol aria-label="Steps"'));
});

test('a rule is saved through the one payload and checked the way a step is: errors under its fields after a save was tried, the sentence above Save', () => {
  assert.match(drawer, /save\.mutate\(payloadOf\(form\)\)/);                                                      // payloadOf carries the whole rule (exceptionRules.test.ts)
  assert.match(drawer, /const errors = tried \? ruleErrors\(form\) : NO_ERRORS/);
  assert.match(drawer, /const problem = said \?\? \(tried \? ruleProblem\(form\) : ''\)/);
  assert.match(drawer, /dirty=\{!sameRuleForm\(form, initial\)\}/);                                               // a change to lose
  assert.match(section, /exceptionRulesApi\.update\(r\.id, payloadOfRule\(r, !r\.is_active\)\)/);                  // a switch sends the whole rule
});

test('the table says the chain of steps only, and "When" stays short however much a rule names: a count or "All ...", the full sentence as the tooltip and for a screen reader', () => {
  assert.match(section, /title=\{stepsLong\(r\.steps\)\}>\{stepsLine\(r\.steps\)\}</);
  assert.match(section, /cardCell: \(r\) => <span[^>]*>\{stepsLong\(r\.steps\)\}<\/span>/);
  assert.match(section, /const chips = conditionChips\(r, types, universe\)/);
  assert.match(section, /<span className="sr-only">\{conditionsLong\(r, types, universe\)\}<\/span>/);
  assert.match(section, /<span aria-hidden title=\{conditionsLong\(r, types, universe\)\} className="flex flex-wrap gap-\[4px\]">/);
  // what "all" is measured against: the server's lists for someone who can edit, the usual ones for someone who cannot, and the organisation's types in use
  assert.match(section, /priorities: answer\.data\?\.options\?\.priorities\?\.length \? answer\.data\.options\.priorities : PRIORITY_ORDER/);
  assert.match(section, /doc_types: answer\.data\?\.options\?\.doc_types\?\.length \? answer\.data\.options\.doc_types : KIND_ORDER/);
  assert.match(section, /exception_types: types\.filter\(\(t\) => !t\.archived\)\.map\(\(t\) => t\.value\)/);
});

test('the words: "Document type" for a kind of document, "exception" for a policy exception, in the editor, the tester, the table and the types', () => {
  for (const f of FILES) assert.doesNotMatch(src[f], /polic(y|ies) exception|policy kind|kinds? of policy/i, f);
  assert.match(drawer, /<FormField label="Document type" optional>\s*<MultiSelect label="Document type"/);
  assert.match(tester, /<FormField label="Document type">/);
  assert.match(section, /conditionsLong\(r, types, universe\)/);                                                            // the table's sentence is the library's ("Document type: Policy")
  assert.match(section, /title="The kinds of exception your organisation tells apart"/);
  assert.match(drawer, /label="Exception type" optional/);                                                                  // the exception type keeps its own word
});
