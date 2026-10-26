'use client';

/**
 * The cells of the library table, each the CONTENT of one <td> (the table owns the <td>: its background, sticky edge and height).
 * Every text has an explicit size and colour, and no cell leans on the platform's bare <p>/<td> defaults (11.5px, dark) or on
 * slate-* / text-white, which the dashboard CSS repaints (PITFALLS: grc-frontend UI). The second line under a value is shown in the
 * comfortable density only; the compact one is a single line per cell.
 */
import Link from 'next/link';
import type { MouseEvent } from 'react';
import {
  AlertCircle, Archive, ArchiveRestore, ChevronDown, ChevronRight, Clock3, Download, ExternalLink, Eye, File as FileIcon, FileSpreadsheet, FileText,
  FileType, Pencil, Presentation, ShieldAlert, type LucideIcon,
} from 'lucide-react';
import { parseUtc } from '@/lib/serverTime';
import { AttestationRing, ReviewDate } from './atoms';
import { InitialsAvatar, LifecycleDots, TypePill, inForceNote, verLabel, type GovDoc } from './lib';
import { LifecycleHover } from './LifecycleHover';
import { RowActionsMenu } from './RowActionsMenu';
import { GAP, STEP } from './Versions';
import { fileKind, relativeTime, type FileKind } from './libraryFormat';
import { STAGE_ORDER, reviewable, statusLabel } from './libraryModel';
import type { Open } from './libraryTableLogic';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/** "—" for a value that is not there, said in words to a screen reader. */
function Dash({ label }: { label: string }) {
  return (
    <span className="text-[13px] text-[#586472]" title={label}>
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ─── Document ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const TILES: Record<FileKind | 'none', { Icon: LucideIcon; tone: string; label: string }> = {
  pdf: { Icon: FileText, tone: 'bg-[#fff1f2] text-[#be123c]', label: 'PDF file' },
  word: { Icon: FileType, tone: 'bg-[#eff6ff] text-[#1d4ed8]', label: 'Word file' },
  excel: { Icon: FileSpreadsheet, tone: 'bg-[#ecfdf5] text-[#047857]', label: 'Excel file' },
  powerpoint: { Icon: Presentation, tone: 'bg-[#fffbeb] text-[#b45309]', label: 'PowerPoint file' },
  text: { Icon: FileText, tone: 'bg-[#f1f5f9] text-[#475569]', label: 'Text file' },
  other: { Icon: FileIcon, tone: 'bg-[#f1f5f9] text-[#475569]', label: 'File' },
  none: { Icon: FileText, tone: 'bg-[#f0fdfa] text-[#0f766e]', label: 'Written in the platform' },
};

/** The kind of file the document carries, as a tile; a document written on the platform has none and gets the teal one. */
function FileTile({ doc, compact }: { doc: GovDoc; compact: boolean }) {
  const { Icon, tone, label } = TILES[fileKind(doc) ?? 'none'];
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex shrink-0 items-center justify-center rounded-lg ${tone} ${compact ? 'h-6 w-6' : 'h-8 w-8'}`}>
      <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/**
 * The first column's content (the tick box is the table's, beside it): the arrow that opens the versions and the documents under
 * this one, the file tile, and the title, a real link (a plain click opens the document here, a modified one in a new tab) over the
 * document's code. A row shown only for the documents under it ("Parent of a match") is greyed.
 */
export function DocumentCell({ doc, depth, match, childCount, open, parentTitle, compact, onToggle, onOpenDoc }: {
  doc: GovDoc;
  depth: number;
  /** false: shown only because a document under it matches */
  match: boolean;
  childCount: number;
  open: Open;
  /** the title of the document it sits under (said to a screen reader; the indent says it to the eye) */
  parentTitle?: string;
  compact: boolean;
  onToggle: () => void;
  onOpenDoc: (id: number) => void;
}) {
  const toggleLabel = open === 'docs' ? `Hide the documents under ${doc.title}`
    : `${open ? 'Hide' : 'Show'} the versions of ${doc.title}${childCount ? ' and the documents under it' : ''}`;
  const archived = doc.status === 'archived';
  // the clamp is on the wrapper and the link stays inline, so only the words are the link: a click beside a short title opens the drawer
  const title = (
    <div className={`relative min-w-0 text-[13px] leading-[1.35] [overflow-wrap:anywhere] ${compact ? 'truncate' : 'line-clamp-2'}`}>
      <Link
        href={`/governance/documents/${doc.id}`}
        prefetch={false}
        title={doc.title}
        onClick={(e) => {
          e.stopPropagation();                                 // the row behind it opens the drawer
          if (plainClick(e)) { e.preventDefault(); onOpenDoc(doc.id); }
        }}
        // the wrapper clips (line-clamp), so the focus mark is a fill inside the words, not a ring around them
        className={`rounded-sm hover:text-[#0f766e] hover:underline focus-visible:bg-[#ccfbf1] focus-visible:text-[#115e59] focus-visible:underline focus-visible:outline-none ${match ? 'font-medium text-[#1f2933]' : 'text-[#586472]'}`}
      >
        {doc.title}
        {parentTitle && <span className="sr-only">, under {parentTitle}</span>}
      </Link>
    </div>
  );
  const tags = (
    <>
      {archived && <span className="inline-flex items-center rounded border border-[#c3ccd5] bg-[#f3f6f8] px-1.5 text-[11px] font-medium leading-4 text-[#586472]">Archived</span>}
      {!open && childCount > 0 && <span className="whitespace-nowrap text-[11px] text-[#586472]">{childCount} under it</span>}
      {!match && <span className="whitespace-nowrap text-[11px] text-[#586472]">Parent of a match</span>}
    </>
  );
  return (
    <div className="flex min-w-0 flex-1 items-center" style={{ paddingLeft: depth * STEP, gap: GAP }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-expanded={open != null}
        aria-label={toggleLabel}
        title={toggleLabel}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#586472] hover:bg-[#eef2f6] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
      >
        {open ? <ChevronDown className="h-4 w-4" strokeWidth={1.75} aria-hidden /> : <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
      </button>
      <FileTile doc={doc} compact={compact} />
      <div className="min-w-0 flex-1 pl-1">
        {compact ? (
          <div className="flex min-w-0 items-center gap-2">
            {title}
            <span className="flex shrink-0 items-center gap-2">{tags}</span>
          </div>
        ) : (
          <>
            {title}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 empty:hidden">
              {doc.document_code && <span className="font-mono text-[11px] text-[#586472]">{doc.document_code}</span>}
              {tags}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Type, lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function TypeCell({ doc }: { doc: GovDoc }) {
  return <TypePill docType={doc.doc_type} />;
}

/** The five workflow statuses show their dots; expired, archived and an applied exception are outside the workflow: a neutral pill. */
export function LifecycleCell({ doc }: { doc: GovDoc }) {
  const inWorkflow = (STAGE_ORDER as readonly string[]).includes(doc.status);
  const Icon = doc.status === 'archived' ? Archive : doc.status === 'expired' ? Clock3 : ShieldAlert;
  return (
    <LifecycleHover doc={doc} focusable>
      {inWorkflow ? (
        <LifecycleDots status={doc.status} />
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d5dbe1] bg-[#f3f6f8] px-2.5 py-0.5 text-[12px] font-medium text-[#586472]">
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {statusLabel(doc.status)}
        </span>
      )}
    </LifecycleHover>
  );
}

// ─── People ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The owner, and under the name the department (comfortable only). A document in force with no owner is a governance gap: amber. */
export function OwnerCell({ doc, department, compact }: { doc: GovDoc; department?: string; compact: boolean }) {
  const name = doc.owner_name?.trim() || null;
  const gap = !name && reviewable(doc);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {gap ? <AlertCircle className="h-4 w-4 shrink-0 text-[#b45309]" strokeWidth={1.75} aria-hidden /> : <InitialsAvatar name={name} size={compact ? 'sm' : 'md'} />}
      <div className="min-w-0 leading-tight">
        {name ? (
          <span className="block truncate text-[13px] text-[#1f2933]" title={name}>{name}</span>
        ) : (
          <span className={`block truncate text-[13px] ${gap ? 'font-medium text-[#b45309]' : 'text-[#586472]'}`} title={gap ? 'In force with no owner' : 'No owner'}>Unassigned</span>
        )}
        {!compact && department && <span className="block truncate text-[11px] text-[#586472]" title={department}>{department}</span>}
      </div>
    </div>
  );
}

export function DepartmentCell({ name }: { name?: string }) {
  return name ? <span className="block truncate text-[13px] text-[#26323d]" title={name}>{name}</span> : <Dash label="No department" />;
}

// ─── Attestation, review, version, updated ──────────────────────────────────────────────────────────────────────────────

export function AttestationCell({ pct, count, compact }: { pct: number | null | undefined; count?: { done: number; total: number }; compact: boolean }) {
  return <AttestationRing pct={pct} done={count?.done} total={count?.total} size={compact ? 22 : 28} showCounts={!compact} />;
}

export function ReviewCell({ doc, compact }: { doc: GovDoc; compact: boolean }) {
  return <ReviewDate doc={doc} compact={compact} />;
}

/** The version, and under it (comfortable only) the one still in force while a newer one is on its way: the only place that note is. */
export function VersionCell({ doc, compact }: { doc: GovDoc; compact: boolean }) {
  const note = inForceNote(doc);
  return (
    <div className="leading-tight">
      <span className="block whitespace-nowrap text-[13px] font-medium tabular-nums text-[#1f2933]">{verLabel(doc.current_version)}</span>
      {!compact && note && <span className="block whitespace-nowrap text-[11px] text-[#586472]">{note}</span>}
    </div>
  );
}

/** How long ago; the full local date and time is its tooltip. */
export function UpdatedCell({ value }: { value: string | null | undefined }) {
  const at = parseUtc(value);
  const ago = relativeTime(value);
  if (!at || !ago) return <Dash label="No update time" />;
  const full = at.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return <time dateTime={at.toISOString()} title={full} className="whitespace-nowrap text-[12px] text-[#586472]">{ago}</time>;
}

// ─── Actions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An icon button that shows with the row's hover or focus (the row is the `group/row`) and is always a real, labelled button. */
function HoverButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      title={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#586472] opacity-0 hover:bg-[#eef2f6] hover:text-[#1f2933] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] group-hover/row:opacity-100 group-focus-within/row:opacity-100"
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
    </button>
  );
}

/** Open and Download as buttons that appear with the row's hover, and the row's menu (Open, Edit, Download, Archive, Restore) as before. */
export function ActionsCell({ doc, rights, onOpenDoc, onEdit, onDownload, onArchive, onRestore }: {
  doc: GovDoc;
  /** what the menu offers beside Open and Download (libraryTableLogic.rowRights) */
  rights: { edit: boolean; archive: boolean; restore: boolean };
  onOpenDoc: (id: number) => void;
  onEdit: (doc: GovDoc) => void;
  onDownload: (doc: GovDoc) => void;
  onArchive: (doc: GovDoc) => void;
  onRestore?: (doc: GovDoc) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <HoverButton label={`Open ${doc.title}`} icon={ExternalLink} onClick={() => onOpenDoc(doc.id)} />
      <HoverButton label={`Download ${doc.title}`} icon={Download} onClick={() => onDownload(doc)} />
      <RowActionsMenu
        actions={[
          { key: 'open', label: 'Open', icon: Eye, onClick: () => onOpenDoc(doc.id) },
          { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => onEdit(doc), hidden: !rights.edit },
          { key: 'download', label: 'Download', icon: Download, onClick: () => onDownload(doc) },
          { key: 'archive', label: 'Archive', icon: Archive, onClick: () => onArchive(doc), variant: 'danger', hidden: !rights.archive },
          { key: 'restore', label: 'Restore', icon: ArchiveRestore, onClick: () => onRestore?.(doc), hidden: !rights.restore },
        ]}
      />
    </div>
  );
}
