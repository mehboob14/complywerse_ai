// node --test "src/app/(dashboard)/governance/workflows/workflowsPage.test.ts"
// What the legacy Approval Workflows page promises and a screenshot cannot hold for long (source-text tests, like exceptionsPage.test.ts): it is on the design-system
// kit, every write is reported by useReportedMutation and goes to the endpoint and the query keys it always did, a failed read is never drawn as zero, no native
// dialog is left, the permission gate is still the one it was, a reason is still required to reject, and the forms start with the record's own values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';
import { ownHeadingSection, routeFor } from '../../../../lib/navRegistry.ts';

const dir = new URL('./', import.meta.url);
const files = readdirSync(dir).filter((f) => /\.tsx$/.test(f));                       // page.tsx and the _Pieces.tsx it is made of
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8');
const src = Object.fromEntries(files.map((f) => [f, read(f)])) as Record<string, string>;
const all = files.map((f) => src[f]).join('\n');
const model = read('_model.ts');
const page = src['page.tsx'];

test('the page is made of the files this test knows about', () => {
  assert.deepEqual(files.sort(), ['_Approvals.tsx', '_DecisionDialog.tsx', '_StepForm.tsx', '_TemplateDetail.tsx', '_TemplateForm.tsx', '_Templates.tsx', '_parts.tsx', 'page.tsx']);
});

test('the head is the kit\'s PageHeader with the registry\'s name, the page is flagged as drawing its own heading, and nothing of the legacy look is left', () => {
  assert.match(page, /<PageHeader\s+variant="page"\s+title=\{TITLE\}/);
  assert.match(page, /routeFor\('\/governance\/workflows'\)\?\.label/);
  assert.equal(routeFor('/governance/workflows')?.label, 'Approval Workflows');
  assert.equal(ownHeadingSection('/governance/workflows'), 'Governance', 'the top bar says the section, the page says its name once');
  assert.doesNotMatch(all, /PageLoader|governance-light|DocPageHeader|docUi|DataTable|cw-btn|cw-field|cw-card|cw-text/);
  assert.match(page, /back=\{\{ href: '\/governance\/documents'/);
});

test('no file of the page uses a class the platform CSS rewrites, a hex colour, a text under 12px or a bare form control (kit rules)', () => {
  for (const f of files) {
    assert.deepEqual(findViolations(src[f]), [], f);
    assert.doesNotMatch(src[f], /#[0-9a-fA-F]{6}\b/, `${f}: colours are the --ds tokens and the status tones`);
    assert.doesNotMatch(src[f], /<(select|textarea|input|button)\b/, `${f}: the kit's Select, Textarea, TextInput, Checkbox, Button and IconButton`);
  }
});

test('no native dialog and no action that waits for a hover: confirm(), alert() and prompt() are gone, deletes ask with the kit dialog, nothing is opacity-0 until hovered', () => {
  assert.doesNotMatch(all, /window\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt)\(|(?<!await )(?<![.\w])confirm\(/);       // (the kit's `await confirm({...})` is the question box)
  assert.doesNotMatch(all, /opacity-0[^'"`]*group-hover|group-hover[^'"`]*opacity-0/);
  assert.match(src['_Templates.tsx'], /confirm\(\{\s*title: 'Delete this template\?'[\s\S]*?tone: 'danger'/);
  assert.match(src['_TemplateDetail.tsx'], /confirm\(\{\s*title: 'Delete this step\?'[\s\S]*?tone: 'danger'/);
  assert.equal((all.match(/useConfirm\(\)/g) ?? []).length, 2);
});

test('the ten writes are reported by useReportedMutation: nothing is a bare useMutation any more, and no hand-made toast is left', () => {
  assert.doesNotMatch(all, /\buseMutation\(/);
  assert.equal((all.match(/useReportedMutation\(\{/g) ?? []).length, 9);                // one hook for approve and reject, then template create, update; step create, update; seed, delete template; reorder, delete step
  assert.doesNotMatch(all, /\btoast\(/);
  assert.match(all, /failure: /);
  for (const call of [
    'approveStep(step.step_id, comments)', 'rejectStep(step.step_id, comments)', 'createWorkflowTemplate(createTemplatePayload(f))', 'updateWorkflowTemplate(template!.id, updateTemplatePayload(f))',
    'deleteWorkflowTemplate(t.id)', 'createWorkflowStep(templateId, createStepPayload(f))', 'updateWorkflowStep(templateId, step!.id, updateStepPayload(f))',
    'deleteWorkflowStep(id, s.id)', 'reorderWorkflowSteps(id, steps)', 'seedDefaultTemplates(TENANT_ID)',
  ]) assert.ok(all.includes(`governanceApi.${call}`), call);
  assert.match(model, /export const TENANT_ID = 1;/, 'create and Seed Defaults send tenant 1, as they always did');
  assert.doesNotMatch(all, /tenant_id: 1/);
});

test('a create is never offered a Retry (a second try could make a second template or step); the others are', () => {
  assert.match(src['_TemplateForm.tsx'], /failure: 'Not created',\s*retryable: false/);
  assert.match(src['_StepForm.tsx'], /failure: 'Not added',\s*retryable: false/);
  assert.equal((all.match(/retryable: false/g) ?? []).length, 2);
});

test('the same reads and query keys as before, each refreshed as before (the classic document page invalidates two of them before it opens this one)', () => {
  const approvals = src['_Approvals.tsx'];
  for (const key of ["['workflow-dashboard']", "['pending-approvals']", "['overdue-approvals']"]) assert.ok(approvals.includes(`queryKey: ${key}`), key);
  assert.ok(src['_Templates.tsx'].includes("queryKey: ['workflow-templates']"));
  assert.ok(src['_TemplateDetail.tsx'].includes("queryKey: ['workflow-template', id]"));
  for (const call of ['getWorkflowDashboard()', 'getPendingApprovals()', 'getOverdueApprovals()', 'getWorkflowTemplates()', 'getWorkflowTemplate(id)']) assert.ok(all.includes(`governanceApi.${call}`), call);
  assert.doesNotMatch(all, /getApprovalHistory|getPendingApprovals\(\{|getOverdueApprovals\(\{|getWorkflowTemplates\(\{/, 'no new request parameters, and the history route does not exist');
  assert.match(src['_DecisionDialog.tsx'], /invalidate: \[\['workflow-dashboard'\], \['pending-approvals'\], \['overdue-approvals'\]\]/);
  assert.match(src['_TemplateForm.tsx'], /invalidate: \[\['workflow-templates'\]\]/);
  assert.match(src['_TemplateForm.tsx'], /invalidate: \[\['workflow-templates'\], \['workflow-template', template\?\.id\]\]/);
  assert.match(src['_Templates.tsx'], /invalidate: \[\['workflow-templates'\]\]/);
  assert.match(src['_TemplateDetail.tsx'], /invalidate: \[\['workflow-template', id\]\]/);
});

test('a read that fails or is refused is never drawn as zero or as an empty list: the lists are read as pages, each fails on its own, a refusal is not retried', () => {
  for (const f of ['_Approvals.tsx', '_Templates.tsx', '_TemplateDetail.tsx']) assert.match(src[f], /retry: retryRead/, f);
  assert.match(src['_Approvals.tsx'], /readPage<PendingStep>\(governanceApi\.getPendingApprovals\(\)\)/);
  assert.match(src['_Templates.tsx'], /readPage<WorkflowTemplate>\(governanceApi\.getWorkflowTemplates\(\)\)/, 'the templates route answers { items, total }: the old page read it as an array and always showed "No workflow templates"');
  assert.doesNotMatch(all, /as WorkflowTemplate\[\]/);
  assert.doesNotMatch(src['_Approvals.tsx'], /\|\| 0\b|\?\? 0\b/, 'a count is the server\'s number or an error, never a default 0');
  assert.match(src['_Approvals.tsx'], /<ErrorState title="Couldn't load the counts"/);
  assert.match(src['_Approvals.tsx'], /<NoAccessState title="You don't have access to approvals" reason=\{errorMessage\(refusal\)\}/);
  assert.match(src['_Approvals.tsx'], /statusOf\(e\) === 403/);
  assert.match(src['_parts.tsx'], /failures < 2 && canRetry\(error\)/);
  assert.match(src['_parts.tsx'], /asPage<T>\(q\.data\)/, 'what another page cached under the same key is not read as ours');
});

test('counts are the server\'s total and a list the server holds more of says so', () => {
  const a = src['_Approvals.tsx'];
  assert.match(a, /pending\.page\?\.total/);
  assert.match(a, /cutTitle\(pending\.page\.items\.length, pending\.page\.total, 'pending approvals'\)/);
  assert.match(a, /cutTitle\(overdue\.page\.items\.length, overdue\.page\.total, 'overdue approvals'\)/);
  assert.match(src['_Templates.tsx'], /cutTitle\(rows\.length, total, 'templates'\)/);
});

test('what a person may do is still the permission gate it was: only New Template is gated, Approve and Reject are drawn for everyone who reads the list, the server decides', () => {
  assert.equal((all.match(/hasPermission\(/g) ?? []).length, 1);
  assert.match(src['_Templates.tsx'], /hasPermission\('governance:workflows:create'\)/);
  assert.match(src['_Templates.tsx'], /\{canCreate && <Button variant="primary"[\s\S]*?>New template<\/Button>\}/);
  assert.doesNotMatch(all, /governance:workflows:(edit|delete)/, 'the old page computed these and never used them');
  assert.doesNotMatch(src['_Approvals.tsx'], /hasPermission|canDecide|is_mine/);
  assert.doesNotMatch(src['_Templates.tsx'], /canCreate && <Button[\s\S]{0,160}?Seed/, 'Seed defaults stays ungated: the server decides');
});

test('a reason is still required to reject and optional to approve, the comments are sent as typed, and the server\'s refusal stays in the dialog', () => {
  const d = src['_DecisionDialog.tsx'];
  assert.match(d, /approve: \{[^}]*required: false/);
  assert.match(d, /reject: \{[^}]*required: true/);
  assert.match(d, /const missing = w\.required && !text\.trim\(\);/);
  assert.match(d, /disabled=\{missing\}/);
  assert.match(d, /decide\.mutate\(text\)/);
  assert.match(d, /toast: 'success'/);
  assert.match(d, /onError: \(error\) => setProblem\(/);
});

test('every drawer and dialog that takes typed input asks "Discard changes?" before it throws it away, and is drawn fresh for each record', () => {
  assert.match(src['_DecisionDialog.tsx'], /dirty=\{text\.trim\(\) !== ''\}/);
  assert.match(src['_TemplateForm.tsx'], /dirty=\{!sameTemplateForm\(form, initial\)\}/);
  assert.match(src['_StepForm.tsx'], /dirty=\{!sameStepForm\(form, initial\)\}/);
  assert.match(src['_Templates.tsx'], /<TemplateFormDrawer key=\{form\.key\}/);
  assert.match(src['_TemplateDetail.tsx'], /<StepFormDrawer key=\{editing\.key\}/);
  assert.match(src['_Approvals.tsx'], /<DecisionDialog key=\{`\$\{deciding\.kind\}-\$\{deciding\.step\.step_id\}`\}/);
  assert.match(src['_TemplateForm.tsx'], /useState<TemplateForm>\(\(\) => \(template \? templateFormFrom\(template\) : emptyTemplateForm\(\)\)\)/, 'Edit starts with the template\'s values');
  assert.match(src['_StepForm.tsx'], /useState<StepForm>\(\(\) => \(step \? stepFormFrom\(step\) : emptyStepForm\(nextSequence\)\)\)/, 'Edit starts with the step\'s values');
});

test('the page keeps its place in the address, and the bare path is still Approvals > Pending', () => {
  assert.match(page, /useAddressState\(ADDRESS\)/);
  assert.match(page, /onChange=\{\(tab\) => set\(\{ tab, template: 0 \}\)\}/);
  assert.match(model, /export const ADDRESS = \{ tab: oneOf\(TABS, 'approvals'\), list: oneOf\(LISTS, 'pending'\), template: integer\(0, \{ min: 0 \}\) \};/);
  assert.match(model, /export const LISTS = \['pending', 'approved', 'rejected', 'all'\] as const;/, 'the four lists are still there; Approved and Rejected say they list nothing');
});

test('Approved and Rejected never promise a list the API cannot give', () => {
  const a = src['_Approvals.tsx'];
  assert.match(a, /requests are not listed here/);
  assert.doesNotMatch(a, /will appear here/);
});

test('every control that is an icon has a name, and every Reject, Approve, Move, Edit and Delete names its record', () => {
  assert.match(src['_Approvals.tsx'], /aria-label=\{`Reject: \$\{truncate\(s\.document_title, 80\)\.text\}`\}/);
  assert.match(src['_Approvals.tsx'], /aria-label=\{`Approve: \$\{truncate\(s\.document_title, 80\)\.text\}`\}/);
  for (const label of ['Move “${nameOf(s)}” up', 'Move “${nameOf(s)}” down', 'Edit “${nameOf(s)}”', 'Delete “${nameOf(s)}”']) assert.ok(src['_TemplateDetail.tsx'].includes(`label={\`${label}\`}`), label);
  for (const label of ['Edit “${nameOf(t)}”', 'Delete “${nameOf(t)}”']) assert.ok(src['_Templates.tsx'].includes(`label={\`${label}\`}`), label);
});

test('dates go through the helpers that keep a day a day and read the server\'s clock as UTC, and nothing formats one by hand', () => {
  assert.doesNotMatch(all, /toLocale(Date|Time)?String|new Date\(|toISOString|Intl\.DateTimeFormat/);
  assert.match(src['_Approvals.tsx'], /formatDate\(step\.due_date\)/);
  assert.match(src['_Approvals.tsx'], /Requested \$\{formatDate\(step\.requested_at\)\}/);
});

test('a document type reads as itself, a missing owner as "Unassigned" and a missing due date as the dash', () => {
  assert.match(src['_Approvals.tsx'], /docTypeLabel\(step\.doc_type\)/);
  assert.match(src['_Approvals.tsx'], /<PersonChip name=\{s\.owner_name\} size=\{20\} \/>/);
  assert.doesNotMatch(all, /'Unknown'|"Unknown"|'N\/A'|'None'/);
});
