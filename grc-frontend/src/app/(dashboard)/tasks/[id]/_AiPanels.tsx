'use client';

// The two AI helpers of a task's page: Root cause (what the AI thinks went wrong and what to do) and AI description (a drafted description with acceptance criteria and suggested sub-tasks that
// can be applied to the task). The calls are the old ones (aiRootCause, aiGenerateDescription, then update with the detailed description). What changed is what they say: a failed call is a message
// with Retry (it used to be swallowed), applying says it was applied, and the answers sit in panels that can be dismissed. A document request's task has neither button (its description is the request's own).
import { useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { criticalTasksApi } from '@/lib/api';
import { Button, IconButton, SectionCard, useReportedMutation } from '@/components/ui/ds';
import type { TaskDetail } from '../tasksModel';

type Json = Record<string, unknown>;
const lines = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))) : []);

export function useTaskAi(task: TaskDetail) {
  const [rootCause, setRootCause] = useState<Json | null>(null);
  const [description, setDescription] = useState<Json | null>(null);

  const askRoot = useReportedMutation({
    mutationFn: () => criticalTasksApi.aiRootCause(task.id),
    success: 'Done',                                                   // not used: the analysis opens below
    failure: "AI couldn't analyse the root cause",
    toast: 'errors',
    onSuccess: (res) => setRootCause((res.data?.analysis || res.data) as Json),
  });
  const askDescription = useReportedMutation({
    mutationFn: () => criticalTasksApi.aiGenerateDescription({ title: task.title || '', context: task.description || '', category: task.category || '', source: task.source || '' }),
    success: 'Done',
    failure: "AI couldn't draft a description",
    toast: 'errors',
    onSuccess: (res) => setDescription((res.data?.description || res.data) as Json),
  });
  const apply = useReportedMutation({
    mutationFn: (text: string) => criticalTasksApi.update(task.id, { description: text }),
    success: 'Description applied to the task',
    failure: "Couldn't apply the description",
    invalidate: [['critical-task', task.id]],
    onSuccess: () => setDescription(null),
  });

  return { rootCause, description, askRoot, askDescription, apply, dismissRoot: () => setRootCause(null), dismissDescription: () => setDescription(null) };
}

type Ai = ReturnType<typeof useTaskAi>;

function Heading({ children }: { children: string }) {
  return <p className="mb-[6px] text-ds-label font-[600] text-ds-fg-muted">{children}</p>;
}

/** a root cause or an action as the AI wrote it: a sentence, or an object with the sentence and a category or priority */
const causeText = (c: unknown): string => (typeof c === 'string' ? c : `${(c as Json).cause ?? JSON.stringify(c)}${(c as Json).category ? ` (${(c as Json).category})` : ''}`);
const actionText = (a: unknown): string => (typeof a === 'string' ? a : `${(a as Json).action ?? JSON.stringify(a)}${(a as Json).priority ? ` [${(a as Json).priority}]` : ''}`);

export function AiPanels({ ai }: { ai: Ai }) {
  const { rootCause: rc, description: d } = ai;
  const causes = Array.isArray(rc?.root_causes) ? (rc?.root_causes as unknown[]).map(causeText) : [];
  const actions = Array.isArray(rc?.remediation_actions) ? (rc?.remediation_actions as unknown[]).map(actionText) : [];
  return (
    <>
      {rc && (
        <SectionCard id="ai-root-cause" title="AI root cause analysis" actions={<IconButton label="Dismiss the root cause analysis" onClick={ai.dismissRoot}><X aria-hidden /></IconButton>}>
          <div className="flex flex-col gap-[12px]">
            {typeof rc.summary === 'string' && rc.summary && <p className="text-ds-body text-ds-fg">{rc.summary}</p>}
            {causes.length > 0 && (
              <div>
                <Heading>Root causes</Heading>
                <ul className="m-0 flex list-disc flex-col gap-[4px] pl-[20px] text-ds-body text-ds-fg">{causes.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            )}
            {actions.length > 0 && (
              <div>
                <Heading>Remediation actions</Heading>
                <ul className="m-0 flex list-disc flex-col gap-[4px] pl-[20px] text-ds-body text-ds-fg">{actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </div>
            )}
          </div>
        </SectionCard>
      )}
      {d && (
        <SectionCard id="ai-description" title="AI-generated description" actions={<IconButton label="Dismiss the generated description" onClick={ai.dismissDescription}><X aria-hidden /></IconButton>}>
          <div className="flex flex-col gap-[12px]">
            {typeof d.summary === 'string' && d.summary && <div><Heading>Summary</Heading><p className="text-ds-body text-ds-fg">{d.summary}</p></div>}
            {typeof d.detailed_description === 'string' && d.detailed_description && <div><Heading>Detailed description</Heading><p className="whitespace-pre-wrap text-ds-body text-ds-fg">{d.detailed_description}</p></div>}
            {lines(d.acceptance_criteria).length > 0 && (
              <div>
                <Heading>Acceptance criteria</Heading>
                <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
                  {lines(d.acceptance_criteria).map((c, i) => <li key={i} className="flex items-start gap-[8px] text-ds-body text-ds-fg"><CheckCircle2 aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-success" />{c}</li>)}
                </ul>
              </div>
            )}
            {lines(d.suggested_sub_tasks).length > 0 && (
              <div>
                <Heading>Suggested sub-tasks</Heading>
                <ul className="m-0 flex list-disc flex-col gap-[4px] pl-[20px] text-ds-body text-ds-fg">{lines(d.suggested_sub_tasks).map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
            {typeof d.detailed_description === 'string' && d.detailed_description && (
              <div><Button variant="primary" loading={ai.apply.isPending} onClick={() => ai.apply.mutate(d.detailed_description as string)}>Apply description to the task</Button></div>
            )}
          </div>
        </SectionCard>
      )}
    </>
  );
}
