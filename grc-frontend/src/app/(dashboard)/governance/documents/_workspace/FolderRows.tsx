'use client';

/**
 * The parts of the library's Folders layout that are not a document row: a folder's row (a yellow folder, its name, what it holds), the "Show N more" row under a folder's documents, the strip
 * above the table (Expand all / Collapse all, Show inactive and the counts) and the two states of a layout with no folders to show (no departments yet, departments that could not be read).
 * The document rows are the table's own (RecordTable draws them, one level deeper than the folder); which folders there are and what they count is libraryFolders.ts.
 *
 * A folder row behaves like a folder in Explorer: a click SELECTS it (its actions are in the folder bar), the arrow (or Right and Left) opens and closes it, a DOUBLE-CLICK or Enter OPENS it
 * (goes into it: the library is scoped to that unit), a right-click or the "…" at the end of the row lists what can be done with it. The row's name is one real button (the tab stop of the
 * folders: the arrow keys, Home, End and a letter move between them, folders/folderKeys.ts), saying whether it is open and what it controls; the arrow in front of it is part of that button
 * (a click on it opens or closes the folder), so a folder has one name for a screen reader. What each action does is useFolders.tsx's.
 * On a phone a folder is a card of its own (FolderHeadCard) with the documents under it as cards. Written on the design-system tokens, 12px at the least.
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, MoreHorizontal } from 'lucide-react';
import { Button, Checkbox, ErrorState } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { withFrom } from '@/components/shell/withFrom';
import { formatCount } from '@/lib/format';
import { folderAria, expandable, statusSummary, type FolderNode } from './libraryFolders';
import { foldersLine } from './libraryNumbers';
import { EmptyFolder } from './folders/EmptyFolder';
import { FolderIcon } from './folders/folderIcon';
import { useHere } from './useHere';
import { STEP } from './Versions';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const fmt = formatCount;
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

// ─── What a row asks of the page ─────────────────────────────────────────────────────────────────────────────────────────

/** What the page lets a folder row do: which one is selected, and what a click, a double-click, a key and a right-click on a folder do. */
export interface FolderUi {
  /** the selected folder's key (`d12`): its actions are the folder bar's */
  selected: string | null;
  /** the folder that is open (a unit's id): its row is the first, drawn open */
  current: number | null;
  /** the unit defines its own approval defaults (the words: "Reviewers", "Workflow"...); none for a unit that does not, and none where it is not known */
  defaults: (node: FolderNode) => string[];
  /** the folder has a menu (a unit of the organisation; "No department" has none) */
  hasMenu: (node: FolderNode) => boolean;
  onSelect: (node: FolderNode) => void;
  /** a double-click or Enter: go into the folder */
  onOpen: (node: FolderNode) => void;
  onContext: (e: MouseEvent<HTMLElement>, node: FolderNode) => void;
  /** the row's "…": the menu opens under it */
  onMenu: (anchor: HTMLElement, node: FolderNode) => void;
  onKey: (e: KeyboardEvent<HTMLElement>, node: FolderNode) => void;
}

// ─── A folder's row ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a folder's row says: the arrow, the yellow folder (open when it shows what is in it; grey when it is switched off), its name, how many documents are in it (the folders inside it
 *  included), what they are ("3 published · 2 draft"), a red "N overdue", "Own defaults" and "Inactive" where they apply. A folder with nothing in it is quiet. */
function FolderBody({ node, open, ui }: { node: FolderNode; open: boolean; ui: FolderUi }) {
  const openable = expandable(node);
  const empty = node.total.docs === 0;
  const summary = statusSummary(node.total);
  const own = ui.defaults(node);
  const here = node.id !== null && node.id === ui.current;
  return (
    <>
      <span
        aria-hidden
        data-folder-arrow={openable ? '' : undefined}
        className={clsx('grid h-[24px] w-[24px] shrink-0 place-items-center rounded-ds-control text-ds-fg-muted [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[44px]', openable && 'hover:bg-ds-border')}
      >
        {openable ? (open ? <ChevronDown className="h-[16px] w-[16px]" strokeWidth={1.75} /> : <ChevronRight className="h-[16px] w-[16px]" strokeWidth={1.75} />) : null}
      </span>
      <FolderIcon size={20} open={(open && openable) || here} inactive={node.inactive} />
      <span dir="auto" className={clsx('min-w-0 max-w-full truncate text-ds-body font-[600]', empty || node.inactive ? 'text-ds-fg-muted' : 'text-ds-fg')} title={node.name}>{node.name}</span>
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
      {own.length > 0 && (
        <span className="whitespace-nowrap rounded-full border border-ds-primary bg-ds-primary-soft px-2 text-ds-label text-ds-primary-text" title={`Sets its own: ${own.join(', ')}`}>Own defaults</span>
      )}
      {node.inactive && (
        <span className="whitespace-nowrap rounded-ds-control border border-ds-border-strong bg-ds-surface-hover px-[6px] text-ds-label text-ds-fg-muted" title="This department is switched off">Inactive</span>
      )}
    </>
  );
}

/** The folder's name as one button: select (click), open (double-click, Enter), its menu (right-click, the menu key), the keys of the folders. The arrow in front of it only repeats what Left and Right do. */
function FolderMain({ node, open, ui, controls, onToggle, tabbable }: {
  node: FolderNode;
  open: boolean;
  ui: FolderUi;
  controls: string[];
  onToggle: () => void;
  tabbable: boolean;
}) {
  const openable = expandable(node);
  const selected = ui.selected === node.key;
  const own = ui.defaults(node);
  return (
    <button
      type="button"
      data-folder-main={node.key}
      aria-expanded={openable ? open : undefined}
      aria-controls={openable && open && controls.length > 0 ? controls.join(' ') : undefined}
      aria-current={selected ? 'true' : undefined}
      aria-label={`${folderAria(node)}${own.length > 0 ? ', has its own defaults' : ''}`}
      tabIndex={tabbable ? 0 : -1}
      onClick={(e) => { if (openable && (e.target as HTMLElement).closest('[data-folder-arrow]')) onToggle(); else ui.onSelect(node); }}
      onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('[data-folder-arrow]')) ui.onOpen(node); }}
      onContextMenu={(e) => ui.onContext(e, node)}
      onKeyDown={(e) => ui.onKey(e, node)}
      className={clsx('flex min-h-ds-control min-w-0 flex-1 select-none flex-wrap items-center gap-x-2 gap-y-[2px] rounded-ds-control py-[2px] text-left', FOCUS)}
    >
      <FolderBody node={node} open={open} ui={ui} />
    </button>
  );
}

function MenuButton({ node, ui }: { node: FolderNode; ui: FolderUi }) {
  if (!ui.hasMenu(node)) return null;
  return (
    <button
      type="button"
      aria-label={`Menu for ${node.name}`}
      aria-haspopup="menu"
      onClick={(e) => { e.stopPropagation(); ui.onMenu(e.currentTarget, node); }}
      className={clsx('grid h-ds-control-sm w-[32px] shrink-0 place-items-center rounded-ds-control text-ds-fg-muted hover:bg-ds-border hover:text-ds-fg [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:w-[44px]', FOCUS)}
    >
      <MoreHorizontal aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
    </button>
  );
}

/**
 * One row across the whole table: a tick box for the folder's documents, then the folder. The content is pinned to the left edge, so it stays in view when the table has scrolled sideways;
 * on a narrow screen it wraps to a second line.
 */
export function FolderHeadRow({ node, open, colSpan, tick, headId, controls, onToggle, ui, tabbable }: {
  node: FolderNode;
  open: boolean;
  colSpan: number;
  /** the tick box for the folder's documents, or a spacer of the same width; null: the table has no tick boxes */
  tick: ReactNode;
  /** this row's id, which the folder above it lists in aria-controls */
  headId: string;
  /** the ids of what this folder controls: the folders inside it (its documents are rows of the table, with no one element of their own to name) */
  controls: string[];
  onToggle: () => void;
  ui: FolderUi;
  tabbable: boolean;
}) {
  const selected = ui.selected === node.key;
  return (
    <tr id={headId} data-folder-row={node.key} className="group/folder min-h-[44px]">
      <td colSpan={colSpan} className={clsx('border-b border-ds-border px-[12px] align-middle [&&]:!py-[6px]', selected ? 'bg-ds-primary-soft' : 'bg-ds-surface-subtle group-hover/folder:bg-ds-surface-hover')}>
        <div className="sticky left-[12px] flex w-full items-center gap-2">
          {tick}
          <div className="flex min-w-0 flex-1 items-center" style={{ paddingLeft: node.depth * STEP }}>
            <FolderMain node={node} open={open} ui={ui} controls={controls} onToggle={onToggle} tabbable={tabbable} />
          </div>
          <MenuButton node={node} ui={ui} />
        </div>
      </td>
    </tr>
  );
}

/** The phone's folder: a card-wide row. The same, a tick box beside it, and the menu at its end. */
export function FolderHeadCard({ node, open, tick, headId, controls, onToggle, ui, tabbable }: {
  node: FolderNode;
  open: boolean;
  tick: ReactNode;
  headId: string;
  controls: string[];
  onToggle: () => void;
  ui: FolderUi;
  tabbable: boolean;
}) {
  const selected = ui.selected === node.key;
  return (
    <li
      id={headId}
      data-folder-row={node.key}
      className={clsx('rounded-ds-card border px-[12px] py-[6px]', selected ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border bg-ds-surface-subtle')}
      style={{ marginLeft: node.depth * 16 }}
    >
      <div className="flex items-center gap-2">
        {tick}
        <div className="flex min-w-0 flex-1 items-center">
          <FolderMain node={node} open={open} ui={ui} controls={controls} onToggle={onToggle} tabbable={tabbable} />
        </div>
        <MenuButton node={node} ui={ui} />
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

/** Expand all / Collapse all (folders, and the documents under documents), "Show inactive" where some unit is switched off, and the counts: "6 folders · 128 documents". */
export function FoldersToolbar({ allOpen, canFold, onToggleAll, folders, documents, loaded, total, inactive, showInactive, onShowInactive }: {
  allOpen: boolean;
  /** some folder has something to open */
  canFold: boolean;
  onToggleAll: () => void;
  folders: number;
  documents: number;
  /** how many documents the page loaded and how many exist: when they differ, the count says it is over the loaded ones */
  loaded?: number;
  total?: number | null;
  /** how many units are switched off: the box is there when there is one */
  inactive?: number;
  showInactive?: boolean;
  onShowInactive?: (on: boolean) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[2px]">
      <div className="flex flex-wrap items-center gap-x-[12px]">
        {canFold ? (
          <Button size="sm" variant="ghost" onClick={onToggleAll} leftIcon={allOpen ? <ChevronsDownUp aria-hidden /> : <ChevronsUpDown aria-hidden />}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        ) : null}
        {onShowInactive && (inactive ?? 0) > 0 && (
          <Checkbox label={`Show inactive (${fmt(inactive ?? 0)})`} checked={!!showInactive} onChange={(e) => onShowInactive(e.target.checked)} />
        )}
      </div>
      <span className="flex items-center gap-1 text-ds-label tabular-nums text-ds-fg-muted">
        <span role="status">{loaded == null ? `${plural(folders, 'folder', 'folders')} · ${plural(documents, 'document', 'documents')}` : foldersLine({ folders, documents, loaded, total })}</span>
        <InfoTip
          label="About folders"
          align="end"
          text="Documents are grouped by their department. A folder's number counts every document in it, the folders inside it included. A document that is in no department, or in one that no longer exists, is in No department. Click a folder to select it; double-click, or press Enter, to open it."
        />
      </span>
    </div>
  );
}

// ─── No folders to show ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Folders chosen, but the organisation has no department in use yet: where to make them (here, for a person who may add a department; else in the settings). */
export function NoDepartments({ canAdd = true, onNew }: { canAdd?: boolean; onNew?: () => void }) {
  const here = useHere();
  return (
    <EmptyFolder
      title="No departments yet"
      action={onNew ? <Button variant="primary" onClick={onNew}>New department</Button> : canAdd ? <Button href={withFrom('/governance/settings', here)}>Set up departments</Button> : undefined}
    />
  );
}

/** The departments could not be read: the folders cannot be told from "No department" without them, so none are drawn. */
export function DepartmentsFailed({ onRetry }: { onRetry: () => void }) {
  return <ErrorState title="Could not load departments" message="The folders cannot be told apart without them." onRetry={onRetry} />;
}
