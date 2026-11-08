// node --test "src/components/issue-management/embedGuard.test.ts"
// Source-text guard for the shared Issues embeds (components/issue-management and the Issues page's IssueForm re-export): the kit's rules (no class the platform CSS rewrites, nothing under 12px),
// no native dialog, no hover-only action, no vendor or model name, no raw technical word in a visible string, every write reported (no bare useMutation), every <p>/<h3> names a text size,
// and the contract the consumer pages rely on (the exported names and props of the three components, the old IssueForm's name) is still there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../ui/ds/kitRules.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const FORM = fileURLToPath(new URL('../../app/(dashboard)/issues/_components/IssueForm.tsx', import.meta.url));
const FILES = [...readdirSync(DIR).filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)).map((n) => join(DIR, n)), FORM];
const read = (f: string) => readFileSync(f, 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/\s.*$/, '$1')).join('\n');
const of = (name: string) => read(join(DIR, name));

test('the folder has its files', () => {
  assert.ok(FILES.length >= 11, `found ${FILES.length}`);
});

test('the kit\'s rules hold in every file: no remapped class, no palette colour, nothing under 12px', () => {
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native dialog and no hover-only action', () => {
  for (const f of FILES) {
    const src = code(read(f));
    assert.doesNotMatch(src, /\bwindow\.(confirm|alert|prompt)\(|(?<![.\w])(alert|prompt|confirm)\(/, `${f}: a native dialog`);
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

test('a write goes through useReportedMutation, never a bare useMutation, and a failed create is said inside the panel', () => {
  for (const f of FILES) assert.doesNotMatch(code(read(f)), /\buseMutation\(/, `${f}: a bare useMutation`);
  const drawer = of('IssueDrawer.tsx');
  assert.match(drawer, /useReportedMutation\(/);
  assert.match(drawer, /<FormError\b/);
  assert.match(drawer, /<RightSlidePanel[\s\S]*?dirty=\{isDirty\(opened, draft\)\}/, 'typed text is protected by the panel\'s discard guard');
});

test('a <p>, <td>, <th>, <h2> or <h3> names its text size (the shell gives a bare one 11.5px and dark text)', () => {
  const size = /(?<![\w:\-[])!?text-(?:ds-(?:title|section|body|label)|\[\d[^\]]*\])(?![\w-])/;
  for (const f of FILES.filter((x) => /\.tsx$/.test(x))) {
    for (const m of Array.from(code(read(f)).matchAll(/<(p|td|th|h2|h3)\b([^>]*)>/g))) assert.match(m[2], size, `${f}: <${m[1]}${m[2].slice(0, 60)}`);
  }
});

test('an icon-only control is named, and the drawer\'s fields are labelled by FormField', () => {
  for (const f of FILES) for (const m of Array.from(read(f).matchAll(/<IconButton\b([^>]*)>/g))) assert.match(m[1], /label=/, `${f}: an IconButton with no label`);
  assert.doesNotMatch(of('IssueDrawer.tsx'), /<label\b/, 'labels come from FormField, bound to their control');
});

test('the consumers\' contract is intact: the three components keep their names and props, the old IssueForm still exists', () => {
  const button = of('CreateIssueButton.tsx');
  assert.match(button, /export function CreateIssueButton\(/);
  for (const prop of ['sourceType', 'sourceId', 'presetFields', 'label', 'variant', 'className']) assert.match(button, new RegExp(`\\b${prop}\\b`), `CreateIssueButton.${prop}`);
  assert.match(button, /variant\?: 'default' \| 'compact'/);
  assert.match(button, /e\.stopPropagation\(\)/, 'a click does not reach a row it sits in');
  const panel = of('RelatedIssuesPanel.tsx');
  assert.match(panel, /export function RelatedIssuesPanel\(/);
  for (const prop of ['sourceType', 'sourceId', 'title', 'createFields', 'compact']) assert.match(panel, new RegExp(`\\b${prop}\\b`), `RelatedIssuesPanel.${prop}`);
  const badge = of('InlineIssueBadge.tsx');
  assert.match(badge, /export function InlineIssueBadge\(/);
  for (const prop of ['sourceType', 'sourceId', 'hideWhenZero', 'size']) assert.match(badge, new RegExp(`\\b${prop}\\b`), `InlineIssueBadge.${prop}`);
  const form = read(FORM);
  assert.match(form, /IssueDrawer as IssueForm/);
  assert.match(form, /IssueDrawerProps as IssueFormProps/);
  const drawer = of('IssueDrawer.tsx');
  for (const prop of ['open', 'onClose', 'presetSource', 'presetFields', 'onCreated']) assert.match(drawer, new RegExp(`\\b${prop}\\??:`), `IssueDrawer.${prop}`);
});

test('the card and the badge are drawn only for a person who may read issues, the button only for one who may raise them; a failed read is never "no issues"', () => {
  assert.match(of('RelatedIssuesPanel.tsx'), /issue_management:issues:view/);
  assert.match(of('InlineIssueBadge.tsx'), /VIEW_ISSUES/);
  assert.match(of('CreateIssueButton.tsx'), /issue_management:issues:create/);
  const panel = code(of('RelatedIssuesPanel.tsx'));
  assert.match(panel, /<ErrorState compact/);
  assert.match(panel, /onRetry=/);
  assert.doesNotMatch(panel, /No open issues linked/);
});

test('the queries keep the keys the rest of the app invalidates, and a create refreshes every card and list', () => {
  assert.match(of('RelatedIssuesPanel.tsx'), /'issues-by-source-panel'/);
  const drawer = of('IssueDrawer.tsx');
  for (const key of ['issues', 'issues-dashboard', 'issues-by-source-panel', 'issues-by-source', 'issues-by-source-counts']) assert.match(drawer, new RegExp(`'${key}'`), key);
});
