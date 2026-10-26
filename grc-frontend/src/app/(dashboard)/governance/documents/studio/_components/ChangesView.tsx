'use client';

/**
 * The redline reading view, in place of the editor: what changed between two versions of the document (where the session
 * started, any revision, what accepting the AI's proposals would do), or how it differs from another document of the library,
 * with an AI explanation of the differences that matter when asked.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import type { ChainHunk } from '@/lib/documentChain';
import { problemOf, studioApi, type Message, type Session } from '@/lib/studio/api';
import { useToast } from '@/components/ui/ToastProvider';
import { maySaveToLibrary } from '@/lib/studio/text';
import RedlineView, { StatsLine, type Focus } from './RedlineView';

export type CompareSpec =
  | { type: 'revision'; from: number; to?: number; label: string; focus?: Focus }
  // since the version in force, or the original until the document is published (GET …/tracked)
  | { type: 'tracked'; focus?: Focus }
  | { type: 'document'; id: number; title: string }
  | { type: 'reference'; id: number; title: string }              // a file the person uploaded (kept with the session as a reference)
  | { type: 'preview'; messageId: number };

const IMPORTANCE: Record<string, string> = { high: 'bg-[#fbdcdc] text-[#9b1c1c]', medium: 'bg-[#fff2a8] text-[#6b5400]', low: 'bg-[#e3f1f1] text-[#0f4c5c]' };

export default function ChangesView({ session, spec, aiConfigured, onClose, flush, onContent, onShowSource }: {
  session: Session; spec: CompareSpec; aiConfigured: boolean; onClose: () => void;
  /** save what the person has typed before something is taken back */
  flush?: () => Promise<void>;
  /** the document's new text after a change was taken back */
  onContent?: (content: string, revision: number) => void;
  onShowSource?: (ref: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [ai, setAi] = useState<Message | null>(null);
  const [asking, setAsking] = useState(false);

  // the change to bring into view is not part of what is compared
  const { focus, ...shape } = spec as CompareSpec & { focus?: Focus };
  const key = ['studio', 'changes', session.id, session.revision, JSON.stringify(shape)];
  const redline = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (spec.type === 'preview') return studioApi.preview(session.id, spec.messageId);
      if (spec.type === 'tracked') {
        try {
          return await studioApi.tracked(session.id);
        } catch (e) {     // a server from before GET …/tracked: since where the session started
          if ((e as { response?: { status?: number } })?.response?.status !== 404) throw e;
          return { ...(await studioApi.diff(session.id, 0, session.revision)), label: session.base_label ? `Changes since “${session.base_label}”` : 'Changes since the start' };
        }
      }
      if (spec.type === 'document') return studioApi.compare(session.id, { document_id: spec.id });
      if (spec.type === 'reference') return studioApi.compare(session.id, { reference_id: spec.id });
      return studioApi.diff(session.id, spec.from, spec.to ?? session.revision);
    },
    staleTime: 10_000,
  });

  const takeBack = useMutation({
    mutationFn: async (h: ChainHunk) => {
      await flush?.();
      return studioApi.revertChanges(session.id, { frm: spec.type === 'revision' ? spec.from : redline.data?.from ?? 0, hunks: [h.id], hash: redline.data?.hash,
                                                    version_id: spec.type === 'tracked' ? redline.data?.from_version_id ?? undefined : undefined });
    },
    onSuccess: (r) => {
      onContent?.(r.content, r.revision);
      qc.invalidateQueries({ queryKey: ['studio', 'changes', session.id] });
      qc.invalidateQueries({ queryKey: ['studio', 'revisions', session.id] });
      qc.invalidateQueries({ queryKey: ['studio', 'messages', session.id] });          // the cards of the changes that were taken back
      toast({ title: 'Change taken back', type: 'success',
              message: session.document_id && maySaveToLibrary(session) ? 'Taken back here; save to the library to make it the next version.' : 'Kept as a new revision, so nothing is lost.' });
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['studio', 'changes', session.id] });
      toast({ title: 'Could not take it back', message: problemOf(e), type: 'error' });
    },
  });

  useEffect(() => { setAi(null); }, [spec]);
  useEffect(() => {
    if (!ai || ai.status !== 'working') return;
    const t = setInterval(async () => {
      try {
        const m = await studioApi.message(session.id, ai.id);
        setAi(m);
        if (m.status !== 'working') clearInterval(t);
        if (m.status === 'error') toast({ title: 'Could not compare the documents', message: m.error ?? undefined, type: 'error' });
      } catch { /* next tick */ }
    }, 1500);
    return () => clearInterval(t);
  }, [ai, session.id, toast]);

  const explain = async () => {
    if (spec.type !== 'document' && spec.type !== 'reference') return;
    setAsking(true);
    try {
      const r = await studioApi.compare(session.id, spec.type === 'document' ? { document_id: spec.id, ai: true } : { reference_id: spec.id, ai: true });
      if (r.ai_message) setAi(r.ai_message);
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: 'Could not start the comparison', message: problemOf(e), type: 'error' });
    } finally {
      setAsking(false);
    }
  };

  const other = spec.type === 'document' || spec.type === 'reference';
  const title = spec.type === 'preview' ? 'Preview of the proposed changes' : other ? `Compared with “${spec.title}”`
    : spec.type === 'tracked' ? redline.data?.label ?? 'Tracked changes' : spec.label;
  // the legend of the colours; a preview says it applied nothing
  const hint = other ? 'Green: only here · red: only in the other' : spec.type === 'preview' ? 'Nothing changes until you accept' : 'Green added · red removed';
  const diffs = ai?.status === 'done' ? ai.proposal?.differences ?? [] : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#eef1f4]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#d5dbe1] bg-[#fff] px-3 py-2">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#0f766e] hover:bg-[#f0fdfa]"><ArrowLeft className="h-3.5 w-3.5" /> Back to document</button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#1f2933]" title={title}>{title}</p>
          <p className="text-xs text-[#586472]">{redline.data ? <><StatsLine stats={redline.data.stats} /> · </> : null}{hint}</p>
        </div>
        {other && (
          <button type="button" onClick={explain} disabled={!aiConfigured || asking || ai?.status === 'working'} aria-label={ai?.status === 'working' ? undefined : 'Ask Comply Agent to explain'}
            title={aiConfigured ? 'Ask Comply Agent to explain what differs in substance' : 'Comply Agent is not connected yet'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-2.5 py-1.5 text-xs font-semibold text-[#fff] hover:bg-[#115e59] disabled:opacity-50">
            {asking || ai?.status === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {ai?.status === 'working' ? ai.stage ?? 'Comparing' : 'Explain'}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-[900px] space-y-4">
          {ai?.status === 'done' && (
            <section className="rounded-xl border border-[#9fd9bd] bg-[#fff] p-4" aria-label="Comply Agent’s comparison">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#1f2933]"><Sparkles className="h-4 w-4 text-[#0f766e]" /> Key differences</h3>
              {ai.content && <p className="mt-1.5 text-sm text-[#26323d]">{ai.content}</p>}
              {diffs.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {diffs.map((d, i) => (
                    <li key={i} className="rounded-lg border border-[#e1e6eb] p-2.5 text-[13px]">
                      <div className="flex items-center gap-2"><span className="font-semibold text-[#1f2933]">{d.topic}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${IMPORTANCE[d.importance] ?? ''}`}>{d.importance}</span></div>
                      <dl className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                        <div><dt className="text-xs font-semibold text-[#586472]">This document</dt><dd className="text-[#26323d]">{d.in_a || '—'}</dd></div>
                        <div><dt className="text-xs font-semibold text-[#586472]">{spec.type === 'document' || spec.type === 'reference' ? spec.title : 'Other'}</dt><dd className="text-[#26323d]">{d.in_b || '—'}</dd></div>
                      </dl>
                      {d.recommendation && <p className="mt-1.5 text-xs text-[#0f766e]">Suggestion: {d.recommendation}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {ai.proposal?.recommendation && <p className="mt-3 rounded bg-[#f3fbf9] p-2 text-sm text-[#0b5f58]">{ai.proposal.recommendation}</p>}
            </section>
          )}
          {ai?.status === 'error' && <p className="rounded-lg border border-[#f1b5b5] bg-[#fdf3f3] p-3 text-sm text-[#8a1c1c]" role="alert">{ai.error}</p>}
          <section className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-3 sm:p-5" aria-label="Changes">
            {redline.isLoading && <p role="status" className="relative text-[#586472]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /><span className="sr-only">Comparing</span></p>}
            {redline.isError && <p className="text-sm text-[#8a1c1c]" role="alert">{problemOf(redline.error)}</p>}
            {redline.data && (
              <RedlineView rows={redline.data.rows} empty={other ? 'No differences' : 'No changes'} focus={focus}
                changes={redline.data.hunks && (spec.type === 'revision' || spec.type === 'tracked') ? {
                  hunks: redline.data.hunks, canRevert: !!redline.data.can_revert && !!onContent, whyNot: redline.data.can_revert ? null : 'Only changes since an earlier version of the document as it is now can be taken back.',
                  busyId: takeBack.isPending ? takeBack.variables?.id ?? null : null, onRevert: (h) => takeBack.mutate(h), onShowSource,
                } : undefined} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
