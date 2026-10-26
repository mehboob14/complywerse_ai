'use client';

/**
 * The parts of the library's Folders view that are not a document row: a folder's header row, the "Show N more" row under a folder's
 * documents, the strip above the table (Expand all / Collapse all and the counts) and the two states of a view with no folders to
 * show (no departments yet, departments that could not be read). The document rows are the table's own (LibraryTable draws them, one
 * level deeper than the folder); which folders there are and what they count is libraryFolders.ts. Every size and colour is explicit:
 * the platform CSS repaints white and slate, forces 12px on a <button>, and gives a bare <td> its own size and colour (PITFALLS 100).
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Folder, FolderOpen } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { BTN } from '@/components/governance/docUi';
import { folderAria, expandable, statusSummary, type FolderNode } from './libraryFolders';
import { STEP } from './Versions';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

// ─── A folder's header ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One row across the whole table: a tick box for the folder's documents, the arrow, the folder, its name, how many documents are in it
 * (the folders inside it included), what they are ("3 published · 2 draft"), a red "N overdue" and "Inactive" where they apply. A click
 * anywhere on the row opens or closes it; the arrow, name and counts are one real button (Tab reaches it, Enter and Space open it)
 * that says what it controls and whether it is open. The content is pinned to the left edge, so it stays in view when the table has
 * scrolled sideways; on a narrow screen it wraps to a second line. A folder with nothing in it has nothing to open and is quiet.
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
  const empty = node.total.docs === 0;
  const summary = statusSummary(node.total);
  const Icon = open && openable ? FolderOpen : Folder;
  const body = (
    <>
      {openable
        ? (open ? <ChevronDown className="h-4 w-4 shrink-0 text-[#586472]" strokeWidth={1.75} aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-[#586472]" strokeWidth={1.75} aria-hidden />)
        : <span className="h-4 w-4 shrink-0" aria-hidden />}
      <Icon className={`h-[18px] w-[18px] shrink-0 ${empty || node.id === null ? 'text-[#9aa5b1]' : 'text-[#0f766e]'}`} strokeWidth={1.75} aria-hidden />
      <span className={`min-w-0 max-w-full truncate text-[13px] font-semibold ${empty ? 'text-[#586472]' : 'text-[#1f2933]'}`} title={node.name}>{node.name}</span>
      {empty ? (
        <span className="text-[12px] text-[#7b8794]">Empty</span>
      ) : (
        <>
          <span
            className="rounded-full bg-[#e8ecf0] px-1.5 text-[11px] font-medium leading-4 tabular-nums text-[#26323d]"
            title={node.total.docs !== node.own.docs ? `${plural(node.total.docs, 'document', 'documents')}, ${fmt(node.own.docs)} directly in it` : undefined}
          >
            {fmt(node.total.docs)}
          </span>
          {summary && <span className="whitespace-nowrap text-[12px] text-[#586472]">{summary}</span>}
        </>
      )}
      {node.total.overdue > 0 && (
        <span className="whitespace-nowrap rounded-full border border-[#f1b5ae] bg-[#fef3f2] px-2 text-[11px] font-medium leading-4 text-[#b42318]" title="Reviews that are overdue">
          {fmt(node.total.overdue)} overdue
        </span>
      )}
      {node.inactive && (
        <span className="whitespace-nowrap rounded border border-[#c3ccd5] bg-[#f3f6f8] px-1.5 text-[11px] font-medium leading-4 text-[#586472]" title="This department is switched off">Inactive</span>
      )}
    </>
  );
  return (
    <tr
      id={headId}
      data-folder-row={node.key}
      onClick={(e) => {
        if (!openable || (e.target as HTMLElement).closest('[data-no-peek], input, label')) return;      // the tick box is not a click on the row
        onToggle();
      }}
      className={`group/folder h-11 ${openable ? 'cursor-pointer' : ''}`}
    >
      <td colSpan={colSpan} className={`border-b border-[#e1e6eb] bg-[#f8fafb] px-[12px] align-middle ${openable ? 'group-hover/folder:bg-[#f1f5f7]' : ''}`}>
        <div className="sticky left-[12px] flex w-[60rem] max-w-[calc(100vw-4rem)] items-center gap-2 py-1">
          {tick}
          <div className="flex min-w-0 flex-1 items-center" style={{ paddingLeft: node.depth * STEP }}>
            {openable ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={open && controls.length > 0 ? controls.join(' ') : undefined}
                aria-label={folderAria(node)}
                className={`flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md py-0.5 text-left ${FOCUS}`}
              >
                {body}
              </button>
            ) : (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5" aria-label={folderAria(node)} role="group">{body}</div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Show N more ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Under a folder's documents when it holds more than are listed: "Show 12 more" lists them (50 at a time); once every one is listed
 *  the same button reads "Show fewer" and goes back to the first ones, so the key that was pressed is still there to press. */
export function ShowMoreRow({ colSpan, indent, hidden, step, onMore, onFewer, folder }: {
  colSpan: number;
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
    <tr data-more-row className="h-11">
      <td colSpan={colSpan} className="border-b border-[#e1e6eb] bg-[#fff] px-[12px] align-middle">
        <div className="sticky left-[12px] flex w-[44rem] max-w-[calc(100vw-4rem)] items-center gap-2" style={{ paddingLeft: indent }}>
          <button
            type="button"
            onClick={more ? onMore : onFewer}
            aria-label={more ? `Show ${step} more documents in ${folder}` : `Show fewer documents in ${folder}`}
            className={`inline-flex h-8 items-center gap-1 rounded-md px-2 !text-[13px] font-medium text-[#0f766e] hover:bg-[#f0fdfa] ${FOCUS}`}
          >
            {more ? <ChevronDown className="h-4 w-4" strokeWidth={1.75} aria-hidden /> : <ChevronsDownUp className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
            {more ? `Show ${fmt(step)} more` : 'Show fewer'}
          </button>
          {more && step < hidden && <span className="text-[12px] tabular-nums text-[#586472]">{fmt(hidden)} left</span>}
        </div>
      </td>
    </tr>
  );
}

// ─── The strip above the table ───────────────────────────────────────────────────────────────────────────────────────────

/** Expand all / Collapse all (folders, and the documents under documents), and the counts: "6 folders · 128 documents". */
export function FoldersToolbar({ allOpen, canFold, onToggleAll, folders, documents }: {
  allOpen: boolean;
  /** some folder has something to open */
  canFold: boolean;
  onToggleAll: () => void;
  folders: number;
  documents: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#e1e6eb] px-[12px] py-[6px]">
      {canFold ? (
        <button
          type="button"
          onClick={onToggleAll}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 !text-[13px] font-medium text-[#26323d] hover:bg-[#f3f6f8] ${FOCUS}`}
        >
          {allOpen ? <ChevronsDownUp className="h-4 w-4 text-[#586472]" strokeWidth={1.75} aria-hidden /> : <ChevronsUpDown className="h-4 w-4 text-[#586472]" strokeWidth={1.75} aria-hidden />}
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      ) : <span />}
      <span className="flex items-center gap-1 text-[12px] tabular-nums text-[#586472]">
        <span role="status">{plural(folders, 'folder', 'folders')} · {plural(documents, 'document', 'documents')}</span>
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
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-4 py-10 text-center">
      <Folder className="h-8 w-8 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden />
      <h3 className="text-[15px] font-semibold text-[#1f2933]">No departments yet</h3>
      {canAdd && <Link href="/governance/settings" prefetch={false} className={BTN}>Set up departments</Link>}
    </div>
  );
}

/** The departments could not be read: the folders cannot be told from "No department" without them, so none are drawn. */
export function DepartmentsFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-sm flex-col items-center gap-2 px-4 py-10 text-center">
      <AlertTriangle className="h-8 w-8 text-[#b42318]" strokeWidth={1.5} aria-hidden />
      <h3 className="text-[15px] font-semibold text-[#1f2933]">Could not load departments</h3>
      <button type="button" onClick={onRetry} className={BTN}>Try again</button>
    </div>
  );
}
