'use client';

// The two AI helpers of a task: Root cause (what the AI thinks went wrong and what to do) and Draft a description (a description with acceptance criteria and suggested sub-tasks that can be
// applied to the task). They are asked from the head's "Ask AI" menu and the answer opens in a sheet beside the task, where it can be read next to the task, applied (the description) and
// dismissed; while it is working the sheet says so, and a failed call is a message with a Retry (it used to be swallowed). The calls are the old ones (aiRootCause, aiGenerateDescription, then
// update with the detailed description). A document request's task has neither (its description is the request's own).
import { CheckCircle2 } from 'lucide-react';
import { Button, FormError, Sheet, SkeletonLines, useReportedMutation } from '@/components/ui/ds';
import { criticalTasksApi } from '@/lib/api';
import { TASK_REFRESH } from '../../_register/taskData';
import type { TaskPageData } from './taskPageModel';

type Json = Record<string, unknown>;
const lines = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))) : []);

/** a root cause or an action as the AI wrote it: a sentence, or an object with the sentence and a category or priority */
const causeText = (c: unknown): string => (typeof c === 'string' ? c : `${(c as Json).cause ?? JSON.stringify(c)}${(c as Json).category ? ` (${(c as Json).category})` : ''}`);
const actionText = (a: unknown): string => (typeof a === 'string' ? a : `${(a as Json).action ?? JSON.stringify(a)}${(a as Json).priority ? ` [${(a as Json).priority}]` : ''}`);

export type AiKind = 'root' | 'description';

/** The two asks, and the one that applies a description. `open` says which answer the sheet shows. */
export function useTaskAi(task: TaskPageData) {
  const root = useReportedMutation({
    mutationFn: () => criticalTasksApi.aiRootCause(task.id),
    success: 'Done',
    failure: "AI couldn't analyse the root cause",
    toast: 'none',                                                      // the sheet shows the answer, the wait and the failure
  });
  const description = useReportedMutation({
    mutationFn: () => criticalTasksApi.aiGenerateDescription({ title: task.title || '', context: task.description || '', category: task.category || '', source: task.source || '' }),
    success: 'Done',
    failure: "AI couldn't draft a description",
    toast: 'none',
  });
  const apply = useReportedMutation({
    mutationFn: (text: string) => criticalTasksApi.update(task.id, { description: text }),
    success: 'Description applied to the task',
    failure: "Couldn't apply the description",
    invalidate: TASK_REFRESH,
    onSuccess: () => description.reset(),
  });
  return { root, description, apply };
}
export type TaskAi = ReturnType<typeof useTaskAi>;

function Heading({ children }: { children: string }) {
  return <h3 className="mb-[6px] !text-ds-label !font-[600] !text-ds-fg-muted">{children}</h3>;
}

function RootCause({ answer }: { answer: Json }) {
  const causes = Array.isArray(answer.root_causes) ? (answer.root_causes as unknown[]).map(causeText) : [];
  const actions = Array.isArray(answer.remediation_actions) ? (answer.remediation_actions as unknown[]).map(actionText) : [];
  return (
    <div className="flex flex-col gap-[16px]">
      {typeof answer.summary === 'string' && answer.summary && <p className="m-0 text-ds-body text-ds-fg">{answer.summary}</p>}
      {causes.length > 0 && <div><Heading>Root causes</Heading><ul className="m-0 flex list-disc flex-col gap-[4px] pl-[20px] text-ds-body text-ds-fg">{causes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
      {actions.length > 0 && <div><Heading>Remediation actions</Heading><ul className="m-0 flex list-disc flex-col gap-[4px] pl-[20px] text-ds-body text-ds-fg">{actions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
      {!answer.summary && causes.length === 0 && actions.length === 0 && <p className="m-0 text-ds-body text-ds-fg-muted">The AI had nothing to add for this task.</p>}
    </div>
  );
}

function Draft({ answer, ai }: { answer: Json; ai: TaskAi }) {
  const detailed = typeof answer.detailed_description === 'string' ? answer.detailed_description : '';
  const criteria = lines(answer.acceptance_criteria);
  const steps = lines(answer.suggested_sub_tasks);
  return (
    <div className="flex flex-col gap-[16px]">
      {typeof answer.summary === 'string' && answer.summary && <div><Heading>Summary</Heading><p className="m-0 text-ds-body text-ds-fg">{answer.summary}</p></div>}
      {detailed && <div><Heading>Description</Heading><p className="m-0 whitespace-pre-wrap text-ds-body text-ds-fg">{detailed}</p></div>}
      {criteria.length > 0 && (
        <div>
          <Heading>Acceptance criteria</Heading>
          <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
            {criteria.map((c, i) => <li key={i} className="flex items-start gap-[8px] text-ds-body text-ds-fg"><CheckCircle2 aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-success" />{c}</li>)}
          </ul>
        </div>
      )}
      {steps.length > 0 && <div><Heading>Suggested sub-tasks</Heading><ul className="m-0 flex list-disc flex-col gap-[4px] pl-[20px] text-ds-body text-ds-fg">{steps.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
      {!detailed && !answer.summary && <p className="m-0 text-ds-body text-ds-fg-muted">The AI had nothing to add for this task.</p>}
      {detailed && <div><Button variant="primary" loading={ai.apply.isPending} onClick={() => ai.apply.mutate(detailed)}>Use this description</Button></div>}
    </div>
  );
}

/** The sheet for whichever answer is asked for. `kind` null = closed. */
export function AiSheet({ kind, ai, onClose }: { kind: AiKind | null; ai: TaskAi; onClose: () => void }) {
  const run = kind === 'root' ? ai.root : ai.description;
  const answer = (run.data as { data?: Json } | undefined)?.data;
  const body = kind === 'root' ? ((answer?.analysis ?? answer) as Json | undefined) : ((answer?.description ?? answer) as Json | undefined);
  return (
    <Sheet open={kind !== null} onClose={onClose} title={kind === 'root' ? 'Root cause analysis' : 'Drafted description'} subtitle="Written by AI from what the task says. Check it before you use it." width="md">
      {run.isPending && <div role="status" aria-label="The AI is working"><SkeletonLines lines={6} /></div>}
      {run.isError && <FormError title={kind === 'root' ? "AI couldn't analyse the root cause" : "AI couldn't draft a description"} error={run.error} onRetry={() => run.mutate()} />}
      {!run.isPending && !run.isError && body && (kind === 'root' ? <RootCause answer={body} /> : <Draft answer={body} ai={ai} />)}
    </Sheet>
  );
}
