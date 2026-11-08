'use client';

// The AI explanation tab of an item: a plain-language reading of the item for someone who is not a risk specialist. The server keeps the last explanation with the item, so an item that has one
// shows it at once (no new request is made for it), and Refresh makes a new one after the item was edited. An item that has none waits for the person to ask: an explanation is a model call.
import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Button, FormError, Skeleton, SkeletonLines, useReportedMutation } from '@/components/ui/ds';
import { rcsaApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { itemsChanged } from './registerData';

interface Explanation { explanation: string; generated_at: string; from_cache: boolean }

export function ExplainTab({ templateId, rowId, cached }: { templateId: number; rowId: number; cached: boolean }) {
  const [result, setResult] = useState<Explanation | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const run = useReportedMutation({
    mutationFn: async (refresh: boolean) => (await rcsaApi.customTemplates.explainRow(templateId, rowId, refresh)).data as Explanation,
    failure: "The explanation couldn't be made",
    toast: 'none',
    invalidate: itemsChanged(templateId),
    onSuccess: (data) => { setProblem(null); setResult(data); },
    onError: (e) => setProblem(e),
  });
  // an item that already has an explanation shows it without asking for a new one
  useEffect(() => { if (cached && !result && !run.isPending && !problem) run.mutate(false); }, [cached]);   // eslint-disable-line react-hooks/exhaustive-deps
  const have = !!result?.explanation;
  return (
    <div className="flex flex-col gap-[12px]">
      <p className="text-ds-body text-ds-fg-muted">A plain-language summary of this item from Comply Agent, for someone who is not a risk specialist. It is kept with the item. Refresh it after you change the item.</p>
      <FormError title="The explanation couldn't be made" error={problem} onRetry={() => run.mutate(have)} />
      {run.isPending && !have && (cached ? <SkeletonLines lines={5} label="Loading the explanation" /> : <Skeleton className="h-[32px] w-[160px]" />)}
      {!have && !run.isPending && !cached && (
        <div><Button variant="primary" leftIcon={<Sparkles aria-hidden />} onClick={() => run.mutate(false)}>Explain with AI</Button></div>
      )}
      {have && (
        <>
          <article aria-live="polite" className="whitespace-pre-wrap break-words rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px] text-ds-body text-ds-fg [overflow-wrap:anywhere]">{result?.explanation}</article>
          <div className="flex flex-wrap items-center gap-[12px]">
            <Button leftIcon={<RefreshCw aria-hidden />} loading={run.isPending} onClick={() => run.mutate(true)}>Refresh</Button>
            <span className="text-ds-label text-ds-fg-muted">{`Written ${formatDateTime(result?.generated_at)}`}</span>
          </div>
        </>
      )}
    </div>
  );
}
