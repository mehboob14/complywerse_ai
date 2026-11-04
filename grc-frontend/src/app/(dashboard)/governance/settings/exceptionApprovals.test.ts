// node --test "src/app/(dashboard)/governance/settings/exceptionApprovals.test.ts"
// What Governance > Settings > Exception approvals promises and a screenshot cannot hold for long (source-text tests, like settingsPage.test.ts): the card sits
// after the Departments card on every state of the page, it is on the design-system kit, the server's `can_edit` decides who sees a control, a refusal is the
// server's sentence, a rule is asked about before it is deleted, and the tester asks only when something is picked. (What a rule says and checks is in
// lib/exceptionRules.ts and tested in exceptionRules.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const FILES = ['./_ExceptionApprovalsSection.tsx', './_RuleDrawer.tsx', './_RuleTester.tsx'] as const;
const src = Object.fromEntries(FILES.map((f) => [f, read(f)])) as Record<(typeof FILES)[number], string>;
const section = src['./_ExceptionApprovalsSection.tsx'];
const drawer = src['./_RuleDrawer.tsx'];
const tester = src['./_RuleTester.tsx'];
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
  assert.match(section, /canEdit \? \(!empty && !failed \? add : undefined\)/);
  assert.match(section, /<ReadOnlyNote>\s*View only/);
  assert.match(section, /\{canEdit && rules\.length > 0 && <RuleTester/);
});

test('every state is said: loading rows, a failure with its sentence (and Retry only where trying again can help), and "No rules" with the Add button and a note', () => {
  assert.match(section, /loading=\{answer\.isLoading\}/);
  assert.match(section, /error=\{failed \? \{ message: errorMessage\(answer\.error\), onRetry: canRetry\(answer\.error\)/);
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
  assert.match(tester, /queryKey: \[\.\.\.RULES_KEY, 'preview', department, priority, kind\]/);
  assert.match(tester, /<div aria-live="polite"/);
  assert.match(tester, /answer\.data\.problems\.map\(\(problem, i\) => <Notice key=\{i\} tone="warning">\{problem\}<\/Notice>\)/);
  assert.match(tester, /errorMessage\(answer\.error\)/);
});

test('nothing here names a model or a vendor', () => {
  for (const f of FILES) assert.doesNotMatch(src[f], /\b(gpt|openai|claude|anthropic)\b/i, f);
});
