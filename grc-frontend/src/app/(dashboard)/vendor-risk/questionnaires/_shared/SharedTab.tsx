'use client';

// Questionnaires > Shared (the Vendor Exchange, "complete once, reuse"): what has been published as a reusable assessment, with its rating, what it holds and until when, and the three things a person does
// to one: copy its share token, download it as a package for another organisation, revoke it (asks first). Publish and Import are the head's buttons (the sheets are SharedSheets.tsx). Copying and
// downloading are reads open to everyone who reaches the page; publishing, importing and revoking need the right to edit assessments, as the server checks.
import type { UseQueryResult } from '@tanstack/react-query';
import { Copy, Download, Share2, Trash2 } from 'lucide-react';
import { Button, EmptyState, ErrorState, Menu, RegisterTable, SkeletonRows, StatusPill, useConfirm, useReportedMutation, type MenuItem, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { tpraApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { sharedRating, sharedStatus } from '@/lib/statuses/vendorQuestionnaires';
import { SHARED_KEY } from '../../_lib/questionnairesApi';
import { contentsText, packageFileName, ratingLabel, ratingWord, sharedActions, supplierText, type SharedRow } from '../../_lib/questionnaires/sharedModel';
import type { Rights } from '../_forms/useRights';

const MUTED = 'text-ds-fg-muted';

export default function SharedTab({ list, rights, onPublish }: { list: UseQueryResult<{ items: SharedRow[]; total: number }, unknown>; rights: Rights; onPublish: () => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const rows = list.data?.items ?? [];

  const copy = useReportedMutation({
    mutationFn: async (r: SharedRow) => {
      if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(r.share_token);
    },
    success: (_d, r) => `Share token copied for ${supplierText(r)}`,
    failure: "Couldn't copy the share token",
    fallback: 'This browser would not let the page copy. Download the package instead.',
  });
  const download = useReportedMutation({
    mutationFn: async (r: SharedRow) => {
      const pkg = (await tpraApi.sharedPackage(r.share_token)).data;
      const url = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = packageFileName(r);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    success: (_d, r) => `Package downloaded for ${supplierText(r)}`,
    failure: "Couldn't download the package",
  });
  const revoke = useReportedMutation({
    mutationFn: async (r: SharedRow) => { await tpraApi.revokeShared(r.id); },
    success: (_d, r) => `Revoked: ${supplierText(r)}`,
    failure: "Couldn't revoke the shared assessment",
    invalidate: [[SHARED_KEY]],
  });
  const askRevoke = async (r: SharedRow) => {
    const yes = await confirm({
      title: 'Revoke this shared assessment?',
      message: `${supplierText(r)}'s shared assessment can no longer be imported by token. Answers already imported stay where they are.`,
      confirmLabel: 'Revoke',
      tone: 'danger',
    });
    if (yes) revoke.mutate(r);
  };

  const menu = (r: SharedRow) => {
    const items: MenuItem[] = sharedActions(r, { edit: rights.resend }).map((a): MenuItem => (
      a === 'copy_token' ? { key: a, label: 'Copy share token', icon: Copy, onSelect: () => copy.mutate(r) }
        : a === 'download' ? { key: a, label: 'Download package', icon: Download, onSelect: () => download.mutate(r) }
          : { key: a, label: 'Revoke', icon: Trash2, danger: true, onSelect: () => { void askRevoke(r); } }
    ));
    return <Menu iconOnly label={`Actions for ${supplierText(r).slice(0, 60)}`} items={items} />;
  };

  const columns: RegisterColumn<SharedRow>[] = [
    {
      key: 'supplier', header: 'Supplier', isRowHeader: true,
      cell: (r) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words font-[600] text-ds-fg" title={supplierText(r)}>{supplierText(r)}</span>
          <span className={`block truncate text-ds-label ${MUTED}`}>{r.template_name || 'No questionnaire'}</span>
        </div>
      ),
    },
    { key: 'rating', header: 'Rating', card: 'meta', cell: (r) => <StatusPill size="sm" tone={sharedRating.tone(ratingWord(r))} label={ratingLabel(r)} /> },
    { key: 'contents', header: 'Contents', priority: 2, card: 'meta', cell: (r) => <span className="text-ds-body text-ds-fg-body">{contentsText(r)}</span> },
    { key: 'validated', header: 'Validated', priority: 3, card: 'meta', cell: (r) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(r.validated_at)}</span> },
    { key: 'status', header: 'Status', card: 'meta', cell: (r) => <StatusPill size="sm" tone={sharedStatus.tone(r.status)} label={sharedStatus.label(r.status)} /> },
    { key: 'actions', header: 'Actions', card: 'hide', align: 'right', width: 'w-[56px]', cell: menu },
  ];

  if (list.isError && !list.data) return <ErrorState title="Couldn't load the shared assessments" message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />;
  if (list.isPending) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={5} columns={5} label="Loading the shared assessments" /></div>;
  return (
    <div className="flex flex-col gap-[12px]">
      {list.isError && <ErrorState compact title="Couldn't refresh the shared assessments" message={`${errorMessage(list.error)} What is shown may be out of date.`} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}
      <RegisterTable
        caption="Shared assessments" columns={columns} rows={rows} getRowId={(r) => r.id}
        cardTitle={(r) => <span className="font-[600] text-ds-fg">{supplierText(r)}</span>} cardActions={menu}
        empty={(
          <EmptyState
            bare kind="firstUse" icon={Share2} title="Nothing shared yet"
            description="Publish a completed assessment to reuse it later: share it by token, or export it as a package for another organisation. Imported answers are re-scored with your own engine."
            action={rights.resend ? <Button variant="primary" leftIcon={<Share2 aria-hidden />} onClick={onPublish}>Publish an assessment</Button> : undefined}
          />
        )}
      />
      {confirmDialog}
    </div>
  );
}
