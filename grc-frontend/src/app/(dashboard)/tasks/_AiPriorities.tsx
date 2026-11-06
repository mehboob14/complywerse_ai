'use client';

// AI Reprioritize: the AI looks at the board and suggests a priority for the tasks it would change; the person reads each suggestion in a dialog and applies them all or discards. The calls are the
// old ones (aiPrioritize, then one update per suggestion with just the priority). What changed is what they say: a failed request is a message with Retry (it used to be swallowed), and applying says
// how many priorities changed and how many could not, instead of closing as if all had worked.
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { criticalTasksApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, EmptyState, useNotify, useReportedMutation } from '@/components/ui/ds';
import { PriorityPill } from './_ui';

interface Suggestion { task_id?: number; current_priority?: string; suggested_priority?: string; justification?: string }

export function AiPriorities() {
  const notify = useNotify();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  const ask = useReportedMutation({
    mutationFn: () => criticalTasksApi.aiPrioritize(),
    success: 'Done',                                                   // not used: the dialog opens with the answer
    failure: "AI couldn't suggest priorities",
    toast: 'errors',
    onSuccess: (res) => setSuggestions(((res.data as { suggestions?: Suggestion[] } | undefined)?.suggestions) ?? []),
  });

  const apply = useReportedMutation({
    mutationFn: async (list: Suggestion[]) => {
      let changed = 0;
      let failed = 0;
      let last: unknown = null;
      for (const s of list) {
        if (!s.task_id || !s.suggested_priority) continue;
        try {
          await criticalTasksApi.update(s.task_id, { priority: s.suggested_priority });
          changed += 1;
        } catch (error) {
          failed += 1;
          last = error;
        }
      }
      if (changed === 0 && failed > 0) throw last;                      // nothing worked: say so with the server's words and offer Retry
      return { changed, failed };
    },
    success: 'Done',                                                   // not used: the words depend on how many worked
    failure: "Couldn't change the priorities",
    invalidate: [['critical-tasks']],
    toast: 'errors',
    onSuccess: ({ changed, failed }) => {
      const tasks = (n: number) => `${n} task${n === 1 ? '' : 's'}`;
      if (failed > 0) notify.warning(`${tasks(failed)} could not be changed. Open the board and change ${failed === 1 ? 'it' : 'them'} by hand.`, { title: `Changed the priority of ${tasks(changed)}` });
      else notify.success(`Changed the priority of ${tasks(changed)}`);
      setSuggestions(null);
    },
  });

  const list = suggestions ?? [];
  return (
    <>
      <Button leftIcon={<Sparkles aria-hidden />} loading={ask.isPending} onClick={() => ask.mutate()}>AI Reprioritize</Button>
      <AnimatedModal
        isOpen={suggestions !== null}
        onClose={() => setSuggestions(null)}
        title="AI priority suggestions"
        subtitle="Read each suggestion, then apply them all or discard."
        size="2xl"
        footer={list.length > 0 ? (
          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => setSuggestions(null)}>Discard</Button>
            <Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate(list)}>{`Apply all (${list.length})`}</Button>
          </div>
        ) : undefined}
      >
        <div className="flex flex-col gap-[12px] p-[16px]">
          {list.length === 0 ? (
            <EmptyState bare kind="firstUse" title="Every task is already prioritized well" info="The AI found no task whose priority it would change." />
          ) : list.map((s, i) => (
            <article key={s.task_id ?? i} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
              <div className="flex flex-wrap items-center gap-[8px]">
                {s.task_id ? <Link href={`/tasks/${s.task_id}`} className="rounded-ds-control text-ds-body font-[600] text-ds-primary-text underline-offset-[2px] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">Task #{s.task_id}</Link> : <span className="text-ds-body text-ds-fg-muted">A task</span>}
                <PriorityPill word={s.current_priority} />
                <ArrowRight aria-label="changes to" className="h-[16px] w-[16px] text-ds-fg-muted" />
                <PriorityPill word={s.suggested_priority} />
              </div>
              {s.justification && <p className="mt-[8px] text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">{s.justification}</p>}
            </article>
          ))}
        </div>
      </AnimatedModal>
    </>
  );
}
