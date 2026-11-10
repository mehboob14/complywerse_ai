// node --test "src/app/(dashboard)/vendor-risk/vendors/[[]id]/recordGuard.test.ts"
// Source-text guard for the vendor record (vendor-risk/vendors/[id]): the page is a host with lazy tabs, the kit's rules hold in every file, nothing a person should not see (an id, "User 5",
// an endpoint), no native dialog, no admin-only people read, no server time shown through the browser's locale, every read has an error branch, and the first paint asks for four reads.
// The Finding files (FindingCard, FindingDialogs, FindingsPanel, ActionPlanPanel, FindingsTab) belong to the intake-and-findings group and are listed in FINDING_FILES: that group takes them
// onto the same rules and removes them from the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const HERE = fileURLToPath(new URL('./', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const rel = (f: string) => f.replace(HERE, '').replace(/\\/g, '/');
const read = (f: string) => readFileSync(f, 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/\s.*$/, '$1')).join('\n');

const FINDING_FILES = new Set(['_tpra/FindingCard.tsx', '_tpra/FindingDialogs.tsx', '_tpra/findingFields.tsx', '_tpra/FindingList.tsx', '_tpra/FindingsPanel.tsx', '_tpra/ActionPlanPanel.tsx', '_tabs/FindingsTab.tsx']);
const ALL = walk(HERE).map((f) => ({ f, name: rel(f) }));
const MINE = ALL.filter((x) => !FINDING_FILES.has(x.name));
const PAGE = read(join(HERE, 'page.tsx'));

test('the record is a host, its parts are files of their own, and the Finding files are still where the findings group expects them', () => {
  const names = ALL.map((x) => x.name);
  for (const part of ['page.tsx', '_record/RecordHead.tsx', '_record/NextUpStrip.tsx', '_record/AtAGlance.tsx', '_record/EngagementPicker.tsx', '_record/recordData.ts', '_record/LazyMount.tsx',
    '_record/Activity.tsx', '_record/RecordPanel.tsx', '_record/recordUi.tsx', '_record/btn.ts', '_tabs/OverviewTab.tsx', '_tabs/LifecycleTab.tsx', '_tabs/AssessmentsTab.tsx',
    '_tabs/PaperworkTab.tsx', '_tabs/MonitoringTab.tsx', 'summary/page.tsx']) assert.ok(names.includes(part), part);
  for (const f of Array.from(FINDING_FILES)) assert.ok(names.includes(f), `${f}: owned by the intake-and-findings group`);
  assert.ok(PAGE.split('\n').length < 220, 'the host stays a host (it was a 315-line page over 10,916 lines of tabs and panels)');
});

test('the kit\'s rules hold in every file of the record: no remapped class, no palette colour, no hex class, nothing under 12px', () => {
  const bad = MINE.flatMap(({ f, name }) => findViolations(read(f)).map((v) => `${name}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('five tab bodies are chunks of their own, loaded when the tab is first opened; the heavy dialogs load when first used', () => {
  assert.match(PAGE, /dynamic\(load, \{ ssr: false, loading: TabLoading \}\)/);
  for (const tab of ['LifecycleTab', 'AssessmentsTab', 'FindingsTab', 'PaperworkTab', 'MonitoringTab']) assert.match(PAGE, new RegExp(`const ${tab} = lazyTab\\(\\(\\) => import\\('\\./_tabs/${tab}'\\)\\)`), tab);
  assert.match(PAGE, /const VendorFormDialog = dynamic\(\(\) => import\('\.\.\/_components\/VendorFormDialog'\)/);
  assert.match(PAGE, /<TabPanel key=\{key\} tabKey=\{key\} lazy>/, 'a tab not yet opened draws nothing');
  assert.ok(!/from '\.\/_tabs\/(Lifecycle|Assessments|Findings|Paperwork|Monitoring)Tab'/.test(PAGE), 'no static import of a lazy tab');
});

test('the first paint asks for four reads (the vendor, its engagements, its exit, its contacts); the decorations wait for the first paint', () => {
  const data = read(join(HERE, '_record/recordData.ts'));
  assert.match(PAGE, /useVendorRecord\(vendorId\)/);
  assert.match(PAGE, /useEngagements\(vendorId\)/);
  assert.match(PAGE, /useOffboarding\(vendorId\)/);
  assert.match(read(join(HERE, '_record/AtAGlance.tsx')), /useRecordContacts\(vendorId, !archived\)/);
  // who is next, the two tab counts and the logo are asked for after the first paint
  assert.match(PAGE, /const late = useAfterPaint\(!!vendor\)/);
  assert.match(PAGE, /useNextUp\(vendorId, engagementId, late && !archived\)/);
  assert.match(PAGE, /useTabCounts\(vendorId, engagementId, late && !archived\)/);       // an archived supplier has nothing to read: no request that would answer "not found"
  assert.match(data, /enabled,\s*staleTime: 15_000/);
  assert.match(read(join(HERE, '_record/AtAGlance.tsx')), /\{late && <VendorLogo/);
  // the duplicates are read when the section is opened, the stage count never loads a list of its own
  assert.match(read(join(HERE, '_record/AtAGlance.tsx')), /useDuplicates\([\s\S]*?vendorId, wantDuplicates\)/);
  assert.match(read(join(HERE, '_tpra/StageWorkspace.tsx')), /queryKey: \['tpra-evidence', assessmentId, 'all'\][\s\S]*select: \(rows\) => rows\.length/);
  // the Overview's lower cards are read when they come near the screen
  const overview = read(join(HERE, '_tabs/OverviewTab.tsx'));
  for (const card of ['DependenciesPanel', 'YourFields', 'ActivityPanel']) assert.match(overview, new RegExp(`<LazyMount[^>]*><${card}`), card);
});

test('no native dialog (confirm, alert, prompt) and no hover-only action', () => {
  for (const { f, name } of MINE) {
    const src = code(read(f));
    assert.ok(!/window\.(confirm|alert|prompt)\b|(?<![.\w])(confirm|alert|prompt)\(/.test(src.replace(/await confirm\(/g, '').replace(/useConfirm\(\)/g, '')), `${name}: a native dialog`);
    assert.ok(!/opacity-0[^'"`]*group-hover|group-hover:opacity-100/.test(src), `${name}: an action that shows only on hover`);
  }
});

test('people come from the module\'s own read (GET /vendor-risk/intake/people), never the admin user list, and a missing person is never "User 12"', () => {
  for (const { f, name } of MINE) {
    const src = code(read(f));
    assert.ok(!/adminApi|getUsers\(|getTenantUsers\(|\/admin\/users/.test(src), `${name}: reads the admin user list`);
    assert.ok(!/User \$\{|`User \$/.test(src), `${name}: names a person "User N"`);
  }
  for (const name of ['_tpra/StageWorkspace.tsx', '_tpra/TeamRosterPanel.tsx', '_tpra/IntakePanel.tsx', '_tpra/ApprovalPanel.tsx', '_tpra/PlanningPanel.tsx']) {
    assert.match(read(join(HERE, name)), /usePeople\(\)/, name);
  }
});

test('Rule U1: no record number, no "#id", no endpoint and no browser-locale date in a visible string', () => {
  for (const { f, name } of MINE) {
    const src = code(read(f));
    assert.ok(!/#\$\{|#\{|ID: #|Vendor #|Evidence #|Finding #|Issue #|VND-ID|reassessment #/.test(src), `${name}: a record number on screen`);
    assert.ok(!/toLocaleDateString|toLocaleTimeString|new Date\([^)]*\)\.toLocaleString/.test(src), `${name}: a date drawn through the browser's locale`);
  }
});

test('the vendor module\'s own _ui kit is gone from the record: only its pure formatters and the tier maths are still imported', () => {
  for (const { f, name } of MINE) {
    for (const m of Array.from(code(read(f)).matchAll(/from '([^']*\/_ui)(?:\/([A-Za-z]+))?'/g))) {
      if (/regulatory-changes/.test(m[1])) assert.fail(`${name}: imports another module's ui kit`);
      assert.ok(m[2] && ['fmt', 'chartMath', 'tiers'].includes(m[2]), `${name}: imports ${m[0]}`);
    }
  }
});

// A read that fails must be said, never drawn as an empty list or as "not started". Every file that asks for data names its failure: an error branch, or a hook that does.
const WITHOUT_OWN_ERROR_BRANCH: Record<string, string> = {
  '_assessments/AssessmentDialog.tsx': 'the questionnaire thread is a secondary read; the card it opens from already said what failed',
  '_assessments/AssessmentCard.tsx': 'a card: no read',
  '_record/Activity.tsx': 'ActivityBody names the failure (q.isError) before the empty branch',
  '_record/recordData.ts': 'the hooks: the page and the glance read isError from them',
  '_tpra/OffboardingPanel.tsx': 'the exit card draws nothing without data; the page says when the exit status could not be read',
  '_tpra/TpraLifecycle.tsx': 'useLifecycle: "Failed to load the lifecycle" with Retry',
  '_tpra/DomainRiskView.tsx': 'drawn from the lifecycle read the workspace already checked',
  '_tpra/PortalPanel.tsx': 'four of its sections name their failure; the contact picker falls back to "all contacts" on a failed read',
  '_tpra/PlanningPanel.tsx': 'templates and reviewers are pick lists: a failed list is an empty pick list with the form still usable',
  '_tpra/SlaPanel.tsx': 'the contracts read only names the contract of a row',
  '_tpra/EngagementsPanel.tsx': 'useEngagements: isError with Retry',
  '_tpra/StageWorkspace.tsx': 'the only read is the count on the Evidence tile, which is left off when it cannot be read (the drawer behind it names its own failure)',
  '_tpra/TieringDialog.tsx': 'the engagements read is the host page’s, which names its failure before this dialog is offered',
};
test('every read of the record has an error branch (a failed read is never an empty list)', () => {
  const bad = MINE.filter(({ f, name }) => /useQuery[<(]|useEngagements\(|useVendorFindings\(/.test(code(read(f))) && !WITHOUT_OWN_ERROR_BRANCH[name] && !/isError|\.error\b|ErrorState|failed\(/.test(code(read(f)))).map((x) => x.name);
  assert.deepEqual(bad, []);
});

test('a refused or failed read of the engagements is not a failure for an archived supplier (the reads answer "not found" there)', () => {
  const data = read(join(HERE, '_record/recordData.ts'));
  assert.match(data, /export const failed = \(q: \{ isError: boolean; error: unknown \}\): boolean => q\.isError && statusOf\(q\.error\) !== 404;/);
  assert.match(PAGE, /const engagementsFailed = failed\(engagements\);/);
});

test('the printable summary stays a page of its own that does not draw the kit\'s head', () => {
  const summary = read(join(HERE, 'summary/page.tsx'));
  assert.ok(!/<PageHeader/.test(summary));
  assert.match(summary, /print/i);
});
