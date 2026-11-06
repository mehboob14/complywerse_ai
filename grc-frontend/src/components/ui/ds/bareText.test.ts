// node --test "src/components/ui/ds/bareText.test.ts"
// The platform CSS (app/globals.css) gives a bare <p>, <td> and <th> inside the shell 11.5px and the dark default colour (`.cw-dashboard :where(p, td, th)`),
// and a bare <h2>/<h3> 12.5px: a class that names a size wins, so the rule is "give the element a size". The kit guard (kitGuard.test.ts) reads only the kit's
// own files; this one reads the PAGES that moved to the kit (the Gate 4 groups of the Governance revamp, the style guide) and fails on a <p>, <td>, <th>,
// <h2> or <h3> whose class names no text size (text-ds-title, text-ds-section, text-ds-body, text-ds-label, a named size or an arbitrary text-[13px]).
// A size that only applies from a breakpoint (`md:text-ds-body`) does not count: below it the element is bare. A className that is built from constants is
// followed into the constants (this file, then the files it imports from); one that cannot be read (a prop passed through, a function call, a property of
// some data) is counted as "unreadable" and listed, never guessed. An element inside a visually hidden box (`sr-only`) is not drawn, so its size is never
// seen and it is not read. An exception is a line of ALLOWED below, with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = 'src/app/(dashboard)';

/** The page folders that are on the kit, from the Phase 1 progress log (each Gate 4 group, and the style guide). A new migrated folder is added here. */
const FOLDERS = [
  `${ROOT}/governance/_overview`,                 // G4-A Overview (its page.tsx is listed below)
  `${ROOT}/governance/settings`,                  // G4-a Settings
  `${ROOT}/governance/exceptions`,                // G4-D Policy exceptions
  `${ROOT}/governance/documents/attestation`,     // G4-D Attestation (documents\ belongs to other builders in parallel: read here, not edited)
  `${ROOT}/governance/documents/overview`,        // the Documents Overview (the library at a glance, by department)
  `${ROOT}/governance/reviews`,                   // G4-C Reviews and the Review calendar
  `${ROOT}/governance/_metrics`,                  // G4-F1 KPI Report (kpi-report/page.tsx is listed below)
  `${ROOT}/governance/committees`,                // G4-E Committees (the list, a committee, a meeting, Oversight Actions)
  `${ROOT}/governance/workflows`,                 // G4-G Approval Workflows (the legacy approval queue and its templates)
  `${ROOT}/is-projects`,                          // G4-F2 Projects
  `${ROOT}/governance/mappings`,                  // G4-G Policy-Control Mappings (standalone and the document's Mappings view)
  `${ROOT}/admin/ui-kit`,                         // the style guide, which documents this rule
  `${ROOT}/cyber-security/_overview`,              // the Cyber Security Overview (its page.tsx is listed below)
  'src/components/compliance/scoping',            // Cyber Security assessments: the type pages, the scoping workspace (components, not a page folder)
];
/** Single files of a migrated group whose folder holds other things. */
const FILES = [
  `${ROOT}/governance/page.tsx`, `${ROOT}/governance/kpi-report/page.tsx`,
  `${ROOT}/cyber-security/page.tsx`, `${ROOT}/cyber-security/assessments/[id]/page.tsx`, `${ROOT}/cyber-security/questionnaires/[format]/page.tsx`,   // the Cyber Security hub, an assessment and a questionnaire
];

/** Every exception, with the reason. `contains` is a piece of the opening tag; an entry that matches nothing fails the test, so the list cannot go stale. */
const ALLOWED: Array<{ file: string; contains: string; why: string }> = [];

const ELEMENTS = ['p', 'td', 'th', 'h2', 'h3'] as const;
/** a text size with no breakpoint or other variant in front of it; `!` (important) is allowed: it is what the kit's headings use */
const SIZE = /(?<![\w:\-[])!?text-(?:ds-(?:title|section|body|label)|xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|\[\d[^\]]*\])(?![\w-])/;

// ── reading a source ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/\s.*$/gm, '$1');

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p.replace(/\\/g, '/')] : [];
  });
}

/** Where the tag that starts at `start` ends: the first `>` outside braces and quotes (attributes may hold `=>`, `{...}` and quotes). -1 when it never ends. */
function tagEnd(source: string, start: number, nameLength: number): number {
  let depth = 0;
  let quote = '';
  for (let i = start + 1 + nameLength; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === quote && source[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

/** The text of every opening tag `<name ...>` of a JSX source, where it starts and the line it starts on. */
function openingTags(source: string, name: string): Array<{ text: string; start: number; line: number }> {
  const tags: Array<{ text: string; start: number; line: number }> = [];
  for (const m of Array.from(source.matchAll(new RegExp(`<${name}(?=[\\s/>])`, 'g')))) {
    const start = m.index ?? 0;
    const end = tagEnd(source, start, name.length);
    if (end >= 0) tags.push({ text: source.slice(start, end + 1), start, line: source.slice(0, start).split('\n').length });
  }
  return tags;
}

/** The stretches of the source inside an element that is visually hidden (`sr-only` in its class): from its opening tag to its closing one. What is in
 *  them is read out and never drawn, so the size of its text is never seen. */
function hiddenRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const open of Array.from(source.matchAll(/<([a-z][a-z0-9]*)(?=[\s/>])/g))) {
    const name = open[1];
    const start = open.index ?? 0;
    const end = tagEnd(source, start, name.length);
    if (end < 0 || source[end - 1] === '/' || !/className=(?:"[^"]*|'[^']*|\{[^}]*['"`][^'"`]*)\bsr-only\b/.test(source.slice(start, end + 1))) continue;
    let depth = 1;
    for (const next of Array.from(source.slice(end + 1).matchAll(new RegExp(`<${name}(?=[\\s/>])|</${name}>`, 'g')))) {
      const at = end + 1 + (next.index ?? 0);
      if (next[0].startsWith('</')) depth -= 1;
      else if (source[tagEnd(source, at, name.length) - 1] !== '/') depth += 1;
      if (depth === 0) { ranges.push([start, at]); break; }
    }
  }
  return ranges;
}

/** The text between the braces that open at `from` (the character after the `{`), or '' when they never close. */
function braced(source: string, from: number): string {
  let depth = 1;
  let quote = '';
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === quote && source[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(from, i);
  }
  return '';
}

const LITERAL = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g;

/** What a tag says about its class, as one string to look for a size in, or null when it cannot be read: a prop passed through, a function call, a property of
 *  some data (`t.cls`), or a constant (an UPPER_CASE or PascalCase name) that is not found. A lowercase name (`open`, `tone`) is a condition or a key, not a
 *  source of classes. A `${CONSTANT}` inside a template literal is followed like any other. */
function classOf(tag: string, resolve: (name: string) => string | null): string | null {
  const quoted = /\bclassName=(?:"([^"]*)"|'([^']*)')/.exec(tag);
  if (quoted) return quoted[1] ?? quoted[2];
  const at = tag.search(/\bclassName=\{/);
  if (at < 0) return /\{\.\.\./.test(tag) ? null : '';                         // no className at all: bare, unless a spread may bring one
  const expression = braced(tag, at + 'className={'.length);
  let text = Array.from(expression.matchAll(LITERAL), (m) => m[1] ?? m[2] ?? m[3]).join(' ');
  // the code that is not a string: the expression with its literals taken out, and what a template literal interpolates
  const interpolated = Array.from(expression.matchAll(/\$\{([^}]*)\}/g), (m) => m[1]).join(' ');
  const outside = `${expression.replace(LITERAL, ' ')} ${interpolated}`;
  let unreadable = /(?<![\w$.])className\b/.test(outside)
    || /(?<![\w$.])(?!clsx\b|cn\b)[A-Za-z_$][\w$.]*\s*\(/.test(outside)         // a function call
    || /[A-Za-z_$\])][\w$]*\.[A-Za-z_$]/.test(outside.replace(/\bclsx\b/g, ''));  // a property of some data
  for (const name of Array.from(new Set(Array.from(outside.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\b(?!\s*\()/g), (m) => m[1])))) {
    if (['clsx', 'cn', 'undefined', 'null', 'true', 'false', 'className'].includes(name)) continue;
    const resolved = resolve(name);
    if (resolved !== null) text += ` ${resolved}`;
    else if (/^[A-Z]/.test(name)) unreadable = true;
  }
  return unreadable && !SIZE.test(text) ? null : text;
}

const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"](\.[^'"]*)['"]/g;

/** The strings of `const NAME = ...` in `source` (every literal inside the declaration, so an object of classes gives all of them), or null. */
function constantsOf(source: string, name: string): string | null {
  const head = new RegExp(`(?:export\\s+)?const\\s+${name.replace(/\$/g, '\\$')}\\b[^=]*=`).exec(source);
  if (!head) return null;
  let depth = 0;
  let quote = '';
  let end = source.length;
  for (let i = head.index + head[0].length; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === quote && source[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ';' && depth <= 0) { end = i; break; }
  }
  const body = source.slice(head.index + head[0].length, end);
  return Array.from(body.matchAll(LITERAL), (m) => m[1] ?? m[2] ?? m[3]).join(' ');
}

function resolver(file: string, source: string): (name: string) => string | null {
  const cache = new Map<string, string | null>();
  return (name) => {
    if (cache.has(name)) return cache.get(name) ?? null;
    let found = constantsOf(source, name);
    if (found === null) {
      for (const m of Array.from(source.matchAll(IMPORT))) {
        if (!m[1].split(',').some((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop() === name)) continue;
        const base = join(dirname(file), m[2]);
        const target = [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')].find((p) => existsSync(p));
        if (target) found = constantsOf(strip(readFileSync(target, 'utf8')), name);
        if (found !== null) break;
      }
    }
    cache.set(name, found);
    return found;
  };
}

interface Finding { file: string; line: number; element: string; tag: string }

/** Every <p>, <td>, <th>, <h2> and <h3> of a source whose class names no text size. `unreadable` counts the ones whose class could not be read. */
function scan(file: string, original: string): { findings: Finding[]; unreadable: number; checked: number } {
  const source = strip(original);
  const resolve = resolver(file, source);
  const hidden = hiddenRanges(source);
  const findings: Finding[] = [];
  let unreadable = 0;
  let checked = 0;
  for (const element of ELEMENTS) {
    for (const tag of openingTags(source, element)) {
      if (hidden.some(([from, to]) => tag.start > from && tag.start < to)) continue;
      checked += 1;
      const classes = classOf(tag.text, resolve);
      if (classes === null) { unreadable += 1; continue; }
      if (!SIZE.test(classes)) findings.push({ file, line: tag.line, element, tag: tag.text.replace(/\s+/g, ' ').slice(0, 140) });
    }
  }
  return { findings, unreadable, checked };
}

// ── the scanner itself ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const found = (source: string, file = 'x.tsx') => scan(file, source).findings.map((f) => f.element);

test('a bare <p>, <td>, <th>, <h2> and <h3> are found; one with a size is not', () => {
  assert.deepEqual(found('<p>hello</p><p className="mt-1">x</p><td>1</td><th>h</th><h2>t</h2><h3 className="font-medium">s</h3>'), ['p', 'p', 'td', 'th', 'h2', 'h3']);
  assert.deepEqual(found('<p className="text-ds-body text-ds-fg">x</p><p className="text-[12px]">x</p><td className="text-ds-label">x</td><h2 className="!text-ds-section">t</h2><p className="text-sm">x</p>'), []);
});

test('only the sizes count: a colour, a weight and a text-[...] that is not a size do not', () => {
  assert.deepEqual(found('<p className="text-ds-fg">a</p><p className="text-ds-fg-muted font-[600]">b</p><p className="text-[#fff]">c</p><p className="text-[var(--x)]">d</p><p className="text-left">e</p>'), ['p', 'p', 'p', 'p', 'p']);
  assert.deepEqual(found('<p className="text-[13px] text-ds-fg">a</p><p className="text-[1.25rem]">b</p>'), []);
});

test('a size that only applies from a breakpoint or a state is not a size: below it the element is bare', () => {
  assert.deepEqual(found('<p className="md:text-ds-body">a</p><p className="hover:text-ds-label">b</p><p className="max-md:text-[12px]">c</p>'), ['p', 'p', 'p']);
  assert.deepEqual(found('<p className="md:text-ds-body text-ds-label">a</p>'), []);
});

test('similar names are not these elements (pre, path, thead, tr, h1, h4), and a comparison is not a tag', () => {
  assert.deepEqual(found('<pre>x</pre><path d="m1" /><thead><tr><h1>a</h1><h4>b</h4></tr></thead>'), []);
  assert.deepEqual(found('const n = a<p.length; const q = i < p;'), []);
});

test('a tag whose attributes hold arrows, braces and quotes is read to its end', () => {
  assert.deepEqual(found('<p onClick={(e) => { if (a > b) go("x>y"); }} className="a>b text-ds-body">x</p>'), []);
  assert.deepEqual(found('<p onClick={(e) => { if (a > b) go("x>y"); }} title="x">x</p>'), ['p']);
});

test('comments are not code', () => {
  assert.deepEqual(found('// <p>a</p>\n/* <td>b</td> */\n{/* <h2>c</h2> */}\n<p className="text-ds-body">d</p>'), []);
});

test('a className built from constants is followed into them: this file, a template\'s ${CONSTANT}, an object of classes', () => {
  assert.deepEqual(found("const LABEL = 'text-ds-label text-ds-fg-muted';\nconst X = <p className={LABEL}>a</p>;"), []);
  assert.deepEqual(found("const NUMBER = 'text-[24px] font-[600]';\nconst X = <p className={`mt-[4px] ${NUMBER}`}>a</p>;"), []);
  assert.deepEqual(found("const MUTED = 'text-ds-fg-muted';\nconst X = <p className={MUTED}>a</p>;"), ['p']);
  assert.deepEqual(found("const MUTED = 'text-ds-fg-muted';\nconst X = <p className={`mt-1 ${MUTED}`}>a</p>;"), ['p']);
  assert.deepEqual(found("const TONE = { a: 'text-ds-body text-ds-fg', b: 'text-ds-body text-ds-danger' } as const;\nconst X = <p className={clsx('mt-1', TONE[tone])}>a</p>;"), []);
  assert.deepEqual(found("const X = <p className={`mt-1 ${cond ? 'text-ds-body' : 'text-ds-label'}`}>a</p>;"), []);
  assert.deepEqual(found("const X = <p className={clsx('mt-1', cond && 'text-ds-fg')}>a</p>;"), ['p']);
});

test('a className that cannot be read is listed as unreadable, never guessed: a prop, a call, a property of some data, a constant that is not found', () => {
  const r = scan('x.tsx', '<p className={className}>a</p><p className={pick(x)}>b</p><p {...rest}>c</p><p className={clsx(t.cls, "mt-1")}>d</p><p className={NOWHERE}>e</p>');
  assert.deepEqual(r.findings, []);
  assert.equal(r.unreadable, 5);
  assert.equal(r.checked, 5);
  assert.deepEqual(scan('x.tsx', '<p className={clsx(t.cls, "text-ds-body")}>d</p>').findings, []);          // sized all the same: readable enough
});

test('what is inside a visually hidden box is not drawn, so it is not read: a table for a screen reader needs no size', () => {
  assert.deepEqual(found('<table className="sr-only"><caption>c</caption><thead><tr><th scope="col">a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><p>drawn</p>'), ['p']);
  assert.deepEqual(found('<div className="mt-1 sr-only"><div><p>x</p></div><p>y</p></div><p>z</p>'), ['p']);                    // nested boxes of the same name
  assert.deepEqual(found('<div className="flex"><p>drawn</p></div>'), ['p']);
  assert.deepEqual(found('<span className={clsx("sr-only", x)}>a</span><p>drawn</p>'), ['p']);
  assert.deepEqual(found('<span className="not-sr-only-at-all">a</span><p>drawn</p>'), ['p']);                                  // a class that merely contains the word
});

// ── the pages ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const all = [...FOLDERS.flatMap(files), ...FILES.filter((f) => existsSync(f))];
const results = all.map((file) => ({ file, ...scan(file, readFileSync(file, 'utf8')) }));

test('the migrated folders exist and are read', () => {
  for (const folder of FOLDERS) assert.ok(existsSync(folder), `${folder} is gone: update FOLDERS`);
  for (const file of FILES) assert.ok(existsSync(file), `${file} is gone: update FILES`);
  assert.ok(results.length > 60, `only ${results.length} files read`);
  assert.ok(results.reduce((n, r) => n + r.checked, 0) > 200, 'the scan found too few elements to mean anything');
});

test('no <p>, <td>, <th>, <h2> or <h3> of a migrated page is bare: each names a text size', () => {
  const bad = results.flatMap((r) => r.findings)
    .filter((f) => !ALLOWED.some((a) => a.file === f.file && f.tag.includes(a.contains)))
    .map((f) => `${f.file}:${f.line} ${f.tag}`);
  assert.deepEqual(bad, []);
});

test('every exception in ALLOWED still matches something (a stale one fails), and has its reason', () => {
  const findings = results.flatMap((r) => r.findings);
  for (const a of ALLOWED) {
    assert.ok(a.why.trim().length > 10, `${a.file}: no reason`);
    assert.ok(findings.some((f) => f.file === a.file && f.tag.includes(a.contains)), `${a.file}: "${a.contains}" matches nothing any more`);
  }
});

test('how many class names could not be read stays small, so the guard means something', (t) => {
  const unreadable = results.reduce((n, r) => n + r.unreadable, 0);
  const checked = results.reduce((n, r) => n + r.checked, 0);
  t.diagnostic(`bareText: ${checked} elements in ${results.length} files, ${unreadable} with a class that cannot be read`);
  assert.ok(unreadable <= Math.ceil(checked * 0.05), `${unreadable} of ${checked} elements have a class that cannot be read: ${results.filter((r) => r.unreadable).map((r) => `${r.file} (${r.unreadable})`).join(', ')}`);
});
