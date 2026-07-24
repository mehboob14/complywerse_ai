'use client';

// Pivot table — nested (tree) row groups crossed with an optional column field.
// Also serves as the table-view twin every chart in this module is required to
// have: whatever the chart caps or folds, the full numbers are readable here.

import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Measure, PivotNode, PivotResult } from './pivot';
import { AGG_LABEL, fmtAgg } from './pivot';

const NUM = 'whitespace-nowrap px-3 py-1.5 text-right text-sm tabular-nums text-slate-700';
const TH = 'whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500';

function measureLabel(m: Measure, label: string): string {
  return m.agg === 'count' ? 'Count' : `${AGG_LABEL[m.agg]} ${label}`;
}

export default function PivotTable({
  result, expanded, onToggle, labelFor,
}: {
  result: PivotResult;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  labelFor: (key: string) => string;
}) {
  const { colKeys, hasCol, rowFields, measures, nodes, grand } = result;
  const twoTier = hasCol && measures.length > 1;
  const rowHeader = rowFields.length ? rowFields.map((f) => f.label).join(' › ') : 'All rows';

  if (!measures.length) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
        <p className="max-w-xs text-sm text-slate-500">Add at least one <span className="font-medium text-slate-700">Value</span> to see numbers here.</p>
      </div>
    );
  }

  const numCells = (n: PivotNode | typeof grand, strong = false) => (
    <>
      {hasCol ? (
        <>
          {colKeys.map((ck, ci) =>
            measures.map((m, mi) => (
              <td key={`${ck}-${m.id}`} className={`${NUM} ${strong ? 'font-semibold text-slate-900' : ''}`}>
                {fmtAgg(n.cells[ci]?.[mi] ?? null, m.agg)}
              </td>
            )),
          )}
          {measures.map((m, mi) => (
            <td key={`total-${m.id}`} className={`${NUM} bg-slate-50/70 font-medium ${strong ? 'font-semibold text-slate-900' : ''}`}>
              {fmtAgg(n.totals[mi] ?? null, m.agg)}
            </td>
          ))}
        </>
      ) : (
        measures.map((m, mi) => (
          <td key={m.id} className={`${NUM} ${strong ? 'font-semibold text-slate-900' : ''}`}>
            {fmtAgg(n.cells[0]?.[mi] ?? null, m.agg)}
          </td>
        ))
      )}
    </>
  );

  const renderNodes = (list: PivotNode[]): React.ReactNode[] =>
    list.flatMap((n) => {
      const open = expanded.has(n.key);
      const hasKids = n.children.length > 0;
      const rows: React.ReactNode[] = [
        <tr key={n.key} className={`border-b border-slate-100 hover:bg-slate-50/60 ${n.depth === 0 ? 'bg-white' : 'bg-slate-50/20'}`}>
          <td className="sticky left-0 z-10 min-w-[220px] bg-inherit px-3 py-1.5 shadow-[1px_0_0_0_#f1f5f9]">
            <div className="flex items-center gap-1.5" style={{ paddingLeft: n.depth * 16 }}>
              {hasKids ? (
                <button
                  onClick={() => onToggle(n.key)}
                  aria-expanded={open}
                  aria-label={open ? `Collapse ${n.label}` : `Expand ${n.label}`}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                >
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
              ) : (
                <span className="inline-block w-[18px]" />
              )}
              <span className={`truncate text-sm ${n.depth === 0 ? 'font-medium text-slate-800' : 'text-slate-600'}`}>{n.label}</span>
              <span className="ml-1 shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] font-medium tabular-nums text-slate-500">{n.count}</span>
            </div>
          </td>
          {numCells(n)}
        </tr>,
      ];
      if (open && hasKids) rows.push(...renderNodes(n.children));
      return rows;
    });

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-max min-w-full table-fixed border-collapse">
        <thead className="sticky top-0 z-20">
          {twoTier ? (
            <>
              <tr>
                <th rowSpan={2} className={`${TH} sticky left-0 z-30 text-left shadow-[1px_0_0_0_#e2e8f0]`}>{rowHeader}</th>
                {colKeys.map((ck) => (
                  <th key={ck} colSpan={measures.length} className={`${TH} border-l border-slate-200 text-center`}>{ck}</th>
                ))}
                <th colSpan={measures.length} className={`${TH} border-l border-slate-200 bg-slate-100 text-center`}>Total</th>
              </tr>
              <tr>
                {colKeys.map((ck) =>
                  measures.map((m, mi) => (
                    <th key={`${ck}-${m.id}`} className={`${TH} text-right ${mi === 0 ? 'border-l border-slate-200' : ''}`}>
                      {measureLabel(m, labelFor(m.key))}
                    </th>
                  )),
                )}
                {measures.map((m, mi) => (
                  <th key={`t-${m.id}`} className={`${TH} bg-slate-100 text-right ${mi === 0 ? 'border-l border-slate-200' : ''}`}>
                    {measureLabel(m, labelFor(m.key))}
                  </th>
                ))}
              </tr>
            </>
          ) : (
            <tr>
              <th className={`${TH} sticky left-0 z-30 text-left shadow-[1px_0_0_0_#e2e8f0]`}>{rowHeader}</th>
              {hasCol
                ? <>
                    {colKeys.map((ck) => <th key={ck} className={`${TH} text-right`}>{ck}</th>)}
                    <th className={`${TH} bg-slate-100 text-right`}>Total</th>
                  </>
                : measures.map((m) => <th key={m.id} className={`${TH} text-right`}>{measureLabel(m, labelFor(m.key))}</th>)}
            </tr>
          )}
        </thead>

        <tbody>
          {rowFields.length === 0 ? (
            <tr><td className="px-3 py-6 text-sm text-slate-400">Add a <span className="font-medium text-slate-600">Row</span> field to break these totals down.</td>{numCells(grand)}</tr>
          ) : nodes.length === 0 ? (
            <tr><td colSpan={99} className="px-4 py-14 text-center text-sm text-slate-400">No rows match your filters.</td></tr>
          ) : (
            renderNodes(nodes)
          )}
        </tbody>

        {rowFields.length > 0 && nodes.length > 0 && (
          <tfoot className="sticky bottom-0">
            <tr className="border-t-2 border-slate-300 bg-slate-50">
              <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 shadow-[1px_0_0_0_#e2e8f0]">
                Grand total <span className="ml-1 rounded-full bg-slate-200 px-1.5 text-[10px] font-medium tabular-nums text-slate-600">{grand.count}</span>
              </td>
              {numCells(grand, true)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
