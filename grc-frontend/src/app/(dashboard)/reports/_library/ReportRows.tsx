'use client';

/**
 * The rows of the Reports library, as configuration for records/RecordTable: the columns (Report, Module, Sharing, Last saved), the card a narrow list gets and the row's menu. The name is a
 * link to the report in the builder (two lines, the whole text is the tooltip), what is wrong with a report is words under it, and nothing appears only on hover: every action of a row is in its
 * menu, reachable by Tab, Enter and the arrow keys. What a row IS, is libraryModel.ts.
 */
import Link from 'next/link';
import { Copy, Download, ExternalLink, FileSpreadsheet, FileText, Lock, Pencil, RotateCw, Trash2, Users } from 'lucide-react';
import { Menu, StatusPill, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { reportSync, reportVisibility } from '@/lib/statuses/reports';
import { builderHref } from './libraryAddress';
import { FORMATS, FORMAT_LABEL, type FileFormat } from './fileModel';
import type { LibraryRow } from './libraryModel';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const LIBRARY_FIT: Record<'module' | 'sharing' | 'updated', Omit<FitColumn, 'key'>> = {
  sharing: { px: 196 },
  updated: { px: 116, dropRank: 2 },
  module: { px: 200, dropRank: 1 },
};

export interface RowEnv {
  /** open the report in the builder */
  onOpen: (row: LibraryRow) => void;
  onDownload: (row: LibraryRow, format: FileFormat) => void;
  onEdit: (row: LibraryRow) => void;
  onShare: (row: LibraryRow) => void;
  onDuplicate: (row: LibraryRow) => void;
  onDelete: (row: LibraryRow) => void;
  onResend: (row: LibraryRow) => void;
  onForget: (row: LibraryRow) => void;
}

/** The pills of a row: who can see it, and, when the server does not hold it, where it is. */
export function SharingCell({ row }: { row: LibraryRow }) {
  return (
    <span className="flex flex-wrap items-center gap-[4px]">
      <StatusPill size="sm" {...statusPill(reportVisibility, row.visibility)} />
      {row.sync !== 'synced' && <StatusPill size="sm" {...statusPill(reportSync, row.sync)} />}
    </span>
  );
}

/** What is wrong with the report, in words under its name (nothing when it is fine). */
function Notes({ row }: { row: LibraryRow }) {
  const notes: string[] = [];
  if (!row.openable) notes.push('You do not have access to this module');
  if (row.sync === 'refused') notes.push('The server did not accept this report');
  if (row.sync === 'device') notes.push('Waiting to be saved');
  if (notes.length === 0) return null;
  return <span className="block text-ds-label font-[600] text-ds-warning">{notes.join(' · ')}</span>;
}

function ReportTitle({ row, env, compact }: { row: RecordRow<LibraryRow>; env: RowEnv; compact?: boolean }) {
  const r = row.record;
  return (
    <div className="min-w-0">
      <div dir="auto" className={`min-w-0 text-ds-body [overflow-wrap:anywhere] ${compact ? 'truncate' : 'line-clamp-2'}`}>
        <Link
          href={builderHref(r.slug)}
          prefetch={false}
          title={r.name}
          onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onOpen(r); } }}
          className="scroll-mt-[44px] rounded-ds-control py-[1px] font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none"
        >
          {r.name}
        </Link>
      </div>
      {r.description && <span dir="auto" title={r.description} className="block max-w-full truncate text-ds-label text-ds-fg-muted">{r.description}</span>}
      <Notes row={r} />
    </div>
  );
}

export function libraryColumns(env: RowEnv): RecordColumn<LibraryRow>[] {
  return [
    { key: 'name', header: 'Report', sortKey: 'name', cell: (row) => <RowLead row={row}><ReportTitle row={row} env={env} /></RowLead> },
    {
      key: 'module', header: 'Module', sortKey: 'module', fit: LIBRARY_FIT.module,
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block truncate text-ds-body text-ds-fg" title={row.record.module}>{row.record.module}</span>
          <span className="block truncate text-ds-label text-ds-fg-muted" title={row.record.dataset}>{row.record.dataset}</span>
        </span>
      ),
    },
    { key: 'sharing', header: 'Sharing', fit: LIBRARY_FIT.sharing, cell: (row) => <SharingCell row={row.record} /> },
    { key: 'updated', header: 'Last saved', sortKey: 'updated', firstDir: 'desc', fit: LIBRARY_FIT.updated, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDate(row.record.updatedAt)}</span> },
  ];
}

/** The card a row is where the list has no room for a table: the name, then who can see it, the module and when it was saved. */
export function ReportCard({ row }: { row: RecordRow<LibraryRow> }) {
  const r = row.record;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={r.name} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.name}</span>
      <Notes row={r} />
      <SharingCell row={r} />
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[2px] text-ds-label text-ds-fg-muted">
        <span className="min-w-0 truncate" title={`${r.module} · ${r.dataset}`}>{r.module}</span>
        <span className="ml-auto whitespace-nowrap">{formatDate(r.updatedAt)}</span>
      </span>
    </div>
  );
}

const FORMAT_ICON: Record<FileFormat, typeof Download> = { csv: FileText, excel: FileSpreadsheet, word: FileText, pdf: FileText };

/** The row's menu: open, download, and what the owner may do. Always drawn; what a person cannot do is left out, what cannot be done right now is shown with the reason. */
export function rowMenuItems(r: LibraryRow, env: RowEnv): MenuItem[] {
  const noModule = r.openable ? undefined : 'You do not have access to the module this report reads.';
  const summary = r.summary ? 'This report is a summary. Open it to download the summary.' : undefined;
  const owner = r.mine;
  const onServer = r.sync === 'synced';
  const manage: MenuItem[] = [
    { key: 'edit', label: 'Edit details', icon: Pencil, onSelect: () => env.onEdit(r), hidden: !owner || !onServer },
    { key: 'share', label: r.visibility === 'shared' ? 'Make private' : 'Share with everyone', icon: r.visibility === 'shared' ? Lock : Users, onSelect: () => env.onShare(r), hidden: !owner || !onServer },
    { key: 'copy', label: 'Make a copy', icon: Copy, onSelect: () => env.onDuplicate(r), hidden: !onServer },
    { key: 'resend', label: 'Save to the server again', icon: RotateCw, onSelect: () => env.onResend(r), hidden: onServer },
    { key: 'forget', label: 'Remove from this device', icon: Trash2, onSelect: () => env.onForget(r), danger: true, hidden: onServer },
    { key: 'delete', label: 'Delete', icon: Trash2, onSelect: () => env.onDelete(r), danger: true, hidden: !owner || !onServer },
  ];
  const first = manage.find((m) => !m.hidden);                    // the group's title goes on its first visible item
  if (first) first.section = 'Manage';
  return [
    { key: 'open', label: 'Open', icon: ExternalLink, onSelect: () => env.onOpen(r), disabled: !r.openable, reason: noModule },
    ...FORMATS.map((f, i): MenuItem => ({
      key: `download:${f}`, label: FORMAT_LABEL[f], icon: FORMAT_ICON[f], section: i === 0 ? 'Download' : undefined,
      onSelect: () => env.onDownload(r, f), disabled: !r.openable || r.summary, reason: noModule ?? summary,
    })),
    ...manage,
  ];
}

export function RowMenu({ row, env }: { row: LibraryRow; env: RowEnv }) {
  return <Menu label={`Actions for ${truncate(row.name, 60).text}`} iconOnly items={rowMenuItems(row, env)} />;
}
