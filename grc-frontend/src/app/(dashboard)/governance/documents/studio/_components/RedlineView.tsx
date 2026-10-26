'use client';

/**
 * A redline: the document block by block with what was inserted (green) and deleted (red, struck through) between two
 * versions. Used for "what changed since I started", "since revision N", "against another document" and for previewing what
 * accepting the AI's changes would do.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Undo2 } from 'lucide-react';
import { shapeOf, type ChainHunk } from '@/lib/documentChain';
import type { RedlineRow, Segment, Stats } from '@/lib/studio/api';
import { plural } from '@/lib/studio/text';
import { focusRows, type Focus } from '@/lib/studio/redlineFocus';
import Attribution, { originLook } from './ChangeAttribution';

export type { Focus };

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

function Row({ row, number, focused }: { row: RedlineRow; number: number; focused?: boolean }) {
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
                  <Cell key={ci} className={`break-words border border-[#bfbfbf] px-2 py-1 text-left align-top ${ri === 0 ? 'bg-[#f2f2f2] font-semibold' : ''}`}>
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
    body = <div className={`font-bold text-[#111] ${HEADING[Math.min(row.level, 6)]}`}><Segments segs={segs} /></div>;
  } else if (row.kind === 'list_item') {
    body = (
      <div className="flex gap-2" style={{ paddingLeft: `${row.level * 1.25}rem` }}>
        <span className="w-5 shrink-0 text-right text-[#586472]">{row.ordered ? `${number}.` : '•'}</span>
        <span className="min-w-0"><Segments segs={segs} /></span>
      </div>
    );
  } else if (row.kind === 'quote') {
    body = <div className="border-l-4 border-[#808080] pl-3 italic text-[#404040]"><Segments segs={segs} /></div>;
  } else if (row.kind === 'code') {
    body = <pre className="overflow-x-auto rounded bg-[#f1f3f5] p-2 font-mono text-xs"><Segments segs={segs} /></pre>;
  } else if (row.kind === 'hr') {
    body = <hr className="border-[#c5ccd3]" />;
  } else {
    body = <div><Segments segs={segs} /></div>;
  }
  return (
    <div data-focus={focused ? '1' : undefined}
      className={`rounded-r px-3 py-1.5 text-[0.9375rem] leading-relaxed text-[#1f2933] ${BAR[row.status]} ${focused ? 'relative z-[1] !bg-[#e3f4ef] outline outline-2 outline-offset-2 outline-[#0f766e] shadow-[0_0_0_6px_rgba(15,118,110,0.12)]' : ''}`}>
      {(row.format_only || row.was || row.structure?.length) && (
        <div className="mb-0.5 text-xs font-semibold text-[#8a6100]">
          {row.structure?.length ? row.structure.join(' · ')
            : row.was ? `Was ${row.was.kind.replace('_', ' ')}${row.was.kind === 'heading' ? ` ${row.was.level}` : ''}` : 'Formatting changed'}
        </div>
      )}
      {body}
    </div>
  );
}

/** One side of a row shown in two columns: what it said (`delete` kept) or what it says now (`insert` kept); null where the block
 *  is not on that side (added: nothing before it; removed: nothing after). */
function sideOf(row: RedlineRow, keep: 'delete' | 'insert'): RedlineRow | null {
  if (row.status === (keep === 'delete' ? 'inserted' : 'deleted')) return null;
  const segs = (s: Segment[]) => s.filter(([op]) => op === 'equal' || op === keep);
  const gone = keep === 'delete' ? 'inserted' : 'deleted';
  return { ...row, segments: row.segments && segs(row.segments),
           table: row.table?.filter((r) => r.status !== gone).map((r) => ({ ...r, cells: r.cells.map(segs) })) };
}

/** A block in two columns, the library's text left and the proposed one right; on a phone the two stack, each named. */
function SideBySide({ row, number, labels }: { row: RedlineRow; number: number; labels: { before: string; after: string } }) {
  const before = sideOf(row, 'delete');
  const after = sideOf(row, 'insert');
  const same = row.status === 'equal';
  const cell = (r: RedlineRow | null, label: string, hideOnPhone: boolean, missing: string) => (
    <div className={`min-w-0 ${hideOnPhone ? 'hidden sm:block' : ''}`}>
      {!same && <p className="px-3 pt-1 text-xs font-semibold text-[#586472] sm:hidden">{label}</p>}
      {r ? <Row row={r} number={number} />
        : <p className="h-full rounded-r border-l-4 border-dashed border-l-[#c5ccd3] bg-[#f8fafb] px-3 py-1.5 text-xs italic text-[#586472]">{missing}</p>}
    </div>
  );
  return (
    <div className="grid gap-x-3 sm:grid-cols-2">
      {cell(before, labels.before, false, 'Added')}
      {cell(after, labels.after, same, 'Removed')}
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
        {shape ? <span className="rounded-full bg-[#fff8e6] px-2 py-0.5 text-[11px] font-semibold text-[#8a6100] ring-1 ring-inset ring-[#f0d9a0]">{shape}</span> : (
          <>
            <span className="font-mono font-semibold text-[#0a7a43]">+{hunk.words_added}</span>
            <span className="font-mono font-semibold text-[#b42318]">−{hunk.words_removed}</span>
          </>
        )}
        {hunk.locked && <span className="rounded-full bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-semibold text-[#067647] ring-1 ring-inset ring-[#abefc6]">Sign-off record</span>}
        {!changes.readOnly && <button type="button" disabled={blocked || busy} title={why} onClick={() => changes.onRevert(hunk)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[#c3ccd5] bg-[#fff] px-2.5 py-1 font-semibold text-[#3f4b58] hover:border-[#d97706] hover:bg-[#fffbeb] hover:text-[#92400e] disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Undo2 className="h-3 w-3" aria-hidden />} Take back
        </button>}
      </div>
      {hunk.by
        ? <div className="border-t border-[#e1e6eb] bg-[#fff] px-3 py-2"><Attribution by={hunk.by} onShowSource={changes.onShowSource} /></div>
        : <p className="border-t border-[#e1e6eb] bg-[#fff] px-3 py-1.5 text-xs text-[#586472]">Changed since that version</p>}
    </div>
  );
}

export default function RedlineView({ rows, empty = 'No changes', changes, focus, sides }: {
  rows: RedlineRow[]; empty?: string; changes?: RedlineChanges; focus?: Focus;
  /** two columns instead of one (a proposed change beside the library's text), named so */
  sides?: { before: string; after: string };
}) {
  const [all, setAll] = useState(false);
  // the change a card asked to see: highlighted and brought into view, the others around it as they are
  const focused = useMemo(() => focusRows(rows, focus), [rows, focus]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focused.size) return;
    const t = setTimeout(() => box.current?.querySelector('[data-focus="1"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
    return () => clearTimeout(t);
  }, [focused]);
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
    return <p className="rounded-lg border border-dashed border-[#c5ccd3] p-6 text-center text-[13px] text-[#586472]">{empty}</p>;
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
      if (focused.has(i) && !focused.has(i - 1)) {
        out.push(<p key={`fl${i}`} className="mt-2 text-xs font-semibold text-[#0f766e]">Selected change</p>);
      }
      out.push(sides ? <SideBySide key={i} row={row} number={numbered[i]} labels={sides} /> : <Row key={i} row={row} number={numbered[i]} focused={focused.has(i)} />);
    } else {
      folded += 1;
    }
  });
  if (folded) out.push(<div key="ftail" className="px-3 py-1 text-center text-xs text-[#586472]">… {plural(folded, 'unchanged block')} …</div>);
  return (
    <div className="space-y-1" ref={box}>
      <div className="flex justify-end">
        <button type="button" onClick={() => setAll((v) => !v)} className="text-xs font-medium text-[#0f766e] hover:underline">
          {all ? 'Show changes only' : 'Show whole document'}
        </button>
      </div>
      {sides && (
        <div className="sticky top-0 z-[2] hidden grid-cols-2 gap-x-3 border-b border-[#d5dbe1] bg-white pb-1.5 pt-1 sm:grid">
          <p className="px-3 text-xs font-semibold text-[#1f2933]">{sides.before}</p>
          <p className="px-3 text-xs font-semibold text-[#1f2933]">{sides.after}</p>
        </div>
      )}
      {out}
    </div>
  );
}
