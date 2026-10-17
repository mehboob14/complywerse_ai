'use client';

/**
 * A redline: the document block by block with what was inserted (green) and deleted (red, struck through) between two
 * versions. Used for "what changed since I started", "since revision N", "against another document" and for previewing what
 * accepting the AI's changes would do.
 */
import { useMemo, useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';
import { shapeOf, type ChainHunk } from '@/lib/documentChain';
import type { RedlineRow, Segment, Stats } from '@/lib/studio/api';
import { plural } from '@/lib/studio/text';
import Attribution, { originLook } from './ChangeAttribution';

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
      {(row.format_only || row.was || row.structure?.length) && (
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a6100]">
          {row.structure?.length ? row.structure.join(' · ')
            : row.was ? `Was ${row.was.kind.replace('_', ' ')}${row.was.kind === 'heading' ? ` ${row.was.level}` : ''}` : 'Formatting changed'}
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

/** What a redline needs to show who made each change and to take one back. */
export interface RedlineChanges {
  hunks: ChainHunk[];
  /** false: the changes are only shown (an old version, a file, a document someone else changed meanwhile) */
  canRevert: boolean;
  /** the person may not change the document at all: no Take back button (a reader) */
  readOnly?: boolean;
  whyNot?: string | null;
  busyId?: number | null;
  onRevert: (hunk: ChainHunk) => void;
  onShowSource?: (ref: string) => void;
}

function ChangeHeader({ hunk, changes }: { hunk: ChainHunk; changes: RedlineChanges }) {
  const busy = changes.busyId === hunk.id;
  const blocked = !changes.canRevert || hunk.can_revert === false || hunk.locked;      // the person's right first, then the text's
  const why = hunk.locked ? 'A sign-off record is stamped by the sign-off and cannot be taken back.' : blocked ? changes.whyNot || undefined : undefined;
  const look = originLook(hunk.by?.origin ?? 'unknown');
  const Icon = look.icon;
  const shape = shapeOf(hunk);
  return (
    <div className="mt-4 overflow-hidden rounded-t-xl border border-b-0 border-[#dbe3ea] bg-[#f8fafc]" data-change={hunk.id}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[11px]">
        <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${look.node}`} aria-hidden><Icon className="h-3 w-3" /></span>
        <span className="min-w-0 truncate text-xs font-semibold text-[#1f2933]" title={hunk.section}>{hunk.section || 'Top of the document'}</span>
        {shape ? <span className="rounded-full bg-[#fff8e6] px-2 py-0.5 text-[10px] font-semibold text-[#8a6100] ring-1 ring-inset ring-[#f0d9a0]">{shape}</span> : (
          <>
            <span className="font-mono font-semibold text-[#0a7a43]">+{hunk.words_added}</span>
            <span className="font-mono font-semibold text-[#b42318]">−{hunk.words_removed}</span>
          </>
        )}
        {hunk.locked && <span className="rounded-full bg-[#ecfdf3] px-2 py-0.5 text-[10px] font-semibold text-[#067647] ring-1 ring-inset ring-[#abefc6]">Sign-off record</span>}
        {!changes.readOnly && <button type="button" disabled={blocked || busy} title={why} onClick={() => changes.onRevert(hunk)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[#c5ccd3] bg-white px-2.5 py-1 font-semibold text-[#3f4b58] hover:border-[#d97706] hover:bg-[#fffbeb] hover:text-[#92400e] disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Undo2 className="h-3 w-3" aria-hidden />} Take back
        </button>}
      </div>
      {hunk.by
        ? <div className="border-t border-[#eef2f6] bg-white px-3 py-2"><Attribution by={hunk.by} onShowSource={changes.onShowSource} /></div>
        : <p className="border-t border-[#eef2f6] bg-white px-3 py-1.5 text-[11px] text-[#586472]">Changed since that version.</p>}
    </div>
  );
}

export default function RedlineView({ rows, empty = 'Nothing changed.', changes }: { rows: RedlineRow[]; empty?: string; changes?: RedlineChanges }) {
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
  const byId = new Map((changes?.hunks ?? []).map((h) => [h.id, h]));
  rows.forEach((row, i) => {
    if (shown[i]) {
      if (folded) {
        out.push(<div key={`f${i}`} className="px-3 py-1 text-center text-xs text-[#586472]">… {plural(folded, 'unchanged block')} …</div>);
        folded = 0;
      }
      const hunk = changes && row.hunk != null ? byId.get(row.hunk) : undefined;
      if (hunk && (i === 0 || rows[i - 1].hunk !== row.hunk || !shown[i - 1])) out.push(<ChangeHeader key={`h${i}`} hunk={hunk} changes={changes!} />);
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
