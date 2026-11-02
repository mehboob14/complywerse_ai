// The rules every file of the design-system kit (this folder) must follow, as data, so kitGuard.test.ts can enforce them and the style guide can print them.
//
// Why: the platform CSS (app/globals.css: 220 `!important`, `.platform-ui.compact-density main ...`) rewrites NAMED Tailwind utilities inside the
// dashboard shell and does not reach portals (modals, drawers), so the same class renders differently on the page and in a dialog. Arbitrary
// values and the --ds theme tokens are untouched, so the kit uses only those. (PITFALLS 100; the Documents and vendor kits spell hex for the same reason.)

export interface KitRule {
  id: string;
  /** a line of code that matches this is a violation */
  re: RegExp;
  why: string;
}

const NOT_PART = '(?<![\\w-])';
const END = '(?![\\w-])';

export const KIT_RULES: KitRule[] = [
  { id: 'named-text-size', re: new RegExp(`${NOT_PART}text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)${END}`), why: 'the shell remaps the named sizes; use text-ds-title, text-ds-section, text-ds-body or text-ds-label' },
  { id: 'palette-class', re: new RegExp(`${NOT_PART}(?:bg|text|border|divide|ring|fill|stroke|from|to|via|outline|decoration|placeholder)-(?:white|black|slate|gray|zinc|neutral|stone|red|rose|pink|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|primary|surface|success|warning|danger|info)(?:-\\d{2,3})?(?:/\\d+)?${END}`), why: 'palette classes are repainted by the platform CSS; use the ds theme colours (bg-ds-surface, text-ds-fg ...)' },
  { id: 'arbitrary-hex', re: new RegExp(`${NOT_PART}(?:bg|text|border|ring|fill|stroke|from|to|via|outline)-\\[#[0-9a-fA-F]{3,8}\\]`), why: 'colours come from the --ds tokens, not from hex in a class' },
  { id: 'shadow', re: new RegExp(`${NOT_PART}shadow-(sm|md|lg|xl|2xl|card|card-hover|elevated|modal|sidebar|inner)${END}`), why: 'the named shadows read variables that are not defined; use shadow-ds-pop or shadow-ds-ring' },
  { id: 'named-radius', re: new RegExp(`${NOT_PART}rounded(?:-[trbl]{1,2})?-(sm|md|lg|xl|2xl|3xl|4xl)${END}`), why: 'use rounded-ds-control (6px) or rounded-ds-card (8px)' },
  { id: 'font-weight', re: new RegExp(`${NOT_PART}font-(bold|semibold)${END}`), why: 'the shell remaps these weights; the ds type sizes carry theirs, else font-medium or font-[600]' },
  { id: 'remapped-spacing', re: new RegExp(`${NOT_PART}(?:p-(?:4|5|6|8)|px-(?:4|5|6)|py-(?:4|5|6)|gap-(?:3|4|5|6)|space-y-(?:3|4|5|6|8))${END}`), why: 'compact density rewrites these inside <main> but not in portals; write the value, e.g. px-[16px], gap-[12px]' },
  { id: 'remapped-size-pair', re: new RegExp(`${NOT_PART}h-(?:8|10|12|16)${END}[^'"\`\\n]*${NOT_PART}w-(?:8|10|12|16)${END}`), why: 'h-N w-N pairs are rewritten inside <main>; use h-ds-control or an arbitrary size' },
  { id: 'max-h-90vh', re: /max-h-\[90vh\]/, why: 'rewritten to 84vh inside <main>' },
  { id: 'gradient', re: /bg-gradient-/, why: 'surfaces are flat' },
];

/** text-[Npx] under 12px, and a bare `outline-none` (no focus-visible replacement on the same line): rules that need a little logic. */
function logicViolations(line: string): string[] {
  const out: string[] = [];
  for (const m of Array.from(line.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g))) if (parseFloat(m[1]) < 12) out.push('small-text');
  if (/outline-none/.test(line) && !/focus-visible:/.test(line)) out.push('bare-outline-none');
  return out;
}

export interface Violation { line: number; rule: string; text: string }

/** Every violation in a source file; comments are ignored. */
export function findViolations(source: string): Violation[] {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const found: Violation[] = [];
  withoutBlocks.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/(^|\s)\/\/\s.*$/, '$1');
    for (const r of KIT_RULES) if (r.re.test(line)) found.push({ line: i + 1, rule: r.id, text: raw.trim().slice(0, 100) });
    for (const id of logicViolations(line)) found.push({ line: i + 1, rule: id, text: raw.trim().slice(0, 100) });
  });
  return found;
}
