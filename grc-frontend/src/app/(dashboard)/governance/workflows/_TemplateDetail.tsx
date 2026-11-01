'use client';

// One workflow template: what it applies to and its settings, and its steps in the order they run, as a register (a table from 768px, cards below) with
// Move up, Move down, Edit and Delete on every row, each named for its step (they were icons with no name, 22px square). The template is read by its own id
// (the open one is in the address, ?template=), so a link or a reload opens it. A step is added, changed, moved and deleted with the calls the page has always
// made; each outcome is said, and a delete asks first (it was a browser confirm). MOVING A STEP IS REFUSED BY THE SERVER TODAY: PUT .../steps/reorder is declared
// after PUT .../steps/{step_id} in workflow_templates.py, which takes "reorder" for a step id and answers 422, so the refusal is what the person is shown.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { NOT_SET, formatCount, truncate } from '@/lib/format';
import { statusPill, workflowTemplate } from '@/lib/status';
import {
  Button, EmptyState, ErrorState, IconButton, RegisterTable, Skeleton, SkeletonLines, StatusPill, useConfirm, useReportedMutation, type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { SectionHeading, retryRead, useFocusAfterRemoval } from './_parts';
import { StepFormDrawer } from './_StepForm';
import {
  approvalModeLabel, docTypeLabel, nextSequence, reorderPayload, stepTypeLabel, stepsInOrder, templatesHref, type WorkflowStep, type WorkflowTemplate,
} from './_model';

const FLAGS: Array<{ key: 'allow_skip' | 'require_all_approvers' | 'auto_publish_on_complete'; label: string }> = [
  { key: 'allow_skip', label: 'Allow skip' }, { key: 'require_all_approvers', label: 'Require all approvers' }, { key: 'auto_publish_on_complete', label: 'Auto-publish' },
];

export function TemplateDetail({ id }: { id: number }) {
  const q = useQuery({
    queryKey: ['workflow-template', id],
    queryFn: async () => (await governanceApi.getWorkflowTemplate(id)).data as WorkflowTemplate,
    retry: retryRead,
  });
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<{ step: WorkflowStep | null; key: number } | null>(null);
  useFocusAfterRemoval(q.data?.steps?.length, '#workflow-add-step');                                  // a deleted step takes the focus on its button with it

  const reorder = useReportedMutation({
    mutationFn: (steps: { step_id: number; sequence: number }[]) => governanceApi.reorderWorkflowSteps(id, steps),
    success: 'Step moved',
    failure: "Couldn't move the step",
    toast: 'errors',                                                      // the row moves: that is the confirmation
    invalidate: [['workflow-template', id]],
  });
  const remove = useReportedMutation({
    mutationFn: (s: WorkflowStep) => governanceApi.deleteWorkflowStep(id, s.id),
    success: 'Step deleted',
    failure: 'Not deleted',
    invalidate: [['workflow-template', id], ['workflow-templates']],
  });

  const back = <Button href={templatesHref()} variant="ghost" size="sm" leftIcon={<ArrowLeft aria-hidden />} className="self-start">Back to templates</Button>;

  if (q.isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-[12px]">
        <span className="sr-only">Loading the template</span>
        <Skeleton className="h-[20px] w-[240px]" />
        <SkeletonLines lines={2} />
      </div>
    );
  }
  if (q.isError && !q.data) {
    return (
      <div className="flex flex-col gap-[12px]">
        {back}
        <ErrorState title="Couldn't load the template" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      </div>
    );
  }
  const t = q.data as WorkflowTemplate;
  const steps = stepsInOrder(t.steps);
  const types = (t.doc_types ?? []).map(docTypeLabel).join(', ');
  const settings = FLAGS.filter((f) => t[f.key]).map((f) => f.label).join(', ');
  const move = (s: WorkflowStep, direction: 'up' | 'down') => {
    const payload = reorderPayload(steps, s.id, direction);
    if (payload) reorder.mutate(payload);
  };
  const askDelete = async (s: WorkflowStep) => {
    const yes = await confirm({
      title: 'Delete this step?',
      message: `“${truncate(s.name, 120).text}” will be removed from this template. The steps after it move up one place.`,
      confirmLabel: 'Delete step',
      tone: 'danger',
    });
    if (yes) remove.mutate(s);
  };
  const nameOf = (s: WorkflowStep) => truncate(s.name, 60).text;
  const add = () => setEditing({ step: null, key: Date.now() });

  const columns: RegisterColumn<WorkflowStep>[] = [
    { key: 'order', header: 'Order', width: 'w-[64px]', card: 'hide', cell: (s) => <span className="tabular-nums">{s.sequence}</span> },
    {
      key: 'step', header: 'Step', isRowHeader: true,
      cell: (s) => (
        <div className="min-w-0">
          <span className="line-clamp-2 font-[600] text-ds-fg [overflow-wrap:anywhere]" title={s.name}>{s.name}</span>
          {s.description && <div className="mt-[2px] line-clamp-2 text-ds-label font-normal text-ds-fg-muted [overflow-wrap:anywhere]" title={s.description}>{s.description}</div>}
        </div>
      ),
    },
    { key: 'type', header: 'Type', width: 'w-[128px]', card: 'meta', cell: (s) => stepTypeLabel(s.step_type) },
    { key: 'mode', header: 'Approval', priority: 2, width: 'w-[136px]', card: 'meta', cell: (s) => approvalModeLabel(s.approval_mode) },
    {
      key: 'timeout', header: 'Timeout', priority: 2, width: 'w-[112px]', card: 'meta',
      cell: (s) => (s.timeout_days ? <span className="whitespace-nowrap">{formatCount(s.timeout_days)} {s.timeout_days === 1 ? 'day' : 'days'}</span> : <span className="text-ds-fg-muted">{NOT_SET}</span>),
    },
    { key: 'approvers', header: 'Approvers', priority: 3, width: 'w-[104px]', card: 'meta', cell: (s) => <span className="tabular-nums">{formatCount(s.approvers?.length ?? 0)}</span> },
    { key: 'required', header: 'Required', priority: 3, width: 'w-[96px]', card: 'meta', cell: (s) => (s.is_required ? 'Yes' : 'No') },
    {
      key: 'actions', header: 'Actions', width: 'w-[176px]', card: 'meta',
      cell: (s) => {
        const at = steps.findIndex((x) => x.id === s.id);
        return (
          <div className="flex items-center gap-[2px]">
            <IconButton label={`Move “${nameOf(s)}” up`} disabled={at <= 0 || reorder.isPending} onClick={() => move(s, 'up')}><ChevronUp aria-hidden /></IconButton>
            <IconButton label={`Move “${nameOf(s)}” down`} disabled={at < 0 || at >= steps.length - 1 || reorder.isPending} onClick={() => move(s, 'down')}><ChevronDown aria-hidden /></IconButton>
            <IconButton label={`Edit “${nameOf(s)}”`} onClick={() => setEditing({ step: s, key: Date.now() })}><Pencil aria-hidden /></IconButton>
            <IconButton label={`Delete “${nameOf(s)}”`} onClick={() => { void askDelete(s); }}><Trash2 aria-hidden /></IconButton>
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[12px]">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-x-[16px] gap-y-[12px]">
          <div className="min-w-0 flex-1 basis-[16rem]">
            <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
              <h2 className="min-w-0 break-words !text-ds-section !text-ds-fg">{t.name}</h2>
              <StatusPill size="sm" {...statusPill(workflowTemplate, t.is_active ? 'active' : 'inactive')} />
              {t.is_default && <StatusPill size="sm" {...statusPill(workflowTemplate, 'default')} />}
            </div>
            {t.description && <p className="mt-[4px] text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">{t.description}</p>}
            <dl className="mt-[8px] flex flex-col gap-[2px]">
              <div className="flex flex-wrap gap-x-[8px]">
                <dt className="text-ds-label text-ds-fg-muted">Applies to</dt>
                <dd className="min-w-0 text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{types || NOT_SET}</dd>
              </div>
              {settings && (
                <div className="flex flex-wrap gap-x-[8px]">
                  <dt className="text-ds-label text-ds-fg-muted">Settings</dt>
                  <dd className="min-w-0 text-ds-body text-ds-fg-body">{settings}</dd>
                </div>
              )}
            </dl>
          </div>
          <Button id="workflow-add-step" variant="primary" leftIcon={<Plus aria-hidden />} onClick={add}>Add step</Button>
        </div>
      </div>

      <section aria-labelledby="workflow-steps" className="flex flex-col gap-[8px]">
        <SectionHeading id="workflow-steps">Steps</SectionHeading>
        <RegisterTable<WorkflowStep>
          caption="Workflow steps"
          columns={columns}
          rows={steps}
          getRowId={(s) => s.id}
          cardTitle={(s) => <span className="[overflow-wrap:anywhere]">{`${s.sequence}. ${s.name}`}</span>}
          empty={(
            <EmptyState bare kind="firstUse" title="No steps configured" description="Add the steps this workflow runs, in order."
              action={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={add}>Add step</Button>} />
          )}
        />
      </section>

      {editing && <StepFormDrawer key={editing.key} templateId={id} step={editing.step} nextSequence={nextSequence(t.steps)} onClose={() => setEditing(null)} />}
      {confirmDialog}
    </div>
  );
}
