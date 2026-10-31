'use client';

// The table primitives of the design-system kit: a scrolling frame, a real <table> that names itself, header cells that sort and say so
// (aria-sort), and rows that open from the keyboard as well as the mouse. Native table semantics throughout; RegisterTable.tsx is the register
// built from them. The logic (sort cycle, which columns give way, what counts as pressing a row) is in tableModel.ts and tested there.
//
// The dashboard CSS styles bare table elements with rules no utility class outranks: `.cw-dashboard thead th` (colour, background, 12px),
// `.cw-dashboard tbody tr:nth-child(even)` (zebra stripes), `.cw-dashboard table` (collapsed borders: a sticky header loses its line),
// `.governance-light table td/th` (10.5px and 12px text, 7px padding with !important) and `.platform-ui.compact-density main table td/th`
// (10px padding). So the few properties those rules set are written important (`!`), and the cell padding is written twice over
// ([&&]:!py-[..], a doubled class) to outrank their !important. Outside the shell the same classes simply apply: a table looks the same
// on a page, under .governance-light and in a dialog.
import { forwardRef, type HTMLAttributes, type ReactNode, type TableHTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import {
  ariaSort, isInteractiveTarget, nextSort, priorityClass, shouldActivateRow,
  type ColumnPriority, type SortCycle, type SortDir, type SortState,
} from './tableModel';

export type CellAlign = 'left' | 'right' | 'center';
const ALIGN: Record<CellAlign, string> = { left: 'text-left', right: 'text-right', center: 'text-center' };

// ── frame and table ──────────────────────────────────────────────────────────
export interface TableFrameProps {
  /** what the scrolling region is called (read out when it takes focus) */
  'aria-label': string;
  /** a Tailwind max-height class with an arbitrary value, written out in full where it is used: 'max-h-[70vh]'. The frame scrolls inside it,
   *  which is what keeps a sticky header (Th `sticky`) in view; without one the frame only scrolls sideways. */
  maxHeight?: string;
  /** layout only (margin, width) */
  className?: string;
  children: ReactNode;
}

/** The box a table scrolls in: bordered, rounded, and a tab stop (a region that scrolls must be reachable by keyboard). */
export function TableFrame({ 'aria-label': label, maxHeight, className, children }: TableFrameProps) {
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={label}
      className={clsx(
        'relative min-w-0 max-w-full overflow-auto rounded-ds-card border border-ds-border bg-ds-surface focus-visible:outline-none focus-visible:shadow-ds-ring',
        maxHeight,
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface TableProps extends Omit<TableHTMLAttributes<HTMLTableElement>, 'children'> {
  /** the table's name: read out, not drawn */
  caption: string;
  children: ReactNode;
}

// `!border-separate`: borders belong to the cells, so a sticky header keeps its line (the shell collapses them).
export function Table({ caption, className, children, ...rest }: TableProps) {
  return (
    <table {...rest} className={clsx('relative w-full !border-separate border-spacing-0 text-left', className)}>
      <caption className="sr-only">{caption}</caption>
      {children}
    </table>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...rest} className={className} />;
}

export function TBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...rest} className={className} />;
}

// ── rows ─────────────────────────────────────────────────────────────────────
/** The click and key handlers of a row (or a card) that opens: a click that lands on a control inside it, on a menu portaled out of it, or
 *  at the end of selecting text is not a click on the row; Enter and Space count when the row itself has focus. {} without `onActivate`. */
export function rowHandlers<E extends HTMLElement>(onActivate: (() => void) | undefined): Pick<HTMLAttributes<E>, 'onClick' | 'onKeyDown'> {
  if (!onActivate) return {};
  return {
    onClick: (e) => {
      const target = e.target as Element;
      if (!e.currentTarget.contains(target) || isInteractiveTarget(target, e.currentTarget)) return;
      if (window.getSelection()?.toString()) return;
      onActivate();
    },
    onKeyDown: (e) => {
      if (!shouldActivateRow({ key: e.key, targetIsRow: e.target === e.currentTarget })) return;
      e.preventDefault();                                       // Space must not scroll the frame
      onActivate();
    },
  };
}

export interface TrProps extends Omit<HTMLAttributes<HTMLTableRowElement>, 'onClick' | 'onKeyDown' | 'tabIndex'> {
  /** the row opens something: it becomes a tab stop that shows the pointer and a hover tint, and a click on it (not on a control inside it)
   *  or Enter / Space on it calls this. Left out, the row is plain (no tab stop). */
  onActivate?: () => void;
  /** the row is the one open or chosen: tinted, and aria-selected */
  selected?: boolean;
}

// `!bg-transparent` keeps the shell's stripe off every second row; a row never gets two important backgrounds. A row takes the keyboard
// ring as an outline drawn just inside it (the focus colour), so the frame around the table cannot clip it on the first and last rows.
const ROW_BASE = '!bg-transparent';
const ROW_SELECTED = '!bg-ds-primary-soft';
const ROW_HOVER = 'hover:!bg-ds-surface-hover';
const ROW_PRESSABLE = 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--ds-focus)]';

export const Tr = forwardRef<HTMLTableRowElement, TrProps>(function Tr({ onActivate, selected = false, className, ...rest }, ref) {
  return (
    <tr
      {...rest}
      ref={ref}
      tabIndex={onActivate ? 0 : undefined}
      aria-selected={selected || undefined}
      {...rowHandlers<HTMLTableRowElement>(onActivate)}
      className={clsx(selected ? ROW_SELECTED : ROW_BASE, onActivate && ROW_PRESSABLE, onActivate && !selected && ROW_HOVER, className)}
    />
  );
});

// ── cells ────────────────────────────────────────────────────────────────────
// Header cell: 12px label in the muted grey on the subtle fill, a line under it. The text, colour, fill and line are important because
// `.cw-dashboard thead th` sets all four; the padding is doubled in specificity (see the top of the file). The label never wraps.
const HEAD = 'whitespace-nowrap border-b !border-ds-border !bg-ds-surface-subtle px-[12px] align-middle !text-ds-label !text-ds-fg-muted [&&]:!py-[8px]';
// Body cell: 13px, a hairline under it; a long word breaks instead of widening the column.
const CELL = 'border-b !border-ds-border px-[12px] align-middle text-ds-fg-body !text-ds-body [overflow-wrap:anywhere] [&&]:!py-[10px]';

export interface ThProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'scope' | 'aria-sort'> {
  align?: CellAlign;
  priority?: ColumnPriority;
  /** stays at the top of the frame while the rows scroll (the frame needs a maxHeight) */
  sticky?: boolean;
  /** the column can be sorted, and this is its key in `sort` */
  sortKey?: string;
  /** the table's current sort */
  sort?: SortState;
  /** with `sortKey`, the header is a button; a click asks for this (tableModel.nextSort) */
  onSortChange?: (next: SortState) => void;
  sortCycle?: SortCycle;
  /** the direction a first click sorts in (default ascending) */
  firstDir?: SortDir;
}

// The sort button is the whole header text; it reaches out of the cell's padding so the target is one control tall (28px, 44px on touch).
const SORT_BUTTON = '-mx-[6px] -my-[6px] inline-flex min-h-ds-control-sm items-center gap-[4px] rounded-ds-control px-[6px] focus-visible:outline-none focus-visible:shadow-ds-ring';
const ICON = 'h-[16px] w-[16px] shrink-0';

export function Th({ align = 'left', priority, sticky = false, sortKey, sort = null, onSortChange, sortCycle, firstDir, className, children, ...rest }: ThProps) {
  const sortable = sortKey != null;
  const state = sortable ? ariaSort(sortKey, sort, true) : undefined;
  const Icon = state === 'ascending' ? ChevronUp : state === 'descending' ? ChevronDown : ChevronsUpDown;
  return (
    <th
      {...rest}
      scope="col"
      aria-sort={state}
      className={clsx(HEAD, ALIGN[align], priorityClass(priority), sticky && 'sticky top-0 z-[1]', className)}
    >
      {sortable && onSortChange ? (
        <button
          type="button"
          onClick={() => onSortChange(nextSort(sort, sortKey, sortCycle, firstDir))}
          className={clsx(SORT_BUTTON, state === 'none' ? 'text-ds-fg-muted hover:text-ds-fg' : 'text-ds-fg')}
        >
          <span>{children}</span>
          <Icon aria-hidden strokeWidth={1.75} className={clsx(ICON, state === 'none' && 'opacity-70')} />
        </button>
      ) : children}
    </th>
  );
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: CellAlign;
  priority?: ColumnPriority;
}

export function Td({ align = 'left', priority, className, ...rest }: TdProps) {
  return <td {...rest} className={clsx(CELL, ALIGN[align], priorityClass(priority), className)} />;
}

export interface RowHeaderCellProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'scope' | 'aria-sort'> {
  align?: CellAlign;
  priority?: ColumnPriority;
}

/** The cell that names its row (the document, the exception): a <th scope="row"> that looks like any other cell. */
export function RowHeaderCell({ align = 'left', priority, className, ...rest }: RowHeaderCellProps) {
  return <th {...rest} scope="row" className={clsx(CELL, ALIGN[align], priorityClass(priority), className)} />;
}
