'use client';

/**
 * Versions of the working document: every save, every accepted AI change, the file as it was opened. Any version can be read
 * as a redline against the next, against the current text, or restored; the document can also be compared with any other
 * document of the library.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, FileUp, GitCompare, History, Loader2, Pencil, RotateCcw, Search, Undo2, Upload, User } from 'lucide-react';
import { problemOf, studioApi, type Revision, type Session } from '@/lib/studio/api';
import { useToast } from '@/components/ui/ToastProvider';
import { ago, plural } from '@/lib/studio/text';
import type { CompareSpec } from './ChangesView';

const AUTHOR: Record<Revision['author_type'], { label: string; icon: typeof Bot }> = {
  user: { label: 'You', icon: Pencil },
  ai: { label: 'AI', icon: Bot },
  import: { label: 'Opened', icon: FileUp },
  system: { label: 'Started', icon: History },
  restore: { label: 'Restored', icon: Undo2 },
  revert: { label: 'Taken back', icon: Undo2 },
};

export interface HistoryPanelProps {
  session: Session;
  flush: () => Promise<void>;
  onCompare: (spec: CompareSpec) => void;
  onContent: (content: string, revision: number) => void;
  /** a file was kept with the session as a reference */
  onSessionChanged: () => void;
}

export default function HistoryPanel({ session, flush, onCompare, onContent, onSessionChanged }: HistoryPanelProps) {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const uploadToCompare = useMutation({
    mutationFn: (f: File) => studioApi.uploadReference(session.id, f),
    onSuccess: (r) => { onSessionChanged(); onCompare({ type: 'reference', id: r.id, title: r.title }); },
    onError: (e) => toast({ title: 'That file could not be read', message: problemOf(e), type: 'error' }),
  });
  const revisions = useQuery({ queryKey: ['studio', 'revisions', session.id, session.revision], queryFn: () => studioApi.revisions(session.id), staleTime: 10_000 });
  const docs = useQuery({ queryKey: ['studio', 'documents', q], queryFn: () => studioApi.documents(q, 12), staleTime: 30_000 });
  const restore = useMutation({
    mutationFn: async (n: number) => { await flush(); return studioApi.restore(session.id, n); },
    onSuccess: (r) => { onContent(r.content, r.revision); toast({ title: 'Version restored', message: 'It is saved as a new version, so nothing is lost.', type: 'success' }); },
    onError: (e) => toast({ title: 'Could not restore it', message: problemOf(e), type: 'error' }),
  });
  const base = revisions.data?.base_label ?? session.base_label;

  return (
    <div className="h-full overflow-y-auto p-3">
      <h3 className="text-sm font-semibold text-[#1f2933]">Changes and versions</h3>
      <div className="mt-2 space-y-1.5">
        <button type="button" onClick={() => onCompare({ type: 'revision', from: 0, label: base ? `Changes since “${base}”` : 'Changes since the start' })}
          className="flex w-full items-center gap-2 rounded-lg border border-[#c5ccd3] bg-white px-3 py-2 text-left text-sm hover:border-[#0f766e] hover:bg-[#f3fbf9]">
          <GitCompare className="h-4 w-4 shrink-0 text-[#0f766e]" />
          <span className="min-w-0"><span className="block font-medium text-[#1f2933]">See what changed since the start</span>{base && <span className="block truncate text-[11px] text-[#586472]">Starting point: {base}</span>}</span>
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-[#d5dbe1] bg-[#f8fafb] p-2.5">
        <p className="text-xs font-semibold text-[#26323d]">Compare with a file</p>
        <p className="mt-0.5 text-[11px] text-[#586472]">Any Word, PDF, text, Markdown or HTML file. It is also kept with this session as a reference.</p>
        <input ref={file} type="file" hidden accept=".docx,.pdf,.txt,.md,.markdown,.html,.htm" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadToCompare.mutate(f); e.target.value = ''; }} />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button type="button" disabled={uploadToCompare.isPending} onClick={() => file.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#7b8794] bg-white px-3 py-2 text-xs font-semibold text-[#26323d] hover:border-[#0f766e] hover:bg-[#f3fbf9] disabled:opacity-50">
            {uploadToCompare.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Choose a file to compare with
          </button>
          {session.references.filter((r) => r.kind !== 'framework').map((r) => (
            <button key={r.id} type="button" onClick={() => onCompare({ type: 'reference', id: r.id, title: r.title })} title={`Compare with ${r.key}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#c5ccd3] bg-white px-2.5 py-2 text-xs font-medium text-[#3f4b58] hover:border-[#0f766e] hover:bg-[#f3fbf9]">
              <GitCompare className="h-3.5 w-3.5 shrink-0 text-[#0f766e]" /> <span className="truncate">{r.key} · {r.title}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[#d5dbe1] bg-[#f8fafb] p-2.5">
        <p className="text-xs font-semibold text-[#26323d]">Compare with another document</p>
        <label className="relative mt-1.5 block">
          <span className="sr-only">Search the library</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#7b8794]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the document library" className="w-full rounded-lg border border-[#b8c4c8] bg-white py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]" />
        </label>
        <ul className="mt-1.5 max-h-44 space-y-1 overflow-y-auto">
          {docs.data?.items.filter((d) => d.id !== session.document_id && (d.has_text || d.has_file)).map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => onCompare({ type: 'document', id: d.id, title: d.title })} className="flex w-full items-center gap-2 rounded-lg border border-[#e1e5e9] bg-white px-2.5 py-1.5 text-left hover:border-[#0f766e] hover:bg-[#f3fbf9]">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm text-[#1f2933]">{d.title}</span><span className="block text-[11px] text-[#586472]">{[d.code, d.doc_type, `v${d.version}`].filter(Boolean).join(' · ')}</span></span>
                <GitCompare className="h-4 w-4 text-[#0f766e]" />
              </button>
            </li>
          ))}
          {docs.data && docs.data.items.length === 0 && <li className="p-2 text-xs text-[#586472]">No document found.</li>}
        </ul>
      </div>

      <h4 className="mb-1.5 mt-5 text-xs font-semibold uppercase tracking-wide text-[#586472]">Versions {revisions.data ? `(${revisions.data.items.length})` : ''}</h4>
      {revisions.isLoading && <p className="text-xs text-[#586472]"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading…</p>}
      <ol className="space-y-1.5">
        {revisions.data?.items.map((r) => {
          const a = AUTHOR[r.author_type] ?? AUTHOR.user;
          const current = r.number === session.revision;
          return (
            <li key={r.number} className={`rounded-lg border bg-white p-2.5 ${current ? 'border-[#0f766e]' : 'border-[#e1e5e9]'}`}>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-[#e3f1f1] px-1.5 py-0.5 font-bold text-[#0f4c5c]">v{r.number}</span>
                <span className="inline-flex items-center gap-1 text-[#3f4b58]">{r.author_type === 'user' ? <User className="h-3 w-3" /> : <a.icon className="h-3 w-3" />} {r.author_type === 'user' && r.author ? r.author : a.label}</span>
                {current && <span className="rounded-full bg-[#d6f3ec] px-1.5 py-0.5 text-[10px] font-semibold text-[#0b6b58]">current</span>}
                <span className="ml-auto text-[#586472]">{ago(r.created_at)}</span>
              </div>
              <p className="mt-1 text-[13px] text-[#1f2933]">{r.summary}</p>
              <p className="mt-0.5 text-[11px] text-[#586472]">{plural(r.words, 'word')}{r.stats && (r.stats.words_added || r.stats.words_removed) ? ` · +${r.stats.words_added} / −${r.stats.words_removed}` : ''}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {r.number > 1 && (
                  <button type="button" onClick={() => onCompare({ type: 'revision', from: r.number - 1, to: r.number, label: `What v${r.number} changed` })} className="rounded px-2 py-0.5 text-[11px] font-semibold text-[#0b6b58] hover:bg-[#e6f4f1]">What it changed</button>
                )}
                {!current && (
                  <>
                    <button type="button" onClick={() => onCompare({ type: 'revision', from: r.number, label: `Changes since v${r.number}` })} className="rounded px-2 py-0.5 text-[11px] font-semibold text-[#0b6b58] hover:bg-[#e6f4f1]">Since then</button>
                    <button type="button" disabled={restore.isPending} onClick={() => restore.mutate(r.number)} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold text-[#8a6100] hover:bg-[#fff2a8] disabled:opacity-50"><RotateCcw className="h-3 w-3" /> Restore</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
