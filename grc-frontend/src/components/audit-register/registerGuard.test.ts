// node --test "src/components/audit-register/registerGuard.test.ts"
// Source-text guard for the Issue Register (components/audit-register, lib/auditRegister, the page): the kit's rules (no class the platform CSS rewrites, nothing under 12px), no native dialog, no
// hover-only action, no vendor or model name, no raw technical word in a visible string, a write only through useReportedMutation (a failed save is said, with Retry where repeating is safe), the
// rights the server asks for on every control that needs one, and the exports the Issues pages import. The Cyber Assurance pages that draw AuditFindingTags are not checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../ui/ds/kitRules.ts';

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const ROOTS = ['components/audit-register', 'lib/auditRegister', 'app/(dashboard)/auditor-portal/issue-register'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const FILES = ROOTS.flatMap((r) => walk(join(SRC, r)));
const read = (f: string) => readFileSync(f, 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/\s.*$/, '$1')).join('\n');
const inFolder = (name: string) => read(join(SRC, 'components/audit-register', name));

test('the folders have files to check', () => {
  assert.ok(FILES.length >= 30, `found ${FILES.length}`);
});

test('the kit\'s rules hold in every file: no remapped class, no palette colour, nothing under 12px', () => {
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no text under 12px written as a style either (AuditFindingTags draws its own)', () => {
  for (const f of FILES) {
    for (const m of Array.from(code(read(f)).matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g))) assert.ok(parseFloat(m[1]) >= 12, `${f}: fontSize ${m[1]}`);
  }
});

test('no native dialog (confirm, alert, prompt) and no hover-only action', () => {
  for (const f of FILES) {
    const src = code(read(f));
    assert.doesNotMatch(src, /\bwindow\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt)\(/, `${f}: a native dialog`);
    if (!/useConfirm/.test(src)) assert.doesNotMatch(src, /(?<![.\w])confirm\(/, `${f}: a native confirm (the kit's useConfirm asks)`);
    assert.doesNotMatch(src, /opacity-0[^"'`]*group-hover|group-hover:opacity-100/, `${f}: an action that shows on hover only`);
  }
});

test('no vendor or model name, and no raw technical word, in what a person reads', () => {
  for (const f of FILES) {
    const src = code(read(f));
    assert.doesNotMatch(src, /gpt-|openai|chatgpt|claude|anthropic/i, `${f}: a model or vendor name`);
    const strings = Array.from(src.matchAll(/(?:>|=\s*|\(|:\s)(['"`])([^'"`\n]{12,})\1/g)).map((m) => m[2]).filter((s) => /\s/.test(s) && !/[{}$]/.test(s) && !/^(use|class|import|from|http|\/)/.test(s));
    for (const s of strings) assert.doesNotMatch(s, /\b(uuid|sha-?256|checksum|stack ?trace|http [45]\d\d|endpoint|payload|json)\b/i, `${f}: "${s}"`);
  }
});

test('a write goes through useReportedMutation, never a bare useMutation', () => {
  for (const f of FILES) assert.doesNotMatch(code(read(f)), /\buseMutation\(/, `${f}: a bare useMutation`);
});

test('an icon-only control is named', () => {
  for (const f of FILES) for (const m of Array.from(read(f).matchAll(/<IconButton\b([^>]*)>/g))) assert.match(m[1], /label=/, `${f}: an IconButton with no label`);
});

test('the AI Assist answer\'s `model` is never read: the page says "AI"', () => {
  for (const f of FILES) assert.doesNotMatch(code(read(f)), /\.model\b|\bmodel:/, `${f}: reads a model`);
});

test('the exports the Issues pages import are still there, with the props they pass', () => {
  assert.match(inFolder('AuditRegister.tsx'), /export function AuditRegister\(\{ initialSource/);
  assert.match(inFolder('RegisterPanel.tsx'), /export function RegisterPanel\(\{ issueId \}: \{ issueId: number \}\)/);
  assert.match(inFolder('AuditFindingTags.tsx'), /export function AuditFindingTags\(\{ kind, recordId \}: \{ kind: 'asset' \| 'vulnerability'; recordId: number \}\)/);
  const importers: Array<[string, RegExp]> = [
    ['app/(dashboard)/issues/page.tsx', /<AuditRegister initialSource=/],
    ['app/(dashboard)/issues/register/_register/IssueRegister.tsx', /<AuditRegister initialSource=/],
    ['app/(dashboard)/issues/[id]/page.tsx', /<RegisterPanel issueId=\{issueId\}/],
  ];
  for (const [file, usage] of importers) {
    const src = read(join(SRC, file));
    assert.match(src, usage, file);
    assert.match(src, /from '@\/components\/audit-register\/(AuditRegister|RegisterPanel)'/, file);
  }
});

test('the Register is the shared explorer frame, the decisions are the Auditor Portal\'s Decision sheet, the words are the register\'s own registry', () => {
  assert.match(inFolder('RegisterTab.tsx'), /from '@\/components\/records\/RegisterFrame'/);
  assert.match(inFolder('RegisterTab.tsx'), /from '@\/lib\/statuses\/auditRegister'/);
  assert.match(inFolder('ValidationDecision.tsx'), /from '@\/components\/auditor-portal\/DecisionSheet'/);
  assert.match(inFolder('ExtensionDecision.tsx'), /from '@\/components\/auditor-portal\/DecisionSheet'/);
  assert.match(read(join(SRC, 'app/(dashboard)/auditor-portal/issue-register/page.tsx')), /<PageHeader variant="page"/);
});

test('a control is drawn only for a person who holds the right the server asks for', () => {
  const need: Array<[string, string[]]> = [
    ['AuditRegister.tsx', ['upload', 'addFinding', 'downloadTemplate', 'readReminders', 'relink', 'restoreFinding', 'exportPack', 'readSettings']],
    ['FieldsPanel.tsx', []],                                      // gets canEdit from FindingTabs (can(rights, 'editFields'))
    ['FindingTabs.tsx', ['editFields']],
    ['ValidationPanel.tsx', ['submitValidation', 'decideValidation']],
    ['ExtensionPanel.tsx', ['requestExtension', 'decideExtension', 'regulatorNotice']],
    ['LinksPanel.tsx', ['regulatorStatus', 'suggestions']],
    ['FindingDrawer.tsx', ['addFinding', 'deleteFinding', 'decideValidation']],
    ['RegisterTab.tsx', ['addFinding', 'deleteFinding']],
    ['QueuesTab.tsx', ['decideValidation', 'decideExtension', 'readMappings']],
    ['ReportsTab.tsx', ['addFinding']],
    ['SetupTab.tsx', ['writeSettings']],
  ];
  for (const [file, actions] of need) for (const a of actions) assert.match(inFolder(file), new RegExp(`can\\(rights, '${a}'\\)`), `${file}: ${a}`);
  // the Setup sections a person may read come from one function of the rights table
  assert.match(inFolder('SetupTab.tsx'), /setupSections\(rights\)/);
  assert.match(inFolder('AuditRegister.tsx'), /setupSections\(rights\)/);
});

test('the open tab is in ?section=, never ?tab= (the Issues page forwards on ?tab=)', () => {
  assert.match(inFolder('AuditRegister.tsx'), /useTabParam<Section>\('section'/);
  for (const f of FILES) assert.doesNotMatch(code(read(f)), /useTabParam\([^)]*'tab'|get\('tab'\)|set\('tab'/, `${f}: reads or writes ?tab=`);
});

test('a date a person reads goes through lib/format, and "today" is the viewer\'s own day', () => {
  for (const f of FILES) {
    const src = code(read(f));
    assert.doesNotMatch(src, /toLocale(Date|Time)String|toISOString\(\)\.slice\(0, 10\)/, `${f}: a date written by hand`);
  }
});
