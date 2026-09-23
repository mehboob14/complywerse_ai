'use client';

/**
 * AI evidence recommendations for one assessment item, shown in its Evidence
 * panel on every Cyber Security assessment (OWASP ASVS, OWASP testing, mobile,
 * and the maturity tools). What evidence proves the item and how to collect
 * it, plus the records already in the Evidence library that fit, each linkable
 * in one click. The last result is kept on the item, so reopening shows it
 * without asking the AI again; Regenerate asks afresh.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Link2, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import apiClient from '@/lib/api';

type Recommendation = {
  evidence_type: string; description: string; how_to_collect?: string;
  priority: 'high' | 'medium' | 'low' | string; example_files?: string[];
};
type Match = {
  evidence_id: number; name: string; file_name?: string | null; evidence_type?: string | null;
  status?: string | null; reason?: string; confidence?: number;
};
type Result = {
  summary?: string; recommendations?: Recommendation[]; matches?: Match[]; library_checked?: number;
};
type Saved = { recommendation: Result | null; generated_at: string | null };

const PRIORITY: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700 ring-rose-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  low: 'bg-slate-50 text-slate-600 ring-slate-200',
};

export function AiEvidenceAdvisor({ assessmentId, itemId, autoRun = false, onLinked }: {
  assessmentId: number; itemId: number;
  /** Ask the AI straight away when nothing was recommended for this item yet. */
  autoRun?: boolean;
  /** After a library record is linked — the parent refreshes its evidence list. */
  onLinked?: () => void;
}) {
  const qc = useQueryClient();
  const key = ['ai-evidence-recommendation', assessmentId, itemId];
  const [error, setError] = useState('');
  const [linked, setLinked] = useState<Set<number>>(new Set());
  const asked = useRef(false);

  const saved = useQuery<Saved>({
    queryKey: key,
    queryFn: async () => (await apiClient.get(`/compliance/assessments/${assessmentId}/items/${itemId}/ai-recommendation`)).data,
    staleTime: 60_000,
  });
  const run = useMutation({
    mutationFn: async () =>
      (await apiClient.post(`/compliance/assessments/${assessmentId}/items/${itemId}/ai-recommendation`)).data as Saved,
    onSuccess: (data) => { setError(''); qc.setQueryData(key, data); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'AI evidence recommendations could not be generated.'),
  });
  const link = useMutation({
    mutationFn: async (evidenceId: number) =>
      (await apiClient.post(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence/link`, { evidence_id: evidenceId })).data,
    onSuccess: (_data, evidenceId) => { setLinked((s) => new Set(s).add(evidenceId)); onLinked?.(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not link that evidence.'),
  });

  const result = saved.data?.recommendation || null;
  const has = !!(result && ((result.recommendations?.length || 0) > 0 || (result.matches?.length || 0) > 0));
  useEffect(() => {
    if (autoRun && !asked.current && saved.isSuccess && !has && !run.isPending) {
      asked.current = true;
      run.mutate();
    }
  }, [autoRun, saved.isSuccess, has]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = (result?.matches || []).filter((m) => !linked.has(m.evidence_id));
  const when = saved.data?.generated_at ? new Date(saved.data.generated_at).toLocaleString() : null;

  return (
    <div className="mb-3 rounded-lg border border-violet-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-violet-100 px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-violet-600" />
        <span className="mr-auto text-[11px] font-semibold uppercase tracking-wide text-violet-700">AI evidence recommendations</span>
        {when && !run.isPending && <span className="text-[10px] text-slate-400">{when}</span>}
        <button type="button" onClick={() => run.mutate()} disabled={run.isPending || saved.isLoading}
                className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60">
          {run.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : has ? <RefreshCw className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
          {run.isPending ? 'Working…' : has ? 'Regenerate' : 'Get recommendations'}
        </button>
      </div>

      <div className="space-y-2.5 px-3 py-2.5">
        {error && <p className="rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700">{error}</p>}
        {run.isPending && (
          <p className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
            Working out what evidence proves this item and checking your evidence library…
          </p>
        )}
        {!run.isPending && !has && !error && (
          <p className="text-[11.5px] text-slate-500">
            Ask the AI which evidence proves this item, how to collect it, and which records you already have that fit.
          </p>
        )}

        {!run.isPending && result && has && (
          <>
            {result.summary && <p className="text-[12px] text-slate-700">{result.summary}</p>}

            {matches.length > 0 && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-2">
                <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-700">
                  Already in your evidence library
                </p>
                <ul className="space-y-1.5">
                  {matches.map((m) => (
                    <li key={m.evidence_id} className="flex items-start gap-2">
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-slate-800" title={m.file_name || m.name}>
                          {m.name}
                          {m.confidence != null && (
                            <span className="ml-1.5 text-[10px] font-normal text-slate-400">{Math.round(m.confidence * 100)}% fit</span>
                          )}
                        </p>
                        {m.reason && <p className="text-[11px] text-slate-500">{m.reason}</p>}
                      </div>
                      <button type="button" onClick={() => link.mutate(m.evidence_id)}
                              disabled={link.isPending && link.variables === m.evidence_id}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">
                        {link.isPending && link.variables === m.evidence_id
                          ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Link
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {linked.size > 0 && (
              <p className="flex items-center gap-1 text-[11px] text-emerald-700">
                <Check className="h-3 w-3" /> {linked.size} record{linked.size === 1 ? '' : 's'} linked to this item.
              </p>
            )}

            {(result.recommendations || []).length > 0 && (
              <ol className="space-y-2">
                {(result.recommendations || []).map((rec, i) => (
                  <li key={i} className="rounded-md border border-slate-200 p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-slate-900">{i + 1}. {rec.evidence_type}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase ring-1 ${PRIORITY[rec.priority] || PRIORITY.medium}`}>
                        {rec.priority}
                      </span>
                    </div>
                    {rec.description && <p className="mt-0.5 text-[11.5px] text-slate-600">{rec.description}</p>}
                    {rec.how_to_collect && (
                      <p className="mt-1 text-[11.5px] text-slate-600">
                        <span className="font-semibold text-slate-700">How to collect: </span>{rec.how_to_collect}
                      </p>
                    )}
                    {(rec.example_files || []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(rec.example_files || []).map((f) => (
                          <span key={f} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{f}</span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <p className="text-[10px] text-slate-400">
              AI suggestions: check each one fits before relying on it.
              {result.library_checked != null && ` ${result.library_checked} library record${result.library_checked === 1 ? '' : 's'} checked.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
