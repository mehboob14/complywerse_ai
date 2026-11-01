'use client';

// The Workflow Templates tab: the templates as a register (a table from 768px, cards below) with Edit and Delete on every row, named for their template, and
// the two buttons the page has always had, Seed Defaults (for everyone, as it was: the server decides) and New Template (for the people with
// governance:workflows:create). THE LIST NOW SHOWS WHAT THE SERVER HOLDS: the templates route answers { items, total } and the page read it as an array, so its
// list was always the empty state "No workflow templates", even with four templates in the tenant, and Edit, Delete and the steps could not be reached. A
// template opens from its name (a link: ?template=, so Back and a reload work). Delete asks first (it was a browser confirm); every outcome is said.
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Layers, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { EMPTY, NOT_SET, formatCount, truncate } from '@/lib/format';
import { statusPill, workflowTemplate } from '@/lib/status';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, IconButton, Notice, Pager, RegisterTable, StatusPill, useConfirm, useReportedMutation, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { TitleLink, readPage, retryRead, useFocusAfterRemoval, useRead } from './_parts';
import { TemplateDetail } from './_TemplateDetail';
import { TemplateFormDrawer } from './_TemplateForm';
import { TENANT_ID, cutTitle, docTypeLabel, sliceOf, stepCount, templatesHref, type WorkflowTemplate } from './_model';

export function TemplatesTab({ templateId }: { templateId: number }) {
  return templateId > 0 ? <TemplateDetail id={templateId} /> : <TemplateList />;
}

function TemplateList() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:workflows:create');
  const { confirm, confirmDialog } = useConfirm();
  const templates = useRead(useQuery({
    queryKey: ['workflow-templates'],
    placeholderData: keepPreviousData,
    queryFn: () => readPage<WorkflowTemplate>(governanceApi.getWorkflowTemplates()),
    retry: retryRead,
  }));
  const [form, setForm] = useState<{ template: WorkflowTemplate | null; key: number } | null>(null);
  useFocusAfterRemoval(templates.page?.total, '#workflow-seed-defaults');                              // a deleted template takes the focus on its button with it
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);

  const seed = useReportedMutation({
    mutationFn: async () => (await governanceApi.seedDefaultTemplates(TENANT_ID)).data as { message?: string } | null,
    success: (data) => data?.message || 'The default template is in place',         // the server says whether it made one or it was already there
    failure: "Couldn't seed the defaults",
    invalidate: [['workflow-templates']],
  });
  const remove = useReportedMutation({
    mutationFn: (t: WorkflowTemplate) => governanceApi.deleteWorkflowTemplate(t.id),
    success: 'Template deleted',
    failure: 'Not deleted',
    invalidate: [['workflow-templates']],
  });
  const askDelete = async (t: WorkflowTemplate) => {
    const yes = await confirm({
      title: 'Delete this template?',
      message: `“${truncate(t.name, 120).text}” and its steps will be deleted. A template that an active workflow uses cannot be deleted.`,
      confirmLabel: 'Delete template',
      tone: 'danger',
    });
    if (yes) remove.mutate(t);
  };

  const rows = templates.page?.items ?? [];
  const total = templates.page?.total ?? 0;
  const cut = templates.page ? cutTitle(rows.length, total, 'templates') : null;
  const view = sliceOf(rows, page, size);
  const nameOf = (t: WorkflowTemplate) => truncate(t.name, 60).text;
  const actions = (t: WorkflowTemplate) => (
    <div className="flex items-center gap-[2px]">
      <IconButton label={`Edit “${nameOf(t)}”`} onClick={() => setForm({ template: t, key: Date.now() })}><Pencil aria-hidden /></IconButton>
      <IconButton label={`Delete “${nameOf(t)}”`} onClick={() => { void askDelete(t); }}><Trash2 aria-hidden /></IconButton>
    </div>
  );

  const columns: RegisterColumn<WorkflowTemplate>[] = [
    {
      key: 'name', header: 'Template', isRowHeader: true,
      cell: (t) => (
        <div className="min-w-0">
          <TitleLink href={templatesHref(t.id)} title={t.name} />
          {t.description && <div className="mt-[2px] line-clamp-2 text-ds-label font-normal text-ds-fg-muted [overflow-wrap:anywhere]" title={t.description}>{t.description}</div>}
        </div>
      ),
    },
    {
      key: 'types', header: 'Document types', priority: 2, width: 'w-[208px]', card: 'meta',
      cell: (t) => ((t.doc_types ?? []).length > 0 ? <span className="line-clamp-2">{(t.doc_types ?? []).map(docTypeLabel).join(', ')}</span> : <span className="text-ds-fg-muted">{NOT_SET}</span>),
    },
    { key: 'steps', header: 'Steps', priority: 2, width: 'w-[80px]', card: 'meta', cell: (t) => <span className="tabular-nums">{formatCount(stepCount(t), EMPTY)}</span> },
    {
      key: 'status', header: 'Status', width: 'w-[168px]', card: 'meta',
      cell: (t) => (
        <span className="inline-flex flex-wrap items-center gap-[4px]">
          <StatusPill size="sm" {...statusPill(workflowTemplate, t.is_active ? 'active' : 'inactive')} />
          {t.is_default && <StatusPill size="sm" {...statusPill(workflowTemplate, 'default')} />}
        </span>
      ),
    },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[96px]', card: 'hide', cell: actions },
  ];

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <span className="text-ds-body text-ds-fg-muted">{templates.page ? `${formatCount(total)} ${total === 1 ? 'template' : 'templates'}` : ''}</span>
        <div className="flex flex-wrap items-center gap-[8px]">
          <span className="inline-flex items-center gap-[4px]">
            <Button id="workflow-seed-defaults" leftIcon={<Wand2 aria-hidden />} loading={seed.isPending} onClick={() => seed.mutate()}>Seed defaults</Button>
            <InfoTip text="Adds the Standard Policy Approval template (review, approval, publish) if it is not there yet." label="About seeding the defaults" />
          </span>
          {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setForm({ template: null, key: Date.now() })}>New template</Button>}
        </div>
      </div>
      {cut && <Notice tone="warning" title={cut}>Paging covers these.</Notice>}
      <RegisterTable<WorkflowTemplate>
        caption="Workflow templates"
        columns={columns}
        rows={view.rows}
        getRowId={(t) => t.id}
        loading={templates.loading}
        error={templates.failed ? { message: `Couldn't load the templates. ${errorMessage(templates.error, "The server's answer could not be read.")}`, onRetry: canRetry(templates.error) ? templates.refetch : undefined } : null}
        empty={<EmptyState bare kind="firstUse" icon={Layers} title="No workflow templates" description="Create a template or seed the defaults to get started." />}
        cardTitle={(t) => (
          <div className="flex items-start justify-between gap-[8px]">
            <div className="min-w-0 flex-1">
              <TitleLink href={templatesHref(t.id)} title={t.name} />
              {t.description && <div className="mt-[2px] line-clamp-2 text-ds-label font-normal text-ds-fg-muted [overflow-wrap:anywhere]">{t.description}</div>}
            </div>
            {actions(t)}
          </div>
        )}
        footer={rows.length > 25 ? (
          <Pager page={view.page} pageSize={size} total={rows.length} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} noun={{ one: 'template', other: 'templates' }} />
        ) : undefined}
      />
      {form && <TemplateFormDrawer key={form.key} template={form.template} onClose={() => setForm(null)} />}
      {confirmDialog}
    </div>
  );
}
