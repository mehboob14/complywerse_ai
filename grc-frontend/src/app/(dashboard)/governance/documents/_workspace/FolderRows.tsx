'use client';

/**
 * The parts of the library's Folders view that are not a document row: a folder's header row, the "Show N more" row under a folder's
 * documents, the strip above the table (Expand all / Collapse all and the counts) and the two states of a view with no folders to
 * show (no departments yet, departments that could not be read). The document rows are the table's own (RecordTable draws them, one
 * level deeper than the folder); which folders there are and what they count is libraryFolders.ts. On a phone a folder is a card of its own (FolderHeadCard)
 * with the documents under it as cards. Written on the design-system tokens, 12px at the least.
 */
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Folder, FolderOpen } from 'lucide-react';
import { Button, EmptyState, ErrorState } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { withFrom } from '@/components/shell/withFrom';
import { formatCount } from '@/lib/format';
import { folderAria, expandable, statusSummary, type FolderNode } from './libraryFolders';
import { foldersLine } from './libraryNumbers';
import { useHere } from './useHere';
import { STEP } from './Versions';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const fmt = formatCount;
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

// ─── A folder's header ───────────────────────────────────────────────────────────────────────────────────────────────────

/** What a folder's header says: the arrow, the folder, its name, how many documents are in it (the folders inside it included), what they are ("3 published · 2 draft"),
 *  a red "N overdue" and "Inactive" where they apply. A folder with nothing in it has nothing to open and is quiet. */
function FolderBody({ node, open }: { node: FolderNode; open: boolean }) {
  const openable = expandable(node);
  const empty = node.total.docs === 0;
  const summary = statusSummary(node.total);
  const Icon = open && openable ? FolderOpen : Folder;
  return (
    <>
      {openable
        ? (open ? <ChevronDown className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} aria-hidden /> : <ChevronRight className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} aria-hidden />)
        : <span className="h-[16px] w-[16px] shrink-0" aria-hidden />}
      <Icon className={`h-[18px] w-[18px] shrink-0 ${empty || node.id === null ? 'text-ds-fg-muted' : 'text-ds-primary-text'}`} strokeWidth={1.75} aria-hidden />
      <span dir="auto" className={`min-w-0 max-w-full truncate text-ds-body font-[600] ${empty ? 'text-ds-fg-muted' : 'text-ds-fg'}`} title={node.name}>{node.name}</span>
      {empty ? (
        <span className="text-ds-label text-ds-fg-muted">Empty</span>
      ) : (
        <>
          <span
            className="rounded-full bg-ds-border px-[6px] text-ds-label tabular-nums text-ds-fg-body"
            title={node.total.docs !== node.own.docs ? `${plural(node.total.docs, 'document', 'documents')}, ${fmt(node.own.docs)} directly in it` : undefined}
          >
            {fmt(node.total.docs)}
          </span>
          {summary && <span className="text-ds-label text-ds-fg-muted">{summary}</span>}
        </>
      )}
      {node.total.overdue > 0 && (
        <span className="whitespace-nowrap rounded-full border border-ds-danger-border bg-ds-danger-soft px-2 text-ds-label text-ds-danger" title="Reviews that are overdue">
          {fmt(node.total.overdue)} overdue
        </span>
      )}
      {node.inactive && (
        <span className="whitespace-nowrap rounded-ds-control border border-ds-border-strong bg-ds-surface-hover px-[6px] text-ds-label text-ds-fg-muted" title="This department is switched off">Inactive</span>
      )}
    </>
  );
}

/**
 * One row across the whole table: a tick box for the folder's documents, then the folder's header. A click anywhere on the row opens or closes it; the arrow, name and counts are
 * one real button (Tab reaches it, Enter and Space open it) that says what it controls and whether it is open. The content is pinned to the left edge, so it stays in
 * view when the table has scrolled sideways; on a narrow screen it wraps to a second line.
 */
export function FolderHeadRow({ node, open, colSpan, tick, headId, controls, onToggle }: {
  node: FolderNode;
  open: boolean;
  colSpan: number;
  /** the tick box for the folder's documents, or a spacer of the same width; null: the table has no tick boxes */
  tick: ReactNode;
  /** this row's id, which the folder above it lists in aria-controls */
  headId: string;
  /** the ids of what this folder controls: the folders inside it and its documents */
  controls: string[];
  onToggle: () => void;
}) {
  const openable = expandable(node);
  const body = <FolderBody node={node} open={open} />;
  return (
    <tr
      id={headId}
      data-folder-row={node.key}
      onClick={(e) => {
        if (!openable || (e.target as HTMLElement).closest('[data-no-peek], input, label')) return;      // the tick box is not a click on the row
        onToggle();
      }}
      className={`group/folder min-h-[44px] ${openable ? 'cursor-pointer' : ''}`}
    >
      <td colSpan={colSpan} className={`border-b border-ds-border bg-ds-surface-subtle px-[12px] align-middle ${openable ? 'group-hover/folder:bg-ds-surface-hover' : ''} [&&]:!py-[6px]`}>
        <div className="sticky left-[12px] flex w-full items-center gap-2">
          {tick}
          <div className="flex min-w-0 flex-1 items-center" style={{ paddingLeft: node.depth * STEP }}>
            {openable ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={open && controls.length > 0 ? controls.join(' ') : undefined}
                aria-label={folderAria(node)}
                className={`flex min-h-ds-control min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-[2px] rounded-ds-control py-[2px] text-left ${FOCUS}`}
              >
                {body}
              </button>
            ) : (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-[2px] py-[2px]" aria-label={folderAria(node)} role="group">{body}</div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

/** The phone's folder: a card-wide header. The same header, a tick box beside it, and one button that opens and closes it. */
export function FolderHeadCard({ node, open, tick, headId, controls, onToggle }: {
  node: FolderNode;
  open: boolean;
  tick: ReactNode;
  headId: string;
  controls: string[];
  onToggle: () => void;
}) {
  const openable = expandable(node);
  const body = <FolderBody node={node} open={open} />;
  return (
    <li id={headId} data-folder-row={node.key} className="rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[6px]" style={{ marginLeft: node.depth * 16 }}>
      <div className="flex items-center gap-2">
        {tick}
        {openable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={open && controls.length > 0 ? controls.join(' ') : undefined}
            aria-label={folderAria(node)}
            className={`flex min-h-ds-control min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-[2px] rounded-ds-control text-left ${FOCUS}`}
          >
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-[2px]" aria-label={folderAria(node)} role="group">{body}</div>
        )}
      </div>
    </li>
  );
}

// ─── Show N more ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Under a folder's documents when it holds more than are listed: "Show 12 more" lists them (50 at a time); once every one is listed
 *  the same button reads "Show fewer" and goes back to the first ones, so the key that was pressed is still there to press. */
export function ShowMore({ indent, hidden, step, onMore, onFewer, folder }: {
  /** px from the left edge: under the arrow of the folder's documents */
  indent: number;
  /** documents not listed yet */
  hidden: number;
  /** how many one click lists */
  step: number;
  onMore: () => void;
  onFewer: () => void;
  folder: string;
}) {
  const more = hidden > 0;
  return (
    <div className="sticky left-[12px] flex w-full items-center gap-2" style={{ paddingLeft: indent }}>
      <Button
        variant="link"
        size="sm"
        onClick={more ? onMore : onFewer}
        aria-label={more ? `Show ${step} more documents in ${folder}` : `Show fewer documents in ${folder}`}
        leftIcon={more ? <ChevronDown aria-hidden /> : <ChevronsDownUp aria-hidden />}
      >
        {more ? `Show ${fmt(step)} more` : 'Show fewer'}
      </Button>
      {more && step < hidden && <span className="text-ds-label tabular-nums text-ds-fg-muted">{fmt(hidden)} left</span>}
    </div>
  );
}

export function ShowMoreRow({ colSpan, ...rest }: { colSpan: number } & Parameters<typeof ShowMore>[0]) {
  return (
    <tr data-more-row className="min-h-[44px]">
      <td colSpan={colSpan} className="border-b border-ds-border bg-ds-surface px-[12px] align-middle [&&]:!py-[6px]"><ShowMore {...rest} /></td>
    </tr>
  );
}

export function ShowMoreCard(props: Parameters<typeof ShowMore>[0]) {
  return <li data-more-row className="px-[4px]"><ShowMore {...props} /></li>;
}

// ─── The strip above the table ───────────────────────────────────────────────────────────────────────────────────────────

/** Expand all / Collapse all (folders, and the documents under documents), and the counts: "6 folders · 128 documents". */
export function FoldersToolbar({ allOpen, canFold, onToggleAll, folders, documents, loaded, total }: {
  allOpen: boolean;
  /** some folder has something to open */
  canFold: boolean;
  onToggleAll: () => void;
  folders: number;
  documents: number;
  /** how many documents the page loaded and how many exist: when they differ, the count says it is over the loaded ones */
  loaded?: number;
  total?: number | null;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-[12px]">
      {canFold ? (
        <Button size="sm" variant="ghost" onClick={onToggleAll} leftIcon={allOpen ? <ChevronsDownUp aria-hidden /> : <ChevronsUpDown aria-hidden />}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </Button>
      ) : <span />}
      <span className="flex items-center gap-1 text-ds-label tabular-nums text-ds-fg-muted">
        <span role="status">{loaded == null ? `${plural(folders, 'folder', 'folders')} · ${plural(documents, 'document', 'documents')}` : foldersLine({ folders, documents, loaded, total })}</span>
        <InfoTip
          label="About folders"
          align="end"
          text="Documents are grouped by their department. A folder's number counts every document in it, the folders inside it included. A document that is in no department, or in one that no longer exists, is in No department."
        />
      </span>
    </div>
  );
}

// ─── No folders to show ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Folders chosen, but the organisation has no department in use yet: where to make them. */
export function NoDepartments({ canAdd = true }: { canAdd?: boolean }) {
  const here = useHere();
  return (
    <EmptyState
      kind="firstUse"
      bare
      icon={Folder}
      title="No departments yet"
      action={canAdd ? <Button href={withFrom('/governance/settings', here)}>Set up departments</Button> : undefined}
    />
  );
}

/** The departments could not be read: the folders cannot be told from "No department" without them, so none are drawn. */
export function DepartmentsFailed({ onRetry }: { onRetry: () => void }) {
  return <ErrorState title="Could not load departments" message="The folders cannot be told apart without them." onRetry={onRetry} />;
}
