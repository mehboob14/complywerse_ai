'use client';

// AI Reprioritize: the AI looks at the open tasks and suggests a priority for the ones it would change. The answer opens in a sheet beside the page (it was a dialog over it): what the AI read in
// words (it reads the 50 open tasks created most recently and the old dialog never said so), then one row per suggestion named by the task's title, the priority it has now and the one suggested,
// the AI's reason and an Apply of its own; "Apply all" is the footer. A suggestion that would change nothing, or names something that is not one of the four priorities, is not offered. The calls
// are the old ones (aiPrioritize, then one update per suggestion with just the priority); a failed request is a message with Retry, and every row says whether it was applied. The All tasks register
// mounts the button; the rows and their writes are _insights/SuggestionRows.tsx, the sheet _insights/AiSheets.tsx.
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button, EmptyState, useReportedMutation } from '@/components/ui/ds';
import { criticalTasksApi } from '@/lib/api';
import { PriorityPill } from './_ui';
import { AiShell } from './_insights/AiSheets';
import { aiReach, priorityRows, type PriorityRow, type PrioritySuggestion } from './_insights/aiModel';
import { SuggestionRows, taskCount, useApplyRows, type SuggestionItem } from './_insights/SuggestionRows';
import { useLeanTasks } from './_register/taskData';

export function AiPriorities() {
  const lean = useLeanTasks();
  const rows = lean.data?.items;
  const loaded = useRef(rows);
  loaded.current = rows;
  const truncated = useRef(false);
  truncated.current = !!lean.data?.truncated;
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<PriorityRow[]>([]);

  const ask = useReportedMutation({
    mutationFn: () => criticalTasksApi.aiPrioritize(),
    success: 'Done',                                                   // not used: the sheet shows the answer, the wait and the failure
    failure: "AI couldn't suggest priorities",
    toast: 'none',
    onSuccess: (res) => setList(priorityRows((res.data as { suggestions?: PrioritySuggestion[] } | undefined)?.suggestions, loaded.current ?? [], !!loaded.current && !truncated.current)),
  });
  const writer = useApplyRows<PriorityRow>({
    run: (r) => criticalTasksApi.update(r.taskId, { priority: r.suggested }),
    done: (n) => `Changed the priority of ${taskCount(n)}`,
    failed: "Couldn't change the priorities",
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { writer.reset(); }, [list]);

  const items: SuggestionItem[] = list.map((r) => ({
    key: r.key, taskId: r.taskId, title: r.title, reason: r.reason,
    change: <><PriorityPill word={r.current} /><ArrowRight aria-label="changes to" className="h-[16px] w-[16px] text-ds-fg-muted" /><PriorityPill word={r.suggested} /></>,
  }));
  const todo = list.filter((r) => writer.outcomes[r.key] !== '');
  const close = () => setOpen(false);

  return (
    <>
      <Button leftIcon={<Sparkles aria-hidden />} onClick={() => { setOpen(true); setList([]); ask.mutate(); }}>AI Reprioritize</Button>
      <AiShell
        open={open} onClose={close} title="Priority suggestions" reach={aiReach('prioritize', rows ?? [], !!rows && !lean.data?.truncated)}
        pending={ask.isPending} error={ask.error} failure="AI couldn't suggest priorities" onRetry={() => ask.mutate()}
        footer={(
          <div className="flex items-center justify-end gap-[8px]">
            <Button onClick={close}>Close</Button>
            {todo.length > 0 && <Button variant="primary" loading={writer.pending && writer.applying.length > 1} disabled={writer.pending} onClick={() => writer.apply(todo)}>{`Apply all (${todo.length})`}</Button>}
          </div>
        )}
      >
        {list.length === 0
          ? <EmptyState bare kind="firstUse" title="Every task is already prioritized well" info="The AI found no task whose priority it would change." />
          : <SuggestionRows items={items} outcomes={writer.outcomes} pending={writer.pending} applying={writer.applying} onApply={(key) => writer.apply(list.filter((r) => r.key === key))} />}
      </AiShell>
    </>
  );
}
