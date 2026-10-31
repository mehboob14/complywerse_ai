'use client';

/**
 * The cells of the library's register, each the CONTENT of one <td> (the table owns the <td>: its background, sticky edge and height). Written on the design-system
 * tokens (only --ds colours, the 12/13px type, 4px-grid values): the register is on the kit, so a cell reads the same in the page and in a card. A status is a
 * StatusPill from the document registry, a date goes through lib/format.ts (review dates are days: `calendar`), a person is a PersonChip. The second line under a value
 * is shown in the comfortable density only; the compact one is a single line per cell.
 * A row has no hover-only control: the title is the link that opens the document, and the row's menu (Open, Edit, Move to…, Download, Archive, Restore) is always there.
 */
import Link from 'next/link';
import type { CSSProperties, MouseEvent } from 'react';
import {
  AlertCircle, Archive, ArchiveRestore, ChevronDown, ChevronRight, Download, Eye, File as FileIcon, FileSpreadsheet, FileText, FileType, FolderInput, Pencil,
  Presentation, type LucideIcon,
} from 'lucide-react';
import { Menu, PersonChip, StatusPill, type MenuItem } from '@/components/ui/ds';
import { EMPTY, formatDateTime, truncate } from '@/lib/format';
import { parseUtc } from '@/lib/serverTime';
import { TONE, documentStatus, statusPill } from '@/lib/status';
import { AttestationRing, ReviewDate } from './atoms';
import { inForceNote, verLabel, type GovDoc } from './lib';
import { LifecycleHover } from './LifecycleHover';
import { GAP, STEP } from './Versions';
import { fileKind, relativeTime, type FileKind } from './libraryFormat';
import { reviewable, typeLabel } from './libraryModel';
import type { Open } from './libraryTableLogic';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
/** "—" for a value that is not there, said in words to a screen reader. */
function Dash({ label }: { label: string }) {
  return (
    <span className="text-ds-body text-ds-fg-muted" title={label}>
      <span aria-hidden>{EMPTY}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ─── Document ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const TILES: Record<FileKind | 'none', { Icon: LucideIcon; tone: keyof typeof TONE | 'platform'; label: string }> = {
  pdf: { Icon: FileText, tone: 'danger', label: 'PDF file' },
  word: { Icon: FileType, tone: 'progress', label: 'Word file' },
  excel: { Icon: FileSpreadsheet, tone: 'success', label: 'Excel file' },
  powerpoint: { Icon: Presentation, tone: 'warning', label: 'PowerPoint file' },
  text: { Icon: FileText, tone: 'neutral', label: 'Text file' },
  other: { Icon: FileIcon, tone: 'neutral', label: 'File' },
  none: { Icon: FileText, tone: 'platform', label: 'Written in the platform' },
};
const tileStyle = (tone: keyof typeof TONE | 'platform'): CSSProperties =>
  tone === 'platform' ? { background: 'var(--ds-primary-soft)', color: 'var(--ds-primary-text)' } : { background: TONE[tone].tint, color: TONE[tone].text };

/** The kind of file the document carries, as a tile; a document written on the platform has none and gets the teal one. */
export function FileTile({ doc, compact }: { doc: GovDoc; compact: boolean }) {
  const { Icon, tone, label } = TILES[fileKind(doc) ?? 'none'];
  return (
    <span role="img" aria-label={label} title={label} style={tileStyle(tone)} className={`inline-flex shrink-0 items-center justify-center rounded-ds-card ${compact ? 'h-[24px] w-[24px]' : 'h-[32px] w-[32px]'}`}>
      <Icon className="h-[16px] w-[16px]" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** The 24px arrow that opens a document's versions and the documents under it (44px on a touch screen). */
export function ToggleArrow({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-expanded={open}
      aria-label={label}
      title={label}
      className={`inline-grid h-[24px] w-[24px] shrink-0 place-items-center rounded-ds-control text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[44px] ${FOCUS}`}
    >
      {open ? <ChevronDown className="h-[16px] w-[16px]" strokeWidth={1.75} aria-hidden /> : <ChevronRight className="h-[16px] w-[16px]" strokeWidth={1.75} aria-hidden />}
    </button>
  );
}

export const toggleLabel = (doc: { title: string }, open: Open, childCount: number): string =>
  open === 'docs' ? `Hide the documents under ${doc.title}` : `${open ? 'Hide' : 'Show'} the versions of ${doc.title}${childCount ? ' and the documents under it' : ''}`;

/** The title as the link that opens the document (a plain click opens it here, a modified one in a new tab), with the version, the code and the small tags under it. */
export function TitleBlock({ doc, match, childCount, open, parentTitle, compact, showVersion = false, onOpenDoc }: {
  doc: GovDoc;
  match: boolean;
  childCount: number;
  open: Open;
  parentTitle?: string;
  compact: boolean;
  showVersion?: boolean;
  onOpenDoc: (id: number) => void;
}) {
  const archived = doc.status === 'archived';
  // the clamp is on the wrapper and the link stays inline, so only the words are the link: a click beside a short title opens the details panel (3px of padding
  // give the words a 24px target without moving a line)
  const title = (
    <div dir="auto" className={`relative min-w-0 text-ds-body [overflow-wrap:anywhere] ${compact ? 'truncate' : 'line-clamp-2'}`}>
      <Link
        href={`/governance/documents/${doc.id}`}
        prefetch={false}
        title={doc.title}
        onClick={(e) => {
          e.stopPropagation();                                 // the row behind it opens the details panel
          if (plainClick(e)) { e.preventDefault(); onOpenDoc(doc.id); }
        }}
        className={`rounded-ds-control py-[3px] hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none ${match ? 'font-[600] text-ds-fg' : 'text-ds-fg-muted'}`}
      >
        {doc.title}
        {parentTitle && <span className="sr-only">, under {parentTitle}</span>}
      </Link>
    </div>
  );
  const tags = (
    <>
      {archived && <span className="inline-flex items-center rounded-ds-control border border-ds-border-strong bg-ds-surface-hover px-[6px] text-ds-label text-ds-fg-muted">Archived</span>}
      {!open && childCount > 0 && <span className="whitespace-nowrap text-ds-label text-ds-fg-muted" title={`${childCount} ${childCount === 1 ? 'document' : 'documents'} under it`}>+{childCount}</span>}
      {!match && <span className="whitespace-nowrap text-ds-label text-ds-fg-muted" title="Shown because a document under it matches">Parent</span>}
    </>
  );
  return compact ? (
    <div className="flex min-w-0 items-center gap-2">
      {title}
      <span className="flex shrink-0 items-center gap-2">{tags}</span>
    </div>
  ) : (
    <>
      {title}
      <div className="mt-[2px] flex flex-wrap items-center gap-x-2 gap-y-[2px] empty:hidden">
        {doc.document_code && <span className="font-mono text-ds-label text-ds-fg-muted">{doc.document_code}</span>}
        {showVersion && doc.current_version && <span className="text-ds-label tabular-nums text-ds-fg-muted" title={inForceNote(doc) ?? undefined}>v{doc.current_version.replace(/^v/i, '')}</span>}
        {tags}
      </div>
    </>
  );
}

/**
 * The first column's content (the tick box is the table's, in its own column): the arrow that opens the versions and the documents under this one, the file tile, and
 * the title block. A row shown only for the documents under it ("Parent of a match") is greyed.
 */
export function DocumentCell({ doc, depth, match, childCount, open, parentTitle, compact, showVersion = false, onToggle, onOpenDoc, step = STEP }: {
  doc: GovDoc;
  depth: number;
  /** false: shown only because a document under it matches */
  match: boolean;
  childCount: number;
  open: Open;
  /** the title of the document it sits under (said to a screen reader; the indent says it to the eye) */
  parentTitle?: string;
  compact: boolean;
  /** the Version column is off: the version is said here, under the title, after the code */
  showVersion?: boolean;
  onToggle: () => void;
  onOpenDoc: (id: number) => void;
  /** px of indent for each level */
  step?: number;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center" style={{ paddingLeft: depth * step, gap: GAP }}>
      <ToggleArrow open={open != null} label={toggleLabel(doc, open, childCount)} onToggle={onToggle} />
      <FileTile doc={doc} compact={compact} />
      <div className="min-w-0 flex-1 pl-1">
        <TitleBlock doc={doc} match={match} childCount={childCount} open={open} parentTitle={parentTitle} compact={compact} showVersion={showVersion} onOpenDoc={onOpenDoc} />
      </div>
    </div>
  );
}

// ─── Type, lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function TypeCell({ doc }: { doc: GovDoc }) {
  return <span className="block truncate text-ds-body text-ds-fg-body" title={typeLabel(doc.doc_type)}>{typeLabel(doc.doc_type)}</span>;
}

/** The status as its pill (the library's own words are registered in lib/status.ts); where the card of the document's life cycle opens on hover or focus. */
export function LifecycleCell({ doc }: { doc: GovDoc }) {
  return (
    <LifecycleHover doc={doc} focusable>
      <span className="inline-flex py-[2px]"><StatusPill size="sm" {...statusPill(documentStatus, doc.status)} /></span>
    </LifecycleHover>
  );
}

// ─── People ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The owner, and under the name the department (comfortable only). A document in force with no owner is a governance gap: amber. */
export function OwnerCell({ doc, department, compact }: { doc: GovDoc; department?: string; compact: boolean }) {
  const name = doc.owner_name?.trim() || null;
  const gap = !name && reviewable(doc);
  return (
    <div className="min-w-0 leading-tight">
      {name ? <PersonChip name={name} /> : gap ? (
        <span className="inline-flex items-center gap-2 text-ds-body font-[600] text-ds-warning" title="In force with no owner">
          <AlertCircle className="h-[16px] w-[16px] shrink-0" strokeWidth={1.75} aria-hidden />
          Unassigned
        </span>
      ) : <PersonChip name={null} />}
      {!compact && department && <span className="mt-[2px] block truncate text-ds-label text-ds-fg-muted" title={department}>{department}</span>}
    </div>
  );
}

export function DepartmentCell({ name }: { name?: string }) {
  return name ? <span className="block truncate text-ds-body text-ds-fg-body" title={name}>{name}</span> : <Dash label="No department" />;
}

// ─── Attestation, review, version, updated ──────────────────────────────────────────────────────────────────────────────

export function AttestationCell({ pct, count, compact }: { pct: number | null | undefined; count?: { done: number; total: number }; compact: boolean }) {
  return <AttestationRing pct={pct} done={count?.done} total={count?.total} size={compact ? 24 : 28} showCounts={!compact} />;
}

export function ReviewCell({ doc, compact }: { doc: GovDoc; compact: boolean }) {
  return <ReviewDate doc={doc} compact={compact} />;
}

/** The version, and under it (comfortable only) the one still in force while a newer one is on its way: the only place that note is. */
export function VersionCell({ doc, compact }: { doc: GovDoc; compact: boolean }) {
  const note = inForceNote(doc);
  return (
    <div className="leading-tight">
      <span className="block whitespace-nowrap text-ds-body font-[600] tabular-nums text-ds-fg">{verLabel(doc.current_version)}</span>
      {!compact && note && <span className="block whitespace-nowrap text-ds-label text-ds-fg-muted">{note}</span>}
    </div>
  );
}

/** How long ago; the full date and time is its tooltip. */
export function UpdatedCell({ value }: { value: string | null | undefined }) {
  const at = parseUtc(value);
  const ago = relativeTime(value);
  if (!at || !ago) return <Dash label="No update time" />;
  return <time dateTime={at.toISOString()} title={formatDateTime(value)} className="whitespace-nowrap text-ds-body text-ds-fg-muted">{ago}</time>;
}

// ─── Actions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where the row's menu button is, for the Move to… popover that opens beside it: the menu has just given focus back to its button. */
const anchorOfFocus = (): DOMRect | undefined => (document.activeElement instanceof HTMLElement ? document.activeElement.getBoundingClientRect() : undefined);

/** The row's menu: Open, Edit, Move to…, Download, Archive and Restore for the person who may. Always drawn (no hover to find it), reachable by Tab, Enter and the arrow keys. */
export function ActionsCell({ doc, rights, onOpenDoc, onEdit, onDownload, onArchive, onRestore, canMove = false, onMove }: {
  doc: GovDoc;
  /** what the menu offers beside Open and Download (libraryTableLogic.rowRights) */
  rights: { edit: boolean; archive: boolean; restore: boolean };
  onOpenDoc: (id: number) => void;
  onEdit: (doc: GovDoc) => void;
  onDownload: (doc: GovDoc) => void;
  onArchive: (doc: GovDoc) => void;
  onRestore?: (doc: GovDoc) => void;
  /** Move to…: the person may change this document and the page can move it; `anchor` is the ⋯ button's box */
  canMove?: boolean;
  onMove?: (doc: GovDoc, anchor?: DOMRect) => void;
}) {
  const items: MenuItem[] = [
    { key: 'open', label: 'Open', icon: Eye, onSelect: () => onOpenDoc(doc.id) },
    { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => onEdit(doc), hidden: !rights.edit },
    { key: 'move', label: 'Move to…', icon: FolderInput, onSelect: () => onMove?.(doc, anchorOfFocus()), hidden: !(canMove && onMove) },
    { key: 'download', label: 'Download', icon: Download, onSelect: () => onDownload(doc) },
    { key: 'archive', label: 'Archive', icon: Archive, onSelect: () => onArchive(doc), danger: true, hidden: !rights.archive },
    { key: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: () => onRestore?.(doc), hidden: !rights.restore },
  ];
  return <Menu label={`Actions for ${truncate(doc.title, 60).text}`} iconOnly items={items} />;
}
