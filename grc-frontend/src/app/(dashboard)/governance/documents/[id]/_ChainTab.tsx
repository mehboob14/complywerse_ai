'use client';

// The document's "Change chain": every version oldest to newest with who changed what, from what to what, on whose request and
// from which sources, the approvals between the versions, and the whole chain as a table that exports to Excel, PDF and CSV.
// The next person to review reads what each person before them changed. Backend: governance/change_chain.py.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet, FileText, GitCompare, Loader2, Send, ShieldCheck, XCircle } from 'lucide-react';
import { documentChainApi, ORIGIN_LABEL, type ChainEvent, type ChainItem, type ChainVersion, type ExportFormat } from '@/lib/documentChain';
import { problemOf, saveBlob, type Segment } from '@/lib/studio/api';
import { wordDiff } from '@/lib/studio/text';
import { dateTime } from '@/lib/documentLifecycle';
import { useToast } from '@/components/ui/ToastProvider';
import { OriginBadge, SourceChips } from '../studio/_components/ChangeAttribution';

type Filter = 'all' | 'ai' | 'manual' | 'approvals';
const KIND: Record<string, string> = { inserted: 'Added', deleted: 'Removed', modified: 'Changed' };
const EVENT: Record<string, { label: string; icon: typeof Send; tone: string }> = {
  created: { label: 'Created', icon: FileText, tone: 'text-slate-600' },
  sent_for_review: { label: 'Sent for review', icon: Send, tone: 'text-primary-700' },
  sent_for_approval: { label: 'Sent for approval', icon: Send, tone: 'text-primary-700' },
  signed: { label: 'Signed', icon: ShieldCheck, tone: 'text-emerald-700' },
  rejected: { label: 'Rejected', icon: XCircle, tone: 'text-rose-700' },
  published: { label: 'Published', icon: CheckCircle2, tone: 'text-emerald-700' },
  archived: { label: 'Archived', icon: FileText, tone: 'text-slate-600' },
  status_changed: { label: 'Status changed', icon: FileText, tone: 'text-slate-700' },
  review_completed: { label: 'Review completed', icon: CheckCircle2, tone: 'text-emerald-700' },
  version_rollback: { label: 'Earlier version restored', icon: FileText, tone: 'text-amber-700' },
};

function Diff({ item }: { item: ChainItem }) {
  const segs: Segment[] = useMemo(() => (item.status === 'modified' ? wordDiff(item.before_text, item.after_text) : []), [item]);
  if (item.status === 'inserted') return <p className="whitespace-pre-wrap rounded bg-[#f3fbf6] px-2 py-1 text-[13px] text-[#0a5a38]">{item.after_text}</p>;
  if (item.status === 'deleted') return <p className="whitespace-pre-wrap rounded bg-[#fdf5f5] px-2 py-1 text-[13px] text-[#9b1c1c] line-through">{item.before_text}</p>;
  return (
    <p className="whitespace-pre-wrap rounded bg-[#f8fafb] px-2 py-1 text-[13px] leading-relaxed text-slate-800">
      {segs.map(([op, text], i) => (op === 'insert'
        ? <ins key={i} className="rounded-sm bg-[#d4f2e0] px-0.5 text-[#0a5a38] no-underline">{text}</ins>
        : op === 'delete' ? <del key={i} className="rounded-sm bg-[#fbdcdc] px-0.5 text-[#9b1c1c] line-through">{text}</del> : <span key={i}>{text}</span>))}
    </p>
  );
}

function ItemRow({ item }: { item: ChainItem }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600">
        <span className="font-semibold text-slate-800">{item.section || 'Top of the document'}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium">{KIND[item.status] ?? item.status}{item.format_only ? ' (formatting)' : ''}</span>
        <span>+{item.words_added} / −{item.words_removed} words</span>
      </div>
      <div className="mt-1.5"><Diff item={item} /></div>
      {item.truncated && <p className="mt-0.5 text-[11px] text-slate-500">Shortened here; the whole text is in the document and in the Excel export of the chain.</p>}
      <div className="mt-1.5">
        <OriginBadge origin={item.origin} by={item.by} coverage={item.coverage} at={item.at} />
        {item.request && <p className="mt-1 text-[11px] italic text-slate-600">Asked: “{item.request}”</p>}
        {item.reason && <p className="mt-0.5 text-[11px] text-slate-700">{item.origin === 'ai' ? 'Why: ' : ''}{item.reason}</p>}
        <SourceChips sources={item.sources} />
      </div>
    </li>
  );
}

function VersionCard({ v, current, open, onToggle, onShow }: { v: ChainVersion; current: boolean; open: boolean; onToggle: () => void; onShow: () => void }) {
  return (
    <li className="rounded-xl border border-slate-300 bg-white" data-version={v.number}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} v{v.number}
        </button>
        {current && <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-700">current</span>}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{ORIGIN_LABEL[v.origin] ?? v.origin_label}</span>
        <span className="text-xs text-slate-700">{v.by}</span>
        <span className="text-xs text-slate-500">{dateTime(v.at)}</span>
        <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600" title="What stage the document was in when this version was made">{v.stage_label}</span>
        <span className="text-xs text-slate-600">{v.changes} change{v.changes === 1 ? '' : 's'} · +{v.words_added} / −{v.words_removed} words</span>
        {!v.comparable && <span className="text-[11px] text-amber-700">its text could not be compared</span>}
        <button type="button" onClick={onShow} disabled={v.origin === 'initial' || !v.comparable} title="See this version's changes marked in the document"
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          <GitCompare className="h-3.5 w-3.5" /> Show in the document
        </button>
      </div>
      {(v.summary || v.reason) && <p className="px-3 pb-2 text-xs text-slate-600">{v.reason && v.reason !== v.summary ? `“${v.reason}”` : v.summary}</p>}
      {v.approved_by && <p className="px-3 pb-2 text-xs text-emerald-700">Approved by {v.approved_by}{v.approved_at ? `, ${dateTime(v.approved_at)}` : ''}</p>}
      {open && (
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-3">
          {v.items.length === 0
            ? <p className="text-xs text-slate-600">{v.origin === 'initial' ? 'The first version: there is nothing before it to compare with.' : v.comparable ? 'The text did not change in this version.' : 'The file of this version could not be read, so its changes are not listed.'}</p>
            : <ul className="space-y-2">{v.items.map((it) => <ItemRow key={`${v.id}-${it.n}`} item={it} />)}</ul>}
        </div>
      )}
    </li>
  );
}

function EventRow({ e }: { e: ChainEvent }) {
  const meta = EVENT[e.kind] ?? { label: e.kind.replace(/_/g, ' '), icon: FileText, tone: 'text-slate-600' };
  const Icon = meta.icon;
  return (
    <li className="flex items-start gap-2 px-3 py-1 text-xs text-slate-700">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.tone}`} aria-hidden />
      <span className="min-w-0 flex-1"><span className="font-medium text-slate-900">{meta.label}</span>{e.actor ? ` · ${e.actor}` : ''}{e.detail ? ` — ${e.detail}` : ''}</span>
      <span className="shrink-0 text-slate-500">{dateTime(e.at)}</span>
    </li>
  );
}

function ChangesTable({ versions }: { versions: ChainVersion[] }) {
  const rows = versions.flatMap((v) => v.items.map((it) => ({ v, it })));
  if (!rows.length) return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">No changes match.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
      <table className="w-full min-w-[980px] border-collapse text-left text-xs">
        <thead className="bg-slate-100 text-slate-700">
          <tr>{['Ref', 'Date', 'Changed by', 'Stage', 'Section', 'Change', 'From', 'To', 'Words', 'How', 'Request and reason', 'Sources'].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(({ v, it }) => (
            <tr key={`${v.id}-${it.n}`} className="border-t border-slate-200 align-top">
              <td className="whitespace-nowrap px-2 py-1.5 font-mono text-slate-700">{v.number}.{it.n}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{dateTime(it.at || v.at)}</td>
              <td className="px-2 py-1.5">{it.by || v.by}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{v.stage_label}</td>
              <td className="px-2 py-1.5">{it.section || '—'}</td>
              <td className="whitespace-nowrap px-2 py-1.5">{KIND[it.status] ?? it.status}</td>
              <td className="max-w-[16rem] px-2 py-1.5 text-[#9b1c1c]"><span className="line-clamp-4 whitespace-pre-wrap" title={it.before_text}>{it.before_text || '—'}</span></td>
              <td className="max-w-[16rem] px-2 py-1.5 text-[#0a5a38]"><span className="line-clamp-4 whitespace-pre-wrap" title={it.after_text}>{it.after_text || '—'}</span></td>
              <td className="whitespace-nowrap px-2 py-1.5">+{it.words_added} / −{it.words_removed}</td>
              <td className="px-2 py-1.5">{ORIGIN_LABEL[it.origin] ?? 'Changed'}</td>
              <td className="max-w-[14rem] px-2 py-1.5">{[it.request && `“${it.request}”`, it.reason].filter(Boolean).join(' — ') || '—'}</td>
              <td className="max-w-[16rem] px-2 py-1.5"><SourceChips sources={it.sources} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ChainTab({ documentId, currentVersion, onShowInDocument }: {
  documentId: number;
  currentVersion?: string | null;
  /** open the Document Viewer with the changes of one version marked (from the version before it, to it) */
  onShowInDocument: (range: { from: number; to: number }) => void;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<'chain' | 'table'>('chain');
  const [filter, setFilter] = useState<Filter>('all');
  const [person, setPerson] = useState('');
  const [opened, setOpened] = useState<Set<number> | null>(null);                // null: nothing was touched, the newest version is open
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const q = useQuery({ queryKey: ['document-chain', documentId], queryFn: () => documentChainApi.chain(documentId), staleTime: 15_000 });

  const data = q.data;
  const versions = useMemo(() => [...(data?.versions ?? [])].reverse(), [data]);        // newest first
  const people = useMemo(() => Array.from(new Set((data?.versions ?? []).map((v) => v.by).filter(Boolean))).sort(), [data]);
  const shown = useMemo(() => versions.filter((v) => {
    if (person && v.by !== person && !v.items.some((i) => i.by === person)) return false;
    if (filter === 'ai') return v.items.some((i) => i.origin === 'ai');
    if (filter === 'manual') return v.items.some((i) => i.origin === 'manual') || v.origin === 'manual';
    return true;
  }), [versions, filter, person]);
  const timeline = useMemo(() => {
    const rows: Array<{ at: string; kind: 'v'; v: ChainVersion } | { at: string; kind: 'e'; e: ChainEvent }> = shown.map((v) => ({ at: v.at ?? '', kind: 'v' as const, v }));
    if (filter === 'all' || filter === 'approvals') {
      for (const e of data?.events ?? []) if (!person || e.actor === person) rows.push({ at: e.at ?? '', kind: 'e', e });
    }
    if (filter === 'approvals') return rows.filter((r) => r.kind === 'e');
    return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [shown, data, filter, person]);

  const newest = timeline.find((r): r is { at: string; kind: 'v'; v: ChainVersion } => r.kind === 'v')?.v.id;
  const open = opened ?? new Set<number>(newest != null && filter !== 'approvals' ? [newest] : []);
  const download = async (format: ExportFormat) => {
    setExporting(format);
    try {
      const { blob, filename } = await documentChainApi.exportFile(documentId, format);
      saveBlob(blob, filename);
    } catch (e) {
      toast({ type: 'error', title: 'Could not export the chain', message: problemOf(e) });
    } finally {
      setExporting(null);
    }
  };

  if (q.isLoading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-400" /></div>;
  if (q.isError || !data) return <p className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{problemOf(q.error, 'The change chain could not be read.')}</p>;
  if (!data.enabled) return <p className="rounded-lg border border-slate-300 bg-white p-4 text-sm text-slate-700">The change chain is not enabled for your organisation.</p>;
  const s = data.summary;
  const latest = currentVersion ?? data.document?.version;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-300 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Change chain</h3>
            <p className="mt-0.5 max-w-3xl text-xs text-slate-600">
              Every version of this document, who changed what from what to what, on whose request and from which sources, and the approvals in between.
              The next person to review sees what each person before them changed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {([['xlsx', 'Excel', FileSpreadsheet], ['pdf', 'PDF', FileText], ['csv', 'CSV', Download]] as const).map(([fmt, label, Icon]) => (
              <button key={fmt} type="button" disabled={exporting !== null} onClick={() => download(fmt)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60">
                {exporting === fmt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />} {label}
              </button>
            ))}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {([['Versions', s.versions], ['Changes', s.changes], ['People', s.people], ['AI-assisted changes', s.ai_assisted], ['Sources', s.sources], ['Words', `+${s.words_added} / −${s.words_removed}`]] as const).map(([k, val]) => (
            <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-[11px] text-slate-600">{k}</dt><dd className="text-sm font-semibold text-slate-900">{val}</dd></div>
          ))}
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="Show">
          {([['chain', 'Chain'], ['table', 'Table']] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${view === k ? 'bg-primary-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>{label}</button>
          ))}
        </div>
        <div className="inline-flex flex-wrap gap-1" role="group" aria-label="Filter">
          {([['all', 'Everything'], ['ai', 'AI-assisted'], ['manual', 'Edited by hand'], ['approvals', 'Approvals']] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
              className={`rounded-full border px-2.5 py-1 text-xs ${filter === k ? 'border-primary-600 bg-primary-50 font-semibold text-primary-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>{label}</button>
          ))}
        </div>
        <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person" className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800">
          <option value="">Everyone</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {view === 'chain' && (
          <button type="button" className="ml-auto text-xs font-medium text-primary-700 hover:underline"
            onClick={() => setOpened(open.size ? new Set() : new Set(shown.map((v) => v.id)))}>{open.size ? 'Collapse all' : 'Expand all'}</button>
        )}
      </div>

      {view === 'table' ? <ChangesTable versions={shown} /> : (
        <ol className="space-y-2" aria-label="Versions and approvals, newest first">
          {timeline.length === 0 && <li className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Nothing matches.</li>}
          {timeline.map((row, i) => row.kind === 'v' ? (
            <VersionCard key={`v${row.v.id}`} v={row.v} current={row.v.number === latest} open={open.has(row.v.id)}
              onToggle={() => setOpened(() => { const n = new Set(open); if (n.has(row.v.id)) n.delete(row.v.id); else n.add(row.v.id); return n; })}
              onShow={() => {
                const idx = (data.versions).findIndex((x) => x.id === row.v.id);
                const before = idx > 0 ? data.versions[idx - 1] : null;
                if (before) onShowInDocument({ from: before.id, to: row.v.id });
              }} />
          ) : <EventRow key={`e${i}`} e={row.e} />)}
        </ol>
      )}
    </div>
  );
}
