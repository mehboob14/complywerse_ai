'use client';

/**
 * The rows of the Evidence Library's list, as configuration for records/RecordTable: the columns (File, Status, Expiry, Maturity, Owner), the card a phone gets, the row's menu.
 * The name is shown in two lines (the whole name is the link's title and the details panel), with the type and the file name under it; the status is a word with a second word
 * when the file is lapsed (a file can be Approved and Lapsed); the expiry is a dot AND words; the maturity is a bar with its band named, or where the AI review stands; the owner
 * is a person or "Unassigned"; nothing appears only on hover. What a cell says is decided in libraryModel.ts and evidenceModel.ts.
 */
import Link from 'next/link';
import { Eye, FileText, FolderPlus, RefreshCw, Send, ThumbsUp, Trash2 } from 'lucide-react';
import { Menu, PersonChip, StatusPill, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { EMPTY, truncate } from '@/lib/format';
import { parseUtc } from '@/lib/serverTime';
import { statusPill } from '@/lib/status';
import { evidenceStatus } from '@/lib/statuses/evidence';
import { normPct, ownerOf, typeLabel } from '../_workspace/evidenceModel';
import { ExpiryText, MaturityMeter } from '../_workspace/lib';
import { isLapsed, type LibraryRow } from './libraryModel';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const LIBRARY_FIT: Record<'status' | 'expiry' | 'maturity' | 'owner', Omit<FitColumn, 'key'>> = {
  status: { px: 148 },
  expiry: { px: 150, dropRank: 3 },
  maturity: { px: 132, dropRank: 1 },
  owner: { px: 68, dropRank: 2, wide: { px: 176, titleMin: 420 } },
};

export interface RowEnv {
  now: number;
  /** the title was pressed: the details open over the list */
  onPeek: (id: number) => void;
  /** the full record page */
  onRecord: (id: number) => void;
  canReview: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onSubmit: (id: number) => void;
  onApprove: (id: number) => void;
  onRenew: (id: number) => void;
  onDelete: (id: number) => void;
  onPackage: (id: number) => void;
}

const recordHref = (id: number) => `/evidence/${id}`;

/** "Policy · firewall-rules.pdf": what a file is, in one line under its name. */
export const subline = (r: LibraryRow): string => [typeLabel(r.evidence_type), r.file_name].filter(Boolean).join(' · ');

function FileTitle({ row, env }: { row: RecordRow<LibraryRow>; env: RowEnv }) {
  const r = row.record;
  const line = subline(r);
  return (
    <div className="min-w-0">
      <div dir="auto" className="line-clamp-2 min-w-0 text-ds-body [overflow-wrap:anywhere]">
        <Link
          href={recordHref(r.id)}
          prefetch={false}
          title={r.name}
          onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onPeek(r.id); } }}
          className="scroll-mt-[44px] rounded-ds-control py-[1px] font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none"
        >
          {r.name}
        </Link>
      </div>
      {line && <p className="m-0 truncate text-ds-label text-ds-fg-muted" title={line}>{line}</p>}
    </div>
  );
}

/** The workflow status, and "Lapsed" beside it when the file is past its date. */
export function StatusCell({ row, now }: { row: LibraryRow; now: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-[4px]">
      <StatusPill size="sm" {...statusPill(evidenceStatus, row.status)} />
      {isLapsed(row, now) && row.status !== 'expired' && <StatusPill size="sm" {...statusPill(evidenceStatus, 'lapsed')} />}
    </span>
  );
}

/** "12 days left", "Expired 3 days ago", "No expiry"; a file marked lapsed by hand with no date says that. */
export function ExpiryCell({ row, now }: { row: LibraryRow; now: number }) {
  // lapsed with no date that has gone by (marked by hand, or expired by hand): the date would say "days left" or nothing beside a word that says lapsed
  const gone = parseUtc(row.expiry_date)?.getTime();
  if (isLapsed(row, now) && (gone === undefined || gone >= now)) return <span className="whitespace-nowrap text-ds-label font-[600] text-ds-danger">Marked as lapsed</span>;
  if (row.status === 'archived') return <span className="text-ds-label text-ds-fg-muted">{EMPTY}<span className="sr-only">Archived</span></span>;
  return <ExpiryText expiry={row.expiry_date} />;
}

export function OwnerCell({ row, withName = false }: { row: LibraryRow; withName?: boolean }) {
  const name = ownerOf(row);
  if (!name) return <span className="text-ds-body text-ds-fg-muted" title="Nobody owns this file"><span aria-hidden>{EMPTY}</span><span className="sr-only">Unassigned</span></span>;
  return withName ? <PersonChip name={name} /> : (
    <span className="inline-flex" title={`${row.owner_name ? 'Owner' : 'Uploaded by'}: ${name}`}><PersonChip name={name} className="[&>span:last-child]:sr-only" /></span>
  );
}

export function libraryColumns(env: RowEnv): RecordColumn<LibraryRow>[] {
  return [
    { key: 'name', header: 'File', sortKey: 'name', cell: (row) => <RowLead row={row}><FileTitle row={row} env={env} /></RowLead> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: LIBRARY_FIT.status, cell: (row) => <StatusCell row={row.record} now={env.now} /> },
    { key: 'expiry', header: 'Expiry', sortKey: 'expiry', fit: LIBRARY_FIT.expiry, cell: (row) => <ExpiryCell row={row.record} now={env.now} /> },
    { key: 'maturity', header: 'Maturity', sortKey: 'maturity', firstDir: 'desc', fit: LIBRARY_FIT.maturity, cell: (row) => <MaturityMeter score={normPct(row.record.quality_score)} review={row.record.ai_review} barWidth="w-[88px]" /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: LIBRARY_FIT.owner, cell: (row, look) => <OwnerCell row={row.record} withName={look.wide} /> },
  ];
}

/** The card a row is where the list has no room for a table: the name (two lines), the status, the expiry, the owner. */
export function LibraryCard({ row, env }: { row: RecordRow<LibraryRow>; env: RowEnv }) {
  const r = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={r.name} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.name}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusCell row={r} now={env.now} />
        <ExpiryCell row={r} now={env.now} />
        <span className="ml-auto"><OwnerCell row={r} /></span>
      </span>
    </div>
  );
}

/** The cards of the board: a name, then where it stands against its date and who owns it. */
export function BoardCard({ row, now }: { row: LibraryRow; now: number }) {
  return (
    <>
      <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{row.name}</span>
      <span className="truncate text-ds-label text-ds-fg-muted">{typeLabel(row.evidence_type)}</span>
      <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
        <ExpiryCell row={row} now={now} />
        <span className="ml-auto"><OwnerCell row={row} /></span>
      </span>
    </>
  );
}

/** The actions a person can take on one file, as a menu: always drawn, reachable by Tab, Enter and the arrow keys. The same list is the panel's footer in other words. */
export function rowActions(row: LibraryRow, env: RowEnv): MenuItem[] {
  const lapsed = isLapsed(row, env.now);
  return [
    { key: 'open', label: 'Open details', icon: Eye, onSelect: () => env.onPeek(row.id) },
    { key: 'record', label: 'Open full record', icon: FileText, onSelect: () => env.onRecord(row.id) },
    { key: 'submit', label: 'Submit for review', icon: Send, onSelect: () => env.onSubmit(row.id), hidden: row.status !== 'draft' },
    { key: 'approve', label: 'Approve', icon: ThumbsUp, onSelect: () => env.onApprove(row.id), hidden: !(env.canReview && row.status === 'pending_review') },
    { key: 'renew', label: 'Renew', icon: RefreshCw, onSelect: () => env.onRenew(row.id), hidden: !(env.canEdit && lapsed && row.status !== 'archived') },
    { key: 'package', label: 'Add to audit package', icon: FolderPlus, onSelect: () => env.onPackage(row.id), hidden: row.status !== 'approved' || !env.canReview },     // the audit packages page always asked for `create` to add evidence
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => env.onDelete(row.id), hidden: !env.canDelete },
  ];
}

export function RowMenu({ row, env }: { row: LibraryRow; env: RowEnv }) {
  return <Menu label={`Actions for ${truncate(row.name, 60).text}`} iconOnly items={rowActions(row, env)} />;
}

