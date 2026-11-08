'use client';

// The rows of an AI suggestion sheet (AI Reprioritize, Balance workload): one row per suggestion, named by the task's title with a link to open it, what would change, the AI's reason and an Apply
// button of its own; "Apply all" is the sheet's footer. What each row did is said on the row (Applied, or why not, with the server's words) and in one message when it is over; a row that worked
// stays in the list as Applied (the list is the answer as it arrived, it is not read again after the writes). The write of ONE suggestion is the caller's (`run`: the old calls, unchanged); the
// words around it, the outcomes and the refresh of everything that shows a task are here. A write goes through useReportedMutation: when none of the rows could be written the failure is the
// mutation's, with Retry; when some were, the row says so and a warning says how many.
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Button, useNotify, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { TASK_REFRESH } from '../_register/taskData';

export interface SuggestionItem {
  /** one per task */
  key: string;
  taskId: number;
  /** the task's own title; null when the list does not hold it */
  title: string | null;
  /** what would change: "Low -> Critical" as pills, or "Ada to Bo" */
  change: ReactNode;
  reason: string;
}

/** '' is Applied; anything else is the words of the failure */
export type Outcomes = Record<string, string>;

/** "1 task", "3 tasks" */
export const taskCount = (n: number): string => `${n} task${n === 1 ? '' : 's'}`;

/** Writes suggestions one by one. `run(item)` is one write; `done(n)` the message when n worked; `failed` the headline when none could be written. */
export function useApplyRows<T extends { key: string }>({ run, done, failed }: { run: (item: T) => Promise<unknown>; done: (n: number) => string; failed: string }) {
  const notify = useNotify();
  const [outcomes, setOutcomes] = useState<Outcomes>({});
  const mutation = useReportedMutation({
    mutationFn: async (items: T[]) => {
      const result: Outcomes = {};
      let last: unknown = null;
      for (const item of items) {
        try {
          await run(item);
          result[item.key] = '';
        } catch (error) {
          last = error;
          result[item.key] = errorMessage(error);
        }
      }
      setOutcomes((before) => ({ ...before, ...result }));
      if (items.length > 0 && Object.keys(result).every((k) => result[k] !== '')) throw last;       // nothing worked: say so with the server's words and offer Retry
      return result;
    },
    success: 'Done',                                                           // not used: the words depend on how many worked
    failure: failed,
    invalidate: TASK_REFRESH,
    toast: 'errors',
    onSuccess: (result) => {
      const keys = Object.keys(result);
      const bad = keys.filter((k) => result[k] !== '').length;
      const good = keys.length - bad;
      if (bad > 0) notify.warning(`${taskCount(bad)} could not be changed: the rows say why.`, { title: done(good) });
      else notify.success(done(good));
    },
  });
  return { outcomes, reset: () => setOutcomes({}), apply: (items: T[]) => mutation.mutate(items), pending: mutation.isPending, applying: (mutation.variables ?? []).map((i) => i.key) };
}

export function SuggestionRows({ items, outcomes, pending, applying, onApply }: {
  items: readonly SuggestionItem[];
  outcomes: Outcomes;
  pending: boolean;
  /** the keys of the rows being written now */
  applying: readonly string[];
  onApply: (key: string) => void;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
      {items.map((it) => {
        const outcome = outcomes[it.key];
        const applied = outcome === '';
        return (
          <li key={it.key} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
            <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[8px]">
              <Link href={`/tasks/${it.taskId}`} className="min-w-0 flex-1 basis-[12rem] rounded-ds-control text-ds-body font-[600] text-ds-primary-text underline-offset-[2px] [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
                {it.title ?? 'Open the task'}
              </Link>
              {applied ? (
                <span className="inline-flex min-h-ds-control items-center gap-[6px] text-ds-body font-[600] text-ds-success"><CheckCircle2 aria-hidden className="h-[16px] w-[16px]" /> Applied</span>
              ) : (
                <Button size="sm" aria-label={`Apply: ${it.title ?? 'this task'}`} loading={pending && applying.indexOf(it.key) >= 0} disabled={pending} onClick={() => onApply(it.key)}>{outcome ? 'Try again' : 'Apply'}</Button>
              )}
            </div>
            <div className="mt-[8px] flex flex-wrap items-center gap-[8px] text-ds-body text-ds-fg">{it.change}</div>
            {it.reason && <p className="mt-[8px] text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">{it.reason}</p>}
            {outcome ? <p role="alert" className="mt-[8px] text-ds-body text-ds-danger [overflow-wrap:anywhere]">Not applied: {outcome}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
