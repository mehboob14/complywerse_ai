// node --test src/lib/uxContent.test.ts
// UX rule U1 (the owner, 2026-11-05): show a person only what helps them understand, decide or act. A hash, a fingerprint, a checksum or any other technical
// receipt is not that: "Your electronic signature was recorded with a fingerprint (SHA-256): df87a89df405faad" after an attestation means nothing to the person
// who signed. Say what happened in plain words; if the technical value has an audit purpose, put it behind an explicit control (Verify, Details) for the people
// who check it, never in a confirmation, an explanation or a table cell everyone reads. This guard reads every screen's visible text (JSX text and prose string
// literals) and fails on those words. A file that must keep one is listed below WITH the reason; the entry goes when the text goes (the second test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const NOISE = /\b(?:SHA-?256|SHA-?1|fingerprints?|checksums?|uuids?|stack ?traces?|tracebacks?|hash(?:es)?)\b/i;

/** The text a person can read in a source file: JSX text and string literals that are prose (they hold a space); comments are dropped first. */
export function visibleText(source: string, jsx = true): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const out: string[] = [];
  if (jsx) {                                                                           // JSX text only in .tsx, and not a run that is really code
    let stripped = code;                                                               // {expressions} out (not the containers that hold markup), so the words around them read as one run
    for (let before = ''; before !== stripped; ) { before = stripped; stripped = stripped.replace(/\{(?:[^{}<>]|=>)*\}/g, ' '); }
    for (const m of Array.from(stripped.matchAll(/>([^<>]+)</g))) if (!/=>|===|;|\b(?:return|const|import|export|new)\b/.test(m[1])) out.push(m[1]);
  }
  for (const m of Array.from(code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g))) out.push(m[2].replace(/\$\{[^}]*\}/g, '…'));
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.includes(' '));
}

/** Files that show such a word on purpose today, with why. Each is a decision for the owner, not an exemption: fix the text and delete the line. */
const ALLOWED: Record<string, string> = {
  'components/governance/SignatureSeal.tsx': 'the seal beside a signature shows its short code with a Verify; the code is the tooltip of "E-signed" (move it into Verify when decided)',
  'app/(dashboard)/governance/documents/_SignoffControl.tsx': 'an (i) note on what signing stamps into the document-control sign-off table (D38/D39): wording decided with that page',
  'app/(dashboard)/compliance-plugins/page.tsx': 'Evidence Collectors: an "Evidence hash" column and its chain-of-custody tooltip, for auditors of collected evidence',
  'app/(dashboard)/compliance-plugins/[id]/page.tsx': 'Evidence Collectors: the "Evidence hash" column of a run, for auditors of collected evidence',
  'app/(dashboard)/vendor-risk/reports/[id]/page.tsx': 'the report header prints the report fingerprint (the examiner page shows the same code): decide whether anyone needs it there',
  'app/vendor-risk/examiner/[token]/page.tsx': 'the examiner page of a shared report prints the report fingerprint beside the expiry: decide whether examiners need it',
  'app/(dashboard)/vulnerabilities/ctem-scopes/CtemScopesRedesign.tsx': 'Cybersecurity Assurance (outside the UX pass): a "Membership hash" column',
  'app/(dashboard)/cyber-assurance/vulnerabilities/ctem-scopes/CtemScopesRedesign.tsx': 'Cybersecurity Assurance (outside the UX pass): a "Membership hash" column',
  'app/(dashboard)/cyber-assurance/compliance-plugins/page.tsx': 'Cybersecurity Assurance copy of the Evidence Collectors page (outside the UX pass)',
  'app/(dashboard)/cyber-assurance/compliance-plugins/[id]/page.tsx': 'Cybersecurity Assurance copy of the Evidence Collectors run page (outside the UX pass)',
  'app/(dashboard)/assets/[id]/_overview-map.ts': 'security terms: "no CDN / WAF fingerprint" is the scanner\'s word for what a web service reveals about itself',
  'app/(dashboard)/cyber-assurance/assets/[id]/_overview-map.ts': 'security terms: "no CDN / WAF fingerprint" is the scanner\'s word for what a web service reveals about itself',
  'lib/guide-notes.ts': '"the fingerprint of an asset that was auto-discovered": a figure of speech, not a value',
  'cyber-assurance/lib/guide-notes.ts': '"the fingerprint of an asset that was auto-discovered": a figure of speech, not a value',
  'lib/apiError.ts': 'the code that finds a Python traceback in an error so that it is NOT shown (safeDetail)',
  'app/(dashboard)/admin/ui-kit/_components/docs.ts': 'the developer style guide describes the address hash for people who build pages',
};

function sourceFiles(dir = SRC): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.d\.ts$|(^|\/)node_modules\//.test(f));
}

const hits = (file: string) => visibleText(readFileSync(`${SRC}${file}`, 'utf8'), file.endsWith('.tsx')).filter((s) => NOISE.test(s));

test('no screen says hash, fingerprint, checksum, UUID or a stack trace to a person, except where a decision keeps it (rule U1)', () => {
  const found = sourceFiles().filter((f) => !(f in ALLOWED) && hits(f).length).map((f) => `${f}: "${hits(f)[0].slice(0, 90)}"`);
  assert.deepEqual(found, [], 'say what happened in plain words; a technical value with an audit purpose goes behind Verify/Details (see the header of this file)');
});

test('every exception still has its text: an entry whose text is gone is deleted', () => {
  const stale = Object.keys(ALLOWED).filter((f) => !hits(f).length);
  assert.deepEqual(stale, []);
});

test('the reader finds prose and ignores code', () => {
  assert.ok(visibleText('<p>Your signature has a fingerprint (SHA-256) <b>x</b></p>').some((s) => NOISE.test(s)));
  assert.ok(visibleText("toast('The checksum did not match');").some((s) => NOISE.test(s)));
  assert.equal(visibleText("const hash = window.location.hash; // the SHA-256 of it\nconst k = 'fingerprint';").some((s) => NOISE.test(s)), false);
  assert.equal(visibleText('/* a hash of the file */ const x = 1;').length, 0);
});
