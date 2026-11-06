'use client';

/**
 * The rows of the Facet explorer's list, as configuration for records/RecordTable: the columns (Document, Status, Next review, Owner, Frameworks), the card a phone gets, the
 * row's menu. The row is cut to what decides: the title (the link that opens the document's details), a line under it (code, version, department), the status with its life-cycle
 * card, the next review date and how far off it is, the owner as an avatar (the name is its label), and the frameworks as ONE count button that opens the whole list. Nothing
 * appears only on hover. The cells are the library's own (cells.tsx, atoms.tsx, FrameworksCell.tsx): the same words, the same rules, drawn tighter.
 */
import Link from 'next/link';
import { AlertCircle, Archive, ArchiveRestore, Download, Eye, FolderInput, Pencil } from 'lucide-react';
import { Avatar, Menu, StatusPill, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import { EMPTY, truncate } from '@/lib/format';
import { documentStatus, statusPill } from '@/lib/status';
import { ReviewDate } from './atoms';
import { FileTile, LifecycleCell } from './cells';
import { FrameworksCell } from './FrameworksCell';
import { inForceNote, verLabel, type GovDoc } from './lib';
import { reviewState, reviewable, type FrameworkInfo, type Lookups } from './libraryModel';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export interface RowEnv {
  lookups: Lookups;
  /** the instant every review rule is read at */
  now: Date;
  info: Record<string, FrameworkInfo>;
  /** Filters.frameworks: the chosen ones lead the list a count button opens */
  preferFrameworks: string[];
  compact: boolean;
  /** the title was pressed: the details open over the list */
  onPeek: (id: number) => void;
  onPickFramework: (id: number) => void;
  /** what the row's menu offers this person for this document */
  rights: (doc: GovDoc) => { edit: boolean; archive: boolean; restore: boolean };
  canMove: (doc: GovDoc) => boolean;
  onOpenDoc: (id: number) => void;
  onEdit: (doc: GovDoc) => void;
  onDownload: (doc: GovDoc) => void;
  onArchive: (doc: GovDoc) => void;
  onRestore: (doc: GovDoc) => void;
  onMove: (doc: GovDoc, anchor?: DOMRect) => void;
}

const departmentOf = (doc: GovDoc, lookups: Lookups): { name?: string; path?: string } => {
  if (doc.department_id == null) return {};
  const key = String(doc.department_id);
  return { name: lookups.departments[key], path: lookups.departmentPaths?.[key] };
};

/** "LIB-013 · v2.1 · Information Security": what a document is, in one line under its title. The version in force, when a newer one is on its way, is in the line's title. */
export function subline(doc: GovDoc, lookups: Lookups): { text: string; title: string } {
  const dept = departmentOf(doc, lookups);
  const note = inForceNote(doc);
  const parts = [doc.document_code, doc.current_version ? verLabel(doc.current_version) : null, dept.name].filter((p): p is string => !!p);
  return { text: parts.join(' · '), title: [parts.join(' · '), note, dept.path && dept.path !== dept.name ? dept.path : null].filter(Boolean).join(' — ') };
}

function DocumentTitle({ row, env }: { row: RecordRow<GovDoc>; env: RowEnv }) {
  const doc = row.record;
  const { text, title } = subline(doc, env.lookups);
  const open = !!row.nested?.open;
  return (
    <div className="flex min-w-0 items-center gap-[8px]">
      <FileTile doc={doc} compact />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-[8px]">
          <Link
            href={`/governance/documents/${doc.id}`}
            prefetch={false}
            dir="auto"
            title={doc.title}
            aria-current={undefined}
            onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onPeek(doc.id); } }}
            className={`min-w-0 truncate rounded-ds-control py-[1px] text-ds-body hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring ${row.context ? 'text-ds-fg-muted' : 'font-[600] text-ds-fg'}`}
          >
            {doc.title}
            {row.depth > 0 && <span className="sr-only">, under another document</span>}
          </Link>
          {doc.status === 'archived' && <span className="shrink-0 rounded-ds-control border border-ds-border-strong bg-ds-surface-hover px-[6px] text-ds-label text-ds-fg-muted">Archived</span>}
          {!open && row.nested && row.nested.count > 0 && <span className="shrink-0 whitespace-nowrap text-ds-label text-ds-fg-muted" title={`${row.nested.count} ${row.nested.count === 1 ? 'document' : 'documents'} under it`}>+{row.nested.count}</span>}
          {row.context && <span className="shrink-0 whitespace-nowrap text-ds-label text-ds-fg-muted" title="Shown because a document under it matches">Parent of a match</span>}
        </div>
        {!env.compact && text && <p className="m-0 truncate text-ds-label text-ds-fg-muted" title={title}>{text}</p>}
      </div>
    </div>
  );
}

/** The owner as an avatar; the name is its label and its title. A document in force with no owner is a governance gap: amber. */
export function OwnerAvatar({ doc, withName = false }: { doc: GovDoc; withName?: boolean }) {
  const name = doc.owner_name?.trim() || null;
  if (!name) {
    const gap = reviewable(doc);
    return gap ? (
      <span className="inline-flex items-center gap-[4px] text-ds-body font-[600] text-ds-warning" title="In force with no owner">
        <AlertCircle aria-hidden className="h-[16px] w-[16px] shrink-0" strokeWidth={1.75} />
        <span className={withName ? '' : 'sr-only'}>Unassigned</span>
      </span>
    ) : (
      <span className="text-ds-body text-ds-fg-muted" title="No owner"><span aria-hidden>{EMPTY}</span><span className="sr-only">Unassigned</span></span>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-[8px]" title={name}>
      <Avatar name={name} size={24} decorative />
      <span className={withName ? 'min-w-0 truncate text-ds-body text-ds-fg-body' : 'sr-only'}>{name}</span>
    </span>
  );
}

export function documentColumns(env: RowEnv): RecordColumn<GovDoc>[] {
  return [
    { key: 'title', header: 'Document', sortKey: 'title', cell: (row) => <RowLead row={row}><DocumentTitle row={row} env={env} /></RowLead> },
    { key: 'status', header: 'Status', sortKey: 'lifecycle', width: 'w-[128px]', cell: (row) => <LifecycleCell doc={row.record} /> },
    { key: 'review', header: 'Next review', sortKey: 'review', width: 'w-[132px]', priority: 2, cell: (row) => <ReviewDate doc={row.record} now={env.now} compact={env.compact} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', width: 'w-[72px] 2xl:w-[176px]', priority: 2, cell: (row) => <><span className="2xl:hidden"><OwnerAvatar doc={row.record} /></span><span className="hidden min-w-0 2xl:inline"><OwnerAvatar doc={row.record} withName /></span></> },
    {
      key: 'frameworks', header: 'Frameworks', sortKey: 'frameworks', firstDir: 'desc', width: 'w-[96px]', priority: 3,
      cell: (row) => <FrameworksCell as="count" doc={row.record} info={env.info} prefer={env.preferFrameworks} onPick={env.onPickFramework} />,
    },
  ];
}

/** The card a phone gets: the title, then the status, the next review and the owner. */
export function DocumentCard({ row, env }: { row: RecordRow<GovDoc>; env: RowEnv }) {
  const doc = row.record;
  const s = reviewState(doc, env.now);
  const { text, title } = subline(doc, env.lookups);
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={doc.title} className={`line-clamp-2 text-ds-body [overflow-wrap:anywhere] ${row.context ? 'text-ds-fg-muted' : 'font-[600] text-ds-fg'}`}>{doc.title}</span>
      {text && <span className="truncate text-ds-label text-ds-fg-muted" title={title}>{text}</span>}
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusPill size="sm" {...statusPill(documentStatus, doc.status)} />
        {s.label && <span className="text-ds-label text-ds-fg-muted">{s.long || s.label}</span>}
        <span className="ml-auto"><OwnerAvatar doc={doc} /></span>
      </span>
    </div>
  );
}

/** The row's menu: Open, Edit, Move to…, Download, Archive, Restore, for the person who may. Always drawn; reachable by Tab, Enter and the arrow keys. */
export function RowMenu({ doc, env }: { doc: GovDoc; env: RowEnv }) {
  const rights = env.rights(doc);
  const items: MenuItem[] = [
    { key: 'open', label: 'Open', icon: Eye, onSelect: () => env.onOpenDoc(doc.id) },
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => env.onEdit(doc), hidden: !rights.edit },
    { key: 'move', label: 'Move to…', icon: FolderInput, onSelect: () => env.onMove(doc, document.activeElement instanceof HTMLElement ? document.activeElement.getBoundingClientRect() : undefined), hidden: !env.canMove(doc) },
    { key: 'download', label: 'Download', icon: Download, onSelect: () => env.onDownload(doc) },
    { key: 'archive', label: 'Archive', icon: Archive, onSelect: () => env.onArchive(doc), danger: true, hidden: !rights.archive },
    { key: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: () => env.onRestore(doc), hidden: !rights.restore },
  ];
  return <Menu label={`Actions for ${truncate(doc.title, 60).text}`} iconOnly items={items} />;
}
