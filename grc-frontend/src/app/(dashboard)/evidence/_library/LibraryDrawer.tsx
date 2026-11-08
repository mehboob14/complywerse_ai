'use client';

/**
 * The details of one file over the Library's list (the Facet explorer's drawer): the kit's SidePanel. The head names the file and says what it is; the body is what the old Workbench
 * preview showed (status, who owns it, then the maturity, OCR and validity tiles, the frameworks it answers and the counts of what it is linked to: DetailPreview); the foot holds the
 * one thing to do next (Submit for review, Approve with Send back, or Renew for a lapsed file), Open file and the full record, and the rest in a menu. Previous / next walk the list as it
 * is shown. Which buttons a person sees follows the rights the old workspace checked.
 */
import { ArrowUpRight, ChevronDown, ChevronUp, FileText, FolderPlus, RefreshCw, Send, ThumbsUp, Trash2, Undo2 } from 'lucide-react';
import { Button, Fact, FactList, IconButton, Menu, SidePanel, type MenuItem } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { ownerOf, typeLabel } from '../_workspace/evidenceModel';
import { DetailPreview } from '../_workspace/DetailPreview';
import { StatusBadges } from '../_workspace/lib';
import { OwnerCell, subline } from './LibraryRows';
import { isLapsed, type LibraryRow } from './libraryModel';
import type { useLibraryActions } from './libraryActions';

type Actions = ReturnType<typeof useLibraryActions>;

export interface LibraryDrawerProps {
  /** the lean row of the file whose details are open; null = closed */
  row: LibraryRow | null;
  now: number;
  actions: Actions;
  canReview: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onOpenFile: (row: LibraryRow) => void;
  onOpenRecord: (id: number) => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
}

/** The row the details were opened from, found again when focus has to go back to it. */
const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const row = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

export function LibraryDrawer({ row, now, actions, canReview, canEdit, canDelete, onClose, onOpenFile, onOpenRecord, onStep, hasPrev, hasNext }: LibraryDrawerProps) {
  const id = row?.id ?? null;
  const lapsed = row ? isLapsed(row, now) && row.status !== 'archived' : false;
  const p = actions.pending;
  const more: MenuItem[] = row ? [
    { key: 'package', label: 'Add to audit package', icon: FolderPlus, onSelect: () => actions.addToPackage([row.id]), hidden: row.status !== 'approved' },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => actions.remove(row.id), hidden: !canDelete, disabled: p.remove === row.id },
  ] : [];
  const draft = row?.status === 'draft';
  const review = !!row && canReview && row.status === 'pending_review';
  const renew = !!row && canEdit && lapsed && (row.status === 'approved' || row.status === 'expired');
  return (
    <SidePanel
      open={!!row}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={row?.name}>{row?.name}</span>}
      subtitle={row ? subline(row) || undefined : undefined}
      dockFrom={Infinity}
      width="md"
      restoreFocus={rowOf(id)}
      actions={row && (
        <>
          <IconButton label="Previous file" aria-disabled={!hasPrev || undefined} onClick={() => { if (hasPrev) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next file" aria-disabled={!hasNext || undefined} onClick={() => { if (hasNext) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
          {more.some((m) => !m.hidden) && <Menu label="More actions" iconOnly items={more} />}
        </>
      )}
      footer={row && (
        <div className="flex flex-wrap items-center gap-[8px]">
          {draft && <Button variant="primary" leftIcon={<Send aria-hidden />} loading={p.submit === row.id} onClick={() => actions.submit(row.id)}>Submit for review</Button>}
          {review && <Button variant="primary" leftIcon={<ThumbsUp aria-hidden />} loading={p.approve === row.id} onClick={() => actions.approve(row.id)}>Approve</Button>}
          {review && <Button leftIcon={<Undo2 aria-hidden />} onClick={() => actions.sendBack(row.id)}>Send back</Button>}
          {renew && <Button variant={draft || review ? 'secondary' : 'primary'} leftIcon={<RefreshCw aria-hidden />} loading={p.renew === row.id} onClick={() => actions.renew(row.id)}>Renew</Button>}
          <Button leftIcon={<FileText aria-hidden />} onClick={() => onOpenFile(row)}>Open file</Button>
          <Button variant="link" rightIcon={<ArrowUpRight aria-hidden />} onClick={() => onOpenRecord(row.id)}>Full record</Button>
        </div>
      )}
    >
      {row && (
        <div key={row.id} data-evidence-detail={row.id}>
          <div className="flex flex-wrap items-center gap-[8px] px-[16px] pt-[16px]"><StatusBadges item={row} /></div>
          <div className="px-[16px] pt-[12px]">
            <FactList min={140}>
              <Fact label="Owner" empty="Unassigned">{ownerOf(row) ? <OwnerCell row={row} withName /> : null}</Fact>
              <Fact label="Type">{typeLabel(row.evidence_type)}</Fact>
              <Fact label="Uploaded">{formatDate(row.uploaded_at)}</Fact>
              <Fact label="Collected" empty="Not set">{row.collection_date ? formatDate(row.collection_date, { calendar: true }) : null}</Fact>
              <Fact label="Version">{row.version ? `v${row.version}` : null}</Fact>
              <Fact label="Source" empty="Not set">{row.source_system}</Fact>
            </FactList>
          </div>
          <DetailPreview evidenceId={row.id} onReassess={actions.reassess} canReview={canReview} busy={{ reassess: p.reassess === row.id }} />
        </div>
      )}
    </SidePanel>
  );
}
