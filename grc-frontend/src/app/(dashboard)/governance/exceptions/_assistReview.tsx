'use client';

// AI for the people who judge an exception (D62): "Suggest risks" drafts a short summary to decide on and the potential risks the exception could carry. It runs only
// when the button is pressed (nothing here fetches on its own), saves nothing, and a suggestion becomes a recorded risk only when the person presses Add (it is then
// marked as AI-suggested). Also the little state machine the other AI helper of the details uses (the controls'): useAiRun, which keeps what _Suggest.tsx keeps of a run:
// idle, loading, done, or failed with the server's own sentence (AI is not configured: 503; its answer could not be used: 502; the guard refused: 403) and a Retry.
import { useRef, useState, type ReactNode } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { policyExceptionApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, SkeletonLines, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { levelPill, levelsLine, ratingOf, type ScaleWords } from './_riskText';
import { LIST_KEYS, type AiRisksAnswer } from './_types';

export type AiRun<T> = { status: 'idle' } | { status: 'loading' } | { status: 'done'; data: T } | { status: 'failed'; error: unknown };

/** One AI request at a time, started by `ask` and by nothing else; an answer for a request that has since been replaced or cleared is dropped. */
export function useAiRun<T>(call: () => Promise<{ data: T }>) {
  const [run, setRun] = useState<AiRun<T>>({ status: 'idle' });
  const latest = useRef(0);
  const ask = async () => {
    const mine = ++latest.current;
    setRun({ status: 'loading' });
    try {
      const res = await call();
      if (mine === latest.current) setRun({ status: 'done', data: res.data });
    } catch (error) {
      if (mine === latest.current) setRun({ status: 'failed', error });
    }
  };
  const clear = () => { latest.current += 1; setRun({ status: 'idle' }); };
  return { run, ask, clear };
}

/** What a run shows under its button: a skeleton while it works, the server's sentence with Retry when it failed, the answer when it is there. Read out as it appears. */
export function AiBox<T>({ run, label, onRetry, children }: { run: AiRun<T>; label: string; onRetry: () => void; children: (data: T) => ReactNode }) {
  return (
    <div aria-live="polite" className="empty:hidden">
      {run.status === 'loading' && <SkeletonLines lines={3} label={label} />}
      {run.status === 'failed' && (
        <ErrorState compact title="Couldn't get suggestions" message={errorMessage(run.error)} onRetry={canRetry(run.error) ? onRetry : undefined} />
      )}
      {run.status === 'done' && children(run.data)}
    </div>
  );
}

const CAPTION = 'text-ds-label text-ds-fg-muted';

/** "Suggest risks" for the person asked at the open step: the summary to decide on, and the suggestions each with Add. */
export function RiskHelper({ exceptionId, words }: { exceptionId: number; words: ScaleWords }) {
  const { run, ask, clear } = useAiRun<AiRisksAnswer>(() => policyExceptionApi.aiRisks(exceptionId));
  const [added, setAdded] = useState<number[]>([]);
  const add = useReportedMutation({
    mutationFn: ({ suggestion }: { index: number; suggestion: AiRisksAnswer['risks'][number] }) =>
      policyExceptionApi.addRisk(exceptionId, { title: suggestion.title, description: suggestion.description, likelihood: suggestion.likelihood, impact: suggestion.impact, source: 'ai' }),
    success: 'Risk added',
    failure: 'Risk not added',
    invalidate: LIST_KEYS,
    onSuccess: (_risk, { index }) => setAdded((a) => [...a, index]),
  });

  return (
    <div className="flex flex-col gap-[8px]">
      <span className="inline-flex items-center gap-1">
        <Button leftIcon={<Sparkles aria-hidden />} loading={run.status === 'loading'} onClick={() => { setAdded([]); void ask(); }}>Suggest risks</Button>
        <InfoTip label="About suggesting risks" text="AI drafts a summary and possible risks from this exception, its document and its assets. Nothing is saved until you add a risk." />
      </span>
      <AiBox run={run} label="AI is drafting risks" onRetry={() => { void ask(); }}>
        {(data) => (
          <div className="flex flex-col gap-[8px]">
            <div className="rounded-ds-card border border-ds-border p-[12px]">
              <span className={CAPTION}>Summary</span>
              <p className="mt-[2px] whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{data.summary}</p>
            </div>
            <ul aria-label="Suggested risks" className="flex flex-col gap-[8px]">
              {data.risks.map((s, i) => {
                const pill = levelPill(ratingOf(s.likelihood, s.impact));
                const done = added.includes(i);
                return (
                  <li key={i} className="flex flex-wrap items-start gap-x-[12px] gap-y-[8px] rounded-ds-card bg-ds-surface-subtle p-[10px]">
                    <div className="min-w-0 flex-1 basis-[14rem]">
                      <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                        <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{s.title}</span>
                        {pill && <StatusPill size="sm" {...pill} />}
                      </div>
                      <span className={CAPTION}>{levelsLine({ likelihood: s.likelihood, impact: s.impact, likelihood_label: words.likelihood[s.likelihood] ?? null, impact_label: words.impact[s.impact] ?? null })}</span>
                      {s.description && <p className="mt-[2px] whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{s.description}</p>}
                    </div>
                    <Button size="sm" leftIcon={done ? undefined : <Plus aria-hidden />} disabled={done} loading={add.isPending && add.variables?.index === i}
                      aria-label={`${done ? 'Added' : 'Add risk'}: ${truncate(s.title, 50).text}`} onClick={() => add.mutate({ index: i, suggestion: s })}>
                      {done ? 'Added' : 'Add'}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div><Button variant="link" size="sm" onClick={clear}>Hide suggestions</Button></div>
          </div>
        )}
      </AiBox>
    </div>
  );
}
