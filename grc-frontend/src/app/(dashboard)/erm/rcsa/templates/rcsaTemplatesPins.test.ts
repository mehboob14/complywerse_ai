// node --test "src/app/(dashboard)/erm/rcsa/templates/rcsaTemplatesPins.test.ts"
// Source-text pins for the RCSA Templates library, the questionnaire workspace and the register workspace (the folders `templates` and `custom-templates`, and the models behind them).
// The kit's own rules (named Tailwind utilities, palette colours, text under 12px, a bare outline-none ...) are read from the kit's list (components/ui/ds/kitRules.ts), so a page and the kit
// cannot drift apart; the rest are this group's promises: no native dialogs, nothing that appears only on hover, nothing technical or permission-shaped in a sentence a person reads, a bare
// <p> that names its size, and the contracts that fixed the old pages' bugs (the editor starts from the question being edited; a new question carries no id; nothing is drag-only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const dir = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url)).replace(/\\/g, '/');
const HERE = dir('./');
const SIBLING = dir('../custom-templates/');
const LIB = dir('../../../../../lib/rcsa/');

function filesOf(dir: string, pattern: RegExp): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => pattern.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => `${dir}${f}`);
}

const PAGES = [...filesOf(HERE, /\.tsx?$/), ...filesOf(SIBLING, /\.tsx?$/)];
const MODELS = ['templatesModel.ts', 'registerModel.ts', 'saveBlob.ts'].map((f) => `${LIB}${f}`);
const read = (path: string): string => readFileSync(path, 'utf8');
const rel = (path: string): string => path.replace(HERE, 'templates/').replace(SIBLING, 'custom-templates/').replace(LIB, 'lib/rcsa/');

/** What a person can read in a source file: JSX text and prose string literals (comments dropped first); the same reading uxContent.test.ts makes. */
function visible(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  let stripped = code;
  for (let before = ''; before !== stripped; ) { before = stripped; stripped = stripped.replace(/\{(?:[^{}<>]|=>)*\}/g, ' '); }
  const out: string[] = [];
  for (const m of Array.from(stripped.matchAll(/>([^<>]+)</g))) if (!/=>|===|;|\b(?:return|const|import|export|new)\b/.test(m[1])) out.push(m[1]);
  for (const m of Array.from(code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g))) out.push(m[2].replace(/\$\{[^}]*\}/g, '…'));
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.includes(' '));
}

test('the folders hold the pages we expect and nothing reads as a page by accident', () => {
  const pages = PAGES.filter((f) => /\/page\.tsx$/.test(f)).map(rel).sort();
  assert.deepEqual(pages, ['custom-templates/[id]/page.tsx', 'custom-templates/page.tsx', 'templates/[id]/page.tsx', 'templates/page.tsx']);
});

test('every page and part follows the kit rules: tokens and arbitrary values only, nothing under 12px, no bare outline-none', () => {
  const found = PAGES.flatMap((f) => findViolations(read(f)).map((v) => `${rel(f)}:${v.line} ${v.rule} ${v.text}`));
  assert.deepEqual(found, []);
});

test('no native dialog, no action that exists only on hover, no drag-only reordering', () => {
  const found: string[] = [];
  for (const f of [...PAGES, ...MODELS]) {
    const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
    if (/\bwindow\.(confirm|alert|prompt)\b|(^|[^.\w])(confirm|alert|prompt)\(/m.test(text.replace(/\bconfirm\(\{/g, 'ask({'))) found.push(`${rel(f)}: a native dialog`);
    if (/opacity-0[^'"`]*group-hover|group-hover[^'"`]*opacity-0/.test(text)) found.push(`${rel(f)}: opacity-0 group-hover`);
    if (/\bdraggable\b|onDragStart|onDragOver|onDrop\b/.test(text)) found.push(`${rel(f)}: drag and drop`);
  }
  assert.deepEqual(found, []);
});

test('nothing a person reads names a permission key or "Tenant", and no raw id, hash or file path (rule U1)', () => {
  const found: string[] = [];
  for (const f of [...PAGES, ...MODELS]) {
    for (const s of visible(read(f))) {
      if (/\berm:rcsa:|\b\w+:\w+:(view|edit|create|delete)\b/.test(s)) found.push(`${rel(f)}: a permission key in "${s.slice(0, 70)}"`);
      if (/\bTenant\b|tenant's/i.test(s)) found.push(`${rel(f)}: "Tenant" in "${s.slice(0, 70)}"`);
      if (/\b(?:sha-?256|checksum|fingerprint|uuid|traceback|stack trace)\b|\bID\s*#|#\{|\bAdministration\s*(?:→|->)/i.test(s)) found.push(`${rel(f)}: technical words in "${s.slice(0, 70)}"`);
      if (/openai|gpt-|anthropic|claude-/i.test(s)) found.push(`${rel(f)}: a vendor or model name in "${s.slice(0, 70)}"`);
    }
  }
  assert.deepEqual(found, []);
});

test('a bare <p> names its size (the platform CSS gives a bare one 11.5px and dark text)', () => {
  const bare: string[] = [];
  for (const f of PAGES.filter((p) => p.endsWith('.tsx'))) {
    for (const m of Array.from(read(f).matchAll(/<p\b((?:[^>=]|=(?!>))*)>/g))) {
      if (!/text-ds-(?:body|label|section|title)|text-\[\d+px\]/.test(m[1])) bare.push(`${rel(f)}: <p${m[1].slice(0, 60)}>`);
    }
  }
  assert.deepEqual(bare, []);
});

test('the question editor starts from the question being edited and from this opening of it (the old one kept the first question\'s type and choices)', () => {
  const sheet = read(`${HERE}[id]/_parts/QuestionSheet.tsx`);
  assert.match(sheet, /key=\{`\$\{shown\.question\.key\}:\$\{shown\.nonce\}`\}/);
  assert.match(sheet, /useState\(first\.kind\)/);
});

test('the questionnaire is saved through the model\'s payload (a new question carries no id) and every move is a button, not a drag', () => {
  const page = read(`${HERE}[id]/page.tsx`);
  assert.match(page, /updateTemplate\(id, \{ questions: toPayload\(draftRef\.current\) \}\)/);
  const outline = read(`${HERE}[id]/_parts/Outline.tsx`);
  assert.match(outline, /Move question \$\{number\} up/);
  assert.match(outline, /Move question \$\{number\} down/);
});

test('the pages that draw their own head say so with the kit\'s PageHeader in its page variant, and the old registers address is only a redirect', () => {
  for (const f of ['templates/page.tsx', 'templates/[id]/page.tsx', 'custom-templates/[id]/page.tsx']) {
    const src = read(f.startsWith('templates') ? `${HERE}${f.slice('templates/'.length)}` : `${SIBLING}${f.slice('custom-templates/'.length)}`);
    assert.match(src, /<PageHeader[\s\S]{0,40}variant="page"/, f);
  }
  const old = read(`${SIBLING}page.tsx`);
  assert.match(old, /router\.replace\(to\)/);
  assert.doesNotMatch(old, /PageHeader/);
  assert.match(old, /kind=registers/);
  assert.match(old, /assigned-to-me/);
});

test('the register workspace follows the edit right the server asks for, keeps the deep link and never prints a permission key', () => {
  const data = read(`${SIBLING}[id]/_parts/registerData.ts`);
  assert.match(data, /hasPermission\('erm:rcsa:edit'\)/);
  const items = read(`${SIBLING}[id]/_parts/RegisterItems.tsx`);
  assert.match(items, /defaultSort=\{\{ key: 'residual', dir: 'desc' \}\}/);
  assert.match(items, /registerLevel/);
});
