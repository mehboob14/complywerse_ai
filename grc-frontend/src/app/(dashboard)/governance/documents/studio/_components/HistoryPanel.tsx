'use client';

/**
 * Revisions of the working document ("rev N", not the library's versions): every save, every accepted AI change, the file as it was opened. Any revision can be read
 * as a redline against the next, against the current text, or restored; the document can also be compared with any other
 * document of the library.
 *
 * On the design-system kit: the buttons and the search are the kit's, and a list that is loading, empty or could not be read says which
 * (the revisions and the documents used to stay blank when they could not be read).
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, FileUp, GitCompare, History, Pencil, RotateCcw, Search, Undo2, Upload, User } from 'lucide-react';
import { DOC_TYPE_LABEL, studioApi, type Revision, type Session } from '@/lib/studio/api';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, SkeletonRows, TextInput, useNotify } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ago, plural } from '@/lib/studio/text';
import type { CompareSpec } from './ChangesView';
import { SIGNOFF_STATUS } from '../../_SignoffControl';
import { docLine } from './homeLists';
import { PICK_ROW } from './ReferencesPanel';

const AUTHOR: Record<Revision['author_type'], { label: string; icon: typeof Bot }> = {
  user: { label: 'You', icon: Pencil },
  ai: { label: 'Comply Agent', icon: Bot },
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
  const notify = useNotify();
  const [q, setQ] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const uploadToCompare = useMutation({
    mutationFn: (f: File) => studioApi.uploadReference(session.id, f),
    onSuccess: (r) => { onSessionChanged(); onCompare({ type: 'reference', id: r.id, title: r.title }); },
    onError: (e) => notify.error(e, { title: 'That file could not be read' }),
  });
  const revisions = useQuery({ queryKey: ['studio', 'revisions', session.id, session.revision], queryFn: () => studioApi.revisions(session.id), staleTime: 10_000 });
  const docs = useQuery({ queryKey: ['studio', 'documents', q], queryFn: () => studioApi.documents(q, 12), staleTime: 30_000 });
  const restore = useMutation({
    mutationFn: async (n: number) => { await flush(); return studioApi.restore(session.id, n); },
    onSuccess: (r) => {
      onContent(r.content, r.revision);
      notify.success(session.document_id ? 'Restored here; save to the library to make it the next version.' : 'Kept as a new revision, so nothing is lost.', { title: 'Revision restored', duration: 6000 });
    },
    onError: (e, n) => notify.error(e, { title: 'Could not restore it', retry: canRetry(e) ? () => restore.mutate(n) : undefined }),
  });
  const base = revisions.data?.base_label ?? session.base_label;

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="flex items-center gap-1">
        <h3 className="text-[15px] font-semibold text-[#1f2933]">Changes</h3>
        <InfoTip label="About the revisions" text="Revisions of the working document (“rev N”, not the library’s versions): every save, every accepted Comply Agent change, the file as it was opened. Read any as a redline against the next one or the current text, or restore it." />
      </div>
      <div className="mt-2 space-y-1.5">
        <button type="button" onClick={() => onCompare({ type: 'revision', from: 0, label: base ? `Changes since “${base}”` : 'Changes since the start' })} className={PICK_ROW}>
          <GitCompare aria-hidden className="h-4 w-4 shrink-0 text-ds-primary-text" />
          <span className="min-w-0"><span className="block text-ds-body font-medium text-ds-fg">Since the start</span>{base && <span className="block truncate text-ds-label text-ds-fg-muted" title={`Starting point: ${base}`}>{base}</span>}</span>
        </button>
      </div>

      <div className="mt-4 rounded-ds-card border border-ds-border bg-ds-surface p-2.5">
        <div className="flex items-center gap-1">
          <p className="text-ds-body font-[600] text-ds-fg">Compare with file</p>
          <InfoTip label="About comparing with a file" text="Any Word, PDF, text, Markdown or HTML file. It is also kept with this session as a reference." />
        </div>
        <input ref={file} type="file" hidden aria-label="Choose a file to compare with" accept=".docx,.pdf,.txt,.md,.markdown,.html,.htm" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadToCompare.mutate(f); e.target.value = ''; }} />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Button leftIcon={<Upload aria-hidden />} loading={uploadToCompare.isPending} onClick={() => file.current?.click()}>Choose file</Button>
          {session.references.filter((r) => r.kind !== 'framework').map((r) => (
            <Button key={r.id} leftIcon={<GitCompare aria-hidden />} onClick={() => onCompare({ type: 'reference', id: r.id, title: r.title })} title={`Compare with ${r.key}`}>
              <span className="max-w-[12rem] truncate">{r.key} · {r.title}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-ds-card border border-ds-border bg-ds-surface p-2.5">
        <p className="text-ds-body font-[600] text-ds-fg">Compare with document</p>
        <div className="mt-1.5">
          <TextInput type="search" aria-label="Search the library" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents" leftAdornment={<Search aria-hidden />} />
        </div>
        <ul className="mt-1.5 max-h-44 space-y-1 overflow-y-auto">
          {docs.isLoading && <li><SkeletonRows rows={3} columns={1} label="Loading the library" /></li>}
          {docs.isError && !docs.data && <li><ErrorState compact title="Couldn't load the library" message={errorMessage(docs.error)} onRetry={canRetry(docs.error) ? () => { void docs.refetch(); } : undefined} /></li>}
          {docs.data?.items.filter((d) => d.id !== session.document_id && (d.has_text || d.has_file)).map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => onCompare({ type: 'document', id: d.id, title: d.title })} className={PICK_ROW}>
                <span className="min-w-0 flex-1"><span className="block truncate text-ds-body text-ds-fg" title={d.title}>{d.title}</span><span className="block text-ds-label text-ds-fg-muted">{docLine(d, DOC_TYPE_LABEL, SIGNOFF_STATUS)}</span></span>
                <GitCompare aria-hidden className="h-4 w-4 shrink-0 text-ds-primary-text" />
              </button>
            </li>
          ))}
          {docs.data && docs.data.items.length === 0 && <li className="p-2 text-ds-label text-ds-fg-muted">No documents</li>}
        </ul>
      </div>

      <h4 className="mb-1.5 mt-5 text-ds-body font-[600] text-ds-fg">Revisions {revisions.data ? `(${revisions.data.items.length})` : ''}</h4>
      {revisions.isLoading && <SkeletonRows rows={3} columns={1} label="Loading the revisions" />}
      {revisions.isError && !revisions.data && <ErrorState compact title="Couldn't load the revisions" message={errorMessage(revisions.error)} onRetry={canRetry(revisions.error) ? () => { void revisions.refetch(); } : undefined} />}
      <ol className="space-y-1.5">
        {revisions.data?.items.map((r) => {
          const a = AUTHOR[r.author_type] ?? AUTHOR.user;
          const current = r.number === session.revision;
          return (
            <li key={r.number} className={`rounded-ds-card border bg-ds-surface p-2.5 ${current ? 'border-ds-primary' : 'border-ds-border'}`}>
              <div className="flex items-center gap-2 text-ds-label">
                <span className="rounded bg-ds-primary-soft px-1.5 py-0.5 font-[700] text-ds-primary-text">rev {r.number}</span>
                <span className="inline-flex items-center gap-1 text-ds-fg-body">{r.author_type === 'user' ? <User aria-hidden className="h-3 w-3" /> : <a.icon aria-hidden className="h-3 w-3" />} {r.author_type === 'user' && r.author ? r.author : a.label}</span>
                {current && <span className="rounded-full bg-ds-primary-soft px-1.5 py-0.5 text-ds-label font-[600] text-ds-primary-text">current</span>}
                <span className="ml-auto text-ds-fg-muted">{ago(r.created_at)}</span>
              </div>
              <p className="mt-1 text-ds-body text-ds-fg">{r.summary}</p>
              <p className="mt-0.5 text-ds-label text-ds-fg-muted">{plural(r.words, 'word')}{r.stats && (r.stats.words_added || r.stats.words_removed) ? ` · +${r.stats.words_added} / −${r.stats.words_removed}` : ''}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {r.number > 1 && (
                  <Button variant="link" size="sm" onClick={() => onCompare({ type: 'revision', from: r.number - 1, to: r.number, label: `What rev ${r.number} changed` })} title="What this revision changed">What changed</Button>
                )}
                {!current && (
                  <>
                    <Button variant="link" size="sm" onClick={() => onCompare({ type: 'revision', from: r.number, label: `Changes since rev ${r.number}` })} title="What changed since this revision">Since then</Button>
                    <Button size="sm" leftIcon={<RotateCcw aria-hidden />} loading={restore.isPending && restore.variables === r.number} disabled={restore.isPending} onClick={() => restore.mutate(r.number)}>Restore</Button>
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
