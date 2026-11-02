// node --test "src/app/(dashboard)/bcm/bcmPages.test.ts"
// What the Business Continuity pages keep and what they no longer do, pinned in the files that carry it (there is no React renderer here; behaviour is checked in a browser): the requests with their
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

test('the folder is the six pages and their pieces (a new file is a decision: it has to be added here)', () => {
  assert.deepEqual(ALL.slice().sort(), [
    '_bcm-ui.tsx', 'bcmModel.ts', 'drills/[id]/_FindingsCard.tsx', 'drills/[id]/_ResultCard.tsx', 'drills/[id]/page.tsx', 'drills/_DrillForm.tsx', 'drills/page.tsx',
    'page.tsx', 'plans/[id]/_BiaDrawer.tsx', 'plans/[id]/_BiaForm.tsx', 'plans/[id]/_Sections.tsx', 'plans/[id]/page.tsx', 'plans/_PlanForm.tsx', 'plans/page.tsx',
  ]);
});

test('the requests each page makes keep their keys and endpoints (the Reports and the dashboard read the same routes)', () => {
  assert.match(source['page.tsx'], /queryKey: \['bcm-dashboard'\],\s*\n\s*queryFn: async \(\) => \(await bcmApi\.dashboard\(\)\)\.data/);
  assert.match(source['page.tsx'], /refetchInterval: 60_000/);
  assert.match(source['plans/page.tsx'], /queryKey: \['bcm-plans'\]/);
  assert.match(source['plans/page.tsx'], /bcmApi\.plans\.list\(\)/);
  assert.match(source['plans/page.tsx'], /bcmApi\.plans\.remove\(p\.id\)/);
  assert.match(source['plans/[id]/page.tsx'], /queryKey: \['bcm-plan', planId\]/);
  assert.match(source['plans/[id]/page.tsx'], /bcmApi\.plans\.get\(planId\)/);
  assert.match(source['plans/[id]/page.tsx'], /bcmApi\.plans\.transition\(planId, status\)/);
  assert.match(source['drills/page.tsx'], /queryKey: \['bcm-drills'\]/);
  assert.match(source['drills/page.tsx'], /bcmApi\.drills\.list\(\)/);
  assert.match(source['drills/page.tsx'], /bcmApi\.drills\.remove\(d\.id\)/);
  assert.match(source['drills/[id]/page.tsx'], /queryKey: \['bcm-drill', drillId\]/);
  assert.match(source['drills/[id]/page.tsx'], /bcmApi\.drills\.get\(drillId\)/);
  assert.match(source['drills/[id]/page.tsx'], /bcmApi\.drills\.transition\(drillId, status\)/);
  assert.match(source['drills/_DrillForm.tsx'], /queryKey: \['bcm-plans-min'\]/);
  assert.match(source['_bcm-ui.tsx'], /queryKey: \['bcm-options', kind\]/);
  assert.match(source['_bcm-ui.tsx'], /bcmApi\.options\[kind\]\(\)/);
});

test('every write keeps its endpoint and refreshes what it always refreshed', () => {
  const calls = (file: string) => Array.from(source[file].matchAll(/bcmApi\.([a-zA-Z]+\.[a-zA-Z]+)\(/g), (m) => m[1]).sort();
  assert.deepEqual(calls('plans/_PlanForm.tsx'), ['plans.create', 'plans.update']);
  assert.deepEqual(calls('plans/[id]/_BiaForm.tsx'), ['bia.create']);
  assert.deepEqual(calls('plans/[id]/_BiaDrawer.tsx'), ['bia.addDependency', 'bia.addStrategy', 'bia.linkRisk', 'bia.update', 'dependencies.remove', 'strategies.remove', 'strategies.update']);
  assert.deepEqual(calls('drills/_DrillForm.tsx'), ['drills.create', 'drills.create', 'drills.update', 'plans.list']);
  assert.deepEqual(calls('drills/[id]/_ResultCard.tsx'), ['drills.saveResult']);
  assert.deepEqual(calls('drills/[id]/_FindingsCard.tsx'), ['findings.create', 'findings.createIssue', 'findings.linkRisk', 'findings.remove']);
  // the keys the old pages invalidated (and no more)
  assert.match(source['plans/_PlanForm.tsx'], /invalidate: \[\['bcm-plans'\]\]/);
  assert.match(source['plans/_PlanForm.tsx'], /invalidate: \[\['bcm-plan', plan\?\.id \?\? 0\], \['bcm-plans'\]\]/);
  assert.match(source['plans/[id]/page.tsx'], /invalidate: \[\['bcm-plan', planId\], \['bcm-plans'\]\]/);
  assert.match(source['drills/_DrillForm.tsx'], /invalidate: \[\['bcm-drills'\]\]/);
  assert.match(source['drills/_DrillForm.tsx'], /invalidate: \[\['bcm-plan', mode\.kind === 'schedule' \? mode\.planId : 0\]\]/);
  assert.match(source['drills/_DrillForm.tsx'], /invalidate: \[\['bcm-drill', edit\?\.id \?\? 0\]\]/);
  assert.match(source['drills/[id]/page.tsx'], /invalidate: \[\['bcm-drill', drillId\]\]/);
});

test('every page asks for the same rights as before (none added, none dropped); the server decides the rest', () => {
  assert.deepEqual(permissionsOf(source['page.tsx']), ['bcm:plans:create'], 'the Overview only decides whether to offer "Create a plan"');
  assert.deepEqual(permissionsOf(source['plans/page.tsx']), ['bcm:plans:create', 'bcm:plans:delete']);
  assert.deepEqual(permissionsOf(source['drills/page.tsx']), ['bcm:drills:create', 'bcm:drills:delete']);
  assert.deepEqual(permissionsOf(source['plans/[id]/page.tsx']), ['bcm:bia:create', 'bcm:bia:edit', 'bcm:drills:create', 'bcm:plans:edit']);
  assert.deepEqual(permissionsOf(source['plans/[id]/_BiaDrawer.tsx']), ['bcm:bia:edit']);
  assert.deepEqual(permissionsOf(source['drills/[id]/page.tsx']), ['bcm:drills:edit', 'bcm:findings:create', 'bcm:findings:delete', 'bcm:findings:edit']);
  assert.deepEqual(permissionsOf(source['drills/[id]/_FindingsCard.tsx']), ['bcm:findings:delete', 'bcm:findings:edit']);
  assert.match(source['plans/page.tsx'], /cardActions=\{canDelete \? rowMenu : undefined\}/, 'no actions column or menu for someone who may not delete');
  assert.match(source['plans/page.tsx'], /\.\.\.\(canDelete \? \[\{ key: 'actions'/);
  assert.match(source['drills/page.tsx'], /\.\.\.\(canDelete \? \[\{ key: 'actions'/);
  assert.match(source['plans/[id]/page.tsx'], /actions=\{canEdit \? \(/, 'Edit and Change status are for plans:edit');
  assert.match(source['plans/[id]/_Sections.tsx'], /canAdd \? <Button size="sm"/);
});

test('every request reports its own outcome: no bare useMutation, the confirmation only after the server answered, a create is never offered again', () => {
  for (const f of ALL) assert.doesNotMatch(source[f], /\buseMutation\(/, `${f}: a bare mutation reports nothing`);
  const count = (f: string) => (source[f].match(/useReportedMutation\(/g) ?? []).length;
  assert.equal(count('plans/page.tsx'), 1);
  assert.equal(count('drills/page.tsx'), 1);
  assert.equal(count('plans/_PlanForm.tsx'), 2);
  assert.equal(count('plans/[id]/page.tsx'), 1);
  assert.equal(count('plans/[id]/_BiaForm.tsx'), 1);
  assert.equal(count('plans/[id]/_BiaDrawer.tsx'), 7);
  assert.equal(count('drills/_DrillForm.tsx'), 3);
  assert.equal(count('drills/[id]/page.tsx'), 1);
  assert.equal(count('drills/[id]/_ResultCard.tsx'), 1);
  assert.equal(count('drills/[id]/_FindingsCard.tsx'), 4);
  for (const f of ['plans/_PlanForm.tsx', 'plans/[id]/_BiaForm.tsx', 'drills/_DrillForm.tsx']) {
    assert.match(source[f], /retryable: false/, `${f}: a create lost in the network could be made twice if repeated`);
    assert.match(source[f], /toast: 'success'/, `${f}: the drawer shows a failure itself; the toast only confirms`);
    assert.match(source[f], /onError: \(error\) => setProblem\(errorMessage\(error\)\)|onError: \(error: unknown\) => setProblem\(errorMessage\(error\)\)|\.\.\.common/, `${f}: what the server said is shown in the form`);
  }
  assert.match(source['drills/[id]/_ResultCard.tsx'], /toast: 'errors'/, 'the save bar says "Saved"; a failure is the toast with Retry');
  assert.match(source['plans/[id]/_BiaDrawer.tsx'], /retryable: false/);
  assert.match(source['drills/[id]/_FindingsCard.tsx'], /retryable: false/);
});

test('no native dialog, no action hidden until hover, no hand-rolled overlay, no developer text on screen', () => {
  for (const f of ALL) {
    assert.doesNotMatch(source[f], /\bwindow\.(confirm|alert|prompt)\(|(^|[^.\w])(alert|prompt)\(|\bif \(!?confirm\(/m, `${f}: a native dialog (the kit's confirm() is awaited and comes from useConfirm)`);
    assert.doesNotMatch(source[f], /opacity-0|group-hover/, `${f}: an action that is invisible until hover (and for ever on touch and keyboard)`);
    assert.doesNotMatch(source[f], /fixed inset-0|aria-modal/, `${f}: a hand-rolled overlay: the kit's drawer and dialog take focus, name themselves and guard typed input`);
    assert.doesNotMatch(source[f], /backend may need a restart|expose the endpoints/, `${f}: developer text`);
  }
});

test('every delete asks first and says what goes with it; the question is the kit\'s', () => {
  for (const f of ['plans/page.tsx', 'drills/page.tsx', 'plans/[id]/_BiaDrawer.tsx', 'drills/[id]/_FindingsCard.tsx']) {
    assert.match(source[f], /const \{ confirm, confirmDialog \} = useConfirm\(\);/, f);
    assert.match(source[f], /tone: 'danger'/, f);
    assert.match(source[f], /\{confirmDialog\}/, f);
  }
  assert.match(source['plans/page.tsx'], /confirm\(\{ \.\.\.planDeleteWords\(p\), tone: 'danger' \}\)/);
  assert.match(source['drills/page.tsx'], /confirm\(\{ \.\.\.drillDeleteWords\(d\), tone: 'danger' \}\)/);
  assert.match(source['plans/[id]/_BiaDrawer.tsx'], /dependencyDeleteWords\(d\.name\)/);
  assert.match(source['plans/[id]/_BiaDrawer.tsx'], /strategyDeleteWords\(strategyType\.label\(s\.strategy_type\)\)/);
  assert.match(source['drills/[id]/_FindingsCard.tsx'], /findingDeleteWords\(f\.title\)/);
  // the actions that cannot be undone from here ask too
  assert.match(source['drills/[id]/_FindingsCard.tsx'], /Create an issue for this finding\?/);
  assert.match(source['drills/[id]/_FindingsCard.tsx'], /Create a new risk from this finding\?/);
  assert.match(source['plans/[id]/_BiaDrawer.tsx'], /Create a new risk from this process\?/);
});

test('after a delete focus goes back to where the list or the section starts, unless the person is typing or a dialog is open', () => {
  for (const f of ['plans/page.tsx', 'drills/page.tsx']) {
    assert.match(source[f], /here\.closest\('\[role="dialog"\]'\) \|\| here\.matches\('input, textarea, select'\)/, f);
    assert.match(source[f], /if \(!busy\) searchField\.current\?\.focus\(\);/, f);
  }
  assert.match(source['plans/[id]/_BiaDrawer.tsx'], /onSuccess: \(\) => addDepButton\.current\?\.focus\(\)/);
  assert.match(source['plans/[id]/_BiaDrawer.tsx'], /onSuccess: \(\) => addStratButton\.current\?\.focus\(\)/);
  assert.match(source['drills/[id]/_FindingsCard.tsx'], /onSuccess: \(\) => addButton\.current\?\.focus\(\)/);
});

test('the drawers and dialogs are the kit\'s and guard typed input', () => {
  for (const f of ['plans/_PlanForm.tsx', 'plans/[id]/_BiaForm.tsx', 'drills/_DrillForm.tsx', 'plans/[id]/_BiaDrawer.tsx']) {
    assert.match(source[f], /<RightSlidePanel\s+isOpen\s+onClose=\{onClose\}\s+dirty=\{/, f);
  }
  assert.match(source['drills/[id]/_FindingsCard.tsx'], /<AnimatedModal\s+isOpen onClose=\{onClose\} dirty=\{risk !== null\}/);
  for (const f of ['plans/_PlanForm.tsx', 'plans/[id]/_BiaForm.tsx', 'drills/_DrillForm.tsx']) assert.match(source[f], /<FormField/, f);
  assert.match(source['plans/_PlanForm.tsx'], /planDirty\(opened, form\)/);
  assert.match(source['drills/_DrillForm.tsx'], /drillDirty\(opened, form\)/);
  assert.match(source['plans/[id]/_BiaForm.tsx'], /dirty=\{biaDirty\(form\)\}/);
  assert.match(source['drills/[id]/_ResultCard.tsx'], /<SaveBar/);
  assert.match(source['drills/[id]/_ResultCard.tsx'], /window\.addEventListener\('beforeunload', ask\)/, 'leaving a half-written result asks');
});

test('each form sends what the old modal sent (the builders are pinned in bcmModel.test.ts) and says what is wrong before it sends', () => {
  assert.match(source['plans/_PlanForm.tsx'], /update\.mutate\(planUpdatePayload\(form\)\)/);
  assert.match(source['plans/_PlanForm.tsx'], /create\.mutate\(planCreatePayload\(form\)\)/);
  assert.match(source['drills/_DrillForm.tsx'], /create\.mutate\(drillCreatePayload\(form\)\)/);
  assert.match(source['drills/_DrillForm.tsx'], /schedule\.mutate\(drillSchedulePayload\(mode\.planId, form\)\)/);
  assert.match(source['drills/_DrillForm.tsx'], /update\.mutate\(drillUpdatePayload\(form, edit\?\.source_type === 'incident_triggered'\)\)/);
  assert.match(source['plans/[id]/_BiaForm.tsx'], /create\.mutate\(biaCreatePayload\(form\)\)/);
  assert.match(source['plans/[id]/_BiaDrawer.tsx'], /addDep\.mutate\(dependencyPayload\(dep\)\)/);
  assert.match(source['plans/[id]/_BiaDrawer.tsx'], /addStrat\.mutate\(strategyPayload\(strat\)\)/);
  assert.match(source['drills/[id]/_FindingsCard.tsx'], /add\.mutate\(findingPayload\(form\)\)/);
  assert.match(source['drills/[id]/_ResultCard.tsx'], /save\.mutate\(resultPayload\(form\)\)/);
  for (const f of ['plans/_PlanForm.tsx', 'plans/[id]/_BiaForm.tsx', 'drills/_DrillForm.tsx', 'drills/[id]/_ResultCard.tsx']) assert.match(source[f], /Errors?\(|errors\b/, f);
  assert.match(source['_bcm-ui.tsx'], /type="number" inputMode="numeric" min=\{0\} step=\{1\} unit="h"/, 'an hours field says its unit and takes whole numbers');
});

test('every state is said: loading, failed (with the server\'s words; Retry only where it can help), empty for the first time, nothing matches', () => {
  for (const f of ['page.tsx', 'plans/page.tsx', 'drills/page.tsx', 'plans/[id]/page.tsx', 'drills/[id]/page.tsx']) {
    assert.match(source[f], /<ErrorState/, `${f}: a failed read`);
    assert.match(source[f], /errorMessage\(query\.error\)|errorMessage\(list\.error\)/, `${f}: the server's words`);
    assert.match(source[f], /canRetry\(/, `${f}: Retry only where repeating can help`);
    assert.match(source[f], /retry: retryRead/, `${f}: a refusal is said at once, not after a seven-second spinner`);
    assert.doesNotMatch(source[f], /PageLoader/, `${f}: a skeleton, not a spinner`);
  }
  for (const f of ['plans/page.tsx', 'drills/page.tsx']) {
    assert.match(source[f], /<EmptyState\s+bare\s+kind="firstUse"/, f);
    assert.match(source[f], /<EmptyState bare kind="noMatches"[^>]*onClearFilters=\{clearFilters\}/, f);
    assert.match(source[f], /loading=\{loading\}/, `${f}: a skeleton while the list loads`);
    assert.match(source[f], /list\.isError && !list\.data/, `${f}: a refetch that fails keeps what was shown`);
  }
  assert.match(source['page.tsx'], /query\.isError && !d/, 'a refetch that fails keeps what was shown');
  assert.match(source['page.tsx'], /isEmptyTenant\(d\)/);
  assert.match(source['page.tsx'], /<EmptyState\s+kind="firstUse"/);
  assert.doesNotMatch(source['page.tsx'], /\?\? 0\b|\|\| 0\b/, 'a failed or empty answer is never read as a zero');
  assert.doesNotMatch(source['plans/page.tsx'] + source['drills/page.tsx'], /\.length \|\| 0|\?\.length \|\| 0/, 'a count is never the length of a capped array');
});

test('the counts are the server\'s: the list asks for the total, and says when the server cut it', () => {
  for (const f of ['plans/page.tsx', 'drills/page.tsx']) {
    assert.match(source[f], /const total = list\.data\?\.total \?\? /, f);
    assert.match(source[f], /rowCountText\(\{ shown: matches\.length, total,/, f);
    assert.match(source[f], /cutNotice\(\{ loaded: \w+\.length, total,/, f);
    assert.match(source[f], /<Notice tone="warning" title=\{cut\.title\}>\{cut\.message\}<\/Notice>/, f);
    assert.match(source[f], /<Pager\s+page=\{range\.page\} pageSize=\{size\} total=\{matches\.length\}/, f);
  }
});

test('the lists keep their filters in the address, and the Overview opens the lists it counts', () => {
  assert.match(source['plans/page.tsx'], /useAddressState\(PLAN_LIST_SCHEMA\)/);
  assert.match(source['drills/page.tsx'], /useAddressState\(DRILL_LIST_SCHEMA\)/);
  assert.match(source['page.tsx'], /href: '\/bcm\/drills\?status=overdue'/);
  assert.match(source['page.tsx'], /href: '\/bcm\/drills\?source=incident_triggered'/);
  assert.match(source['page.tsx'], /href=\{`\/bcm\/plans\?status=\$\{s\}`\}/);
  assert.match(source['page.tsx'], /href="\/bcm\/plans\?new=1"/, 'the first-use action opens the Add plan form');
});

test('status and dates: the registry\'s words, the platform\'s formatter, a day is a day, a moment is the viewer\'s own', () => {
  for (const f of ALL) {
    assert.doesNotMatch(source[f], /toLocaleDateString|toLocaleString|new Date\(/, `${f}: the platform's formatter writes dates and numbers (a naive-UTC string parsed here shifts)`);
    assert.doesNotMatch(source[f], /_LABEL\b|_CLS\b|PlanStatusBadge|DrillStatusBadge|SeverityBadge|StrategyStatusBadge|IssueStatusBadge|useBcmToast|fmtDate|fmtDateTime/, `${f}: the old page-local labels, badges, toast and date helpers are gone`);
  }
  for (const f of ['plans/page.tsx', 'drills/page.tsx', 'plans/[id]/page.tsx', 'plans/[id]/_Sections.tsx']) assert.match(source[f], /formatDate\([^)]*\{ calendar: true, empty: NOT_SET \}\)/, `${f}: a day (scheduled, review due) never moves`);
  assert.match(source['drills/[id]/page.tsx'], /formatDateTime\(drill\.actual_start\)/);
  assert.match(source['drills/[id]/page.tsx'], /formatDateTime\(drill\.actual_end\)/);
  assert.match(source['drills/[id]/_ResultCard.tsx'], /formatDateTime\(r\.recorded_at\)/);
  assert.match(source['page.tsx'], /statusLabel|drillStatus/);
});

test('the heads are the kit\'s: PageHeader variant="page", with the (i) for what used to be an intro sentence', () => {
  for (const f of ['page.tsx', 'plans/page.tsx', 'drills/page.tsx', 'plans/[id]/page.tsx', 'drills/[id]/page.tsx']) assert.match(source[f], /<PageHeader\s+variant="page"/, f);
  for (const f of ['plans/[id]/page.tsx', 'drills/[id]/page.tsx']) assert.match(source[f], /back=\{BACK\}/, `${f}: a link back to the list`);
  for (const f of ['plans/[id]/page.tsx', 'drills/[id]/page.tsx']) assert.match(source[f], /<ReadOnlyNote>/, `${f}: a person who can change nothing is told so`);
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
