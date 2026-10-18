'use client';

/**
 * The library's TREE view: every document under its parent, with file-tree connector lines, open/close per document and
 * for all, the full title, and the Register's own detail columns and row Actions (RegisterTable passes its columns in,
 * so both views show and do the same). Ancestors of a search/filter match stay visible, greyed, with a note.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileText } from 'lucide-react';
import type { ColumnDef } from '@/components/ui';
import { DocTypeTile, ReviewStatus, type GovDoc } from './lib';
import { buildTree, flattenTree, parentIds, type TreeRow } from './docTree';

export interface DocumentTreeProps {
  /** the documents that match the search and filters, as the Register lists them */
  docs: GovDoc[];
  /** every document in the library scope (the selected tree node, My documents …): the ancestors of a match come from here */
  scope: GovDoc[];
  /** the Register's columns; the tree draws the title itself and adds Next review */
  columns: ColumnDef<GovDoc>[];
  headerDoc: GovDoc | null;
  breadcrumb: string[];
  totalCount: number;
  updatedLabel?: string;
  onOpenDoc: (id: number) => void;
}

// The lines are drawn against the title cell, whose content sits in its middle (align-middle), so they do not depend on
// the cell's top/bottom padding (the platform CSS sets it with !important); the left padding and the gap are inline.
const STEP = 20;           // px per level (the width of the open/close button)
const PAD = 12;            // the title cell's left padding
const GAP = 6;             // between the open/close button and the type tile
const LINE = 'absolute w-px bg-[#c5ced6]';
const EMPTY = new Set<number>();
// The tree is wider than its column on most screens: the Actions column stays in view while the details scroll sideways
// (not on a phone, where it would cover the title). Its cell needs the row's own colour (the platform's zebra: every
// second row --color-subtle; hover the same).
const STICKY = 'sm:sticky sm:right-0 sm:z-[1] sm:shadow-[inset_1px_0_0_#dde1e7]';
const stickyCell = (i: number) =>
  `${STICKY} ${i % 2 ? 'bg-[var(--color-subtle,#f1f3f5)]' : 'bg-[#fff] group-hover:bg-[var(--color-subtle,#f1f3f5)]'}`;

const REVIEW: ColumnDef<GovDoc> = {
  id: 'review',
  header: 'Next review',
  minWidth: '110px',
  render: (d) => <ReviewStatus date={d.next_review_date} />,
};

function cell(col: ColumnDef<GovDoc>, d: GovDoc, i: number): React.ReactNode {
  if (col.render) return col.render(d, i);
  if (typeof col.accessor === 'function') return col.accessor(d);
  return col.accessor ? String(d[col.accessor] ?? '') : null;
}

/** The connector lines of one row: rails of the ancestors, its own elbow, and the line down to its first child. */
function Guides({ row }: { row: TreeRow<GovDoc> }) {
  const x = (col: number) => PAD + col * STEP + STEP / 2;
  const d = row.depth;
  return (
    <span aria-hidden>
      {row.rails.map((on, c) => (on ? <span key={c} className={LINE} style={{ left: x(c), top: -1, bottom: 0 }} /> : null))}
      {d > 0 && (
        <>
          <span className={LINE} style={row.last ? { left: x(d - 1), top: -1, height: 'calc(50% + 1px)' } : { left: x(d - 1), top: -1, bottom: 0 }} />
          <span className="absolute h-px bg-[#c5ced6]" style={{ left: x(d - 1), top: '50%', width: STEP / 2 + (row.childCount ? 2 : STEP + GAP - 2) }} />
        </>
      )}
      {row.expanded && <span className={LINE} style={{ left: x(d), top: 'calc(50% + 9px)', bottom: 0 }} />}
    </span>
  );
}

function TitleCell({ row, parentTitle, onToggle, onOpen }: { row: TreeRow<GovDoc>; parentTitle?: string; onToggle: (id: number) => void; onOpen: (id: number) => void }) {
  const d = row.doc;
  return (
    <td className="relative py-2 align-middle" style={{ minWidth: 320, paddingLeft: PAD, paddingRight: PAD }}>
      <Guides row={row} />
      <div className="flex items-center" style={{ paddingLeft: row.depth * STEP, gap: GAP }}>
        {row.childCount > 0 ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(d.id); }}
            aria-expanded={row.expanded}
            aria-label={`${row.expanded ? 'Hide' : 'Show'} the documents under ${d.title}`}
            className="inline-flex h-7 w-5 shrink-0 items-center justify-center rounded text-[#586472] hover:bg-[#eef2f6] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
          >
            {row.expanded ? <ChevronDown className="h-4 w-4" strokeWidth={1.75} /> : <ChevronRight className="h-4 w-4" strokeWidth={1.75} />}
          </button>
        ) : (
          <span aria-hidden className="h-7 w-5 shrink-0" />
        )}
        <DocTypeTile docType={d.doc_type} size="sm" />
        <span className="min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(d.id); }}
            className={`break-words text-left text-sm leading-5 hover:text-[#0f766e] hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] ${row.match ? 'font-medium text-[#1f2933]' : 'text-[#586472]'}`}
          >
            {d.title}
          </button>
          {/* the lines show the nesting to the eye; this says it to a screen reader */}
          {parentTitle && <span className="sr-only">, under {parentTitle}</span>}
          {row.childCount > 0 && !row.expanded && (
            <span className="ml-1.5 whitespace-nowrap text-[11px] text-[#586472]">{row.childCount} under it</span>
          )}
          {!row.match && <span className="block text-[11px] text-[#586472]">Parent of a match</span>}
        </span>
      </div>
    </td>
  );
}

export function DocumentTree({ docs, scope, columns, headerDoc, breadcrumb, totalCount, updatedLabel, onOpenDoc }: DocumentTreeProps) {
  const roots = useMemo(() => buildTree(scope, new Set(docs.map((d) => d.id))), [scope, docs]);
  const parents = useMemo(() => parentIds(roots), [roots]);

  // what is folded belongs to one set of matches: a new search opens everything again, so no match hides under a fold
  const matchKey = useMemo(() => docs.map((d) => d.id).join(','), [docs]);
  const [fold, setFold] = useState<{ key: string; ids: Set<number> }>({ key: '', ids: EMPTY });
  const collapsed = fold.key === matchKey ? fold.ids : EMPTY;
  const setCollapsed = (ids: Set<number>) => setFold({ key: matchKey, ids });
  const toggle = (id: number) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const rows = useMemo(() => flattenTree(roots, collapsed), [roots, collapsed]);
  const titleOf = useMemo(() => new Map(scope.map((d) => [d.id, d.title])), [scope]);
  const context = rows.filter((r) => !r.match).length;
  const shown = columns.filter((c) => !c.hidden);     // as the Table: a hidden column is not drawn
  const cols = [...shown.filter((c) => c.id !== 'title' && c.id !== 'actions'), REVIEW, ...shown.filter((c) => c.id === 'actions')];
  const th = 'px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600';
  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-[#d5dbe1] bg-white px-2.5 py-1 text-sm font-medium text-[#26323d] hover:bg-[#f3f6f8] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          {headerDoc && breadcrumb.length > 1 && (
            <nav aria-label="Where this document sits" className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[#586472]">
              {breadcrumb.slice(0, -1).map((seg, i) => (
                <span key={`${seg}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden className="text-[#9aa5b1]">/</span>}
                  <span className="break-words">{seg}</span>
                </span>
              ))}
            </nav>
          )}
          <h2 className="break-words text-lg font-semibold text-[#1f2933]">{headerDoc ? headerDoc.title : 'Document hierarchy'}</h2>
          <p className="text-sm text-[#586472]">
            {docs.length} shown · {totalCount} total
            {context > 0 ? ` · ${context} shown as parents` : ''}
            {updatedLabel ? ` · ${updatedLabel}` : ''}
          </p>
        </div>
        {parents.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" className={btn} onClick={() => setCollapsed(EMPTY)} disabled={collapsed.size === 0}>
              <ChevronsUpDown className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Expand all
            </button>
            <button type="button" className={btn} onClick={() => setCollapsed(new Set(parents))} disabled={parents.every((id) => collapsed.has(id))}>
              <ChevronsDownUp className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Collapse all
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full" aria-label="Documents by hierarchy">
            <thead className="bg-slate-200/70">
              <tr className="border-b-2 border-slate-300 bg-slate-200/70">
                <th className={th} style={{ minWidth: 320 }}>Title</th>
                {cols.map((c) => (
                  <th key={c.id} className={`${th} ${c.id === 'actions' ? `${STICKY} bg-[var(--color-subtle,#f1f3f5)]` : ''}`} style={{ width: c.width, minWidth: c.minWidth }}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={cols.length + 1} className="px-3 py-10 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <FileText size={40} className="text-[#9aa5b1]" aria-hidden />
                      <span className="text-sm text-[#586472]">No documents match the current filters.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr
                    key={r.doc.id}
                    onClick={() => onOpenDoc(r.doc.id)}
                    className="group cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50"
                  >
                    <TitleCell row={r} parentTitle={r.depth > 0 && r.doc.parent_document_id != null ? titleOf.get(r.doc.parent_document_id) : undefined}
                      onToggle={toggle} onOpen={onOpenDoc} />
                    {cols.map((c) => (
                      <td key={c.id} className={`px-3 py-2.5 text-sm text-slate-600 ${c.id === 'actions' ? stickyCell(i) : ''}`} style={{ width: c.width, minWidth: c.minWidth }}>
                        {cell(c, r.doc, i)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default DocumentTree;
