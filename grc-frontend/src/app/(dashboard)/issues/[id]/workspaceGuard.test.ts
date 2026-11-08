// node --test "src/app/(dashboard)/issues/[[]id]/workspaceGuard.test.ts"
// Source-text guard for the issue record (issues/[id]) and its timeline model (lib/issues/timeline.ts): the kit's rules (no class the platform CSS rewrites, nothing under 12px), no native dialog,
// no hover-only action, no vendor or model name, no raw technical word in a visible string, no bare useMutation (a write goes through useReportedMutation, so a failed one is said), the record
// never offers the unguarded "closed", and writes are drawn only with the right the server asks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const SRC = fileURLToPath(new URL('../../../../', import.meta.url));
const HERE = fileURLToPath(new URL('./', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const FILES = [...walk(HERE), join(SRC, 'lib/issues/timeline.ts')];
const read = (f: string) => readFileSync(f, 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/\s.*$/, '$1')).join('\n');
const PAGE = read(join(HERE, 'page.tsx'));

test('the record is split into its parts: a host, five tabs, their models and the data hooks', () => {
  const names = FILES.map((f) => f.replace(HERE, '').replace(/\\/g, '/'));
  for (const part of ['page.tsx', 'workspaceData.ts', '_overview/OverviewTab.tsx', '_overview/EditPanel.tsx', '_overview/issueEdit.ts', '_actions/ActionsTab.tsx', '_actions/ActionPanel.tsx', '_actions/actionsModel.ts',
    '_linked/LinkedTab.tsx', '_linked/linkedModel.ts', '_discussion/DiscussionTab.tsx', '_timeline/TimelineTab.tsx']) assert.ok(names.includes(part), part);
  assert.ok(PAGE.split('\n').length < 300, 'the host stays a host (it was a 1,384-line file)');
});

test('the kit\'s rules hold in every file: no remapped class, no palette colour, nothing under 12px', () => {
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native dialog (confirm, alert, prompt), no portal of its own and no hover-only action', () => {
  for (const f of FILES) {
    const src = code(read(f));
    assert.doesNotMatch(src, /\bwindow\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt)\(/, `${f}: a native dialog`);
    if (!/useConfirm/.test(src)) assert.doesNotMatch(src, /(?<![.\w])confirm\(/, `${f}: a native confirm (the kit's useConfirm asks)`);
    assert.doesNotMatch(src, /createPortal|fixed inset-0/, `${f}: an overlay of its own (the kit's panels and dialogs have focus, Escape and a guard)`);
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

test('an icon-only control is named, and nothing shows an issue or an action by its internal number', () => {
  for (const f of FILES) {
    for (const m of Array.from(read(f).matchAll(/<IconButton\b([^>]*)>/g))) assert.match(m[1], /label=/, `${f}: an IconButton with no label`);
    assert.doesNotMatch(code(read(f)), /`#\$\{[^}]*\.id\}`|'#' \+ |Task #|Action #/, `${f}: a record shown by its bare number`);
  }
});

test('no ?from= and no shell helper: the record links back to the register, as the sidebar does', () => {
  for (const f of FILES) assert.doesNotMatch(code(read(f)), /withFrom|[?&]from=/, f);
  assert.match(PAGE, /href: '\/issues\/register'/);
});

test('the record never offers the unguarded "closed": closing asks for the notes, and the steps are the shared ones', () => {
  assert.doesNotMatch(code(PAGE), /to_state:\s*'closed'|TRANSITIONS/);
  assert.match(PAGE, /stepsFrom\(/, 'the steps are the shared ones (equal to the server\'s transitions)');
  assert.match(PAGE, /issuesApi\.close\(issueId, \{ closure_notes/);
  assert.match(PAGE, /issuesApi\.reopen\(issueId, \{ reason/);
  assert.match(PAGE, /to_state: v\.step\.to/, 'a move keeps `to_state` in its body: the workflow trigger reads it');
  assert.match(PAGE, /StepDialog/);
});

test('a write is drawn only with the right the server asks for (edit), and reading is what the page needs to open', () => {
  assert.match(PAGE, /hasPermission\('issue_management:issues:edit'\)/);
  for (const f of FILES) assert.doesNotMatch(code(read(f)), /issue_management:issues:(create|delete)/, `${f}: the record asks for neither create nor delete`);
  for (const part of ['_actions/ActionsTab.tsx', '_linked/LinkedTab.tsx', '_discussion/DiscussionTab.tsx', '_overview/OverviewTab.tsx']) {
    assert.match(read(join(HERE, part)), /canEdit/, `${part}: the writes are drawn only for a person who may edit`);
  }
});

test('the parts use the shared words and registries, not a copy', () => {
  assert.match(read(join(HERE, '_actions/ActionsTab.tsx')), /from '@\/lib\/statuses\/issues'/);
  assert.match(read(join(HERE, '_actions/ActionsTab.tsx')), /actionStepsFrom\(/);
  assert.match(read(join(HERE, '_overview/EditPanel.tsx')), /from '@\/lib\/statuses\/issues'/);
  assert.match(read(join(SRC, 'lib/issues/timeline.ts')), /from '\.\/words\.ts'/);
});
