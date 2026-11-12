// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryWords.test.ts"
// The owner, 2026-11-12: "under document library don't use in force anywhere, use published instead". A document is published, or it is not: no screen of Governance > Documents says it is
// "in force" (the Overview, which has its own guard, is the one folder left out). The guard reads what a person can read in each source file (JSX text and string literals, comments dropped, as
// lib/uxContent.test.ts does) and fails on the words; a code identifier (`version_in_force`, `inForce`, the `in-force` view id) is not text and stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DOCUMENTS = fileURLToPath(new URL('../', import.meta.url));
const IN_FORCE = /\bin[\s-]+force\b/i;

/** The text a person can read in a source file: JSX text and string literals that are prose (they hold a space); comments are dropped first. */
export function visibleText(source: string, jsx = true): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const out: string[] = [];
  if (jsx) {
    let stripped = code;                                                               // {expressions} out, so the words around them read as one run
    for (let before = ''; before !== stripped; ) { before = stripped; stripped = stripped.replace(/\{(?:[^{}<>]|=>)*\}/g, ' '); }
    for (const m of Array.from(stripped.matchAll(/>([^<>]+)</g))) if (!/=>|===|;|\b(?:return|const|import|export|new)\b/.test(m[1])) out.push(m[1]);
  }
  for (const m of Array.from(code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g))) out.push(m[2].replace(/\$\{[^}]*\}/g, '…'));
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.includes(' '));
}

function sourceFiles(): string[] {
  return (readdirSync(DOCUMENTS, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.d\.ts$/.test(f) && !f.startsWith('overview/'));
}

test('no screen of Governance > Documents says "in force": it says Published', () => {
  const files = sourceFiles();
  assert.ok(files.length > 100 && files.includes('_workspace/DocumentsWorkspace.tsx') && files.includes('[id]/_DocumentStudio.tsx') && files.includes('_workspace/folders/DefaultCard.tsx'), 'the guard reads the whole area');
  const found = files.flatMap((f) => visibleText(readFileSync(`${DOCUMENTS}${f}`, 'utf8'), f.endsWith('.tsx')).filter((s) => IN_FORCE.test(s)).map((s) => `${f}: "${s.slice(0, 90)}"`));
  assert.deepEqual(found, [], 'say "published" (or "active" for a default); the code may keep version_in_force, inForce and the in-force view id');
});

test('the reader finds the words in prose and in JSX and leaves identifiers and comments alone', () => {
  assert.ok(visibleText("toast('It is no longer in force');").some((s) => IN_FORCE.test(s)));
  assert.ok(visibleText('<span>The version In Force</span>').some((s) => IN_FORCE.test(s)));
  assert.ok(visibleText('const l = `v${n} in force`;', false).some((s) => IN_FORCE.test(s)));
  assert.equal(visibleText("const inForce = doc.version_in_force; // the version in force\nconst id = 'in-force'; /* in force */").some((s) => IN_FORCE.test(s)), false);
});
