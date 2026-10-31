// node --test "src/app/(dashboard)/is-projects/projectsPages.test.ts"
// What the Projects pages promise and a screenshot cannot hold for long (source-text tests, like exceptionsPage.test.ts; there is no React renderer here, behaviour is
// checked in a browser): the pages are on the design-system kit, no native dialog and no hover-only action is left, every write is reported and every delete asks first,
// the same requests and query keys as before are still made, no permission check was added or taken away, and the old pages' numbers are still the ones shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../../../components/ui/ds/kitRules.ts';
import { routeFor, titleFor } from '../../../lib/navRegistry.ts';

const root = new URL('./', import.meta.url);
const tsx = (dir: string): string[] => readdirSync(new URL(dir, root)).filter((f) => /\.tsx$/.test(f)).map((f) => `${dir}${f}`);
const files = [...tsx(''), ...tsx('dashboard/'), ...tsx('my-projects/'), ...tsx('[id]/')];
const read = (f: string) => readFileSync(new URL(f, root), 'utf8');
const src = Object.fromEntries(files.map((f) => [f, read(f)])) as Record<string, string>;
const all = files.map((f) => src[f]).join('\n');
const detail = src['[id]/page.tsx'];
const shell = src['page.tsx'];

test('the pages are made of the files this test knows about', () => {
  assert.deepEqual(files.slice().sort(), [
    '[id]/_AiResult.tsx', '[id]/_Delivery.tsx', '[id]/_EditProject.tsx', '[id]/_Evidence.tsx', '[id]/_Overview.tsx', '[id]/_Planning.tsx', '[id]/_RecordDrawer.tsx', '[id]/_Records.tsx',
    '[id]/_parts.tsx', '[id]/page.tsx', '_MyProjects.tsx', '_PortfolioOverview.tsx', '_ProjectForm.tsx', '_ProjectTable.tsx', '_ProjectsList.tsx', '_ui.tsx',
    'dashboard/page.tsx', 'my-projects/page.tsx', 'page.tsx',
  ]);
});

test('no file uses a class the platform CSS rewrites, a hex colour, or a bare form control (kit rules); the only bare buttons are the clear-search cross and the risk picker\'s rows', () => {
  for (const f of files) {
    assert.deepEqual(findViolations(src[f]), [], f);
    assert.doesNotMatch(src[f], /#[0-9a-fA-F]{6}\b/, `${f}: colours are the --ds tokens and the status tones`);
    assert.doesNotMatch(src[f], /<(select|textarea|input)\b/, `${f}: the kit's Select, Textarea and TextInput`);
    assert.doesNotMatch(src[f], /governance-light|docUi|DocPageHeader|PageLoader/, f);
  }
  const bare = Object.fromEntries(files.map((f) => [f, (src[f].match(/<button\b/g) ?? []).length])) as Record<string, number>;
  assert.deepEqual(Object.keys(bare).filter((f) => bare[f] > 0).sort(), ['[id]/_RecordDrawer.tsx', '_ProjectsList.tsx']);
  assert.equal(bare['_ProjectsList.tsx'], 1);
  assert.equal(bare['[id]/_RecordDrawer.tsx'], 1);
});

test('no native dialog and no hover-only action: confirm(), alert() and prompt() are gone, deletes ask with the kit dialog, actions are always drawn', () => {
  assert.doesNotMatch(all, /window\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt)\(|(?<!await )(?<![.\w])confirm\(/);       // (the kit's `await confirm({...})` is the question box)
  assert.doesNotMatch(all, /opacity-0[^"'`]*group-hover|group-hover[^"'`]*opacity-0/);
  assert.match(detail, /useConfirm\(\)/);
  assert.match(detail, /confirm\(\{ title: copy\.title[^}]*tone: 'danger'/);
  assert.match(detail, /title: 'Delete this project\?'/);
  assert.match(detail, /if \(ok\) deleteProjectMut\.mutate\(\);/);
  assert.match(src['[id]/_Evidence.tsx'], /title: 'Delete this evidence\?'[^}]*tone: 'danger'/);
  // every kind of record has its question, and a record is deleted only through `remove`, after the answer
  for (const kind of ['milestone', 'task', 'team', 'risk', 'update', 'document', 'budget', 'compliance', 'lesson', 'dependency']) assert.match(detail, new RegExp(`\\n  ${kind}: \\{ title: '`), kind);
  assert.match(detail, /if \(await confirm\([^\n]*\)\) REMOVERS\[kind\]\(id\);/);
  assert.equal((detail.match(/Mut\.mutate\(id\)|Mut\.mutate\(\)/g) ?? []).length, 12, 'ten record deletes through REMOVERS, the project delete and the AI apply');
});

test('every write is reported by useReportedMutation: nothing is a bare useMutation, and a create is never offered a Retry', () => {
  assert.doesNotMatch(all, /\buseMutation\(/);
  assert.equal((detail.match(/useReportedMutation\(\{/g) ?? []).length, 31, '30 writes of the old page and the AI apply');
  assert.equal((detail.match(/failure: /g) ?? []).length, 31);
  assert.equal((detail.match(/retryable: false/g) ?? []).length, 12, 'eleven creates and the AI apply (a second try would add its items twice)');
  assert.equal((src['[id]/_Evidence.tsx'].match(/useReportedMutation\(\{/g) ?? []).length, 2);
  assert.equal((src['_ProjectForm.tsx'].match(/useReportedMutation\(\{[\s\S]*?retryable: false/g) ?? []).length, 1);
  assert.doesNotMatch(all, /\btoast\(/, 'no hand-made toast: useReportedMutation and useNotify say it');
  assert.match(detail, /notify\.error\(err, \{ title: "Couldn't download the file"/, 'a download that fails says so (it used to be swallowed)');
  assert.doesNotMatch(detail, /catch \{\s*\/\/ noop/);
});

test('what is changed in place is saved once and said: no request per keystroke or per slider tick, no mutate in the cells', () => {
  assert.doesNotMatch(src['[id]/_Delivery.tsx'] + src['[id]/_Records.tsx'], /\.mutate\(|mutateAsync\(/);
  assert.doesNotMatch(all, /type="range"|parseInt\(e\.target\.value\)/);
  const parts = src['[id]/_parts.tsx'];
  assert.match(parts, /onBlur=\{commit\}/);
  assert.match(parts, /e\.key === 'Enter'/);
  assert.match(detail, /mutateAsync\(\{ id, data \}\)/);
});

test('the same endpoints as before are still asked, with the same query keys (other pages and the pages\' own refreshes depend on them)', () => {
  for (const call of [
    'getAll(', 'create(', 'getDashboard()', 'getEnhancedAnalytics()', 'getHealthTrend()', 'getMyProjects()', 'getById(', 'update(', 'delete(', 'createMilestone(', 'updateMilestone(', 'deleteMilestone(',
    'getMilestoneEvidence(', 'uploadMilestoneEvidence(', 'deleteMilestoneEvidence(', 'createTask(', 'updateTask(', 'deleteTask(', 'addTeamMember(', 'removeTeamMember(', 'createUpdate(',
    'deleteUpdate(', 'createRisk(', 'updateRisk(', 'deleteRisk(', 'addDocument(', 'uploadDocument(', 'downloadDocument(', 'removeDocument(', 'getBudgetItems(', 'createBudgetItem(',
    'updateBudgetItem(', 'deleteBudgetItem(', 'getComplianceMappings(', 'createComplianceMapping(', 'updateComplianceMapping(', 'deleteComplianceMapping(', 'getLessonsLearned(',
    'createLessonLearned(', 'updateLessonLearned(', 'deleteLessonLearned(', 'getDependencies(', 'createDependency(', 'updateDependency(', 'deleteDependency(', 'aiGeneratePlan(',
    'aiAssessRisks(', 'aiDraftStatusReport(', 'aiSuggestTeam(', 'aiEstimateBudget(',
  ]) assert.ok(all.includes(`isProjectsApi.${call}`), call);
  assert.ok(all.includes('tenantApi.getTenantUsers()') && all.includes('assetsApi.getTenantUsers()') && all.includes('risksApi.getAll()'));
  for (const key of [
    "['is-projects-tenant-users']", "['is-projects-dashboard']", "['is-projects-enhanced-analytics']", "['is-projects-health-trend']", "['is-projects-my']", "['is-project', projectId]",
    "['is-project-tenant-users', projectId]", "['is-project-tenant-risks', projectId]", "['is-project-budget', projectId]", "['is-project-compliance', projectId]",
    "['is-project-lessons', projectId]", "['is-project-deps', projectId]",
  ]) assert.ok(all.includes(`queryKey: ${key}`), key);
  assert.ok(src['_ProjectsList.tsx'].includes("queryKey: ['is-projects', asked.status, asked.category, asked.priority, asked.health, asked.owner, asked.search, page, pageSize]"));
  assert.ok(src['[id]/_Evidence.tsx'].includes("['is-project-milestone-evidence', projectId, milestoneId]"));
  for (const tab of ['budget', 'compliance', 'lessons', 'dependencies']) assert.match(detail, new RegExp(`enabled: tab === '${tab}'`), `${tab} still loads when its tab is opened`);
  assert.match(detail, /queryClient\.invalidateQueries\(\{ queryKey: \['is-project', projectId\] \}\)/);
});

test('the list asks for a page and says how many there are in all, instead of showing the first 50 and saying nothing', () => {
  const list = src['_ProjectsList.tsx'];
  assert.match(list, /listParams\(asked, page, pageSize\)/);
  assert.match(list, /readProjectPage\(/);
  assert.match(list, /<Pager page=\{page\} pageSize=\{pageSize\} total=\{total\}/);
  assert.doesNotMatch(list, /\.length\}?\s*(?:projects|total)/);
  assert.match(list, /useDebounced\(typed, 300\)/, 'a search is asked for once the typing pauses');
  assert.match(list, /kind="firstUse"/);
  assert.match(list, /kind="noMatches"/);
});

test('what a person may do is as before: New project is gated by is_projects:projects:create, and no other page asks for a permission', () => {
  assert.match(shell, /hasPermission\('is_projects:projects:create'\)/);
  assert.equal((all.match(/hasPermission\(/g) ?? []).length, 1);
  for (const f of files.filter((n) => n !== 'page.tsx')) assert.doesNotMatch(src[f], /usePermissions|PermissionGuard|NoAccessState/, `${f}: the detail page never had a gate and none is added`);
  assert.match(src['_ProjectsList.tsx'], /canCreate \? <Button variant="primary"/, 'the empty state offers New project only to those who may create');
});

test('the heads are the kit\'s, with the registry\'s names; the open tab is in the address and the old values keep working', () => {
  assert.match(shell, /<PageHeader\s+variant="page"\s+title=\{routeFor\('\/is-projects'\)\?\.label \?\? 'Projects'\}/);
  assert.equal(routeFor('/is-projects')?.label, 'Projects');
  assert.equal(titleFor('/is-projects/dashboard'), 'Projects Overview');
  assert.equal(titleFor('/is-projects/my-projects'), 'My Projects');
  assert.match(src['dashboard/page.tsx'], /titleFor\('\/is-projects\/dashboard'\)/);
  assert.match(src['my-projects/page.tsx'], /titleFor\('\/is-projects\/my-projects'\)/);
  assert.match(shell, /useTabParam\('tab', LIST_TAB_KEYS, \{ fallback: 'overview' \}\)/);
  assert.match(detail, /useTabParam\('tab', DETAIL_TAB_KEYS, \{ fallback: 'overview' \}\)/);
  assert.match(detail, /<Tabs tabs=\{tabs\} value=\{tab\}/);
  assert.match(src['_MyProjects.tsx'], /href="\/is-projects\?tab=projects"/, 'the empty state\'s button works from the tab and from its own route');
});

test('every form and drawer asks before it discards typed input, and the project\'s forms keep the old save buttons\' payloads', () => {
  for (const f of ['_ProjectForm.tsx', '[id]/_RecordDrawer.tsx', '[id]/_EditProject.tsx']) assert.match(src[f], /dirty=\{/, f);
  assert.match(src['_ProjectForm.tsx'], /newProjectPayload\(form\)/);
  assert.match(src['[id]/_EditProject.tsx'], /editPayload\(form\)/);
  assert.match(detail, /recordPayload\(drawer\.kind, form, tenantUsersById\)/);
  assert.match(detail, /documentFields\(form\)\.forEach\(\(\[k, v\]\) => formData\.append\(k, v\)\)/);
  assert.equal((all.match(/<RightSlidePanel/g) ?? []).length, 3);
  assert.equal((all.match(/<AnimatedModal/g) ?? []).length, 1, 'the AI result');
  assert.doesNotMatch(all, /fixed inset-0/, 'no hand-made overlay');
});

test('dates go through the helpers that keep a day a day, and the numbers are the old pages\' (the AI plan\'s own date arithmetic apart)', () => {
  assert.doesNotMatch(all, /toLocale(Date|Time)?String|Intl\.DateTimeFormat/);
  for (const f of files.filter((n) => n !== '[id]/page.tsx')) assert.doesNotMatch(src[f], /new Date\(|toISOString/, f);
  assert.equal((detail.match(/new Date\(/g) ?? []).length, 3, 'the AI plan turns target_week into a date, as before (its start date, today, and the week offset)');
  assert.equal((detail.match(/toISOString\(\)/g) ?? []).length, 1);
  assert.match(src['_PortfolioOverview.tsx'], /import \{[^}]*healthScore[^}]*\} from '\.\/_model'/);
  assert.match(src['[id]/_Overview.tsx'], /budgetShare\(project\.budget_estimated, project\.budget_actual\)/);
});

test('the pictures are also said in words, and a chart has no numbers that live only in a tooltip', () => {
  const o = src['_PortfolioOverview.tsx'];
  assert.ok((o.match(/role="img" aria-label=\{/g) ?? []).length >= 3);
  assert.match(o, /aria-label=\{statusSummary\(data\.status_distribution\)\}/);
  assert.match(o, /aria-label=\{trendSummary\(trend\)\}/);
  assert.match(o, /aria-label=\{categorySummary\(categories\)\}/);
  assert.doesNotMatch(o, /recharts/, 'values are text in the page, not a hover');
  assert.match(src['[id]/_Planning.tsx'], /role="img" aria-label=\{`Coverage of /);
});

test('loading, failure and empty are different states: a failed request is never drawn as an empty list or as "not found"', () => {
  for (const f of ['_PortfolioOverview.tsx', '_MyProjects.tsx', '[id]/page.tsx']) assert.match(src[f], /Couldn't load/, f);
  assert.match(detail, /statusOf\(projectQuery\.error\) === 404/);
  assert.match(detail, /title="Project not found"/);
  assert.match(src['_PortfolioOverview.tsx'], /Couldn't load the project analytics/, 'the four analytics cards no longer vanish silently');
  for (const noun of ['budget', 'compliance mappings', 'lessons', 'dependencies']) assert.ok(all.includes(`<LoadState q={`) && all.includes(`noun="${noun}"`), noun);
  assert.match(src['_ui.tsx'], /export const retryRead = \(failures: number, error: unknown\): boolean => failures < 2 && canRetry\(error\);/);
  assert.ok((all.match(/retry: retryRead/g) ?? []).length >= 14, 'a refusal is said at once, not after three tries with back-off');
});
