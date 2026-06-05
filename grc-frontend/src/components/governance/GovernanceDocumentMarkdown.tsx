'use client';

// GovernanceDocumentMarkdown
// ─────────────────────────────────────────────────────────────────────────
// Single renderer used by every surface that displays governance document
// content — the policy detail viewer (DocumentViewerTab) and the NCA
// template preview popup. Centralising it gives us:
//
//   1. Consistent styling — same heading hierarchy, table chrome, bullet
//      indentation everywhere a doc is shown.
//   2. Robust normalization — AI drafts often emit "almost-markdown" that
//      breaks remark's parser (heading without space, table without
//      separator row, orphan list bullets, CRLF noise). We repair those
//      shapes here once instead of trying to coax remark to be lenient.
//   3. Optional reference detection — when the caller supplies a map of
//      pre-extracted reference entries plus a draft handler, list items
//      AND numbered-clause paragraphs that match a reference get a
//      "+ Draft" pill rendered inline so the operator can spawn the
//      referenced doc without leaving the viewer.
//
// Anything that previously inlined `<ReactMarkdown>` with bespoke
// `components={}` overrides should switch to this. Adding a new override
// here keeps every surface consistent.

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles } from 'lucide-react';

// ─── Reference-detection types (mirrored from the doc viewer) ─────────
export type GovernanceMdReferenceEntry = {
  raw: string;
  doc_type: 'policy' | 'standard' | 'procedure' | 'guideline';
};

export type GovernanceMdReferenceMap = Map<string, GovernanceMdReferenceEntry>;

interface Props {
  /** Raw markdown — gets normalized before remark sees it. */
  content: string;
  /** Optional reference-item lookup keyed by cleaned-lowercased text. */
  references?: GovernanceMdReferenceMap;
  /** Handler invoked when the operator clicks "+ Draft" on a reference item. */
  onDraftReference?: (entry: GovernanceMdReferenceEntry, parentTitle: string) => void;
  /** Title of the document we're rendering — passed back to onDraftReference. */
  parentTitle?: string;
  /**
   * Reference-line cleaner. The two callers share the same regex stack but
   * we keep it injectable so this component never needs to import upwards.
   * Falls back to a sensible default if not supplied.
   */
  cleanReferenceLine?: (text: string) => string;
  /** className for the outer wrapper — caller can adjust prose width. */
  className?: string;
}

// ─── Defaults ──────────────────────────────────────────────────────────
const defaultCleanReferenceLine = (text: string): string => {
  let out = text
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
  out = out.replace(/^\(?(?:[A-Z]\.?\d+(?:\.\d+)*|\d+(?:\.\d+)+|\d+\.)\)?\s+/, '').trim();
  out = out.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*[—–-]\s+.+$/, '').trim();
  out = out.replace(/[.,;:]+$/, '').trim();
  return out;
};

// ─── Normalization pipeline ────────────────────────────────────────────
/**
 * Repair common AI-markdown shapes that remark either refuses to parse
 * cleanly or renders distorted. Pure: same input → same output, no
 * remote state, no DOM access.
 *
 * Steps, in order:
 *   1. CRLF / CR → LF so line-by-line scans behave consistently.
 *   2. Trim per-line trailing whitespace (some models emit ragged spaces
 *      that confuse hard-break logic).
 *   3. Add a space after a `#` heading marker when missing
 *      (`##Foo` → `## Foo`).
 *   4. Promote orphan list markers — a line that's only `*` or `1.` with
 *      content on a later line is fused with that next content line.
 *      This is the original normalizeAiMarkdown behaviour, preserved.
 *   5. Inject a GFM table separator row when a `|`-pipe line is followed
 *      by another `|`-pipe line WITHOUT a `| --- | --- |` separator
 *      between them. Without this, remark renders both rows as plain
 *      paragraphs and the table is lost.
 *   6. Collapse 3+ consecutive blank lines down to 2 so block boundaries
 *      stay tight.
 */
export const normalizeGovernanceMarkdown = (raw: string | null | undefined): string => {
  if (!raw) return '';
  // 1 — line endings
  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 2 — trim trailing whitespace
  text = text.split('\n').map((l) => l.replace(/[\t ]+$/, '')).join('\n');
  // 3 — space after `#` markers (works for # to ######)
  text = text.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');

  const lines = text.split('\n');

  // 4 — orphan list-marker merge (original logic kept verbatim)
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    const stripped = current.trimEnd();
    const emptyBulletMatch = stripped.match(/^([\t ]*)([*+\-]|\d+\.)\s*$/);
    if (emptyBulletMatch) {
      const indent = emptyBulletMatch[1] ?? '';
      const marker = emptyBulletMatch[2] ?? '*';
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length) {
        const nextStripped = lines[j].replace(/^\s+/, '');
        merged.push(`${indent}${marker} ${nextStripped}`);
        i = j;
        continue;
      }
    }
    merged.push(current);
  }

  // 5 — inject missing GFM table separators. A "pipe line" is any line
  //     starting with a `|`. When two consecutive pipe lines are NOT
  //     separated by a `| --- |` row, we infer the first is a header and
  //     synthesize the separator. Only intervene when there are no
  //     separator rows in the whole table block.
  const withTables: string[] = [];
  for (let i = 0; i < merged.length; i++) {
    const line = merged[i];
    const isPipe = /^\s*\|.+\|\s*$/.test(line);
    if (!isPipe) {
      withTables.push(line);
      continue;
    }
    // Walk the block of consecutive pipe lines.
    const block: string[] = [];
    let j = i;
    while (j < merged.length && /^\s*\|.+\|\s*$/.test(merged[j])) {
      block.push(merged[j]);
      j++;
    }
    const hasSeparator = block.some((b) =>
      /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(b),
    );
    if (!hasSeparator && block.length >= 2) {
      // Count columns in the first row to size the synthesized separator.
      const headerCells = block[0]
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|').length;
      const sepRow = '| ' + Array.from({ length: headerCells }, () => '---').join(' | ') + ' |';
      withTables.push(block[0]);
      withTables.push(sepRow);
      for (let k = 1; k < block.length; k++) withTables.push(block[k]);
    } else {
      withTables.push(...block);
    }
    i = j - 1;
  }

  // 6 — collapse runs of blank lines (3+ → 2)
  const out: string[] = [];
  let blankRun = 0;
  for (const l of withTables) {
    if (l.trim() === '') {
      blankRun++;
      if (blankRun <= 2) out.push('');
    } else {
      blankRun = 0;
      out.push(l);
    }
  }
  return out.join('\n');
};

// Flatten ReactMarkdown's `children` prop into a plain string for matching
// against reference entries. Recurses through nested JSX (`<strong>`, etc).
const childrenToText = (node: React.ReactNode): string => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join('');
  if (typeof node === 'object') {
    const el = node as { props?: { children?: React.ReactNode } };
    if (el.props) return childrenToText(el.props.children);
  }
  return '';
};

// ─── Component ─────────────────────────────────────────────────────────
export function GovernanceDocumentMarkdown({
  content,
  references,
  onDraftReference,
  parentTitle,
  cleanReferenceLine = defaultCleanReferenceLine,
  className,
}: Props) {
  const normalized = useMemo(() => normalizeGovernanceMarkdown(content), [content]);

  const renderDraftButton = (entry: GovernanceMdReferenceEntry) => {
    if (!onDraftReference) return null;
    return (
      <button
        type="button"
        onClick={() => onDraftReference(entry, parentTitle || '')}
        title={`Draft "${entry.raw}" as a ${entry.doc_type}`}
        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 opacity-70 group-hover:opacity-100"
      >
        <Sparkles className="h-3 w-3" />
        Draft
      </button>
    );
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-2xl font-bold text-gray-900 mt-6 mb-3 pb-2 border-b border-gray-200">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-xl font-semibold text-gray-900 mt-5 mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg font-semibold text-gray-900 mt-4 mb-2">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-base font-semibold text-gray-900 mt-3 mb-1">{children}</h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-semibold text-gray-900 mt-2 mb-1">{children}</h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-sm font-medium text-gray-700 mt-2 mb-1">{children}</h6>
          ),
          p: ({ children }) => {
            // Numbered-clause paragraphs inside a references section render
            // as <p>. If we have a reference map and this paragraph matches
            // an entry, append the "+ Draft" pill the same way <li> does.
            if (references && references.size > 0 && onDraftReference) {
              const text = cleanReferenceLine(childrenToText(children)).toLowerCase();
              const entry = references.get(text);
              if (entry) {
                return (
                  <p className="text-gray-800 mb-3 leading-relaxed flex items-start gap-2 group text-sm">
                    <span className="flex-1">{children}</span>
                    {renderDraftButton(entry)}
                  </p>
                );
              }
            }
            return <p className="text-gray-800 mb-3 leading-relaxed text-sm">{children}</p>;
          },
          ul: ({ children }) => (
            <ul className="list-disc list-inside mb-3 space-y-1 text-gray-800 pl-4 text-sm">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside mb-3 space-y-1 text-gray-800 pl-4 text-sm">
              {children}
            </ol>
          ),
          li: ({ children }) => {
            if (references && references.size > 0 && onDraftReference) {
              const text = cleanReferenceLine(childrenToText(children)).toLowerCase();
              const entry = references.get(text);
              if (entry) {
                return (
                  <li className="text-gray-800 flex items-start gap-2 group">
                    <span className="flex-1">{children}</span>
                    {renderDraftButton(entry)}
                  </li>
                );
              }
            }
            return <li className="text-gray-800">{children}</li>;
          },
          strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
          em: ({ children }) => <em className="italic text-gray-800">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-gray-300 pl-4 my-3 text-gray-700 italic text-sm">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-xs font-mono">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="bg-gray-100 text-gray-800 p-4 rounded-lg overflow-x-auto mb-3 text-xs font-mono">
              {children}
            </pre>
          ),
          hr: () => <hr className="border-gray-200 my-4" />,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-blue-600 underline hover:text-blue-800"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-4">
              <table className="w-full border-collapse border border-gray-300 text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-gray-300 bg-gray-100 px-2 py-1.5 text-left font-semibold text-gray-900">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-300 px-2 py-1.5 text-gray-800 align-top">{children}</td>
          ),
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
