// node --test "src/app/(dashboard)/frameworks/\[id\]/_requirements/requirementsRules.test.ts"
// Source-text pins for the Requirements tab (the facet explorer, the drawer and the actions on a requirement). There is no React renderer here; behaviour is checked in a browser. These
// hold what must not drift: the kit's class rules in every file written for the tab, no native dialog, nothing hidden until hover, every write a reported mutation that names its
// failure, the endpoints and payload keys the page always called, the rights each button has always had, a bulk action as single requests one after the other, the tab's state in the
// address, and the files this tab replaced gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const UP = fileURLToPath(new URL('../', import.meta.url));
const SOURCES = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((file) => ({ file, text: readFileSync(`${DIR}${file}`, 'utf8') }));
const TSX = SOURCES.filter((s) => s.file.endsWith('.tsx'));
const src = (file: string) => SOURCES.find((s) => s.file === file)!.text;
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('every file of the tab follows the kit: no named sizes or palette, nothing under 12px, no bare outline-none, no legacy scope', () => {
  for (const { file, text } of SOURCES) {
    const found = findViolations(text);
    assert.deepEqual(found, [], `${file}: ${found.map((v) => `${v.rule}@${v.line}`).join(', ')}`);
    assert.doesNotMatch(code(text), /governance-light/, `${file}: the legacy scope`);
  }
});

test('no bare <p>, <td>, <th>, <h2>, <h3> or <h4>: each names its text size', () => {
  const SIZE = /(?<![\w:-])!?text-(?:ds-(?:title|section|body|label)|\[\d)/;
  for (const { file, text } of TSX) {
    const c = code(text);
    const tag = /<(p|td|th|h2|h3|h4)(\s[^>]*?)?>/g;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(c)) !== null) {
      const open = c.slice(m.index, m.index + 400).split('>')[0] + '>';
      assert.match(open, SIZE, `${file}:${c.slice(0, m.index).split('\n').length} <${m[1]}> has no text size: ${open.slice(0, 90)}`);
    }
  }
});

test('no native dialog, no action hidden until hover, nothing logged to the console, no storage that matters', () => {
  for (const { file, text } of SOURCES) {
    const c = code(text);
    assert.doesNotMatch(c, /window\.(confirm|alert|prompt)\s*\(/, file);
    assert.doesNotMatch(c, /(^|[^\w.$])(alert|prompt)\s*\(/m, `${file}: a bare alert( or prompt(`);
    assert.doesNotMatch(c, /opacity-0[^'"`\n]*group-hover|group-hover[^'"`\n]*opacity-0|group-hover:opacity-100/, `${file}: hover-only`);
    assert.doesNotMatch(c, /console\.(log|info|debug)\(/, `${file}: console logging`);
    assert.doesNotMatch(c, /localStorage|sessionStorage/, `${file}: browser storage (the tab's state is in the address)`);
  }
});

test('every write is a reported mutation that names its failure (a bare useMutation would fail silently)', () => {
  for (const file of ['useRequirementActions.ts', 'useCriteriaTicks.ts', 'useRequirementArtifacts.ts']) {
    const c = code(src(file));
    assert.doesNotMatch(c, /\buseMutation\(/, `${file}: a bare useMutation`);
    const n = (c.match(/useReportedMutation[<(]/g) ?? []).length;
    assert.ok(n > 0, file);
    assert.equal((c.match(/failure: /g) ?? []).length, n, `${file}: every mutation names its failure`);
  }
  for (const { file, text } of SOURCES) assert.doesNotMatch(code(text), /\buseMutation\(/, `${file}: a bare useMutation`);
  assert.equal((code(src('useRequirementActions.ts')).match(/useReportedMutation[<(]/g) ?? []).length, 10, 'upload, rate, review, unlink, assign, assign a sub-control, status, scope, bulk owners, bulk scope');
});

test('the endpoints and payload keys are the ones the page always called', () => {
  const a = code(src('useRequirementActions.ts'));
  assert.match(a, /certificationsApi\.uploadEvidence\(journeyId, controlId, form\)/);
  assert.match(a, /form\.append\('file', file\)/);
  assert.match(a, /form\.append\('sub_control_code', subControlCode\)/);
  assert.match(a, /apiClient\.post\(`\/evidence-mgmt\/ai\/\$\{evidenceId\}\/review`, null, \{ params: \{ force: true \} \}\)/);
  assert.match(a, /apiClient\.put\(`\/certifications\/evidence\/\$\{evidenceId\}\/review`, \{ action \}\)/);
  assert.match(a, /\/evidence-mgmt\/links\/\$\{ev\.linked_evidence_id\}\/controls\/\$\{ev\.id\}/);
  assert.match(a, /apiClient\.delete\(`\/certifications\/evidence\/\$\{ev\.id\}`\)/);
  assert.match(a, /certificationsApi\.assignControl\(journeyId, controlId, userIds\)/);
  assert.match(a, /certificationsApi\.assignSubControl\(journeyId, controlId, code, userIds\)/);
  assert.match(a, /certificationsApi\.updateControl\(journeyId, controlId, \{ status \}\)/, 'the status change sends the status and nothing else (the old modal also sent "notes", which the server ignores)');
  assert.match(a, /governanceApi\.setClauseApplicability\(\{ control_id: control\.parsedId \?\? control\.id, uploaded_framework_id: appFwId, is_applicable: applicable, justification \}\)/);
  assert.match(code(src('useCriteriaTicks.ts')), /apiClient\.patch\(`\/certifications\/\$\{journeyId\}\/controls\/\$\{controlId\}\/criteria`, \{ criteria_status: next \}\)/);
  const art = code(src('useRequirementArtifacts.ts'));
  assert.match(art, /apiClient\.get\('\/artifacts\/by-control', \{ params: \{ assessment_type: frameworkLabel, control_ref: codes\.join\(','\) \} \}\)/);
  assert.match(art, /apiClient\.post\('\/artifacts', payload\)/);
  assert.match(art, /apiClient\.put\(`\/artifacts\/\$\{id\}`, patch\)/);
});

test('a tick that could not be saved is put back and said; the artifacts are asked for only when a tab needs them', () => {
  const t = code(src('useCriteriaTicks.ts'));
  assert.match(t, /failure: "Couldn't save the tick"/);
  assert.match(t, /onError: \(_e, vars\) => setCriteriaState\(\(prev\) => \(\{ \.\.\.prev, \[vars\.controlId\]: vars\.current \}\)\)/);
  const d = code(src('RequirementDrawer.tsx'));
  assert.match(d, /useRequirementArtifacts\(control, frameworkLabel, tab === 'artifacts' \|\| \(tab === 'checklist' && structured\)\)/, 'no request for every requirement that is opened');
  assert.match(code(src('useRequirementArtifacts.ts')), /enabled: enabled && !!frameworkLabel && codes\.length > 0/);
});

test('the rights are the ones each button always had: upload create, approve / turn down / assign / status edit, unlink delete, scope and rating none', () => {
  const ev = code(src('DrawerEvidence.tsx'));
  assert.match(ev, /\{canCreate && \(\s*<>\s*<input ref=\{picker\}/, 'upload');
  assert.match(ev, /ev\.review_status === 'pending' && canEdit/, 'approve and turn down');
  assert.match(ev, /\{canDelete && \(\s*<Button size="sm" variant="dangerOutline" leftIcon=\{<Unlink/, 'unlink');
  assert.doesNotMatch(ev.slice(ev.indexOf('canAssess &&'), ev.indexOf('canAssess &&') + 120), /canEdit|canCreate|canDelete/, 'asking the AI to rate a file has never had a right');
  assert.match(code(src('RequirementDrawer.tsx')), /if \(!canEdit\) return null;\s*const same/, 'the owners editor');
  assert.match(code(src('RequirementDrawer.tsx')), /if \(!canEdit\) return null;\s*if \(!STATUS_CHOICES/, 'the status editor');
  const tab = code(src('RequirementsTab.tsx'));
  assert.match(tab, /canAssign: rights\.canEdit/);
  assert.match(tab, /\.\.\.\(rights\.canEdit \? \[\{ id: 'assign'/, 'bulk owners need edit');
  assert.doesNotMatch(tab.slice(tab.indexOf('const ownersPlan')), /rights\.can(Create|Delete)/);
  const ws = code(readFileSync(`${UP}_workspace/JourneyWorkspace.tsx`, 'utf8'));
  for (const [name, key] of [['canCreate', 'create'], ['canEdit', 'edit'], ['canDelete', 'delete']]) assert.match(ws, new RegExp(`const ${name} = hasPermission\\('frameworks:framework_library:${key}'\\)`));
});

test('a requirement whose status follows its ticks has no status to set; one without can be set to the four states, not to "not applicable"', () => {
  const d = code(src('RequirementDrawer.tsx'));
  assert.match(d, /const STATUS_CHOICES = \['not_started', 'in_progress', 'implemented', 'verified'\] as const;/);
  assert.match(d, /if \(followsTicks\) \{/);
  assert.match(src('RequirementDrawer.tsx'), /decided through scope/, 'the comment says why not applicable is missing from the choices');
});

test('a bulk action is one request after the other (the pool is small), reports how many and keeps the failures ticked', () => {
  const a = code(src('useRequirementActions.ts'));
  assert.doesNotMatch(a, /Promise\.all|Promise\.allSettled/, 'no parallel burst on a small pool');
  assert.equal((a.match(/for \(const (id|it) of (ids|items)\)/g) ?? []).length, 2, 'both bulk actions loop');
  assert.match(a, /failedIds/);
  const tab = code(src('RequirementsTab.tsx'));
  assert.match(tab, /selection\.keep\(o\.failedIds\); selection\.set\(new Set\(o\.failedIds\)\)/);
});

test('the tab\'s state is in the address and a view, search, every facet and the order are part of it; `tab`, `req` and `item` are the journey page\'s', () => {
  const addr = code(src('reqAddress.ts'));
  for (const name of ['q:', 'status:', 'evidence:', 'section:', 'owner:', 'priority:', 'critical:', 'category:', 'scope:', 'quick:', 'view:', 'sort:']) assert.ok(addr.includes(name), name);
  for (const name of ['tab:', 'req:', 'item:']) assert.ok(!addr.includes(name), `${name} stays the journey page's`);
  assert.match(code(src('RequirementsTab.tsx')), /useAddressState\(REQ_SCHEMA\)/);
});

test('every state of the list is drawn: loading, a failed load that keeps the tab and offers Retry, nothing yet, no matches', () => {
  const tab = code(src('RequirementsTab.tsx'));
  assert.match(tab, /const noList = !!error && !controls;/);
  assert.match(tab, /Couldn't load the \$\{props\.entityLabelPlural\.toLowerCase\(\)\}/);
  assert.match(tab, /onRetry=\{canRetry\(error\) \? onRetry : undefined\}/);
  assert.match(tab, /SkeletonRows/);
  assert.match(tab, /kind="noMatches"/);
  assert.match(tab, /kind="firstUse"/);
  assert.match(tab, /That requirement is not here/, 'an address that names a requirement the journey does not have says so');
});

test('the tab replaced the spine, the popup and the accordion: the files that drew them are gone and nothing imports them', () => {
  for (const gone of ['_tabs/HierarchicalRequirements.tsx', '_tabs/ControlDetail.tsx', '_tabs/RequirementChips.tsx', '_workspace/RequirementArtifactsSection.tsx', '_workspace/ScopeDecisionDialog.tsx']) {
    assert.equal(existsSync(`${UP}${gone}`), false, gone);
  }
  assert.equal(existsSync(`${UP}_tabs/requirementTree.ts`), true, 'the structure builder stays: it names the families and sub-families of the list');
  assert.match(code(readFileSync(`${DIR}reqModel.ts`, 'utf8')), /from '\.\.\/_tabs\/requirementTree\.ts'/);
  const ws = code(readFileSync(`${UP}_workspace/JourneyWorkspace.tsx`, 'utf8'));
  assert.doesNotMatch(ws, /HierarchicalRequirements|renderControlAccordion|renderRequirementsSpine|selectedSpineControl|fixed inset-0/);
  assert.match(ws, /<RequirementsTab/);
});
