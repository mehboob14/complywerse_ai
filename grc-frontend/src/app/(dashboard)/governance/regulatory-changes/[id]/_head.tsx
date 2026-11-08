'use client';

// The parts at the top of a change's page: what the AI is doing with the circular (said in plain words, never the error text it stored), the journey (six steps, the first not done is the next one),
// and the Close sheet (the real list of what is left, and for a change with no tasks the way forward instead of a dead end). The close RULE is the server's and is not changed here.
import { AlertCircle, CheckCircle2, Circle, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Button, Notice, PersonStack, ProgressBar, Sheet, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { regulatoryApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { taskStatus } from '@/lib/statuses/regulatory';
import { CHANGE_REFRESH } from '../_lib/data';
import { closeState, type JourneyStep } from '../_lib/regulatoryModel';
import type { Analysis, ChangeRow, Task } from '../_lib/types';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Shown while the AI reads the circular, if it failed, or if parts of it could not be read. */
export function AnalysisBanner({ analysis, onRetry, busy }: { analysis: Analysis; onRetry: () => void; busy: boolean }) {
  const again = <Button loading={busy} leftIcon={<RefreshCw aria-hidden />} onClick={onRetry}>Run it again</Button>;
  if (analysis.status === 'failed') {
    return <Notice tone="danger" title="The AI did not finish reading this circular" action={again}>What it found before it stopped is kept. Run it again to read the rest, or add the obligations yourself.</Notice>;
  }
  if (analysis.status === 'done') {
    const missed = analysis.counts?.failed || [];
    if (!missed.length) return null;
    return <Notice tone="warning" title="Part of the circular could not be read" action={again}>The AI could not read {missed.join(', ')}. The rest of the circular was read in full.</Notice>;
  }
  const total = analysis.total_steps || 0;
  const done = analysis.done_steps || 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div role="status" aria-live="polite" className="rounded-ds-card border border-ds-border bg-ds-primary-soft px-[12px] py-[8px]">
      <p className="m-0 flex flex-wrap items-center gap-[8px] text-ds-body font-[600] text-ds-primary-text">
        <Loader2 aria-hidden className="h-[16px] w-[16px] animate-spin" />
        {analysis.status === 'queued' ? 'The AI is starting to read this circular' : 'The AI is reading this circular'}
        {total > 0 && <span className="font-normal">{`· ${done} of ${total} parts read`}</span>}
        {(analysis.found ?? 0) > 0 && <span className="font-normal">{`· ${plural(analysis.found ?? 0, 'obligation')} found so far`}</span>}
      </p>
      <ProgressBar className="mt-[6px]" value={Math.max(5, pct)} label="Parts of the circular read" showValue={false} />
      <p className="m-0 mt-[4px] text-ds-label text-ds-fg-muted">Results appear below as each part is read, usually within two minutes. You can leave this page.</p>
    </div>
  );
}

const STEP_STYLE: Record<JourneyStep['state'], string> = {
  done: 'border-ds-border bg-ds-surface text-ds-fg-body',
  current: 'border-ds-primary bg-ds-primary-soft text-ds-fg',
  todo: 'border-ds-border bg-ds-surface text-ds-fg-muted',
  failed: 'border-ds-danger-border bg-ds-danger-soft text-ds-danger',
};
const STATE_WORD: Record<JourneyStep['state'], string> = { done: 'Done', current: 'Next', todo: 'Later', failed: 'Needs attention' };

/** Where the change stands, as six steps. Each opens the tab where that step is done. */
export function JourneyStrip({ steps, onGo }: { steps: JourneyStep[]; onGo: (tab: JourneyStep['tab']) => void }) {
  return (
    <ol aria-label="Where this change stands" className="m-0 grid list-none grid-cols-2 gap-[8px] p-0 sm:grid-cols-3 lg:grid-cols-6">
      {steps.map((s) => (
        <li key={s.key}>
          <button
            type="button"
            onClick={() => onGo(s.tab)}
            className={`flex min-h-[64px] w-full flex-col items-start gap-[2px] rounded-ds-card border px-[10px] py-[8px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring ${STEP_STYLE[s.state]}`}
          >
            <span className="flex items-center gap-[6px] text-ds-body font-[600]">
              {s.state === 'done' ? <CheckCircle2 aria-hidden className="h-[16px] w-[16px] text-ds-success" /> : s.state === 'failed' ? <AlertCircle aria-hidden className="h-[16px] w-[16px]" /> : <Circle aria-hidden className="h-[16px] w-[16px]" />}
              {s.label}
              <span className="sr-only">{`: ${STATE_WORD[s.state]}`}</span>
            </span>
            <span className="text-ds-label">{s.note}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The Close sheet: what is left, in the server's own terms. */
export function CloseSheet({ open, onClose, change, tasks, onGoToTasks, onAddTask }: {
  open: boolean; onClose: () => void; change: ChangeRow; tasks: Task[]; onGoToTasks: () => void; onAddTask: () => void;
}) {
  const state = closeState(change, tasks);
  const close = useReportedMutation({
    mutationFn: () => regulatoryApi.closeChange(change.id),
    success: { title: 'Change closed', message: 'It is recorded as closed today, by you.' },
    failure: "Couldn't close the change",
    invalidate: CHANGE_REFRESH.map((k) => [...k]),
    onSuccess: onClose,
  });
  const left = tasks.filter((t) => t.status !== 'completed');
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Close this change"
      subtitle="A change closes when its work is done."
      width="md"
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          {state.kind === 'no_tasks' && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => { onClose(); onAddTask(); }}>Add a task</Button>}
          {state.kind === 'open_tasks' && <Button variant="primary" onClick={() => { onClose(); onGoToTasks(); }}>Go to the tasks</Button>}
          {state.kind === 'ready' && <Button variant="primary" loading={close.isPending} onClick={() => close.mutate()}>Close change</Button>}
        </div>
      )}
    >
      {state.kind === 'finished' && <Notice tone="info">This change is already closed.</Notice>}
      {state.kind === 'wrong_status' && <Notice tone="warning" title="It cannot be closed from here yet">{state.reason}</Notice>}
      {state.kind === 'no_tasks' && (
        <Notice tone="info" title="This change has no tasks yet">Add the work that implementing it takes. When every task is done, the change can be closed.</Notice>
      )}
      {state.kind === 'ready' && <Notice tone="info" title={`All ${plural(state.total, 'task')} are done`}>Closing records who closed the change and when.</Notice>}
      {state.kind === 'open_tasks' && (
        <>
          <p className="m-0 mb-[8px] text-ds-body text-ds-fg">{`${state.total - state.open} of ${state.total} tasks are done. Finish these first:`}</p>
          <ul className="m-0 list-none divide-y divide-ds-border rounded-ds-card border border-ds-border p-0">
            {left.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px] px-[12px] py-[8px]">
                <span className="min-w-0 flex-1 text-ds-body text-ds-fg [overflow-wrap:anywhere]">{t.title}</span>
                <PersonStack people={(t.assignees || []).map((a) => a.display_name)} label="On this task" size={24} />
                <StatusPill size="sm" {...statusPill(taskStatus, t.status)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
