// node --test "src/app/(dashboard)/erm/risk-assessments/assessmentsPagesGuard.test.ts"
// Source-text guard for the Risk Assessments pages (the home, an assessment, a framework assessment, the AI System Risks register and the forwards): the kit's own rules (no named text sizes,
// palette colours, shadows, radii, weights or remapped spacing; nothing under 12px; no bare outline-none), no native confirm / alert / prompt, no action that appears only on hover, no model or
// vendor name or technical word on a screen, no record number shown as a name, no server text shown as it comes, and the contracts of the revamp: ONE band system, the old pages gone, the old
// addresses forwarding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const ROOT = 'src/app/(dashboard)/erm/risk-assessments';
/** One-time-only: the OneLink fields are older code moved as it was (their component lives in risks/_components and is not touched). */
function files(rel: string): string[] {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return [];
  if (statSync(p).isDirectory()) return readdirSync(p).flatMap((n) => files(join(rel, n)));
  return /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) ? [rel] : [];
}
const all = files('.');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const src = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the folder has the pages and components the revamp built', () => {
  for (const f of ['page.tsx', 'layout.tsx', '_register/AssessmentRegister.tsx', '[id]/page.tsx', 'framework/[id]/page.tsx', 'ai-risk-assessment/page.tsx']) assert.ok(all.map((x) => x.replace(/\\/g, '/')).includes(f), f);
});

test('the pages follow the kit rules (tokens, no remapped utilities, nothing under 12px)', () => {
  const bad = all.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('no page asks with a native dialog, hides an action until hover, or names a model or a vendor', () => {
  for (const f of all) {
    const s = src(f);
    assert.doesNotMatch(s, /window\.(confirm|alert|prompt)\(|(?<![\w.])(alert|prompt)\(|(?<![\w.])confirm\(\s*['"`]/, `${f}: a native dialog`);
    assert.doesNotMatch(s, /opacity-0[^'"`]*group-hover|group-hover:opacity-100/, `${f}: an action that appears only on hover`);
    assert.doesNotMatch(s, /\b(gpt-|openai|claude|anthropic)\b/i, `${f}: a model or vendor name`);
  }
});

test('nothing shows a record number as a name, and no server text reaches the screen raw', () => {
  for (const f of all) {
    const s = src(f);
    assert.doesNotMatch(s, /`#\$\{[\w.]*id\}|Risk #|KRI #|Incident #|Finding #|Evidence #|Entry #|Moved to Risk Register: #/, `${f}: an internal id on a screen`);
    assert.doesNotMatch(s, /response\??\.data\??\.detail|\.response\?\.data/, `${f}: the server's own text shown as it comes (use errorMessage / aiFailureWords)`);
    assert.doesNotMatch(s, /toLocale(Date|Time)?String\(/, `${f}: a date written by the browser's locale (use lib/format)`);
  }
});

test('one band system: no page keeps its own cut-offs (21 / 13, 15 / 8) or its own rating function', () => {
  for (const f of all) {
    const s = src(f);
    assert.doesNotMatch(s, />=\s*21\b|>=\s*13\b|score\s*>=\s*15\b|score\s*>=\s*8\b/, `${f}: its own score cuts`);
    assert.doesNotMatch(s, /computeRating|getScoreColor|getRatingStyle|residualTone/, `${f}: an old per-page rating helper`);
  }
});

test('the old pages are gone and their addresses forward', () => {
  assert.match(read('dashboard/page.tsx'), /redirect\('\/erm\/risk-assessments\?view=insights'\)/);
  assert.match(read('list/page.tsx'), /redirect\(`\/erm\/risk-assessments\$\{text \? `\?\$\{text\}` : ''\}`\)/);
  assert.match(read('framework/page.tsx'), /redirect\(searchParams\?\.tab === 'assigned' \? '\/erm\/risk-assessments\?kind=framework&quick=mine' : '\/erm\/risk-assessments\?kind=framework'\)/);
  assert.match(read('[id]/analytics/page.tsx'), /redirect\(`\/erm\/risk-assessments\/\$\{encodeURIComponent\(params\.id\)\}\?tab=insights`\)/);
  assert.match(read('page.tsx'), /<AssessmentRegister \/>/);
  for (const dead of ['[id]/page.tsx']) assert.ok(read(dead).split('\n').length < 400, `${dead} is a workspace of parts, not the 1,269-line page`);
});

test('the tab strip names the AI register for what it is', () => {
  assert.match(read('layout.tsx'), /name: 'AI System Risks'/);
  assert.doesNotMatch(read('layout.tsx'), /AI Risk Assessment/);
  assert.match(src('ai-risk-assessment/_ai/AiRegister.tsx'), /'AI System Risks'/);
});

test('an AI suggestion says where it came from, and a failed AI request never shows the server\'s text', () => {
  assert.match(read('_register/AiDraft.tsx'), /suggestionSource/);
  assert.match(read('[id]/_workspace/RiskDrawer.tsx'), /aiFailureWords\(statusOf\(e\)/);
  assert.match(read('framework/[id]/_framework/QuestionDrawer.tsx'), /aiFailureWords\(statusOf\(e\)/);
  assert.match(read('ai-risk-assessment/_ai/AiDrawer.tsx'), /aiFailureWords\(statusOf\(e\)/);
});

test('a regenerate says what it deletes in numbers and the upload says it creates register risks, both before they run', () => {
  assert.match(read('framework/[id]/_framework/Sheets.tsx'), /regenerateWords\(facts\)/);
  assert.match(read('_register/CreatePanels.tsx'), /This adds risks to the Risk Register/);
  assert.match(read('_register/CreatePanels.tsx'), /reuse_existing/);
});
