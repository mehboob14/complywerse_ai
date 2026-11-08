// node --test "src/app/(dashboard)/bcm/bcmPages.test.ts"
// What the Business Continuity pages keep and what they no longer do (the registers, the records and the Overview), pinned in the files that carry it (there is no React renderer here; behaviour is checked in a browser): the requests with their
// keys and endpoints, the rights each page asks for (the same ones as before), every request reporting its own outcome, no native dialog and no action hidden until hover, a delete that asks first,
// drawers that guard typed input, the registry's words and the platform's date formatter, the kit's rules in every file of the folder, no bare <p> without a size (the platform CSS gives it 11.5px),
// and nothing outside the folder importing its helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';

import { findViolations } from '../../../components/ui/ds/kitRules.ts';

const ROOT = new URL('./', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), 'utf8');

/** every non-test .ts / .tsx of the folder, by its path under it */
function filesOf(dir: URL = ROOT, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const url = new URL(name, dir);
    if (statSync(url).isDirectory()) return filesOf(new URL(`${name}/`, dir), `${prefix}${name}/`);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [`${prefix}${name}`] : [];
  });
}
const ALL = filesOf();
const TSX = ALL.filter((f) => f.endsWith('.tsx'));
const source = Object.fromEntries(ALL.map((f) => [f, read(f)])) as Record<string, string>;
const permissionsOf = (text: string) => Array.from(text.matchAll(/hasPermission\('([^']+)'\)/g), (m) => m[1]).sort();

test('the folder is the pages and their pieces (a new file is a decision: it has to be added here)', () => {
  assert.deepEqual(ALL.slice().sort(), [
    '_bcm-ui.tsx', '_drills/DrillsRegister.tsx', '_drills/drillsConfig.ts', '_findings/FindingsRegister.tsx', '_findings/ThresholdSheet.tsx', '_findings/findingActions.tsx', '_findings/findingsConfig.ts',
    '_overview/OverviewParts.tsx', '_overview/overviewModel.ts', '_plans/PlansRegister.tsx', '_plans/plansConfig.ts', '_record/EvidencePicker.tsx', '_record/JourneyStrip.tsx', '_record/NextSteps.tsx',
    '_record/recordModel.ts', '_register/BcmRegister.tsx', '_register/bits.tsx', '_register/registerModel.ts', '_tabs/BcmTabs.tsx', '_tabs/tabsModel.ts', 'bcmData.ts', 'bcmModel.ts',
    'drills/[id]/_FindingsCard.tsx', 'drills/[id]/_ResultCard.tsx', 'drills/[id]/page.tsx', 'drills/_DrillForm.tsx', 'drills/page.tsx', 'findings/page.tsx', 'page.tsx',
    'plans/[id]/_BiaForm.tsx', 'plans/[id]/_BiaPanel.tsx', 'plans/[id]/_BiaTab.tsx', 'plans/[id]/_Sections.tsx', 'plans/[id]/page.tsx', 'plans/_PlanForm.tsx', 'plans/page.tsx',
  ]);
});

test('the requests each page makes keep their keys and endpoints (the Reports and the dashboard read the same routes)', () => {
  const data = source['bcmData.ts'];
  assert.match(data, /PLANS_KEY = \['bcm-plans', 'lean'\] as const/, 'under the prefix every plan write already refreshed');
  assert.match(data, /DRILLS_KEY = \['bcm-drills', 'lean'\] as const/);
  assert.match(data, /FINDINGS_KEY = \['bcm-findings'\] as const/);
  assert.match(data, /DASHBOARD_KEY = \['bcm-dashboard'\] as const/);
  assert.match(data, /fetchLean<PlanRow>\('\/bcm\/plans', \{ lean: 1, limit: LEAN_LIMIT \}\)/);
  assert.match(data, /fetchLean<DrillRow>\('\/bcm\/drills', \{ lean: 1, limit: LEAN_LIMIT \}\)/);
  assert.match(data, /fetchLean<FindingRow>\('\/bcm\/findings', \{ limit: LEAN_LIMIT \}\)/);
  assert.match(data, /apiClient\.get\('\/bcm\/dashboard'\)/);
  assert.match(data, /refetchInterval: 60_000/);
  assert.match(data, /apiClient\.get\('\/bcm\/settings'\)/);
  assert.match(data, /apiClient\.get\('\/bcm\/evidence-options'/);
  assert.match(data, /LEAN_LIMIT = 5000/);
  assert.match(source['page.tsx'], /useDashboard\(\)/);
  assert.match(source['plans/[id]/page.tsx'], /queryKey: \['bcm-plan', planId\]/);
  assert.match(source['plans/[id]/page.tsx'], /bcmApi\.plans\.get\(planId\)/);
  assert.match(source['plans/[id]/page.tsx'], /bcmApi\.plans\.transition\(planId, status\)/);
  assert.match(source['drills/[id]/page.tsx'], /queryKey: \['bcm-drill', drillId\]/);
  assert.match(source['drills/[id]/page.tsx'], /bcmApi\.drills\.get\(drillId\)/);
  assert.match(source['drills/[id]/page.tsx'], /bcmApi\.drills\.transition\(drillId, status\)/);
  assert.match(source['drills/_DrillForm.tsx'], /queryKey: \['bcm-plans-min'\]/);
  assert.match(source['_bcm-ui.tsx'], /queryKey: \['bcm-options', kind\]/);
  assert.match(source['_bcm-ui.tsx'], /bcmApi\.options\[kind\]\(\)/);
  for (const f of ['plans/page.tsx', 'drills/page.tsx', 'findings/page.tsx']) assert.doesNotMatch(source[f], /useQuery|apiClient|bcmApi/, `${f}: the page is the address of its register`);
});

test('every write keeps its endpoint and refreshes every list and the Overview that shows what it changed', () => {
  const calls = (file: string) => Array.from(source[file].matchAll(/bcmApi\.([a-zA-Z]+\.[a-zA-Z]+)\(/g), (m) => m[1]).sort();
  assert.deepEqual(calls('_plans/PlansRegister.tsx'), ['plans.remove', 'plans.transition']);
  assert.deepEqual(calls('_drills/DrillsRegister.tsx'), ['drills.remove', 'drills.transition']);
  assert.deepEqual(calls('plans/_PlanForm.tsx'), ['plans.create', 'plans.update']);
  assert.deepEqual(calls('plans/[id]/_BiaForm.tsx'), ['bia.create', 'bia.update']);
  assert.deepEqual(calls('plans/[id]/_BiaPanel.tsx'), ['bia.addDependency', 'bia.addStrategy', 'bia.linkRisk', 'bia.remove', 'bia.update', 'dependencies.remove', 'strategies.remove', 'strategies.update']);
  assert.deepEqual(calls('drills/_DrillForm.tsx'), ['drills.create', 'drills.create', 'drills.update', 'plans.list']);
  assert.deepEqual(calls('drills/[id]/_ResultCard.tsx'), ['drills.saveResult']);
  assert.deepEqual(calls('drills/[id]/_FindingsCard.tsx'), ['findings.create']);
  assert.deepEqual(calls('_findings/findingActions.tsx'), ['findings.createIssue', 'findings.linkRisk', 'findings.remove', 'findings.update']);
  assert.deepEqual(calls('_findings/ThresholdSheet.tsx'), ['settings.update']);
  // a plan, a drill or a finding changed anywhere refreshes the lists and the Overview (REFRESH_ALL), and the record the person is on
  for (const f of ['_plans/PlansRegister.tsx', '_drills/DrillsRegister.tsx', 'plans/_PlanForm.tsx', 'plans/[id]/_BiaForm.tsx', 'plans/[id]/_BiaPanel.tsx', 'drills/_DrillForm.tsx', 'drills/[id]/_ResultCard.tsx', 'drills/[id]/_FindingsCard.tsx', '_findings/findingActions.tsx', 'plans/[id]/page.tsx', 'drills/[id]/page.tsx']) {
    assert.match(source[f], /\.\.\.REFRESH_ALL/, `${f}: the lists and the Overview follow`);
  }
  assert.match(source['plans/_PlanForm.tsx'], /invalidate: \[\['bcm-plan', plan\?\.id \?\? 0\], \.\.\.REFRESH_ALL\]/);
  assert.match(source['plans/[id]/page.tsx'], /invalidate: \[\['bcm-plan', planId\], \.\.\.REFRESH_ALL\]/);
  assert.match(source['drills/_DrillForm.tsx'], /invalidate: \[\['bcm-plan', mode\.kind === 'schedule' \? mode\.planId : 0\], \.\.\.REFRESH_ALL\]/);
  assert.match(source['drills/_DrillForm.tsx'], /invalidate: \[\['bcm-drill', edit\?\.id \?\? 0\], \.\.\.REFRESH_ALL\]/);
  assert.match(source['drills/[id]/page.tsx'], /invalidate: \[\['bcm-drill', drillId\], \.\.\.REFRESH_ALL\]/);
  assert.match(source['bcmData.ts'], /REFRESH_ALL: ReadonlyArray<readonly unknown\[\]> = \[\['bcm-plans'\], \['bcm-drills'\], FINDINGS_KEY, DASHBOARD_KEY\]/);
});

test('every page asks for the rights the server checks (none widened); the server decides the rest', () => {
  assert.deepEqual(permissionsOf(source['page.tsx']), ['bcm:drills:create', 'bcm:plans:create'], 'the Overview only decides which first action to offer');
  assert.deepEqual(permissionsOf(source['_plans/PlansRegister.tsx']), ['bcm:plans:create', 'bcm:plans:delete', 'bcm:plans:edit']);
  assert.deepEqual(permissionsOf(source['_drills/DrillsRegister.tsx']), ['bcm:drills:create', 'bcm:drills:delete', 'bcm:drills:edit']);
  assert.deepEqual(permissionsOf(source['_findings/FindingsRegister.tsx']), ['bcm:findings:delete', 'bcm:findings:edit']);
  assert.deepEqual(permissionsOf(source['_findings/ThresholdSheet.tsx']), ['bcm:plans:edit'], 'the server asks plans:edit to change the threshold');
  assert.deepEqual(permissionsOf(source['plans/[id]/page.tsx']), ['bcm:bia:create', 'bcm:bia:delete', 'bcm:bia:edit', 'bcm:drills:create', 'bcm:plans:edit']);
  assert.deepEqual(permissionsOf(source['drills/[id]/page.tsx']), ['bcm:drills:edit', 'bcm:findings:create', 'bcm:findings:delete', 'bcm:findings:edit']);
  assert.deepEqual(permissionsOf(source['drills/[id]/_FindingsCard.tsx']), ['bcm:findings:delete', 'bcm:findings:edit']);
  assert.deepEqual(permissionsOf(source['plans/[id]/_BiaPanel.tsx']), [], 'the panel takes the rights from the page');
  // the delete of a dependency, a strategy or a process is offered to those the server lets delete (the drawer offered it to anyone who could edit, and the server answered 403)
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /\{canDelete && <IconButton label=\{`Remove dependency/);
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /\{canDelete && <IconButton label=\{`Delete the /);
  assert.match(source['plans/[id]/page.tsx'], /canDelete=\{canDeleteBia\}/);
  assert.match(source['_plans/PlansRegister.tsx'], /hidden: !canDelete/);
  assert.match(source['_findings/FindingsRegister.tsx'], /hidden: !canEdit \|\| !!f\.linked_issue_id/);
  assert.match(source['plans/[id]/page.tsx'], /actions=\{canEdit \? \(/, 'Edit and Change status are for plans:edit');
  assert.match(source['plans/[id]/_Sections.tsx'], /canSchedule \? <Button size="sm"/);
  // the tabs are offered by the rights the three sidebar leaves used, plus the Findings tab on its own
  assert.match(source['_tabs/tabsModel.ts'], /right: 'bcm:dashboard:\*'[\s\S]*right: 'bcm:plans:\*'[\s\S]*right: 'bcm:drills:\*'[\s\S]*right: 'bcm:findings:\*'/);
});

test('every request reports its own outcome: no bare useMutation, the confirmation only after the server answered, a create is never offered again', () => {
  for (const f of ALL) assert.doesNotMatch(source[f], /\buseMutation\(/, `${f}: a bare mutation reports nothing`);
  const count = (f: string) => (source[f].match(/useReportedMutation\(/g) ?? []).length;
  const expected: Record<string, number> = {
    '_plans/PlansRegister.tsx': 2, '_drills/DrillsRegister.tsx': 2, 'plans/_PlanForm.tsx': 2, 'plans/[id]/page.tsx': 1, 'plans/[id]/_BiaForm.tsx': 2, 'plans/[id]/_BiaPanel.tsx': 8,
    'drills/_DrillForm.tsx': 3, 'drills/[id]/page.tsx': 1, 'drills/[id]/_ResultCard.tsx': 1, 'drills/[id]/_FindingsCard.tsx': 1, '_findings/findingActions.tsx': 4, '_findings/ThresholdSheet.tsx': 1,
  };
  for (const [f, n] of Object.entries(expected)) assert.equal(count(f), n, f);
  for (const f of ['plans/_PlanForm.tsx', 'plans/[id]/_BiaForm.tsx', 'drills/_DrillForm.tsx']) {
    assert.match(source[f], /retryable: false/, `${f}: a create lost in the network could be made twice if repeated`);
    assert.match(source[f], /toast: 'success'/, `${f}: the drawer shows a failure itself; the toast only confirms`);
    assert.match(source[f], /onError: \(error\) => setProblem\(errorMessage\(error\)\)|onError: \(error: unknown\) => setProblem\(errorMessage\(error\)\)|\.\.\.common/, `${f}: what the server said is shown in the form`);
  }
  assert.match(source['drills/[id]/_ResultCard.tsx'], /toast: 'errors'/, 'the save bar says "Saved"; a failure is the toast with Retry');
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /retryable: false/);
  assert.match(source['drills/[id]/_FindingsCard.tsx'], /retryable: false/);
  assert.match(source['_findings/findingActions.tsx'], /retryable: false/);
});

test('no native dialog, no action hidden until hover, no hand-rolled overlay, no developer text on screen, no browser storage', () => {
  for (const f of ALL) {
    assert.doesNotMatch(source[f], /\bwindow\.(confirm|alert|prompt)\(|(^|[^.\w])(alert|prompt)\(|\bif \(!?confirm\(/m, `${f}: a native dialog (the kit's confirm() is awaited and comes from useConfirm)`);
    assert.doesNotMatch(source[f], /opacity-0|group-hover/, `${f}: an action that is invisible until hover (and for ever on touch and keyboard)`);
    assert.doesNotMatch(source[f], /fixed inset-0|aria-modal/, `${f}: a hand-rolled overlay: the kit's drawer and dialog take focus, name themselves and guard typed input`);
    assert.doesNotMatch(source[f], /backend may need a restart|expose the endpoints/, `${f}: developer text`);
    assert.doesNotMatch(source[f], /localStorage|sessionStorage/, `${f}: nothing that matters is kept in the browser`);
  }
});

test('every delete asks first and says what goes with it; the question is the kit\'s', () => {
  for (const f of ['_plans/PlansRegister.tsx', '_drills/DrillsRegister.tsx', 'plans/[id]/_BiaPanel.tsx', '_findings/findingActions.tsx']) {
    assert.match(source[f], /const \{ confirm, confirmDialog \} = useConfirm\(\);/, f);
    assert.match(source[f], /tone: 'danger'/, f);
    assert.match(source[f], /\{confirmDialog\}/, f);
  }
  assert.match(source['_plans/PlansRegister.tsx'], /confirm\(\{ \.\.\.planDeleteWords\(p\), tone: 'danger' \}\)/);
  assert.match(source['_drills/DrillsRegister.tsx'], /confirm\(\{ \.\.\.drillDeleteWords\(d\), tone: 'danger' \}\)/);
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /dependencyDeleteWords\(d\.name\)/);
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /strategyDeleteWords\(strategyType\.label\(s\.strategy_type\)\)/);
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /biaDeleteWords\(bia\)/);
  assert.match(source['_findings/findingActions.tsx'], /findingDeleteWords\(f\.title\)/);
  // the actions that cannot be undone from here ask too
  assert.match(source['_findings/findingActions.tsx'], /Create an issue for this finding\?/);
  assert.match(source['_findings/findingActions.tsx'], /Create a new risk from this finding\?/);
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /Create a new risk from this process\?/);
  assert.match(source['plans/[id]/_BiaTab.tsx'], /title: 'Discard changes\?'/, 'choosing another process asks when the open one holds typing');
});

test('after a delete focus goes back to where the section starts, and a panel that held the record closes', () => {
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /onSuccess: \(\) => addDepButton\.current\?\.focus\(\)/);
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /onSuccess: \(\) => addStratButton\.current\?\.focus\(\)/);
  assert.match(source['drills/[id]/_FindingsCard.tsx'], /onRemoved: \(\) => addButton\.current\?\.focus\(\)/);
  assert.match(source['_findings/findingActions.tsx'], /onSuccess: \(_data, f\) => onRemoved\?\.\(f\)/);
  assert.match(source['_plans/PlansRegister.tsx'], /if \(address\.open === p\.id\) setAddress\(\{ open: 0 \}\)/);
  assert.match(source['_drills/DrillsRegister.tsx'], /if \(address\.open === d\.id\) setAddress\(\{ open: 0 \}\)/);
  assert.match(source['_findings/FindingsRegister.tsx'], /if \(address\.open === f\.id\) setAddress\(\{ open: 0 \}\)/);
});

test('the drawers and dialogs are the kit\'s and guard typed input', () => {
  for (const f of ['plans/_PlanForm.tsx', 'plans/[id]/_BiaForm.tsx', 'drills/_DrillForm.tsx']) {
    assert.match(source[f], /<RightSlidePanel\s+isOpen\s+onClose=\{onClose\}\s+dirty=\{/, f);
    assert.match(source[f], /<FormField/, f);
  }
  assert.match(source['_findings/findingActions.tsx'], /<AnimatedModal\s+isOpen onClose=\{onClose\} dirty=\{risk !== null\}/);
  assert.match(source['plans/_PlanForm.tsx'], /planDirty\(opened, form\)/);
  assert.match(source['drills/_DrillForm.tsx'], /drillDirty\(opened, form\)/);
  assert.match(source['plans/[id]/_BiaForm.tsx'], /dirty=\{biaDirty\(form, opened\)\}/);
  assert.match(source['_findings/ThresholdSheet.tsx'], /<Sheet\s+open\s+onClose=\{onClose\}[\s\S]*dirty=\{dirty\}/);
  assert.match(source['drills/[id]/_ResultCard.tsx'], /<SaveBar/);
  assert.match(source['drills/[id]/_ResultCard.tsx'], /window\.addEventListener\('beforeunload', ask\)/, 'leaving a half-written result asks');
  // the registers' panels are the kit's SidePanel (focus handled, Escape closes one layer, focus returns to the row)
  for (const f of ['_plans/PlansRegister.tsx', '_drills/DrillsRegister.tsx', '_findings/FindingsRegister.tsx']) {
    assert.match(source[f], /<SidePanel\s+open=\{!!row\}[\s\S]*dockFrom=\{Infinity\}[\s\S]*restoreFocus=\{rowOf\(row\?\.id \?\? null\)\}/, f);
  }
});

test('each form sends what the old modal sent (the builders are pinned in bcmModel.test.ts) and says what is wrong before it sends', () => {
  assert.match(source['plans/_PlanForm.tsx'], /update\.mutate\(planUpdatePayload\(form\)\)/);
  assert.match(source['plans/_PlanForm.tsx'], /create\.mutate\(planCreatePayload\(form\)\)/);
  assert.match(source['drills/_DrillForm.tsx'], /create\.mutate\(drillCreatePayload\(form\)\)/);
  assert.match(source['drills/_DrillForm.tsx'], /schedule\.mutate\(drillSchedulePayload\(mode\.planId, form\)\)/);
  assert.match(source['drills/_DrillForm.tsx'], /update\.mutate\(drillUpdatePayload\(form, edit\?\.source_type === 'incident_triggered'\)\)/);
  assert.match(source['plans/[id]/_BiaForm.tsx'], /create\.mutate\(biaCreatePayload\(form\)\)/);
  assert.match(source['plans/[id]/_BiaForm.tsx'], /update\.mutate\(biaUpdatePayload\(form\)\)/);
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /addDep\.mutate\(dependencyPayload\(dep\)\)/);
  assert.match(source['plans/[id]/_BiaPanel.tsx'], /addStrat\.mutate\(strategyPayload\(strat\)\)/);
  assert.match(source['drills/[id]/_FindingsCard.tsx'], /add\.mutate\(findingPayload\(form\)\)/);
  assert.match(source['drills/[id]/_ResultCard.tsx'], /save\.mutate\(resultPayload\(form\)\)/);
  assert.match(source['_findings/findingActions.tsx'], /update\(f\.id, \{ owner_id: ownerId, due_date: due \|\| null \}\)/);
  for (const f of ['plans/_PlanForm.tsx', 'plans/[id]/_BiaForm.tsx', 'drills/_DrillForm.tsx', 'drills/[id]/_ResultCard.tsx']) assert.match(source[f], /Errors?\(|errors\b/, f);
  assert.match(source['_bcm-ui.tsx'], /type="number" inputMode="numeric" min=\{0\} step=\{1\} unit="h"/, 'an hours field says its unit and takes whole numbers');
  assert.match(source['_record/EvidencePicker.tsx'], /Attach evidence/);
});

test('every state is said: loading, failed (with the server\'s words; Retry only where it can help), empty for the first time, nothing matches', () => {
  for (const f of ['page.tsx', 'plans/[id]/page.tsx', 'drills/[id]/page.tsx']) {
    assert.match(source[f], /<ErrorState/, `${f}: a failed read`);
    assert.match(source[f], /errorMessage\(query\.error\)/, `${f}: the server's words`);
    assert.match(source[f], /canRetry\(/, `${f}: Retry only where repeating can help`);
    assert.doesNotMatch(source[f], /PageLoader/, `${f}: a skeleton, not a spinner`);
  }
  for (const f of ['plans/[id]/page.tsx', 'drills/[id]/page.tsx']) assert.match(source[f], /retry: retryRead/, `${f}: a refusal is said at once, not after a seven-second spinner`);
  assert.match(source['bcmData.ts'], /retry: retryRead/);
  const register = source['_register/BcmRegister.tsx'];
  assert.match(register, /const noList = query\.isError && !query\.rows;/, 'a list that could not be read is never an empty register');
  assert.match(register, /<ErrorState \{\.\.\.failure\} onRetry=\{canRetry\(query\.error\)/);
  assert.match(register, /status[Oo]f\(query\.error\) === 403/, 'a refusal says the person has no access, and offers no Retry');
  assert.match(register, /<SkeletonRows rows=\{10\}/, 'a skeleton while the register loads');
  assert.match(register, /kind="noMatches"/);
  assert.match(register, /Couldn't refresh the \$\{noun\.other\}/, 'a refresh that fails keeps what was shown, and says it may be out of date');
  for (const f of ['_plans/PlansRegister.tsx', '_drills/DrillsRegister.tsx', '_findings/FindingsRegister.tsx']) assert.match(source[f], /kind="firstUse" bare/, `${f}: the first-use state`);
  assert.match(source['page.tsx'], /query\.isError && !d/, 'a refetch that fails keeps what was shown');
  assert.match(source['page.tsx'], /isEmptyTenant\(d\)/);
  assert.match(source['page.tsx'], /<EmptyState\s+kind="firstUse"/);
  assert.doesNotMatch(source['page.tsx'], /\?\? 0\b|\|\| 0\b/, 'a failed or empty answer is never read as a zero');
});

test('the counts are the server\'s: every register loads whole, says its true total and says when the server cut it', () => {
  const register = source['_register/BcmRegister.tsx'];
  assert.match(register, /countLine\(noun, query\.total, rows\.length, !!query\.truncated\)/);
  assert.match(register, /query\.truncated && <Notice tone="info"/);
  assert.match(register, /<Pager className="mt-\[8px\]" page=\{pageClamped\}/);
  assert.doesNotMatch(register, /\.length \|\| 0/, 'a count is never the length of a capped array');
  assert.match(source['_overview/overviewModel.ts'], /value: d\.totals\.overdue_drills/, 'a counter of the Overview is the server\'s number');
});

test('the registers keep their state in the address, and the Overview opens the lists it counts', () => {
  assert.match(source['_plans/PlansRegister.tsx'], /schemaFor\(PLANS\)/);
  assert.match(source['_drills/DrillsRegister.tsx'], /schemaFor\(DRILLS\)/);
  assert.match(source['_findings/FindingsRegister.tsx'], /schemaFor\(FINDINGS\)/);
  for (const f of ['_plans/PlansRegister.tsx', '_drills/DrillsRegister.tsx', '_findings/FindingsRegister.tsx']) assert.match(source[f], /useAddressState\(SCHEMA\)/, f);
  const model = source['_overview/overviewModel.ts'];
  for (const href of ['/bcm/drills?quick=overdue', '/bcm/plans?quick=review', '/bcm/plans?quick=draft', '/bcm/plans?quick=nostrategy', '/bcm/findings?quick=noissue']) assert.ok(model.includes(`'${href}'`), href);
  assert.match(source['_overview/OverviewParts.tsx'], /href=\{`\/bcm\/plans\?status=\$\{s\}`\}/);
  assert.match(source['_overview/OverviewParts.tsx'], /href=\{`\/bcm\/findings\?severity=\$\{s\}&quick=open`\}/);
  assert.match(source['page.tsx'], /href="\/bcm\/plans\?new=1"/, 'the first-use action opens the Add plan form');
  assert.match(source['_plans/PlansRegister.tsx'], /address\.new && canCreate/, '?new=1 opens the form for a person who may create');
  assert.match(source['_drills/DrillsRegister.tsx'], /address\.new && canCreate/);
  assert.match(source['plans/[id]/page.tsx'], /useTabParam<PlanTab>\('tab', TABS, \{ fallback: 'overview' \}\)/);
  assert.match(source['drills/[id]/page.tsx'], /useTabParam<DrillTab>\('tab', TABS, \{ fallback: 'overview' \}\)/);
  assert.match(source['plans/[id]/_BiaTab.tsx'], /process: integer\(0, \{ min: 1 \}\)/);
});

test('status and dates: the registry\'s words, the platform\'s formatter, a day is a day, a moment is the viewer\'s own', () => {
  for (const f of ALL) {
    assert.doesNotMatch(source[f], /toLocaleDateString|toLocaleString/, `${f}: the platform's formatter writes dates and numbers`);
    if (f.endsWith('.tsx')) assert.doesNotMatch(source[f], /new Date\(/, `${f}: a screen never parses a date itself (a naive-UTC string parsed here shifts); the models count days, the formatter writes them`);
    assert.doesNotMatch(source[f], /_LABEL\b|_CLS\b|PlanStatusBadge|DrillStatusBadge|SeverityBadge|StrategyStatusBadge|IssueStatusBadge|useBcmToast|fmtDate|fmtDateTime/, `${f}: the old page-local labels, badges, toast and date helpers are gone`);
  }
  assert.match(source['_register/bits.tsx'], /formatDate\(value, \{ calendar: true \}\)/, 'a day (scheduled, review due, due) never moves');
  assert.match(source['drills/[id]/page.tsx'], /formatDateTime\(drill\.actual_start\)/);
  assert.match(source['drills/[id]/page.tsx'], /formatDateTime\(drill\.actual_end\)/);
  assert.match(source['drills/[id]/_ResultCard.tsx'], /formatDateTime\(r\.recorded_at\)/);
  assert.match(source['_plans/PlansRegister.tsx'], /statusPill\(planStatus, /);
  assert.match(source['_drills/DrillsRegister.tsx'], /statusPill\(drillStatus, d?\.?[a-z.]*effective_status|statusPill\(drillStatus, row\.record\.effective_status\)/);
});

test('the heads are the kit\'s: PageHeader variant="page", with the (i) for what used to be an intro sentence', () => {
  for (const f of ['page.tsx', '_plans/PlansRegister.tsx', '_drills/DrillsRegister.tsx', '_findings/FindingsRegister.tsx', 'plans/[id]/page.tsx', 'drills/[id]/page.tsx']) assert.match(source[f], /<PageHeader\s+variant="page"/, f);
  for (const f of ['page.tsx', '_plans/PlansRegister.tsx', '_drills/DrillsRegister.tsx', '_findings/FindingsRegister.tsx']) {
    assert.match(source[f], /title=\{AREA\}/, `${f}: the four list pages share the area's name`);
    assert.match(source[f], /<BcmTabs \/>/, `${f}: and the strip of tabs`);
  }
  for (const f of ['plans/[id]/page.tsx', 'drills/[id]/page.tsx']) assert.match(source[f], /back=\{BACK\}/, `${f}: a link back to the list`);
  for (const f of ['plans/[id]/page.tsx', 'drills/[id]/page.tsx']) assert.match(source[f], /<ReadOnlyNote>/, `${f}: a person who can change nothing is told so`);
  for (const f of ['plans/[id]/page.tsx', 'drills/[id]/page.tsx']) assert.match(source[f], /<JourneyStrip journey=/, `${f}: where the record stands`);
});

test('every file follows the kit\'s rules: only the --ds tokens and arbitrary values, no legacy scope, no legacy pieces', () => {
  for (const f of ALL) {
    assert.deepEqual(findViolations(source[f]).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`), []);
    assert.doesNotMatch(source[f], /governance-light|docUi|DocPageHeader|PageLoader|common\/EmptyState|MultiSelectDropdown|ComboBoxInput|SearchInput|ToastProvider|useToast/, f);
    assert.doesNotMatch(source[f], /<(button|select|textarea|input)\b[^>]*className="[^"]*(bg-primary|bg-white)/, f);
  }
});

// ── a bare <p>, <td>, <th>, <h2> or <h3> gets 11.5px and dark text from the platform CSS (bareText.test.ts guards the migrated Governance folders; this is the same rule for this one) ──
const SIZE = /(?<![\w:\-[])!?text-(?:ds-(?:title|section|body|label)|xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|\[\d[^\]]*\])(?![\w-])/;

/** The opening tags `<name ...>` of a source, where each starts, and the text of the string constants of the file they may take their class from. */
function bareTags(text: string): string[] {
  const constants = Array.from(text.matchAll(/const ([A-Z][A-Z0-9_]+)\s*=\s*(?:'([^']*)'|`([^`]*)`)/g)).reduce<Record<string, string>>((all, m) => ({ ...all, [m[1]]: m[2] ?? m[3] }), {});
  const bad: string[] = [];
  for (const name of ['p', 'td', 'th', 'h2', 'h3']) {
    for (const open of Array.from(text.matchAll(new RegExp(`<${name}(?=[\\s>])`, 'g')))) {
      let depth = 0;
      let quote = '';
      let end = -1;
      for (let i = (open.index ?? 0) + 1 + name.length; i < text.length; i++) {            // the first `>` outside braces and quotes
        const c = text[i];
        if (quote) { if (c === quote && text[i - 1] !== '\\') quote = ''; continue; }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) { end = i; break; }
      }
      const tag = text.slice(open.index ?? 0, end + 1);
      const named = Array.from(tag.matchAll(/\b([A-Z][A-Z0-9_]+)\b/g)).map((m) => constants[m[1]] ?? '').join(' ');
      if (!SIZE.test(`${tag} ${named}`)) bad.push(tag.replace(/\s+/g, ' ').slice(0, 120));
    }
  }
  return bad;
}

test('no <p>, <td>, <th>, <h2> or <h3> of these pages is bare: each names a text size (the scanner can say no)', () => {
  assert.deepEqual(bareTags('<p className="mt-1">x</p><p>y</p>'), ['<p className="mt-1">', '<p>']);
  assert.deepEqual(bareTags("const NOTE = 'text-ds-label';\nconst a = <p className={clsx(NOTE, 'mt-1')}>x</p>;"), []);
  assert.deepEqual(bareTags('<p className="text-ds-body text-ds-fg">x</p><h3 className="!text-ds-body">y</h3>'), []);
  for (const f of TSX) assert.deepEqual(bareTags(source[f]).map((t) => `${f}: ${t}`), []);
});

test('only the BCM pages import their helpers, and the old page-local mini kit is not imported by anything', () => {
  /** every .ts / .tsx under src, so the test can say who imports the helpers */
  function sources(dir: URL, found: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const url = new URL(name, dir);
      if (statSync(url).isDirectory()) { if (name !== 'node_modules' && name !== '.next') sources(new URL(`${name}/`, dir), found); }
      else if (/\.tsx?$/.test(name) && !/\.test\.ts$/.test(name)) found.push(url.pathname);
    }
    return found;
  }
  const importers = sources(new URL('../../../', import.meta.url))
    .filter((f) => /from '[^']*\/_bcm-ui'|from '\.{1,2}\/(\.\.\/)*bcmModel'/.test(readFileSync(f.replace(/^\/(\w:)/, '$1'), 'utf8')))
    .map((f) => f.replace(/^.*\/src\//, ''))
    .filter((f) => !f.startsWith('app/(dashboard)/bcm/'));
  assert.deepEqual(importers, []);
});
