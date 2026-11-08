'use client';

// The corrective-action register (Issue & Incident Management > Corrective actions): the Facet explorer over every action of every issue (read whole), a board by status and a details drawer
// that carries the guided next step. It replaces the CAPA kanban of ~200px columns (and its "#41" issue numbers): an action is named with its issue, "Mine" and "Late" are chips, and the
// state of the page is in its address. Adding, editing, deleting and moving an action need the right to edit issues, which is what the server asks; an action that became a task is run from Task
// Management, so it has no status buttons here.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, Menu, useConfirm, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { OwnerCell } from '@/components/records/cells';
import { useCurrentUserId } from '@/components/records/lookups';
import { RecordDetail, RegisterFrame } from '@/components/records/RegisterFrame';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { usePermissions } from '@/hooks/usePermissions';
import { issuesApi } from '@/lib/api';
import { UNASSIGNED, formatCount, formatDate, truncate } from '@/lib/format';
import { ACTION_SCHEMA, actionCounts, actionDef, isManagedInTasks, issueLine, type ActionRow } from '@/lib/issues/actionDef';
import { actionStepsFrom, type ActionStep } from '@/lib/issues/words';
import { actionStatus, actionType } from '@/lib/statuses/issues';
import { ActionDetail, ActionLatePill, ActionStatusPill } from './ActionDetail';
import { ActionForm } from './ActionForm';
import { useActionRows } from './actionData';

const MUTED = 'text-ds-fg-muted';
const STALE = [['issues'], ['issue-detail'], ['issue-actions'], ['capa-actions'], ['issues-dashboard']];

export default function ActionRegister({ label }: { label: string }) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('issue_management:issues:edit');
  const { confirm, confirmDialog } = useConfirm();
  const me = useCurrentUserId();
  const def = useMemo(() => actionDef(me), [me]);
  const [editing, setEditing] = useState<ActionRow | null | undefined>(undefined);
  const list = useActionRows();
  const rows = list.data?.items ?? [];
  const now = useMemo(() => new Date(), [list.dataUpdatedAt]);          // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => actionCounts(rows, now), [rows, now]);

  const create = useReportedMutation({
    mutationFn: async (v: { issueId: number; payload: Record<string, unknown> }) => (await issuesApi.actions.create(v.issueId, v.payload)).data,
    success: 'Action added', failure: "Couldn't add the action", retryable: false, invalidate: STALE, onSuccess: () => setEditing(undefined),
  });
  const update = useReportedMutation({
    mutationFn: async (v: { id: number; payload: Record<string, unknown> }) => (await issuesApi.actions.patch(v.id, v.payload)).data,
    success: 'Action saved', failure: "Couldn't save the action", retryable: false, invalidate: STALE, onSuccess: () => setEditing(undefined),
  });
  const move = useReportedMutation({
    mutationFn: async (v: { action: ActionRow; step: ActionStep }) => (v.step.kind === 'verify'
      ? (await issuesApi.actions.verify(v.action.id, {})).data
      : (await issuesApi.actions.patch(v.action.id, { status: v.step.to })).data),
    success: (_d, v) => (v.step.kind === 'verify' ? 'Action verified' : `Marked ${actionStatus.label(v.step.to).toLowerCase()}`),
    failure: "Couldn't change the action", invalidate: STALE,
  });
  const remove = useReportedMutation({
    mutationFn: async (a: ActionRow) => (await issuesApi.actions.delete(a.id)).data,
    success: 'Action deleted', failure: "Couldn't delete the action", invalidate: STALE,
  });

  const run = async (a: ActionRow, s: ActionStep) => {
    if (s.danger) {
      const yes = await confirm({ title: 'Cancel this action?', message: `“${truncate(a.title, 80).text}” will be marked cancelled. You can restore it later.`, confirmLabel: 'Cancel action', tone: 'danger' });
      if (!yes) return;
    }
    move.mutate({ action: a, step: s });
  };
  const askDelete = async (a: ActionRow, closeDetail?: () => void) => {
    const yes = await confirm({ title: 'Delete this action?', message: `“${truncate(a.title, 80).text}” will be deleted from ${issueLine(a)}. This can't be undone.`, confirmLabel: 'Delete action', tone: 'danger' });
    if (yes) { remove.mutate(a); closeDetail?.(); }
  };
  const stepsOf = (a: ActionRow): ActionStep[] => (canEdit && !isManagedInTasks(a) ? actionStepsFrom(a.status) : []);
  const menuFor = (a: ActionRow, closeDetail?: () => void): MenuItem[] => [
    { key: 'issue', label: 'Open issue', icon: ArrowUpRight, onSelect: () => router.push(`/issues/${a.issue_id}`) },
    ...stepsOf(a).map((s): MenuItem => ({ key: s.key, label: s.label, danger: s.danger, onSelect: () => { void run(a, s); } })),
    { key: 'edit', label: 'Edit', icon: Pencil, hidden: !canEdit, onSelect: () => setEditing(a) },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canEdit, onSelect: () => { void askDelete(a, closeDetail); } },
  ];

  const columns: RecordColumn<ActionRow>[] = [
    {
      key: 'title', header: 'Action', sortKey: 'title',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={row.record.title}>{row.record.title}</span>
          <Link href={`/issues/${row.record.issue_id}`} onClick={(e) => e.stopPropagation()} className={`block max-w-full truncate text-ds-label ${MUTED} underline-offset-2 hover:text-ds-primary-text hover:underline`} title={issueLine(row.record)}>{issueLine(row.record)}</Link>
        </div>
      ),
    },
    { key: 'type', header: 'Type', sortKey: 'type', fit: { px: 112, dropRank: 1 }, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{row.record.action_type ? actionType.label(row.record.action_type) : '—'}</span> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 124 }, cell: (row) => <ActionStatusPill a={row.record} /> },
    {
      key: 'due', header: 'Due', sortKey: 'due', fit: { px: 132, dropRank: 2 },
      cell: (row) => (
        <div className="flex flex-col items-start gap-[2px]">
          <span className={`whitespace-nowrap text-ds-body ${row.record.due_date ? 'text-ds-fg-body' : MUTED}`}>{formatDate(row.record.due_date, { calendar: true })}</span>
          <ActionLatePill a={row.record} now={now} />
        </div>
      ),
    },
    { key: 'assignee', header: 'Assigned to', sortKey: 'assignee', fit: { px: 96, dropRank: 3, wide: { px: 168, titleMin: 420 } }, cell: (row, look) => <OwnerCell name={row.record.assignee_name} wide={look.wide} /> },
  ];
  const meta = (a: ActionRow): string => [issueLine(a), a.due_date ? `due ${formatDate(a.due_date, { calendar: true })}` : null, a.assignee_name || UNASSIGNED].filter(Boolean).join(' · ');
  const card = (row: RecordRow<ActionRow>) => (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg">{row.record.title}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><ActionStatusPill a={row.record} /><ActionLatePill a={row.record} now={now} /></span>
      <span className={`line-clamp-2 text-ds-label ${MUTED}`}>{meta(row.record)}</span>
    </div>
  );
  const boardCard = (a: ActionRow) => (
    <>
      <span className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{a.title}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><ActionLatePill a={a} now={now} /></span>
      <span className={`line-clamp-2 text-ds-label ${MUTED}`}>{meta(a)}</span>
    </>
  );

  const headMeta = list.data ? [`${formatCount(list.data.total)} ${list.data.total === 1 ? 'action' : 'actions'}`, `${formatCount(counts.open)} open`, `${formatCount(counts.late)} late`].join(' · ') : undefined;

  return (
    <>
      <RegisterFrame
        def={def}
        schema={ACTION_SCHEMA}
        label={label}
        rows={rows}
        loading={list.isLoading}
        error={list.isError && !list.data ? list.error : undefined}
        refreshError={list.isError && list.data ? list.error : undefined}
        onRetry={() => { void list.refetch(); }}
        serverTotal={list.data?.total}
        head={() => (
          <PageHeader
            variant="page" title={label} meta={headMeta}
            info="The steps that put an issue right and stop it coming back. Open means planned, in progress or blocked; late means open and past its due date; completed actions wait for someone to verify that they worked."
            actions={canEdit ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>New action</Button> : undefined}
          />
        )}
        columns={columns}
        card={card}
        boardCard={boardCard}
        boardLabel={(a) => a.title}
        rowActions={(a) => <Menu iconOnly label={`Actions for ${truncate(a.title, 60).text}`} items={menuFor(a)} />}
        rowLabel={(a) => `Select ${truncate(a.title, 60).text}`}
        searchLabel="Search actions by title, issue, person or notes"
        noAccess={{ title: "You don't have access to the corrective actions", reason: errorMessage(list.error) }}
        emptyFirst={(
          <EmptyState bare kind="firstUse" title="No corrective actions" description={canEdit ? 'Add one to an issue to see it here.' : 'No corrective actions have been added yet.'}
            action={canEdit ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>New action</Button> : undefined} />
        )}
        detail={(open, nav) => {
          const steps = open ? stepsOf(open) : [];
          const primary = steps.find((s) => s.primary) ?? null;
          return (
            <RecordDetail
              id={open?.id ?? null}
              nav={nav}
              title={<span dir="auto" className="line-clamp-3 break-words" title={open?.title}>{open?.title}</span>}
              subtitle={open ? issueLine(open) : undefined}
              actions={open && canEdit ? <Menu label="More actions" iconOnly items={menuFor(open, nav.onClose).filter((m) => m.key === 'delete')} /> : undefined}
              footer={open ? (
                <div className="flex flex-wrap items-center gap-[8px]">
                  {primary && <Button variant="primary" loading={move.isPending} onClick={() => { void run(open, primary); }}>{primary.label}</Button>}
                  {canEdit && <Button variant={primary ? 'secondary' : 'primary'} leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(open)}>Edit</Button>}
                  <Button href={`/issues/${open.issue_id}`} rightIcon={<ArrowUpRight aria-hidden />}>Open issue</Button>
                  {steps.filter((s) => s !== primary).length > 0 && (
                    <Menu label="More" items={steps.filter((s) => s !== primary).map((s) => ({ key: s.key, label: s.label, danger: s.danger, onSelect: () => { void run(open, s); } }))} />
                  )}
                </div>
              ) : undefined}
            >
              {open && <ActionDetail a={open} now={now} />}
            </RecordDetail>
          );
        }}
      />
      {editing !== undefined && (
        <ActionForm
          key={editing?.id ?? 'new'}
          action={editing}
          saving={create.isPending || update.isPending}
          onClose={() => setEditing(undefined)}
          onSubmit={(payload, issueId) => (editing ? update.mutate({ id: editing.id, payload }) : create.mutate({ issueId: issueId as number, payload }))}
        />
      )}
      {confirmDialog}
    </>
  );
}
