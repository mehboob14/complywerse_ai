// node --test "src/app/(dashboard)/auditor-portal/statutoryRules.test.ts"   (or the whole suite: npm test)
// Source-text pins for the revamped Statutory Audit register and record, the Statutory Audit settings page and the Internal Audit list (statutory-audit/**, internal-audit/**): the files
// follow the kit, no native dialog or hover-only action, no bare mutation, the organisation's own status levels drive every status, a write is confirmed or fails in words, a request says
// loading / failed with Retry, a copy of a register finding is protected, and the Internal Audit page no longer carries a switch to settings that were not its own.
// The Portal's front door and review queue are portalRules.test.ts; the Issue Register is another group's and is not read here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../components/ui/ds/kitRules.ts';

const APP = fileURLToPath(new URL('.', import.meta.url));                              // .../auditor-portal
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
});
const STAT = join(APP, 'statutory-audit');
const INTERNAL = join(APP, 'internal-audit');
const MINE = [...walk(STAT), ...walk(INTERNAL)];
const read = (p: string) => readFileSync(p, 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const at = (...rel: string[]) => code(join(...rel));

test('the files written for the revamp follow the kit: no named sizes or palette, nothing under 12px, no bare outline-none', () => {
  const bad = MINE.flatMap((f) => findViolations(read(f)).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
  assert.deepEqual(bad, []);
});

test('a bare paragraph, cell or heading is given a size (the platform CSS would make it 11.5px)', () => {
  const bad: string[] = [];
  for (const f of MINE.filter((x) => x.endsWith('.tsx'))) {
    for (const m of Array.from(code(f).matchAll(/<(p|td|th|h2|h3)(\s[^>]*?)?>/g))) {
      const attrs = m[2] ?? '';
      const named = /className=\{([A-Z_]+)\}/.exec(attrs);                                    // a class held in a constant: the constant must carry the size
      const sized = (text: string) => /text-ds-(title|section|body|label)|text-\[\d/.test(text);
      const holds = named ? new RegExp(`const ${named[1]}\\s*=\\s*[^\\n]*`).exec(code(f))?.[0] ?? '' : '';
      if (!sized(attrs) && !sized(holds)) bad.push(`${f}: <${m[1]}${attrs.slice(0, 60)}>`);
    }
  }
  assert.deepEqual(bad, []);
});

test('no native dialog, no action hidden until hover, no logging, no browser storage, no locale-formatted date, no bare mutation', () => {
  const bad: string[] = [];
  for (const f of MINE) {
    const src = code(f);
    if (/\bwindow\.(confirm|alert|prompt)\b|(?<![\w.])(alert|prompt|confirm)\s*\(/.test(src.replace(/await confirm\(/g, ''))) bad.push(`${f}: native dialog`);
    if (/opacity-0[^'"`]*group-hover|group-hover:opacity-100/.test(src)) bad.push(`${f}: hover-only action`);
    if (/console\.(info|log|debug)\(/.test(src)) bad.push(`${f}: console logging`);
    if (/localStorage|sessionStorage/.test(src)) bad.push(`${f}: browser storage`);
    if (/toLocale(Date|Time)?String/.test(src)) bad.push(`${f}: locale date`);
    if (/\buseMutation\(/.test(src)) bad.push(`${f}: a bare useMutation`);
    if (/governance-light|\bslate-\d|\bprimary-\d{3}|\bemerald-|\brose-|\bamber-/.test(src)) bad.push(`${f}: the legacy wrapper or the palette`);
  }
  assert.deepEqual(bad, []);
});

test('nothing technical or vendor-named reaches a screen: no model or provider word, no server path, no e-mail, no internal ids', () => {
  for (const f of MINE.filter((x) => x.endsWith('.tsx'))) {
    const src = code(f);
    assert.doesNotMatch(src, /\bOpenAI\b|\bGPT\b|\bChatGPT\b|api key|tesseract/i, `${f} names a vendor or a setting`);
    assert.doesNotMatch(src, /\.file_path\b|uploaded_by|\.user_id\b|\.created_by\b/, `${f} reads something that is not for a person`);
  }
});

test('the old page\'s legacy kit and constants are gone: the _ui file, the hard-coded status lists and the moves table', () => {
  assert.equal(existsSync(join(STAT, '_ui.tsx')), false);
  for (const f of MINE) {
    const src = code(f);
    assert.doesNotMatch(src, /\bSTATUS_OPTIONS\b|\bSTATUS_LABEL\b|\bTRANSITIONS\b(?!\))|MultiSelectDropdown|DataTable|RightSlidePanel|AnimatedModal|RowActionsMenu/, `${f} still uses the old page's pieces`);
  }
});

test('every status is the organisation\'s own: the register, the record, the form and the drawer read the levels, never a constant', () => {
  const page = at(STAT, 'page.tsx');
  assert.match(page, /levelsOf\(metaQ\.data, rows\)/);
  assert.match(page, /observationDef\(levels, me\)/);
  assert.match(page, /nextStatuses\(levels, /);
  const record = at(STAT, '[id]', 'page.tsx');
  assert.match(record, /levelsOf\(metaQ\.data/);
  assert.match(record, /nextStatuses\(levels, o\.status\)/);
  assert.match(at(STAT, '_register', 'useObservationActions.tsx'), /levelPill\(levels, /);
  assert.match(at(STAT, '_register', 'ObservationForm.tsx'), /initialStatus\(levels\)/, 'a new observation starts in a status the organisation has');
});

test('the heads are the kit\'s, and the settings are a page of their own that holds the shared panel unchanged', () => {
  for (const f of [at(STAT, 'page.tsx'), at(STAT, '[id]', 'page.tsx'), at(STAT, 'settings', 'page.tsx'), at(INTERNAL, 'page.tsx')]) assert.match(f, /<PageHeader\s+variant="page"/);
  assert.match(at(STAT, 'settings', 'page.tsx'), /<ModuleSettingsPanel moduleKey="statutory_audit" \/>/);
  assert.match(at(STAT, 'page.tsx'), /href="\/auditor-portal\/statutory-audit\/settings"/, 'the register head links to it');
});

test('every request says loading, failed with Retry and empty on its own; a failed request is never drawn as an empty list or a zero', () => {
  const page = at(STAT, 'page.tsx');
  assert.match(page, /error=\{list\.isError && !list\.data \? list\.error : undefined\}/);
  assert.match(page, /onRetry=/);
  assert.match(page, /serverTotal=\{list\.data\?\.total\}/, 'the cut list says how many the server holds');
  assert.match(page, /metaQ\.isError/, 'a failure to load the status levels is said');
  const record = at(STAT, '[id]', 'page.tsx');
  assert.match(record, /<ErrorState/);
  assert.match(record, /onRetry=/);
  assert.match(record, /<SkeletonRows/);
  assert.match(at(STAT, '[id]', '_record', 'LinkPicker.tsx'), /<ErrorState/);
  const audits = at(INTERNAL, 'page.tsx');
  assert.match(audits, /onRetry: \(\) =>/);
  assert.match(audits, /error=\{q\.isError \?/);
  assert.doesNotMatch(audits, /\?\? \[\]\)\.length|error: null/, 'no failure becomes an empty list');
});

test('a write is confirmed or fails in words: reported mutations everywhere, a question before a delete, an unlink and a bulk change', () => {
  const actions = at(STAT, '_register', 'useObservationActions.tsx');
  assert.match(actions, /useReportedMutation\(/);
  assert.match(actions, /await confirm\(/);
  assert.match(actions, /tone: 'danger'/);
  for (const f of [['_register', 'ObservationForm.tsx'], ['_register', 'ImportSheet.tsx'], ['[id]', '_record', 'EvidenceTab.tsx'], ['[id]', '_record', 'LinksTab.tsx'], ['[id]', '_record', 'LinkPicker.tsx']]) {
    assert.match(at(STAT, ...f), /useReportedMutation\(/, f.join('/'));
  }
  assert.match(at(STAT, '[id]', '_record', 'EvidenceTab.tsx'), /await confirm\(/);
  assert.match(at(STAT, '[id]', '_record', 'LinksTab.tsx'), /await confirm\(/);
  assert.match(at(STAT, '_register', 'ObservationForm.tsx'), /toast: 'success'/, 'a failed save is said in the sheet, once');
});

test('a copy of a register finding is protected: its fields are read-only in the form, it is left out of bulk changes, and the notice says where to change it', () => {
  const form = at(STAT, '_register', 'ObservationForm.tsx');
  assert.match(form, /lockedField\(mirrored, field\)/);
  assert.match(form, /changes\(opened, draft, mirrored\)/, 'only what changed is sent, never what the register owns');
  const page = at(STAT, 'page.tsx');
  assert.match(page, /filter\(\(r\) => !r\.mirrored\)/);
  assert.match(page, /o\.mirrored \? \[\] : nextStatuses/);
  assert.match(at(STAT, '_register', 'parts.tsx'), /Open the finding/);
});

test('the AI import is stopped cleanly, says what is read of a long document, and names a draft that is already registered', () => {
  const sheet = at(STAT, '_register', 'ImportSheet.tsx');
  assert.match(sheet, /abort\.current\?\.abort\(\)/);
  assert.match(sheet, /readNotice\(answer\)/);
  assert.match(sheet, /Already registered/);
  assert.match(sheet, /first 20 pages/);
  assert.match(at(STAT, '_register', 'observationData.ts'), /signal/);
});

test('a link from a record opens the record: evidence, risks, issues and documents are links', () => {
  const links = at(STAT, '[id]', '_record', 'LinksTab.tsx');
  assert.match(links, /\/erm\/risks\/\$\{r\.risk_id\}/);
  assert.match(links, /\/issues\/\$\{r\.issue_id\}/);
  assert.match(links, /\/governance\/documents\/\$\{r\.document_id\}/);
  assert.match(at(STAT, '[id]', '_record', 'EvidenceTab.tsx'), /\/evidence\/\$\{r\.evidence_id\}/);
});

test('the old tab names still open the right tab, and the record opens on the timeline', () => {
  const record = at(STAT, '[id]', 'page.tsx');
  assert.match(record, /history: 'timeline'/);
  assert.match(record, /fallback: 'timeline'/);
  assert.match(record, /countFormat="exact"/, 'a count is the real one');
});

test('Internal Audit is a list: it opens no audit by itself, carries no switch to settings that are not its own, and keeps the legacy assessments client out', () => {
  const src = at(INTERNAL, 'page.tsx');
  assert.doesNotMatch(src, /ModuleSettingsPanel|ModuleSettingsSwitch|AssessmentsRedesignClient|router\.replace/);
  assert.match(src, /workspaceHref\(r\.id\)/);
  assert.match(src, /RegisterTable/);
  assert.match(src, /assessment_format: INTERNAL_AUDIT_FORMAT/);
});
