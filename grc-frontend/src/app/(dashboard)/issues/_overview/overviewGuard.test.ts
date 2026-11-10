// node --test "src/app/(dashboard)/issues/_overview/overviewGuard.test.ts"
// Source-text guard for the Issue & Incident Overview (issues/page.tsx, issues/_overview) and the Issue settings (issues/settings): the kit's rules (no class the platform CSS rewrites, nothing under
// 12px), no native dialog, no hover-only action, no vendor or model name, no raw technical word in a visible string, a write only through useReportedMutation, a bare <p>/<td>/<th>/<h2>/<h3>
// always sized, every counter and breakdown opening the register FILTERED, and the rights the server asks for. The register folders are guarded by register/registerGuard.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';
import { COUNTER_DEFS } from './overviewModel.ts';

const SRC = fileURLToPath(new URL('../../../../', import.meta.url));
const ISSUES = join(SRC, 'app/(dashboard)/issues');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const FILES = [join(ISSUES, 'page.tsx'), ...walk(join(ISSUES, '_overview')), ...walk(join(ISSUES, 'settings'))];
const read = (f: string) => readFileSync(f, 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/\s.*$/, '$1')).join('\n');

test('the folders have files to check', () => {
  assert.ok(FILES.length >= 10, `found ${FILES.length}`);
});

test('the old tab components and the old board are gone (nothing imports them)', () => {
  for (const f of ['ClosureTracker', 'IssueAnalytics', 'SeverityMatrixEditor', 'ClassificationMatrixEditor', 'AutomationFlags', 'IssueList', 'CAPABoard', 'ImportIssuesModal']) assert.equal(existsSync(join(ISSUES, `_components/${f}.tsx`)), false, f);
  assert.equal(existsSync(join(SRC, 'components/dashboard/IssuesOverviewCards.tsx')), false);
  assert.equal(existsSync(join(SRC, 'cyber-assurance/components/dashboard/IssuesOverviewCards.tsx')), true, 'the Cybersecurity Assurance copy is not ours to remove');
});

test('the kit\'s rules hold in every file: no remapped class, no palette colour, nothing under 12px', () => {
  const bad = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no native dialog (confirm, alert, prompt) and no hover-only action', () => {
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
    for (const s of strings) assert.doesNotMatch(s, /\b(uuid|sha-?256|checksum|stack ?trace|http [45]\d\d|endpoint|payload|json|api)\b/i, `${f}: "${s}"`);
  }
});

test('a write goes through useReportedMutation, never a bare useMutation', () => {
  for (const f of FILES) assert.doesNotMatch(code(read(f)), /\buseMutation\(/, `${f}: a bare useMutation`);
});

test('an icon-only control is named', () => {
  for (const f of FILES) for (const m of Array.from(read(f).matchAll(/<IconButton\b([^>]*)>/g))) assert.match(m[1], /label=/, `${f}: an IconButton with no label`);
});

test('a bare <p>, <td>, <th>, <h2> or <h3> always names a text size (the platform CSS gives a bare one 11.5px and dark text)', () => {
  const SIZE = /(?<![\w:\-[])!?text-(?:ds-(?:title|section|body|label)|\[\d[^\]]*\])(?![\w-])/;
  for (const f of FILES) {
    for (const m of Array.from(code(read(f)).matchAll(/<(p|td|th|h2|h3)\b([^>]*)>/g))) assert.match(m[2], SIZE, `${f}: <${m[1]}${m[2].slice(0, 70)}>`);
  }
});

test('every counter opens a register FILTERED, never the bare list', () => {
  for (const d of COUNTER_DEFS) assert.match(d.href, /^\/(issues\/register|issues\/actions|erm\/incidents)\?quick=[a-z]+$/, d.key);
  const model = read(join(ISSUES, '_overview/overviewModel.ts'));
  assert.match(model, /const REGISTER = '\/issues\/register\?quick=open'/, 'the issue breakdowns open the OPEN issues');
  assert.match(model, /href: `\$\{REGISTER\}&\$\{param\}=\$\{encodeURIComponent\(k\.key\)\}`/, 'a breakdown row adds its own filter');
  assert.match(model, /href: `\/issues\/actions\?status=\$\{x\.s\}`/, 'an action row opens the actions with that status');
});

test('the rights are the ones the server asks for: Raise issue needs create; Settings and every step need edit; incidents are read with the incident right', () => {
  const page = code(read(join(ISSUES, 'page.tsx')));
  assert.match(page, /hasPermission\('issue_management:issues:create'\)/);
  assert.match(page, /hasPermission\('issue_management:issues:edit'\)/);
  assert.match(page, /hasPermission\('erm:incidents:\*'\)/);
  assert.match(page, /\{canEdit && <Button href="\/issues\/settings"/);
  assert.match(page, /\{canCreate && <Button variant="primary"/);
  const settings = code(read(join(ISSUES, 'settings/page.tsx')));
  assert.match(settings, /hasPermission\('issue_management:issues:edit'\)/);
});

test('a failed list is never a number: every count, the work list and the cards say so (with Retry) instead of drawing 0', () => {
  const model = read(join(ISSUES, '_overview/overviewModel.ts'));
  assert.match(model, /feed\.state === 'ready' \? \{ \.\.\.base, value:/, 'a counter has a value only from a feed that is ready');
  const page = code(read(join(ISSUES, 'page.tsx')));
  assert.doesNotMatch(page, /\?\? 0\b/, 'no "?? 0" stands in for a count');
  const parts = code(read(join(ISSUES, '_overview/parts.tsx')));
  assert.match(parts, /Couldn't load/);
  assert.match(parts, /onRetry=\{retryOf\(feed\)\}/);
});

test('the settings page hides what does nothing and sends the matrix\'s unchanged acknowledge window', () => {
  const dir = join(ISSUES, 'settings/_settings');
  const all = walk(dir).map((f) => code(read(f))).join('\n');
  assert.doesNotMatch(all, /classification|Classification/, 'the classification matrix is not shown');
  for (const flag of ['refresh_document_review', 'overdue_mitigation', 'control_evidence_rejected']) assert.doesNotMatch(all, new RegExp(`\\b${flag}\\b(?!\\?)`), `${flag} is not written by this page (it is only declared, optional, in the Flags type)`);
  assert.match(read(join(dir, 'settingsModel.ts')), /sla_ack_hours: cell\.sla_ack_hours/);
});
