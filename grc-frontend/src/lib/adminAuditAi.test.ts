// node --test "src/lib/adminAuditAi.test.ts"
// Source-text pins for the files of the adm-audit-ai group (Administration: audit log, AI usage, AI governance, scheduled jobs, the Workflow Engine and the shared module
// settings panels): the rebuilt pages follow the design-system kit's rules, no file draws a native dialog or a reveal-on-hover action, nothing is under 12px, no screen names
// a vendor, a model or a setting, a failed load is said, and the things the plan promises (the tracing address, the registry flags, the dead-code inventory) stay true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { findViolations } from '../components/ui/ds/kitRules.ts';
import { ADMIN_SECTIONS, sectionById } from './adminSections.ts';

const ADMIN = 'src/app/(dashboard)/admin';
const WF = 'src/app/(dashboard)/workflow-engine';
const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const inDir = (dir: string, re: RegExp) => readdirSync(dir).filter((f) => re.test(f)).map((f) => `${dir}/${f}`);

// the files rebuilt on the kit: held to the kit's own rules
const KIT_FILES = [
  ...inDir(`${ADMIN}/audit-logs`, /\.(tsx|ts)$/), ...inDir(`${ADMIN}/ai-usage`, /\.(tsx|ts)$/), `${ADMIN}/usage/page.tsx`,
  ...inDir(`${ADMIN}/ai-governance`, /\.(tsx|ts)$/), ...inDir(`${ADMIN}/scheduler`, /\.(tsx|ts)$/),
  `${WF}/page.tsx`, `${WF}/workflowModel.ts`, ...inDir(`${WF}/_parts`, /\.tsx$/), 'src/lib/statuses/adminAuditAi.ts',
].filter((f) => !/\.test\.ts$/.test(f) && existsSync(f));
// the older files the Workflow Engine page still draws and the shared settings panels: floor, dialogs and wording only
const LEGACY_LIVE = ['GuidedBuilder', 'AnalyticsTab', 'ApprovalsTab', 'SchedulesTab', 'SidebarTree'].map((n) => `${WF}/components/${n}.tsx`);
const SETTINGS = inDir('src/components/settings', /\.tsx$/);
const EVERY = [...KIT_FILES, ...LEGACY_LIVE, ...SETTINGS];
const code = (f: string) => read(f).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('the rebuilt files follow the kit rules: no palette class, named text size, named radius or shadow, no bare outline-none, nothing under 12px', () => {
  assert.ok(KIT_FILES.length >= 24, `the files are there (${KIT_FILES.length})`);
  const bad = KIT_FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no <p>, <td>, <th>, <h2> or <h3> is bare in the rebuilt pages, the live Workflow Engine files and the settings panels: each names a text size (the platform CSS gives a bare one 11.5px)', () => {
  const bad = [...KIT_FILES, ...LEGACY_LIVE.filter((f) => !/GuidedBuilder|SidebarTree/.test(f)), 'src/components/settings/ModuleSettingsPanel.tsx'].filter((f) => f.endsWith('.tsx')).flatMap((f) => Array.from(read(f).matchAll(/<(p|td|th|h2|h3)\b([^>]*)>/g))
    .filter((m) => !/(^|[\s"'`!])text-(ds-(title|section|body|label)|\[\d|xs|sm)/.test(m[2]))
    .map((m) => `${f}: <${m[1]}${m[2].slice(0, 60)}`));
  assert.deepEqual(bad, []);
});

test('no native dialog (confirm, alert, prompt) and no reveal-on-hover action in any file of the group, the live Workflow Engine files and the shared settings panels', () => {
  for (const f of EVERY.filter((x) => x.endsWith('.tsx'))) {
    const src = code(f);
    assert.doesNotMatch(src, /\bwindow\.(?:confirm|alert|prompt)\(|(?<![\w.])(?:alert|prompt)\(|(?<![\w.])(?<!await )confirm\(/, `${f}: a native dialog`);
    assert.doesNotMatch(src, /opacity-0[^'"`]*group-hover/, `${f}: an action revealed by hover`);
  }
});

test('nothing in the group draws text under 12px: no text-[Npx] below 12 and no inline font size below 12', () => {
  for (const f of EVERY) {
    const src = code(f);
    for (const m of Array.from(src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g))) assert.ok(Number(m[1]) >= 12, `${f}: ${m[0]}`);
    for (const m of Array.from(src.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g))) assert.ok(Number(m[1]) >= 12, `${f}: fontSize ${m[1]}`);
  }
});

test('no screen names a vendor, a model or a setting (rule 5 and U1): no service, engine or environment-variable name outside comments', () => {
  const words = /langsmith|openai|\bgpt[-\d]|claude|anthropic|LANGSMITH_API_KEY|DISABLE_PLATFORM_CLOCK|AI_USAGE_PRICE_CATALOG_JSON|CONNECTOR_MASTER_KEY|\bredis\b/i;
  for (const f of EVERY.filter((x) => x.endsWith('.tsx') || x.endsWith('format.ts') || x.endsWith('Model.ts'))) assert.doesNotMatch(code(f), words, f);
});

test('no audit, usage or governance screen shows the model that answered or a call\'s endpoint, and the audit date presets are not the UTC day', () => {
  for (const f of [...inDir(`${ADMIN}/ai-usage`, /\.tsx$/), ...inDir(`${ADMIN}/ai-governance`, /\.tsx$/)]) {
    assert.doesNotMatch(code(f), /\.(?:requested_model|response_model|model)\b(?!_)/, `${f}: a model name`);
    assert.doesNotMatch(code(f), /detail\.endpoint|\.http_method/, `${f}: an endpoint`);
  }
  assert.doesNotMatch(code(`${ADMIN}/audit-logs/auditModel.ts`), /toISOString\(\)\.slice\(0,\s*10\)/, 'the presets count the viewer\'s own days');
});

test('every request of the rebuilt pages says what failed: no silent catch that turns a failed load into an empty list', () => {
  for (const f of [`${WF}/components/AnalyticsTab.tsx`, `${WF}/components/ApprovalsTab.tsx`, `${WF}/components/SchedulesTab.tsx`]) {
    const src = read(f);
    assert.doesNotMatch(src, /silently fail|console\.error\('(?:Create|Decision)/, `${f}: a failure swallowed`);
    assert.match(src, /<ErrorState/, `${f}: a failed load has a state with a Retry`);
  }
  assert.match(read('src/components/settings/ModuleSettingsPanel.tsx'), /if \(isError && !data\)[\s\S]*?<ErrorState/, 'the settings panel no longer reads "Loading" for ever when the load fails');
  assert.match(read(`${WF}/components/GuidedBuilder.tsx`), /<ErrorState title="Couldn't open the builder"/, 'a builder that cannot load is an error, not a blank form');
  assert.match(read(`${ADMIN}/audit-logs/page.tsx`), /error=\{failure\}/);
  assert.match(read(`${ADMIN}/scheduler/page.tsx`), /error=\{schedule\.isError/);
});

test('the module settings panels keep their props (11 consumers): ModuleSettingsPanel takes { moduleKey } and the shared hooks keep their names', () => {
  const panel = read('src/components/settings/ModuleSettingsPanel.tsx');
  assert.match(panel, /export default function ModuleSettingsPanel\(\{ moduleKey \}: \{ moduleKey: string \}\)/);
  assert.match(panel, /export function ModuleSettingsSwitch\(\{ view, onView, label \}/);
  assert.match(panel, /export function SlaBadge\(\{ sla \}/);
  const fields = read('src/components/settings/CustomFields.tsx');
  for (const name of ['useModuleSettings', 'useSaveModuleSettings', 'useCanCustomise', 'FieldsEditor', 'ListsEditor', 'CustomFieldsTab', 'liveFields', 'statusChoices', 'listOptions']) {
    assert.match(fields, new RegExp(`export (?:function|const) ${name}\\b`), `${name} is still exported`);
  }
});

test('the Workflow Engine is a full-width page of its own: tabs in the address, kit dialogs, one load of what the page needs, no canvas and no "locked" switches', () => {
  const page = read(`${WF}/page.tsx`);
  const src = code(`${WF}/page.tsx`);
  assert.match(src, /useTabParam<TabKey>\('tab', TAB_KEYS/, 'the five tabs live in the address');
  assert.match(src, /useConfirm\(\)/, 'a question is the kit\'s confirm');
  assert.doesNotMatch(src, /@xyflow|ReactFlow|WORKFLOW_CREATION_LOCKED|locked|h-screen|overflow-hidden"\s*>?\s*$/m, 'no canvas, no locked switch, no full-screen frame');
  assert.equal((src.match(/nodeConfigOptions\(/g) ?? []).length, 0, 'the request made twice is not made at all (the builder loads its own catalog)');
  assert.match(page, /<GuidedBuilder key=\{`\$\{selectedId \?\? 'new'\}-\$\{builderKey\}`\}/, 'Cancel remounts the builder, so it really discards');
  assert.match(read(`${WF}/components/GuidedBuilder.tsx`), /<Sheet open onClose=\{onClose\} width="md" title="Add a trigger"/, 'the trigger picker is a kit Sheet (Escape, focus, a dialog role)');
  const section = sectionById('workflow');
  assert.equal(section?.url, '/workflow-engine');
  assert.equal(section?.layout, 'full');
});

test('the old free-form canvas components are listed as dead: nothing live imports them (so the inventory in the plan stays true)', () => {
  const dead = ['ConfigPanel', 'TopToolbar', 'NodePalette', 'AIPanel', 'TemplatesModal', 'VersionDrawer', 'CustomNodes'];
  const live = [`${WF}/page.tsx`, ...LEGACY_LIVE, ...inDir(`${WF}/_parts`, /\.tsx$/)];
  for (const f of live) for (const name of dead) assert.doesNotMatch(read(f), new RegExp(`from '\\.{1,2}/(?:components/)?${name}'`), `${f} imports ${name}`);
});

test('the registry: the five sections of this group draw their own heading, and the tracing view has its own address (GET /admin/ai-usage/overview has one handler)', () => {
  for (const id of ['audit-logs', 'ai-usage', 'ai-governance', 'scheduler', 'workflow']) assert.equal(sectionById(id)?.ownHeading, true, id);
  assert.ok(ADMIN_SECTIONS.length >= 13);
  const api = read('src/lib/api.ts');
  assert.match(api, /\}>\('\/admin\/ai-usage\/tracing\/overview'/);
  assert.equal((api.match(/'\/admin\/ai-usage\/overview'/g) ?? []).length, 1, 'only the token dashboard calls /overview');
  const router = read('../backend/grc/routers/admin_ai_usage_router.py');
  assert.match(router, /@router\.get\("\/tracing\/overview"\)/);
  assert.doesNotMatch(router, /@router\.get\("\/overview"\)/);
});

test('/admin/usage forwards to the Activity view of AI usage', () => {
  assert.match(read(`${ADMIN}/usage/page.tsx`), /redirect\('\/admin\/ai-usage\?view=activity'\)/);
});
