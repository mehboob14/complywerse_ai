'use client';

/**
 * A redline: the document block by block with what was inserted (green) and deleted (red, struck through) between two
 * versions. Used for "what changed since I started", "since revision N", "against another document" and for previewing what
 * accepting the AI's changes would do.
 */
import { useMemo, useState } from 'react';
import type { RedlineRow, Segment, Stats } from '@/lib/studio/api';
import { plural } from '@/lib/studio/text';

function Segments({ segs }: { segs: Segment[] }) {
  return (
    <>
      {segs.map(([op, text], i) =>
        op === 'insert' ? (
          <ins key={i} className="rounded-sm bg-[#d4f2e0] px-0.5 text-[#0a5a38] no-underline">{text}</ins>
        ) : op === 'delete' ? (
          <del key={i} className="rounded-sm bg-[#fbdcdc] px-0.5 text-[#9b1c1c] line-through decoration-[#9b1c1c]/60">{text}</del>
        ) : (
          <span key={i}>{text}</span>
        ),
      )}
    </>
  );
}

const BAR: Record<string, string> = {
  inserted: 'border-l-4 border-l-[#22a06b] bg-[#f3fbf6]',
  deleted: 'border-l-4 border-l-[#d64545] bg-[#fdf5f5]',
  modified: 'border-l-4 border-l-[#e0a100] bg-[#fffdf3]',
  equal: 'border-l-4 border-l-transparent',
};

const HEADING = ['', 'text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-base', 'text-sm'];

function Row({ row, number }: { row: RedlineRow; number: number }) {
  const segs: Segment[] = row.segments ?? [];
  let body: React.ReactNode;
  if (row.kind === 'table' && row.table) {
    body = (
      <table className="w-full table-fixed border-collapse text-sm">
        <tbody>
          {row.table.map((r, ri) => (
            <tr key={ri} className={r.status === 'inserted' ? 'bg-[#e8f8ee]' : r.status === 'deleted' ? 'bg-[#fbe9e9]' : r.status === 'modified' ? 'bg-[#fff8dc]' : ''}>
              {r.cells.map((cell, ci) => {
                const Cell = ri === 0 ? 'th' : 'td';
                return (
                  <Cell key={ci} className={`break-words border border-[#b8c4c8] px-2 py-1 text-left align-top ${ri === 0 ? 'bg-[#e3f1f1] font-semibold' : ''}`}>
                    <Segments segs={cell} />
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (row.kind === 'heading') {
    body = <div className={`font-bold text-[#0f4c5c] ${HEADING[Math.min(row.level, 6)]}`}><Segments segs={segs} /></div>;
  } else if (row.kind === 'list_item') {
    body = (
      <div className="flex gap-2" style={{ paddingLeft: `${row.level * 1.25}rem` }}>
        <span className="w-5 shrink-0 text-right text-[#586472]">{row.ordered ? `${number}.` : '•'}</span>
        <span className="min-w-0"><Segments segs={segs} /></span>
      </div>
    );
  } else if (row.kind === 'quote') {
    body = <div className="border-l-4 border-[#0f4c5c] pl-3 italic text-[#52606d]"><Segments segs={segs} /></div>;
  } else if (row.kind === 'code') {
    body = <pre className="overflow-x-auto rounded bg-[#f1f3f5] p-2 font-mono text-xs"><Segments segs={segs} /></pre>;
  } else if (row.kind === 'hr') {
    body = <hr className="border-[#c5ccd3]" />;
  } else {
    body = <div><Segments segs={segs} /></div>;
  }
  return (
    <div className={`rounded-r px-3 py-1.5 text-[0.9375rem] leading-relaxed text-[#1f2933] ${BAR[row.status]}`}>
      {(row.format_only || row.was) && (
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a6100]">
          {row.was ? `Was ${row.was.kind.replace('_', ' ')}${row.was.kind === 'heading' ? ` ${row.was.level}` : ''}` : 'Formatting changed'}
        </div>
      )}
      {body}
    </div>
  );
}

export function StatsLine({ stats }: { stats: Stats | null | undefined }) {
  if (!stats) return null;
  const parts = [
    stats.inserted ? `${plural(stats.inserted, 'block')} added` : '',
    stats.deleted ? `${plural(stats.deleted, 'block')} removed` : '',
    stats.modified ? `${plural(stats.modified, 'block')} changed` : '',
    stats.words_added || stats.words_removed ? `+${stats.words_added} / −${stats.words_removed} words` : '',
  ].filter(Boolean);
  return <span>{parts.length ? parts.join(' · ') : 'No changes'}</span>;
}

export default function RedlineView({ rows, empty = 'Nothing changed.' }: { rows: RedlineRow[]; empty?: string }) {
  const [all, setAll] = useState(false);
  const changed = useMemo(() => rows.some((r) => r.status !== 'equal'), [rows]);
  // number the ordered items of a list: 1, 2, 3 … restarting after anything else
  const numbered = useMemo(() => {
    let n = 0;
    return rows.map((r) => {
      n = r.kind === 'list_item' && r.ordered ? n + 1 : 0;
      return n;
    });
  }, [rows]);
  // unchanged blocks far from any change are folded away
  const shown = useMemo(() => {
    const keep = rows.map((r) => r.status !== 'equal');
    const near = keep.map((k, i) => k || keep[i - 1] || keep[i + 1]);
    return all || !changed ? rows.map(() => true) : near.map(Boolean);
  }, [rows, all, changed]);

  if (!rows.length || !changed) {
    return <p className="rounded-lg border border-dashed border-[#c5ccd3] p-6 text-center text-sm text-[#586472]">{empty}</p>;
  }
  const out: React.ReactNode[] = [];
  let folded = 0;
  rows.forEach((row, i) => {
    if (shown[i]) {
      if (folded) {
        out.push(<div key={`f${i}`} className="px-3 py-1 text-center text-xs text-[#586472]">… {plural(folded, 'unchanged block')} …</div>);
        folded = 0;
      }
      out.push(<Row key={i} row={row} number={numbered[i]} />);
    } else {
      folded += 1;
    }
  });
  if (folded) out.push(<div key="ftail" className="px-3 py-1 text-center text-xs text-[#586472]">… {plural(folded, 'unchanged block')} …</div>);
  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <button type="button" onClick={() => setAll((v) => !v)} className="text-xs font-medium text-[#0b6b58] hover:underline">
          {all ? 'Show only what changed' : 'Show the whole document'}
        </button>
      </div>
      {out}
    </div>
  );
}
