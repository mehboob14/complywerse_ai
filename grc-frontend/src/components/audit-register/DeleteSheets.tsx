'use client';

// Deleting a finding and getting one back. Delete (the delete right) leaves the register, the Issue Summary, the reports and the reminders but keeps the issue as cancelled with its whole history,
// so the audit trail stays intact; the sheet says exactly that, and what a later workbook does with it. A reason is kept in the history. "Deleted findings" lists what was deleted, with Restore.
import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Button, EmptyState, ErrorState, FormField, Notice, SkeletonRows, Sheet, StatusPill, Textarea, useReportedMutation, RegisterTable } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { auditRegisterApi } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { findingStatus } from '@/lib/statuses/auditRegister';
import { referenceOf, sourceWord, type RegisterRow } from '@/lib/auditRegister/registerDef';
import type { DeleteTarget } from './FindingDrawer';
import { REFRESH_ALL, useDeletedRows } from './registerData';

export function DeleteFindingSheet({ target, onClose, onDeleted }: { target: DeleteTarget | null; onClose: () => void; onDeleted?: (id: number) => void }) {
  const [reason, setReason] = useState('');
  const remove = useReportedMutation({
    mutationFn: async (v: { id: number; reason: string }) => (await auditRegisterApi.deleteFinding(v.id, v.reason)).data,
    success: 'Finding deleted',
    failure: "Couldn't delete the finding",
    invalidate: [...REFRESH_ALL, ['audit-register-rows', 'deleted']],
    retryable: false,
    onSuccess: (_d, v) => { setReason(''); onDeleted?.(v.id); onClose(); },
  });
  const close = () => { if (!remove.isPending) { setReason(''); onClose(); } };
  return (
    <Sheet
      open={!!target}
      onClose={close}
      title="Delete this finding?"
      subtitle={target?.label}
      width="md"
      dirty={reason.trim().length > 0}
      footer={(
        <div className="flex w-full flex-wrap justify-end gap-[8px]">
          <Button onClick={close} disabled={remove.isPending}>Keep it</Button>
          <Button variant="danger" leftIcon={<Trash2 aria-hidden />} loading={remove.isPending} onClick={() => target && remove.mutate({ id: target.id, reason })}>Delete finding</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px]">
        <p className="m-0 text-ds-body text-ds-fg-body">
          It leaves the register, the Issue Summary, the reports and the reminders. Its issue is kept as cancelled with its full history, so the audit trail stays intact
          {target?.source === 'regulator' ? ', and its Statutory Audit observation is cancelled' : ''}
          {target?.source === 'self_id' ? ', and its incident is closed' : ''}.
        </p>
        {target && !target.addedInPlatform && (
          <Notice tone="warning">This finding came from the workbook. Later uploads that still carry it will leave it out rather than add it back.</Notice>
        )}
        <p className="m-0 text-ds-body text-ds-fg-body">You can bring it back at any time from More, Deleted findings.</p>
        <FormField label="Reason" optional hint="Kept in the history.">
          <Textarea value={reason} rows={3} placeholder="For example: entered twice, or raised in error" disabled={remove.isPending} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </div>
    </Sheet>
  );
}

export function DeletedFindingsSheet({ open, canRestore, onClose }: { open: boolean; canRestore: boolean; onClose: () => void }) {
  const deleted = useDeletedRows(open);
  const restore = useReportedMutation({
    mutationFn: async (id: number) => (await auditRegisterApi.restoreFinding(id)).data,
    success: 'Finding restored to the register',
    failure: "Couldn't restore the finding",
    invalidate: [...REFRESH_ALL, ['audit-register-rows', 'deleted']],
  });
  const rows = deleted.data ?? [];
  return (
    <Sheet open={open} onClose={onClose} title="Deleted findings" subtitle={deleted.data ? `${formatCount(rows.length)} ${rows.length === 1 ? 'finding' : 'findings'}` : undefined} width="lg" padded={false}>
      {deleted.isLoading ? <div className="p-[16px]"><SkeletonRows rows={5} columns={3} label="Loading the deleted findings" /></div>
        : deleted.isError ? <div className="p-[16px]"><ErrorState compact title="Couldn't load the deleted findings" message={errorMessage(deleted.error)} onRetry={() => { void deleted.refetch(); }} /></div>
        : rows.length === 0 ? <EmptyState bare kind="firstUse" title="Nothing has been deleted" />
        : (
          <RegisterTable<RegisterRow>
            caption="Deleted findings"
            rows={rows}
            getRowId={(r) => r.issue_id}
            cardTitle={(r) => <span className="break-words text-ds-body font-[600] text-ds-fg">{[referenceOf(r), r.title].filter(Boolean).join(' · ')}</span>}
            cardActions={canRestore ? (r) => <Button size="sm" leftIcon={<RotateCcw aria-hidden />} loading={restore.isPending && restore.variables === r.issue_id} onClick={() => restore.mutate(r.issue_id)}>Restore</Button> : undefined}
            columns={[
              { key: 'finding', header: 'Finding', isRowHeader: true, cell: (r) => <span className="line-clamp-2 break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{[referenceOf(r), r.title].filter(Boolean).join(' · ')}</span>, card: 'hide' },
              { key: 'source', header: 'Source', priority: 2, cell: (r) => <span className="text-ds-body text-ds-fg-body">{sourceWord(r.source)}</span>, card: 'meta' },
              { key: 'status', header: 'Was', priority: 2, cell: (r) => <StatusPill size="sm" {...statusPill(findingStatus, r.status)} />, card: 'meta' },
              { key: 'deleted', header: 'Deleted', cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(r.deleted_at)}</span>, card: 'meta' },
              ...(canRestore ? [{ key: 'restore', header: 'Restore', cell: (r: RegisterRow) => <Button size="sm" leftIcon={<RotateCcw aria-hidden />} loading={restore.isPending && restore.variables === r.issue_id} onClick={() => restore.mutate(r.issue_id)}>Restore</Button>, card: 'hide' as const }] : []),
            ]}
          />
        )}
    </Sheet>
  );
}
