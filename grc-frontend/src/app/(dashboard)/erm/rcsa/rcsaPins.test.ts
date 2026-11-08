// node --test "src/app/(dashboard)/erm/rcsa/rcsaPins.test.ts"
// Source-text pins for the RCSA Worklist, the unit page, the campaigns and the findings (everything under erm/rcsa except the Templates folders, which have their own). The kit's rules are read from the
// kit's list (components/ui/ds/kitRules.ts); the rest are this group's promises: no native dialog, nothing only on hover, nothing technical or permission-shaped in a sentence a person reads, a bare <p>
// that names its size, and the contracts that fixed the old pages' bugs (answers saved under the API's names; link calls with query parameters; the old addresses only forward).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../../../components/ui/ds/kitRules.ts';

const ROOT = fileURLToPath(new URL('./', import.meta.url)).replace(/\\/g, '/');
const API = fileURLToPath(new URL('../../../../lib/api.ts', import.meta.url)).replace(/\\/g, '/');
const OWN = ['page.tsx', '_parts', 'assessments', 'campaigns', 'findings', 'approvals'];

function filesOf(base: string): string[] {
  return (readdirSync(base, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => `${base}${f}`);
}
const FILES = OWN.flatMap((name) => (name.endsWith('.tsx') ? [`${ROOT}${name}`] : filesOf(`${ROOT}${name}/`)));
const read = (p: string): string => readFileSync(p, 'utf8');
const rel = (p: string): string => p.replace(ROOT, '');

function visible(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  let stripped = code;
  for (let before = ''; before !== stripped; ) { before = stripped; stripped = stripped.replace(/\{(?:[^{}<>]|=>)*\}/g, ' '); }
  const out: string[] = [];
  for (const m of Array.from(stripped.matchAll(/>([^<>]+)</g))) if (!/=>|===|;|\b(?:return|const|import|export|new)\b/.test(m[1])) out.push(m[1]);
  for (const m of Array.from(code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g))) out.push(m[2].replace(/\$\{[^}]*\}/g, '…'));
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.includes(' '));
}

test('the pages of the group are the ones we expect: the old addresses are pages that only forward', () => {
  const pages = FILES.filter((f) => /\/page\.tsx$/.test(f)).map(rel).sort();
  assert.deepEqual(pages, ['approvals/[id]/page.tsx', 'approvals/page.tsx', 'assessments/[id]/page.tsx', 'assessments/page.tsx', 'campaigns/[id]/page.tsx', 'campaigns/page.tsx', 'findings/[id]/page.tsx', 'findings/page.tsx', 'page.tsx']);
  for (const old of ['approvals/page.tsx', 'approvals/[id]/page.tsx', 'assessments/page.tsx']) assert.match(read(`${ROOT}${old}`), /redirect\(/, old);
  assert.match(read(`${ROOT}findings/[id]/page.tsx`), /findings\?open=/);
});

test('every page and part follows the kit rules: tokens and arbitrary values only, nothing under 12px, no bare outline-none', () => {
  const found = FILES.flatMap((f) => findViolations(read(f)).map((v) => `${rel(f)}:${v.line} ${v.rule} ${v.text}`));
  assert.deepEqual(found, []);
});

test('no native dialog and no action that exists only on hover', () => {
  const found: string[] = [];
  for (const f of FILES) {
    const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
    if (/\bwindow\.(confirm|alert|prompt)\b|(^|[^.\w])(confirm|alert|prompt)\(/m.test(text.replace(/\bconfirm\(\{/g, 'ask({'))) found.push(`${rel(f)}: a native dialog`);
    if (/opacity-0[^'"`]*group-hover|group-hover[^'"`]*opacity-0/.test(text)) found.push(`${rel(f)}: opacity-0 group-hover`);
  }
  assert.deepEqual(found, []);
});

test('nothing a person reads names a permission key or "Tenant", and no id, hash, file path or vendor name (rule U1)', () => {
  const found: string[] = [];
  for (const f of FILES) {
    for (const s of visible(read(f))) {
      if (/\berm:rcsa:|\b\w+:\w+:(view|edit|create|delete)\b/.test(s)) found.push(`${rel(f)}: a permission key in "${s.slice(0, 70)}"`);
      if (/\bTenant\b|tenant's/i.test(s)) found.push(`${rel(f)}: "Tenant" in "${s.slice(0, 70)}"`);
      if (/\b(?:sha-?256|checksum|fingerprint|uuid|traceback|stack trace)\b|\bID\s*#|#\{|\bRisk #|\bControl #|\bUser ID\b/i.test(s)) found.push(`${rel(f)}: technical words in "${s.slice(0, 70)}"`);
      if (/openai|gpt-|anthropic|claude-/i.test(s)) found.push(`${rel(f)}: a vendor or model name in "${s.slice(0, 70)}"`);
    }
  }
  assert.deepEqual(found, []);
});

test('a bare <p> names its size (the platform CSS gives a bare one 11.5px and dark text)', () => {
  const bare: string[] = [];
  for (const f of FILES.filter((p) => p.endsWith('.tsx'))) {
    for (const m of Array.from(read(f).matchAll(/<p\b((?:[^>=]|=(?!>))*)>/g))) {
      if (!/text-ds-(?:body|label|section|title)|text-\[\d+px\]/.test(m[1])) bare.push(`${rel(f)}: <p${m[1].slice(0, 60)}>`);
    }
  }
  assert.deepEqual(bare, []);
});

test('the unit page saves through the model\'s payload (the API\'s field names), starts itself on the assessor\'s first visit and never offers a Start button', () => {
  const hook = read(`${ROOT}assessments/[id]/_parts/useAnswers.ts`);
  assert.match(hook, /savePayload\(byId\.get\(id\) as Question/);
  assert.doesNotMatch(hook, /yes_no_value|text_value|effectiveness:/);
  const page = read(`${ROOT}assessments/[id]/page.tsx`);
  assert.match(page, /canStart\(\{ status: data\.status, campaignStatus: data\.campaign_status \}\)/);
  assert.match(page, /data\.viewer_is_assessor/);
  assert.doesNotMatch(page, />\s*Start\s*</);
  assert.match(page, /await api\.flush\(\)/, 'Submit waits for what is unsaved');
});

test('the finding calls take query parameters, as the server reads them (the old pages posted a body the server ignores)', () => {
  const all = read(API);
  const api = all.slice(all.indexOf('export const rcsaApi = {'), all.indexOf('export const dashboardApi'));
  assert.match(api, /linkFindingToRisk: \(id: number, riskId: number\) => apiClient\.post\([^)]*undefined, \{ params: \{ risk_id: riskId \} \}/);
  assert.match(api, /linkFindingToControl: \(id: number, controlId: number\)[^\n]*params: \{ control_id: controlId \}/);
  assert.match(api, /createFinding: \(assessmentId: number[^\n]*params: \{ assessment_id: assessmentId \}/);
  assert.doesNotMatch(api, /getPendingApprovals|sendReminders|exportResults|getFinding:/);
});

test('the registers are complete loads and say their true totals (no first-100 cut)', () => {
  const data = read(`${ROOT}_parts/rcsaData.ts`);
  assert.match(data, /export async function fetchAll/);
  for (const f of ['campaigns/page.tsx', 'findings/page.tsx']) assert.match(read(`${ROOT}${f}`), /fetchAll</, f);
});
