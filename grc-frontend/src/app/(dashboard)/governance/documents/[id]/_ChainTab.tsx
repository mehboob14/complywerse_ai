'use client';

// The document's "Change chain": every version from the original (the uploaded file, or the first version written here) to the
// document as it is now, with who changed what, from what to what, on whose request and from which sources, the approvals in
// between, each version's file to download, and the whole chain as a table that exports to Excel, PDF and CSV. The next person
// to review reads what each person before them changed. Backend: governance/change_chain.py.
//
// Colours are explicit values where the platform shell repaints slate classes (see the design system): teal for the AI, amber
// for taken back, emerald for approvals, neutral for edits by hand, the original outlined.
import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpenCheck, CheckCircle2, ChevronDown, ChevronRight, FileDown, FileSpreadsheet, FileText, GitCompare, GitCommitVertical, History,
  ListTree, Loader2, Send, ShieldCheck, Sparkles, Table2, Users, XCircle, type LucideIcon,
  RotateCcw,
} from 'lucide-react';
import { documentChainApi, ORIGIN_LABEL, type ChainEvent, type ChainItem, type ChainVersion, type ExportFormat } from '@/lib/documentChain';
import { problemOf, saveBlob, type Segment } from '@/lib/studio/api';
import { ago, plural, wordDiff } from '@/lib/studio/text';
import { dateTime } from '@/lib/documentLifecycle';
import { useToast } from '@/components/ui/ToastProvider';
import { InitialsAvatar } from '../_workspace/lib';
import { OriginBadge, SourceChips, originLook } from '../studio/_components/ChangeAttribution';

type Filter = 'all' | 'ai' | 'manual' | 'approvals';

const MUTED = 'text-[#586472]';
const KIND: Record<string, { label: string; tone: string }> = {
  inserted: { label: 'Added', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  deleted: { label: 'Removed', tone: 'bg-rose-50 text-rose-800 ring-rose-200' },
  modified: { label: 'Changed', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
};
const STAGE_DOT: Record<string, string> = {
  draft: 'bg-[#94a3b8]', pending_review: 'bg-amber-500', pending_approval: 'bg-amber-500', approved: 'bg-emerald-500', published: 'bg-emerald-600',
  expired: 'bg-rose-500', archived: 'bg-[#94a3b8]', exception_applied: 'bg-amber-500',
};
const SLATE = 'bg-[#f1f5f9] text-[#475569] ring-[#e2e8f0]';
const EVENT: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  created: { label: 'Created', icon: FileText, tone: SLATE },
  sent_for_review: { label: 'Sent for review', icon: Send, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  sent_for_approval: { label: 'Sent for approval', icon: Send, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  signed: { label: 'Signed', icon: ShieldCheck, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rejected: { label: 'Rejected', icon: XCircle, tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  published: { label: 'Published', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  archived: { label: 'Archived', icon: FileText, tone: SLATE },
  status_changed: { label: 'Status changed', icon: GitCommitVertical, tone: SLATE },
  review_completed: { label: 'Review completed', icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  version_rollback: { label: 'Earlier version restored', icon: History, tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
};

const originLabel = (v: ChainVersion, isFirst: boolean) => (isFirst && v.origin === 'initial' ? 'The original' : ORIGIN_LABEL[v.origin] ?? v.origin_label);

function Words({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]" title={`${added} words added, ${removed} removed`}>
      <span className="font-mono font-semibold text-emerald-700">+{added}</span>
      <span className="font-mono font-semibold text-rose-700">−{removed}</span>
      <span className={MUTED}>words</span>
    </span>
  );
}

function Stage({ stage, label }: { stage: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#334155]" title="The stage the document was in when this happened">
      <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[stage] ?? 'bg-[#94a3b8]'}`} aria-hidden />{label}
    </span>
  );
}

function SectionPath({ section }: { section: string }) {
  const parts = (section || 'Top of the document').split(' › ');
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 text-xs">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-[#94a3b8]" aria-hidden />}
          <span className={i === parts.length - 1 ? 'font-semibold text-slate-900' : MUTED}>{p}</span>
        </Fragment>
      ))}
    </span>
  );
}

function Diff({ item }: { item: ChainItem }) {
  const segs: Segment[] = useMemo(() => (item.status === 'modified' ? wordDiff(item.before_text, item.after_text) : []), [item]);
  if (item.status === 'inserted') {
    return <p className="whitespace-pre-wrap rounded-lg border-l-[3px] border-l-emerald-500 bg-emerald-50/60 px-3 py-2 text-[13px] leading-relaxed text-emerald-950">{item.after_text}</p>;
  }
  if (item.status === 'deleted') {
    return <p className="whitespace-pre-wrap rounded-lg border-l-[3px] border-l-rose-500 bg-rose-50/60 px-3 py-2 text-[13px] leading-relaxed text-rose-900 line-through decoration-rose-400">{item.before_text}</p>;
  }
  return (
    <p className="whitespace-pre-wrap rounded-lg border-l-[3px] border-l-amber-400 bg-[#fffdf5] px-3 py-2 text-[13px] leading-relaxed text-slate-800">
      {segs.map(([op, text], i) => (op === 'insert'
        ? <ins key={i} className="rounded-sm bg-emerald-100 px-0.5 text-emerald-900 no-underline">{text}</ins>
        : op === 'delete' ? <del key={i} className="rounded-sm bg-rose-100 px-0.5 text-rose-800 line-through decoration-rose-400">{text}</del> : <span key={i}>{text}</span>))}
    </p>
  );
}

function ItemCard({ item, version }: { item: ChainItem; version: string }) {
  const kind = KIND[item.status] ?? KIND.modified;
  return (
    <li className="rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#eef2f6] px-3 py-2">
        <span className="rounded-md bg-[#f1f5f9] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#334155]" title="Reference in the export">{version}.{item.n}</span>
        <SectionPath section={item.section} />
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${kind.tone}`}>{kind.label}{item.format_only ? ' · formatting' : ''}</span>
        <span className="ml-auto"><Words added={item.words_added} removed={item.words_removed} /></span>
      </div>
      <div className="px-3 py-2.5">
        <Diff item={item} />
        {item.truncated && <p className={`mt-1 text-[11px] ${MUTED}`}>Shortened here; the whole text is in the document and in the Excel export.</p>}
      </div>
      <div className="rounded-b-xl border-t border-[#eef2f6] bg-[#f8fafc] px-3 py-2">
        <OriginBadge origin={item.origin} by={item.by} coverage={item.coverage} at={item.at} />
        {item.request && <p className="mt-1.5 border-l-2 border-primary-100 pl-2 text-[12px] italic text-[#475569]">“{item.request}”</p>}
        {item.reason && <p className="mt-1 text-[12px] text-[#334155]">{item.origin === 'ai' ? <span className="font-medium text-[#0b6b58]">Why: </span> : null}{item.reason}</p>}
        <SourceChips sources={item.sources} />
      </div>
    </li>
  );
}

function VersionCard({ v, isFirst, current, open, onToggle, onShow, onDownload, downloading, onRestore }: {
  v: ChainVersion; isFirst: boolean; current: boolean; open: boolean; onToggle: () => void; onShow: () => void; onDownload: () => void; downloading: boolean;
  /** make this version the document again, as a new version (editors only) */
  onRestore?: () => void;
}) {
  const look = originLook(isFirst && v.origin === 'initial' ? 'initial' : v.origin);
  const Icon = look.icon;
  const quote = v.reason && v.reason !== v.summary ? `“${v.reason}”` : v.summary;
  const canShow = !isFirst && v.origin !== 'initial' && v.comparable;
  return (
    <div className={`rounded-xl border bg-white shadow-card ${current ? 'border-primary-600/50 ring-1 ring-primary-100' : 'border-slate-200'}`} data-version-id={v.id}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 pb-2.5 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-slate-900">v{v.number}</span>
            {current && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0b6b58] ring-1 ring-inset ring-primary-100">Current</span>}
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${look.pill}`}><Icon className="h-3 w-3" aria-hidden /> {originLabel(v, isFirst)}</span>
            {!v.comparable && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">text not readable</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1.5 text-[#334155]"><InitialsAvatar name={v.by} size="sm" /> {v.by}</span>
            <span className={MUTED} title={ago(v.at)}>{dateTime(v.at)}</span>
            <Stage stage={v.stage} label={v.stage_label} />
            {v.has_file && v.file_name && <span className={`inline-flex items-center gap-1 ${MUTED}`}><FileText className="h-3.5 w-3.5" aria-hidden /> {v.file_name}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {v.changes > 0 && <span className="mr-1"><Words added={v.words_added} removed={v.words_removed} /></span>}
          {v.has_file && (
            <button type="button" onClick={onDownload} disabled={downloading} title={`Download the file of version ${v.number}`}
              className="inline-flex items-center gap-1 rounded-lg border border-[#cbd5e1] bg-white px-2 py-1 text-[11px] font-semibold text-[#334155] hover:border-primary-600 hover:bg-primary-50 disabled:opacity-60">
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} File
            </button>
          )}
          <button type="button" onClick={onShow} disabled={!canShow} title={canShow ? "See this version's changes marked in the document" : 'The original has nothing before it to compare with'}
            className="inline-flex items-center gap-1 rounded-lg border border-[#cbd5e1] bg-white px-2 py-1 text-[11px] font-semibold text-[#334155] hover:border-primary-600 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40">
            <GitCompare className="h-3.5 w-3.5" /> Show in the document
          </button>
          {onRestore && !current && (
            <button type="button" onClick={onRestore} title={`Make version ${v.number} the document again, as a new version`}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-50">
              <RotateCcw className="h-3.5 w-3.5" /> Restore
            </button>
          )}
        </div>
      </div>
      {quote && <p className="mx-4 mb-2.5 border-l-2 border-[#cbd5e1] pl-3 text-[13px] text-[#475569]">{quote}</p>}
      {v.approved_by && (
        <p className="mx-4 mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Approved by {v.approved_by}{v.approved_at ? `, ${dateTime(v.approved_at)}` : ''}
        </p>
      )}
      <button type="button" onClick={onToggle} aria-expanded={open}
        className={`flex w-full items-center gap-1.5 border-t border-[#eef2f6] px-4 py-2 text-xs font-semibold text-[#0b6b58] hover:bg-primary-50 ${open ? '' : 'rounded-b-xl'}`}>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {v.items.length ? `${open ? 'Hide' : 'Show'} ${plural(v.items.length, 'change')}` : open ? 'Hide' : 'Details'}
      </button>
      {open && (
        <div className="rounded-b-xl border-t border-[#eef2f6] bg-[#f8fafc] p-3">
          {v.items.length === 0
            ? <p className={`text-xs ${MUTED}`}>{v.origin === 'initial' || isFirst ? `The original${v.has_file ? ' file' : ''}: the first version, so there is nothing before it to compare with.` : v.comparable ? 'The text did not change in this version.' : 'The file of this version could not be read, so its changes are not listed.'}</p>
            : <ul className="space-y-2.5">{v.items.map((it) => <ItemCard key={`${v.id}-${it.n}`} item={it} version={v.number} />)}</ul>}
        </div>
      )}
    </div>
  );
}

function EventRow({ e }: { e: ChainEvent }) {
  const meta = EVENT[e.kind] ?? { label: e.kind.replace(/_/g, ' '), icon: FileText, tone: SLATE };
  const Icon = meta.icon;
  return (
    <li className="relative pl-12">
      <span className={`absolute left-[8px] top-1 inline-flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-inset ${meta.tone}`} aria-hidden><Icon className="h-3 w-3" /></span>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 text-xs">
        <span className="font-semibold text-slate-900">{meta.label}</span>
        {e.actor && <span className="inline-flex items-center gap-1 text-[#334155]"><InitialsAvatar name={e.actor} size="sm" /> {e.actor}</span>}
        {e.detail && <span className={`min-w-0 flex-1 ${MUTED}`}>{e.detail}</span>}
        <span className={`ml-auto shrink-0 ${MUTED}`}>{dateTime(e.at)}</span>
      </div>
    </li>
  );
}

/** From the original to now at a glance: one marker per version, coloured by how it was made. A marker opens its version. */
function Journey({ versions, onPick }: { versions: ChainVersion[]; onPick: (id: number) => void }) {
  if (versions.length < 2) return null;
  const first = versions[0];
  const last = versions[versions.length - 1];
  const dense = versions.length > 14;
  return (
    <div className="mt-4 rounded-xl border border-[#eef2f6] bg-[#f8fafc] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
        <span className={MUTED}><span className="font-semibold text-[#0f4c5c]">The original</span> · v{first.number} · {dateTime(first.at)}{first.file_name ? ` · ${first.file_name}` : ''}</span>
        <span className={MUTED}><span className="font-semibold text-slate-900">Now</span> · v{last.number} · {last.stage_label}</span>
      </div>
      <div className="relative mt-2.5 flex items-center justify-between gap-1">
        <span className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 rounded bg-[#dbe3ea]" aria-hidden />
        {versions.map((v, i) => {
          const look = originLook(i === 0 && v.origin === 'initial' ? 'initial' : v.origin);
          const Icon = look.icon;
          const now = i === versions.length - 1;
          return (
            <button key={v.id} type="button" onClick={() => onPick(v.id)}
              title={`v${v.number} · ${originLabel(v, i === 0)} · ${v.by} · ${dateTime(v.at)}${v.changes ? ` · ${plural(v.changes, 'change')}` : ''}`}
              className={`relative z-[1] inline-flex shrink-0 items-center justify-center rounded-full ring-inset transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${look.node}
                ${dense ? 'h-5 w-5 ring-1' : 'h-8 w-8 ring-1'} ${now ? 'ring-2 ring-primary-600' : ''}`}>
              {!dense && <Icon className="h-3.5 w-3.5" aria-hidden />}
              <span className="sr-only">Version {v.number}</span>
            </button>
          );
        })}
      </div>
      {!dense && <div className="mt-1 flex justify-between gap-1 font-mono text-[10px] text-[#94a3b8]">{versions.map((v) => <span key={v.id} className="w-8 shrink-0 text-center">v{v.number}</span>)}</div>}
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-[#0b6b58]"><Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden /></span>
      <div className="min-w-0">
        <p className={`text-[11px] font-medium uppercase tracking-wide ${MUTED}`}>{label}</p>
        <p className="text-xl font-bold leading-tight text-slate-900">{value}</p>
        {sub && <div className={`mt-0.5 text-[11px] ${MUTED}`}>{sub}</div>}
      </div>
    </div>
  );
}

function People({ names }: { names: string[] }) {
  return (
    <span className="flex items-center">
      {names.slice(0, 4).map((n, i) => <span key={n} className={i ? '-ml-1.5' : ''}><InitialsAvatar name={n} size="sm" /></span>)}
      {names.length > 4 && <span className="ml-1">+{names.length - 4}</span>}
    </span>
  );
}

function ChangesTable({ versions }: { versions: ChainVersion[] }) {
  const rows = versions.flatMap((v) => v.items.map((it) => ({ v, it })));
  if (!rows.length) return <p className={`rounded-xl border border-dashed border-[#cbd5e1] bg-white p-8 text-center text-sm ${MUTED}`}>No changes match these filters.</p>;
  return (
    <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
      <table className="w-full min-w-[1040px] border-collapse text-left text-xs">
        <thead className="bg-[#f8fafc] text-[10px] uppercase tracking-wide text-[#475569]">
          <tr>{['Ref', 'Date', 'Changed by', 'Stage', 'Section', 'Change', 'From', 'To', 'Words', 'How', 'Request and reason', 'Sources'].map((h) => <th key={h} className="whitespace-nowrap px-2.5 py-2.5 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(({ v, it }) => {
            const kind = KIND[it.status] ?? KIND.modified;
            const look = originLook(it.origin);
            return (
              <tr key={`${v.id}-${it.n}`} className="border-t border-[#eef2f6] align-top hover:bg-[#f8fafc]">
                <td className="whitespace-nowrap px-2.5 py-2 font-mono text-[#334155]">{v.number}.{it.n}</td>
                <td className="whitespace-nowrap px-2.5 py-2 text-[#334155]">{dateTime(it.at || v.at)}</td>
                <td className="px-2.5 py-2"><span className="inline-flex items-center gap-1.5 text-[#334155]"><InitialsAvatar name={it.by || v.by} size="sm" /> {it.by || v.by}</span></td>
                <td className="whitespace-nowrap px-2.5 py-2"><Stage stage={v.stage} label={v.stage_label} /></td>
                <td className="px-2.5 py-2 text-[#334155]">{it.section || '—'}</td>
                <td className="whitespace-nowrap px-2.5 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${kind.tone}`}>{kind.label}</span></td>
                <td className="max-w-[16rem] bg-rose-50/40 px-2.5 py-2 text-rose-900"><span className="line-clamp-4 whitespace-pre-wrap" title={it.before_text}>{it.before_text || '—'}</span></td>
                <td className="max-w-[16rem] bg-emerald-50/40 px-2.5 py-2 text-emerald-950"><span className="line-clamp-4 whitespace-pre-wrap" title={it.after_text}>{it.after_text || '—'}</span></td>
                <td className="whitespace-nowrap px-2.5 py-2"><Words added={it.words_added} removed={it.words_removed} /></td>
                <td className="whitespace-nowrap px-2.5 py-2"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${look.pill}`}><look.icon className="h-3 w-3" aria-hidden />{ORIGIN_LABEL[it.origin] ?? 'Changed'}</span></td>
                <td className="max-w-[14rem] px-2.5 py-2 text-[#334155]">{[it.request && `“${it.request}”`, it.reason].filter(Boolean).join(' — ') || '—'}</td>
                <td className="max-w-[16rem] px-2.5 py-2"><SourceChips sources={it.sources} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ChainTab({ documentId, currentVersion, onShowInDocument, onRestore }: {
  documentId: number;
  /** editors: make a version the document again (asks first) */
  onRestore?: (v: { id: number; number: string }) => void;
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
  const [fetching, setFetching] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['document-chain', documentId], queryFn: () => documentChainApi.chain(documentId), staleTime: 15_000 });

  const data = q.data;
  const oldestFirst = useMemo(() => data?.versions ?? [], [data]);
  const versions = useMemo(() => [...oldestFirst].reverse(), [oldestFirst]);        // newest first
  const firstId = oldestFirst[0]?.id;
  const people = useMemo(() => Array.from(new Set([...(data?.versions ?? []).map((v) => v.by), ...(data?.events ?? []).map((e) => e.actor ?? '')].filter(Boolean))).sort(), [data]);
  const counts = useMemo(() => ({
    ai: versions.filter((v) => v.items.some((i) => i.origin === 'ai')).length,
    manual: versions.filter((v) => v.items.some((i) => i.origin === 'manual') || v.origin === 'manual').length,
    approvals: data?.events.length ?? 0,
  }), [versions, data]);
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
  const toggle = (id: number) => setOpened(() => { const n = new Set(open); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const jumpTo = (id: number) => {
    setView('chain');
    setFilter('all');
    setPerson('');
    setOpened(new Set(Array.from(open).concat(id)));
    setTimeout(() => document.querySelector(`[data-version-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };
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
  const downloadVersion = async (v: ChainVersion) => {
    setFetching(v.id);
    try {
      const { blob, filename } = await documentChainApi.versionFile(documentId, v.id, v.file_name || data?.document?.title || 'document', v.number);
      saveBlob(blob, filename);
    } catch (e) {
      toast({ type: 'error', title: `Could not download the file of version ${v.number}`, message: problemOf(e) });
    } finally {
      setFetching(null);
    }
  };

  if (q.isLoading) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-600" /></div>;
  if (q.isError || !data) return <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{problemOf(q.error, 'The change chain could not be read.')}</p>;
  if (!data.enabled) return <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-[#334155]">The change chain is not enabled for your organisation.</p>;
  const s = data.summary;
  const latest = currentVersion ?? data.document?.version;
  const found = data.sources.filter((x) => x.verified === true).length;
  const chips: Array<[Filter, string, number | null]> = [['all', 'Everything', null], ['ai', 'Comply Agent', counts.ai], ['manual', 'Edited by hand', counts.manual], ['approvals', 'Approvals', counts.approvals]];

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-[#0b6b58]"><History className="h-5 w-5" strokeWidth={1.75} aria-hidden /></span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900">Change chain</h3>
              <p className={`mt-0.5 max-w-3xl text-xs ${MUTED}`}>
                Every version from the original to now: who changed what, from what to what, on whose request and from which sources, and the approvals in between.
                The next person to review sees what each person before them changed.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`hidden text-[11px] font-medium uppercase tracking-wide sm:inline ${MUTED}`}>Export</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-[#cbd5e1] bg-white" role="group" aria-label="Export the chain">
              {([['xlsx', 'Excel', FileSpreadsheet], ['pdf', 'PDF', FileText], ['csv', 'CSV', FileDown]] as const).map(([fmt, label, Icon], i) => (
                <button key={fmt} type="button" disabled={exporting !== null} onClick={() => download(fmt)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-[#334155] hover:bg-primary-50 hover:text-[#0b6b58] disabled:opacity-60 ${i ? 'border-l border-[#cbd5e1]' : ''}`}>
                  {exporting === fmt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />} {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Journey versions={oldestFirst} onPick={jumpTo} />

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Tile icon={History} label="Versions" value={s.versions} sub={oldestFirst[0]?.at ? `since ${dateTime(oldestFirst[0].at)}` : undefined} />
          <Tile icon={GitCompare} label="Changes" value={s.changes} sub={<Words added={s.words_added} removed={s.words_removed} />} />
          <Tile icon={Sparkles} label="Comply Agent" value={s.ai_assisted} sub={s.changes ? `${Math.round((100 * s.ai_assisted) / s.changes)}% of the changes` : 'none yet'} />
          <Tile icon={Users} label="People" value={s.people} sub={<People names={people} />} />
          <Tile icon={BookOpenCheck} label="Sources" value={s.sources} sub={s.sources ? `${found} of ${s.sources} quotes found in the source` : 'none cited'} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-[#eef1f4] p-0.5" role="group" aria-label="Show as">
          {([['chain', 'Timeline', ListTree], ['table', 'Table', Table2]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${view === k ? 'bg-white text-[#0b6b58] shadow-card' : 'text-[#475569] hover:text-slate-900'}`}>
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
        <div className="inline-flex flex-wrap gap-1" role="group" aria-label="Filter">
          {chips.map(([k, label, n]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${filter === k ? 'border-primary-600 bg-primary-50 font-semibold text-[#0b6b58]' : 'border-[#cbd5e1] bg-white text-[#334155] hover:border-primary-600'}`}>
              {label}{n != null && <span className={`rounded-full px-1.5 text-[10px] font-semibold ${filter === k ? 'bg-white text-[#0b6b58]' : 'bg-[#f1f5f9] text-[#475569]'}`}>{n}</span>}
            </button>
          ))}
        </div>
        <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person" className="rounded-lg border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-xs text-[#334155]">
          <option value="">Everyone</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {view === 'chain' && (
          <button type="button" className="ml-auto text-xs font-semibold text-[#0b6b58] hover:underline"
            onClick={() => setOpened(open.size ? new Set() : new Set(shown.map((v) => v.id)))}>{open.size ? 'Collapse all' : 'Expand all'}</button>
        )}
      </div>

      {view === 'table' ? <ChangesTable versions={shown} /> : (
        <ol className="relative space-y-3 before:absolute before:bottom-4 before:left-[19px] before:top-4 before:w-px before:bg-[#dbe3ea]" aria-label="Versions and approvals, newest first">
          {timeline.length === 0 && <li className={`relative rounded-xl border border-dashed border-[#cbd5e1] bg-white p-8 text-center text-sm ${MUTED}`}>Nothing matches these filters.</li>}
          {timeline.map((row, i) => {
            if (row.kind === 'e') return <EventRow key={`e${i}`} e={row.e} />;
            const v = row.v;
            const isFirst = v.id === firstId;
            const look = originLook(isFirst && v.origin === 'initial' ? 'initial' : v.origin);
            const Icon = look.icon;
            return (
              <li key={`v${v.id}`} className="relative pl-12">
                <span className={`absolute left-0 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-inset shadow-card ${look.node}`} aria-hidden><Icon className="h-4 w-4" /></span>
                <VersionCard v={v} isFirst={isFirst} current={v.number === latest} open={open.has(v.id)} onToggle={() => toggle(v.id)}
                  downloading={fetching === v.id} onDownload={() => downloadVersion(v)} onRestore={onRestore ? () => onRestore({ id: v.id, number: v.number }) : undefined}
                  onShow={() => {
                    const idx = oldestFirst.findIndex((x) => x.id === v.id);
                    const before = idx > 0 ? oldestFirst[idx - 1] : null;
                    if (before) onShowInDocument({ from: before.id, to: v.id });
                  }} />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
