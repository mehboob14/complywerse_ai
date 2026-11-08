// node --test "src/app/(dashboard)/issues/register/registerGuard.test.ts"
// Source-text guard for the two issue registers (issues/register, issues/actions) and their models (lib/issues): the kit's rules (no class the platform CSS rewrites, nothing under 12px), no
// native dialog, no hover-only action, no vendor or model name, no raw technical word in a visible string, and no bare useMutation (a write goes through useReportedMutation, so a failed
// save is said, with Retry where repeating is safe). The folders the registers do NOT own (the record page, the older tab components) are not checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const SRC = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOTS = ['app/(dashboard)/issues/register', 'app/(dashboard)/issues/actions', 'lib/issues'];

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

test('the folders have files to check', () => {
  assert.ok(FILES.length >= 13, `found ${FILES.length}`);
});

test('the kit\'s rules hold in every file: no remapped class, no palette colour, nothing under 12px', () => {
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
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

test('an icon-only control is named, and a row never opens an issue by its internal number', () => {
  for (const f of FILES) {
    for (const m of Array.from(read(f).matchAll(/<IconButton\b([^>]*)>/g))) assert.match(m[1], /label=/, `${f}: an IconButton with no label`);
    assert.doesNotMatch(code(read(f)), /`#\$\{[^}]*\.id\}`|'#' \+ /, `${f}: an issue shown by its bare number`);
  }
});

test('the registers use the shared frame and the shared words, not a copy of either', () => {
  const issues = read(join(SRC, 'app/(dashboard)/issues/register/_register/IssueRegister.tsx'));
  const actions = read(join(SRC, 'app/(dashboard)/issues/actions/_register/ActionRegister.tsx'));
  for (const src of [issues, actions]) {
    assert.match(src, /from '@\/components\/records\/RegisterFrame'/);
    assert.match(src, /from '@\/lib\/statuses\/issues'/);
  }
  assert.match(issues, /stepsFrom\(/, 'the issue steps are the shared ones (equal to the server\'s transitions)');
  assert.match(actions, /actionStepsFrom\(/);
});

test('a step needs the right the server asks for: the buttons are drawn only with it', () => {
  const issues = read(join(SRC, 'app/(dashboard)/issues/register/_register/IssueRegister.tsx'));
  const actions = read(join(SRC, 'app/(dashboard)/issues/actions/_register/ActionRegister.tsx'));
  assert.match(issues, /hasPermission\('issue_management:issues:create'\)/);
  assert.match(issues, /hasPermission\('issue_management:issues:edit'\)/);
  assert.match(actions, /hasPermission\('issue_management:issues:edit'\)/);
});
