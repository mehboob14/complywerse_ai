// Source-text scanning for the tests of the Evidence pages (evidencePage.test.ts, requirementsPage.test.ts): the same rules the design-system kit holds its own
// files to (ds/kitRules.ts), read over the page folders that moved to the kit, plus the two rules the kit's guards keep for pages: a bare <p>, <td>, <th>,
// <h2> or <h3> gets the platform's 11.5px unless its class names a size, and native dialogs / hover-only actions are gone. Not part of the app.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findViolations } from '../../../components/ui/ds/kitRules.ts';

/** The .tsx sources of a folder (its tests and the folders in `skip` left out). */
export function tsxFiles(dir: string, skip: readonly string[] = []): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (skip.includes(name)) return [];
    if (statSync(path).isDirectory()) return tsxFiles(path, skip);
    return /\.tsx$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path.replace(/\\/g, '/')] : [];
  });
}

export const read = (file: string): string => readFileSync(file, 'utf8');

/** Comments out (so a rule written in a comment is not a violation). */
const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|\s)\/\/\s.*$/gm, '$1');

/** Every kit-rule violation in the files: "file:line rule text". */
export function kitViolations(files: readonly string[]): string[] {
  return files.flatMap((file) => findViolations(read(file)).map((v) => `${file}:${v.line} ${v.rule} ${v.text}`));
}

const SIZE = /(?<![\w:\-[])!?text-(?:ds-(?:title|section|body|label)|xs|sm|base|lg|xl|2xl|3xl|4xl|\[\d[^\]]*\])(?![\w-])/;

/** The end of the tag that starts at `start`: the first `>` outside braces and quotes. */
function tagEnd(source: string, start: number): number {
  let depth = 0;
  let quote = '';
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (c === quote && source[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

/** The text a tag's class is made of: its string literals, and what each `${NAME}` stands for where the file defines `const NAME = '...'`. */
function classText(tag: string, source: string): string {
  const at = tag.search(/\bclassName=/);
  if (at < 0) return '';
  const rest = tag.slice(at);
  const literals = Array.from(rest.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g), (m) => m[1] ?? m[2] ?? m[3]).join(' ');
  const names = Array.from(rest.matchAll(/\$\{\s*([A-Z_][A-Z0-9_]*)\s*\}|className=\{\s*([A-Z_][A-Z0-9_]*)\s*\}/g), (m) => m[1] ?? m[2]);
  const resolved = names.map((n) => new RegExp(`const ${n}\\s*=\\s*(['"\`])([\\s\\S]*?)\\1`).exec(source)?.[2] ?? '').join(' ');
  return `${literals} ${resolved}`;
}

/** The <p>, <td>, <th>, <h2> and <h3> whose class names no text size (outside anything visually hidden): "file:line <tag>". */
export function bareText(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const source = code(read(file));
    for (const m of Array.from(source.matchAll(/<(p|td|th|h2|h3)(?=[\s/>])/g))) {
      const start = m.index ?? 0;
      const end = tagEnd(source, start);
      if (end < 0) continue;
      const tag = source.slice(start, end + 1);
      if (/\bsr-only\b/.test(tag)) continue;
      if (!SIZE.test(classText(tag, source))) out.push(`${file}:${source.slice(0, start).split('\n').length} ${tag.slice(0, 90).replace(/\s+/g, ' ')}`);
    }
  }
  return out;
}

/** Native dialogs, hover-only actions, the legacy scope and a bare outline: the things the revamp removes. */
export function legacyLeftovers(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    code(read(file)).split('\n').forEach((line, i) => {
      // the browser's own: window.confirm('...'), alert('...'), prompt('...'); the kit's useConfirm().confirm({ ... }) takes an object and is not one
      if (/\bwindow\.(?:confirm|alert|prompt)\(|(?<![\w.$])(?:confirm|alert|prompt)\((?!\s*\{)/.test(line)) out.push(`${file}:${i + 1} native dialog: ${line.trim().slice(0, 80)}`);
      if (/opacity-0[^'"`]*group-hover|group-hover:opacity|hover:opacity-100/.test(line)) out.push(`${file}:${i + 1} hover-only action: ${line.trim().slice(0, 80)}`);
      if (/governance-light/.test(line)) out.push(`${file}:${i + 1} legacy .governance-light scope`);
      if (/\.toLocale(?:Date|Time)?String\(/.test(line)) out.push(`${file}:${i + 1} a date written by the browser's locale: ${line.trim().slice(0, 80)}`);
    });
  }
  return out;
}
