// node --test "src/app/(dashboard)/auditor-portal/portalRules.test.ts"   (or the whole suite: npm test)
// Source-text pins for the Portal's front door and review queue (auditor-portal/page.tsx, _front, [frameworkId], components/auditor-portal): the files follow the kit, no
// native dialog or hover-only action, no bare mutation, no server path or e-mail on a screen, a decision is sent through the route the platform has always used (and a file
// previews by its LIBRARY id), Auto-approve is kept behind a question, an old address is forwarded, and the queue links into Frameworks without importing any of it.
// The pages of Statutory Audit, Internal Audit and the Issue Register are other groups' and are not read here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../components/ui/ds/kitRules.ts';

const APP = fileURLToPath(new URL('.', import.meta.url));                              // .../auditor-portal
const SRC = fileURLToPath(new URL('../../../', import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
});
const MINE = [
  join(APP, 'page.tsx'), ...walk(join(APP, '_front')), join(APP, '[frameworkId]', 'page.tsx'), ...walk(join(APP, '[frameworkId]', '_queue')),
  ...walk(join(SRC, 'components', 'auditor-portal')),
];
const read = (p: string) => readFileSync(p, 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const at = (rel: string) => read(join(APP, ...rel.split('/')));

test('the files written for the revamp follow the kit: no named sizes or palette, nothing under 12px, no bare outline-none', () => {
  const bad = MINE.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('a bare paragraph, cell or heading is given a size (the platform CSS would make it 11.5px)', () => {
  const bad: string[] = [];
  for (const f of MINE.filter((x) => x.endsWith('.tsx'))) {
    for (const m of Array.from(code(f).matchAll(/<(p|td|th|h2|h3)(\s[^>]*?)?>/g))) {
      const attrs = m[2] ?? '';
      if (!/text-ds-(title|section|body|label)|text-\[\d/.test(attrs)) bad.push(`${f}: <${m[1]}${attrs.slice(0, 60)}>`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no native dialog, no action hidden until hover, no logging, no browser storage, no locale-formatted date', () => {
  const bad: string[] = [];
  for (const f of MINE) {
    const src = code(f);
    if (/\bwindow\.(confirm|alert|prompt)\b|(?<![\w.])(alert|prompt)\s*\(/.test(src)) bad.push(`${f}: native dialog`);
    if (/opacity-0[^'"`]*group-hover|group-hover:opacity-100/.test(src)) bad.push(`${f}: hover-only action`);
    if (/console\.(info|log|debug)\(/.test(src)) bad.push(`${f}: console logging`);
    if (/localStorage|sessionStorage/.test(src)) bad.push(`${f}: browser storage`);
    if (/toLocale(Date|Time)?String/.test(src)) bad.push(`${f}: locale date`);
    if (/\buseMutation\(/.test(src)) bad.push(`${f}: a bare useMutation`);
  }
  assert.deepEqual(bad, []);
});

test('nothing technical reaches a screen: no server path, no e-mail field, no ids of people', () => {
  for (const f of MINE.filter((x) => x.endsWith('.tsx'))) {
    const src = code(f);
    assert.doesNotMatch(src, /\.file_path\b|uploaded_by\.email|\.email\b/, `${f} reads a server path or an e-mail address`);
    assert.doesNotMatch(src, /user_id|requested_by_id|reviewed_by_id/, `${f} shows an id of a person`);
  }
});

test('a decision goes through the route the platform has always used, and a file previews by its library id', () => {
  const host = code(join(APP, '[frameworkId]', '_queue', 'DecisionHost.tsx'));
  assert.match(host, /\/certifications\/evidence\/\$\{id\}\/review/, 'a file: the route the Evidence tab always called');
  assert.match(host, /governanceApi\.reviewApplicability\(/, 'a scope request: the platform review, pending-only, applied to the journey');
  assert.doesNotMatch(host, /\/auditor-portal\/reviews/, 'the older route that sets a status and applies nothing is not used');
  assert.match(host, /evidence_id: preview\.library_evidence_id/, 'the viewer is given the library id');
  assert.doesNotMatch(host, /evidence_id: (file|item|preview)\.id\b/, 'never the journey-evidence row id');
  assert.match(host, /toast: 'success'/, 'a failure is shown in the sheet with Try again, not twice');
});

test('Auto-approve is kept, behind a question that says one person asks and approves', () => {
  const hook = code(join(APP, '[frameworkId]', '_queue', 'useUntouchedActions.tsx'));
  assert.match(hook, /auto-approve/);
  assert.match(hook, /await confirm\(/);
  assert.match(hook, /both the person who asked and the person who approved/);
  assert.match(code(join(APP, '[frameworkId]', '_queue', 'QueueTab.tsx')), /useUntouchedActions\(/);
});

test('every request says loading, failed with Retry and empty on its own; a failed request is never drawn as zero', () => {
  const page = code(join(APP, 'page.tsx'));
  assert.match(page, /workFailed/);
  assert.match(page, /canRetry\(/);
  const journey = code(join(APP, '[frameworkId]', 'page.tsx'));
  assert.match(journey, /<ErrorState/);
  assert.match(journey, /onRetry=/);
  for (const f of ['DoNowCard.tsx', 'JourneysCard.tsx']) assert.match(code(join(APP, '_front', f)), /<ErrorState compact/, f);
  for (const f of ['QueueTab.tsx', 'DecisionsTab.tsx']) assert.match(code(join(APP, '[frameworkId]', '_queue', f)), /error=\{failed\}/, f);
  assert.match(code(join(APP, '[frameworkId]', '_queue', 'SummaryTab.tsx')), /error=\{journeyFailed\}/);
  assert.doesNotMatch(page, /\?\? 0\b|\|\| 0\b/, 'the counters do not default to 0 when a request failed');
});

test('an address from before the revamp is forwarded, the old tabs are gone, and the page is the kit\'s page head', () => {
  const journey = code(join(APP, '[frameworkId]', 'page.tsx'));
  assert.match(journey, /upgradeLegacyAddress\(window\.location\.search\)/);
  assert.match(journey, /<PageHeader\s+variant="page"/);
  assert.match(code(join(APP, 'page.tsx')), /<PageHeader\s+variant="page"/);
  assert.equal(existsSync(join(APP, '[frameworkId]', '_tabs')), false, 'the 11 old tab files are deleted');
});

test('the queue links into the Frameworks workspace and imports none of it', () => {
  for (const f of MINE) assert.doesNotMatch(code(f), /from '[^']*frameworks\/\[id\]|from '@\/app\/\(dashboard\)\/frameworks/, `${f} copies the Frameworks workspace`);
  const host = code(join(APP, '[frameworkId]', '_queue', 'DecisionHost.tsx'));
  assert.match(host, /frameworksHref\(/);
  assert.match(code(join(APP, '[frameworkId]', 'page.tsx')), /Open in Frameworks/);
});

test('the shared sheet is exported for the register group: DecisionSheet and its model', () => {
  const sheet = read(join(SRC, 'components', 'auditor-portal', 'DecisionSheet.tsx'));
  assert.match(sheet, /export function DecisionSheet\b/);
  assert.match(sheet, /export interface DecisionSheetProps\b/);
  assert.match(read(join(SRC, 'components', 'auditor-portal', 'decisionModel.ts')), /export function remarksProblem\b/);
});
