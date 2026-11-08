// node --test "src/app/(dashboard)/frameworks/\[id\]/_workspace/workspaceRules.test.ts"   (or the whole suite: npm test)
// Source-text pins for the journey page (/frameworks/[id]): the shell stays thin, the files written for the revamp follow the kit's rules, nothing
// uses a native dialog, hides an action until hover, logs payloads or writes from a GET, every tab the page draws is a tab of the model and every
// tab of the model is drawn, and the old wrong sum (verified counted twice) is gone. The requirement popup and accordion that still live in
// JourneyWorkspace.tsx are group J2's: they are held to the dialog, log and sum rules here, not yet to the kit's class rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';
import { CORE_TABS, REGISTERS_TAB, TAB_ALIASES, journeyTabKeys } from '../../../../../lib/journeyModel.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));          // .../frameworks/[id]
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const files = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((n) => {
  const rel = join(dir, n);
  return statSync(join(ROOT, rel)).isDirectory() ? files(rel) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [rel] : [];
});
const all = [...files('_workspace'), ...files('_tabs'), 'page.tsx'];

// the files written for the revamp (the kit's class rules apply to them)
const NEW = [
  '_workspace/JourneyHeader.tsx', '_workspace/JourneyHome.tsx', '_workspace/NextForMe.tsx', '_workspace/RecentActivity.tsx', '_workspace/StageList.tsx',
  '_workspace/OverviewTab.tsx', '_workspace/JourneyCharts.tsx', '_workspace/ScopeTab.tsx', '_workspace/ScopeDecisionDialog.tsx', '_workspace/ActivityTab.tsx',
  '_workspace/RegistersHost.tsx', '_workspace/useJourneyActions.ts', '_tabs/_StageOwnerPicker.tsx',
];

test('the page file is a thin shell: it reads the id and hands it to the workspace', () => {
  const src = read('page.tsx');
  assert.ok(src.split('\n').length < 20, 'page.tsx stays a shell');
  assert.match(src, /useParams\(\)/);
  assert.match(src, /<JourneyWorkspace journeyId=/);
});

test('the files written for the revamp follow the kit: no named sizes or palette, nothing under 12px, no bare outline-none', () => {
  const bad = NEW.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native dialog, no action hidden until hover, no payload logged to the console, anywhere in the page folder', () => {
  const bad: string[] = [];
  for (const f of all) {
    const src = read(f);
    // the kit's `confirm({...})` (useConfirm) is not the browser's: only window.confirm/alert/prompt and a bare alert()/prompt() are
    if (/\bwindow\.(confirm|alert|prompt)\b|(?<![\w.])(alert|prompt)\s*\(/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) bad.push(`${f}: native dialog`);
    if (/opacity-0[^'"`]*group-hover|group-hover:opacity-100/.test(src)) bad.push(`${f}: hover-only action`);
    if (/console\.(info|log|debug)\(/.test(src)) bad.push(`${f}: console logging`);
    if (/\[JourneyTrace\]/.test(src)) bad.push(`${f}: JourneyTrace`);
  }
  assert.deepEqual(bad, []);
});

test('opening the page writes nothing: no polling of the charts, no AI job started by an effect, no write behind a GET', () => {
  const ws = read('_workspace/JourneyWorkspace.tsx');
  for (const f of files('_workspace')) assert.doesNotMatch(read(f), /refetchInterval/, `${f} polls`);
  assert.doesNotMatch(ws, /generatePhasesMutation|phaseGenerationTriggered/, 'the timeline is written by a button');
  const hooks = read('_workspace/useJourneyActions.ts');
  assert.match(hooks, /useGeneratePhases/);
  assert.match(hooks, /useAnalyzeCritical/);
  // every AI/snapshot call is made from a mutation (a press), never from a query function
  assert.doesNotMatch(read('_workspace/OverviewTab.tsx'), /useEffect/);
});

test('the numbers come from the model: verified is not added to implemented, and the page does not read the legacy progress keys', () => {
  for (const f of all) {
    const src = read(f);
    assert.doesNotMatch(src, /implementedCount\s*\+\s*verifiedCount/, `${f} counts verified twice`);
    assert.doesNotMatch(src, /progress\??\.implemented\b|progress\??\.in_progress\b/, `${f} reads a key only the detail payload has`);
  }
  assert.match(read('_workspace/JourneyWorkspace.tsx'), /journeyNumbers\(progress\)/);
});

test('every tab of the model is drawn and every tab drawn is a tab of the model', () => {
  const ws = read('_workspace/JourneyWorkspace.tsx');
  const drawn = Array.from(ws.matchAll(/<TabPanel tabKey="([a-z]+)"/g)).map((m) => m[1]).sort();
  const model = Array.from(new Set([...CORE_TABS, REGISTERS_TAB])).sort();
  assert.deepEqual(drawn, model, 'one TabPanel per tab of the model');
  // the labelled tab strip is built from the model's keys (a key with no label would read "Activity")
  const labelled = Array.from(ws.matchAll(/case '([a-z]+)': return \{ key/g)).map((m) => m[1]);
  for (const key of journeyTabKeys({ hasFlow: true, templateKeys: ['x'] })) if (key !== 'activity') assert.ok(labelled.indexOf(key) >= 0, `${key} has a label`);
  // an old address still resolves to a tab that is drawn
  for (const target of Object.values(TAB_ALIASES)) assert.ok(drawn.indexOf(target) >= 0, `${target} is drawn`);
  assert.doesNotMatch(ws, /case 'applicability'|renderApplicabilityTab|renderHistoryTab|renderSoaTab|renderAssignedToMeTab|renderCDEScopeTab|renderPhasesTab|renderScopingTab/, 'the dead renderers are gone');
});

test('the requirement link keeps working: ?req= opens the popup and the tab goes to the address', () => {
  const ws = read('_workspace/JourneyWorkspace.tsx');
  assert.match(ws, /searchParams\.set\('req', String\(control\.id\)\)/);
  assert.match(ws, /searchParams\.set\('tab', 'controls'\)/);
  assert.match(ws, /useTabParam<string>\('tab'/);
  assert.match(ws, /setTab\('controls'\)/);
});

test('every mutation of the page reports: none is a bare useMutation', () => {
  // RequirementArtifactsSection is the requirement popup's artifacts block, moved as it was (it prints its own failure under the list); J2 rebuilds it,
  // and the other _tabs files belong to J2 and J3
  const mine = all.filter((x) => !/RequirementArtifactsSection/.test(x) && (!/^_tabs/.test(x) || /_StageOwnerPicker/.test(x)));
  for (const f of mine) assert.doesNotMatch(read(f), /\buseMutation\(/, `${f} uses a bare useMutation`);
});
