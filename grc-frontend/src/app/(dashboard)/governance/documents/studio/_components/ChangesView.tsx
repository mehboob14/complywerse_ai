'use client';

/**
 * The redline reading view, in place of the editor: what changed between two versions of the document (where the session
 * started, any revision, what accepting the AI's proposals would do), or how it differs from another document of the library,
 * with an AI explanation of the differences that matter when asked.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { problemOf, studioApi, type Message, type Session } from '@/lib/studio/api';
import { useToast } from '@/components/ui/ToastProvider';
import RedlineView, { StatsLine } from './RedlineView';

export type CompareSpec =
  | { type: 'revision'; from: number; to?: number; label: string }
  | { type: 'document'; id: number; title: string }
  | { type: 'preview'; messageId: number };

const IMPORTANCE: Record<string, string> = { high: 'bg-[#fbdcdc] text-[#9b1c1c]', medium: 'bg-[#fff2a8] text-[#6b5400]', low: 'bg-[#e3f1f1] text-[#0f4c5c]' };

export default function ChangesView({ session, spec, aiConfigured, onClose }: { session: Session; spec: CompareSpec; aiConfigured: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [ai, setAi] = useState<Message | null>(null);
  const [asking, setAsking] = useState(false);

  const key = ['studio', 'changes', session.id, session.revision, JSON.stringify(spec)];
  const redline = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (spec.type === 'preview') return studioApi.preview(session.id, spec.messageId);
      if (spec.type === 'document') return studioApi.compare(session.id, { document_id: spec.id });
      return studioApi.diff(session.id, spec.from, spec.to ?? session.revision);
    },
    staleTime: 10_000,
  });

  useEffect(() => { setAi(null); }, [spec]);
  useEffect(() => {
    if (!ai || ai.status !== 'working') return;
    const t = setInterval(async () => {
      try {
        const m = await studioApi.message(session.id, ai.id);
        setAi(m);
        if (m.status !== 'working') clearInterval(t);
        if (m.status === 'error') toast({ title: 'The AI could not compare the documents', message: m.error ?? undefined, type: 'error' });
      } catch { /* next tick */ }
    }, 1500);
    return () => clearInterval(t);
  }, [ai, session.id, toast]);

  const explain = async () => {
    if (spec.type !== 'document') return;
    setAsking(true);
    try {
      const r = await studioApi.compare(session.id, { document_id: spec.id, ai: true });
      if (r.ai_message) setAi(r.ai_message);
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: 'The AI could not start', message: problemOf(e), type: 'error' });
    } finally {
      setAsking(false);
    }
  };

  const title = spec.type === 'preview' ? 'What accepting the AI’s changes would do' : spec.type === 'document' ? `This document compared with “${spec.title}”` : spec.label;
  const hint = spec.type === 'document' ? 'Green is in this document and not in the other; red is in the other and not here.' : spec.type === 'preview' ? 'Nothing is changed until you accept.' : 'Green was added, red was removed.';
  const diffs = ai?.status === 'done' ? ai.proposal?.differences ?? [] : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#eef1f4]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#d5dbe1] bg-white px-3 py-2">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#0b6b58] hover:bg-[#e6f4f1]"><ArrowLeft className="h-3.5 w-3.5" /> Back to the document</button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#1f2933]" title={title}>{title}</p>
          <p className="text-[11px] text-[#586472]">{redline.data ? <><StatsLine stats={redline.data.stats} /> · </> : null}{hint}</p>
        </div>
        {spec.type === 'document' && (
          <button type="button" onClick={explain} disabled={!aiConfigured || asking || ai?.status === 'working'} title={aiConfigured ? undefined : 'The AI is not connected yet'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50">
            {asking || ai?.status === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {ai?.status === 'working' ? ai.stage ?? 'Comparing' : 'Explain the differences'}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-[900px] space-y-4">
          {ai?.status === 'done' && (
            <section className="rounded-xl border border-[#9fd9bd] bg-white p-4" aria-label="AI comparison">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#1f2933]"><Sparkles className="h-4 w-4 text-[#0f766e]" /> What differs in substance</h3>
              {ai.content && <p className="mt-1.5 text-sm text-[#26323d]">{ai.content}</p>}
              {diffs.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {diffs.map((d, i) => (
                    <li key={i} className="rounded-lg border border-[#e1e5e9] p-2.5 text-[13px]">
                      <div className="flex items-center gap-2"><span className="font-semibold text-[#1f2933]">{d.topic}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${IMPORTANCE[d.importance] ?? ''}`}>{d.importance}</span></div>
                      <dl className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                        <div><dt className="text-[11px] font-semibold uppercase text-[#586472]">This document</dt><dd className="text-[#26323d]">{d.in_a || '—'}</dd></div>
                        <div><dt className="text-[11px] font-semibold uppercase text-[#586472]">{spec.type === 'document' ? spec.title : 'Other'}</dt><dd className="text-[#26323d]">{d.in_b || '—'}</dd></div>
                      </dl>
                      {d.recommendation && <p className="mt-1.5 text-xs text-[#0b6b58]">Suggestion: {d.recommendation}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {ai.proposal?.recommendation && <p className="mt-3 rounded bg-[#f3fbf9] p-2 text-sm text-[#0b5f58]">{ai.proposal.recommendation}</p>}
            </section>
          )}
          {ai?.status === 'error' && <p className="rounded-lg border border-[#f1b5b5] bg-[#fdf3f3] p-3 text-sm text-[#8a1c1c]" role="alert">{ai.error}</p>}
          <section className="rounded-xl border border-[#d5dbe1] bg-white p-3 sm:p-5" aria-label="Changes">
            {redline.isLoading && <p className="text-sm text-[#586472]"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Comparing…</p>}
            {redline.isError && <p className="text-sm text-[#8a1c1c]" role="alert">{problemOf(redline.error)}</p>}
            {redline.data && <RedlineView rows={redline.data.rows} empty={spec.type === 'document' ? 'The two documents have the same blocks.' : 'Nothing changed.'} />}
          </section>
        </div>
      </div>
    </div>
  );
}
