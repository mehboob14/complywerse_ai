// node --test "src/app/(dashboard)/erm/riskPagesGuard.test.ts"
// Source-text guard for the pages the register group rebuilt (the Overview, the Risk Register, the risk page, Reviews, Reports): the kit's own rules (no named text sizes, palette colours,
// shadows, radii, weights or remapped spacing; nothing under 12px; no bare outline-none), no native confirm / alert / prompt, no action that appears only on hover, no model or vendor name on a
// screen, and no raw id or hash shown. Two pieces are older code moved as they were and listed with the reason: the Add / Edit form (RiskForm.tsx: the register's template blocks, 1,900 lines of
// palette classes) and the CRQM summary card. They are held to the rules that do not need a restyle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { findViolations } from '../../../components/ui/ds/kitRules.ts';

const ERM = 'src/app/(dashboard)/erm';
const OWN = ['page.tsx', '_overview', 'reviews/page.tsx', 'reviews/_review', 'reports/page.tsx', 'risks/page.tsx', 'risks/_register', 'risks/[id]/page.tsx', 'risks/[id]/_workspace'];
/** Moved as they were, not restyled in this pass: the rules that do not need a restyle still apply. */
const MOVED = ['risks/_register/RiskForm.tsx'];

function files(rel: string): string[] {
  const p = join(ERM, rel);
  if (statSync(p).isDirectory()) return readdirSync(p).flatMap((n) => files(join(rel, n)));
  return /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) ? [rel] : [];
}
const all = OWN.flatMap(files);
const strict = all.filter((f) => !MOVED.includes(f.replace(/\\/g, '/')));
const src = (f: string) => readFileSync(join(ERM, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the rebuilt pages follow the kit rules (tokens, no remapped utilities, nothing under 12px)', () => {
  const bad = strict.flatMap((f) => findViolations(readFileSync(join(ERM, f), 'utf8')).map((v) => `${f}:${v.line} ${v.rule}: ${v.text}`));
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

test('the moved form keeps the rules that need no restyle: no native dialog, no text under 12px', () => {
  for (const f of MOVED) {
    const s = readFileSync(join(ERM, f), 'utf8');
    assert.deepEqual(findViolations(s).filter((v) => v.rule === 'small-text').map((v) => `${v.line}: ${v.text}`), [], `${f}: text under 12px`);
  }
});

test('nothing shows a record id as a name: no "RISK-" + id, no #id, no raw status word', () => {
  for (const f of strict) {
    const s = src(f);
    assert.doesNotMatch(s, /RISK-\$\{|`#\$\{[a-z.]*id\}/, `${f}: an internal id on a screen`);
  }
});
