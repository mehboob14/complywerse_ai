'use client';

// The list of a record explorer, on the kit's table primitives: the table from 768px (sortable headers with aria-sort, a tick column, a row that opens from the keyboard, the columns
// that matter least dropped as the window narrows) and the same rows as cards below it. Only the one for the window's width is drawn (a library of thousands of rows is not two lists of
// work), and the window decides before anything is painted.
// The page hands it ITEMS: records (with a depth for a tree, a "context" flag for a row shown only because something under it matches, and the caret that opens what is under it),
// a group header (a folder) and a "Show more" line. It does not sort, filter or page: the order is the page's and so is the pager under it.
import { Fragment, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Checkbox, Table, TableFrame, TBody, Td, Th, THead, Tr, type ColumnPriority, type SortState } from '@/components/ui/ds';
import type { TickState } from './explorerModel';
import { useMinWidth } from './useMinWidth';

export interface RecordRow<R> {
  kind: 'row';
  id: number;
  record: R;
  /** levels under a parent (0: a top row) */
  depth: number;
  /** shown only because a record under it matches: greyed, never ticked */
  context?: boolean;
  /** what the caret opens: the records under this one */
  nested?: { count: number; open: boolean; label: string; onToggle: () => void };
}
/** A line that is not a record: a group header (a folder) or a "Show more". It is a whole table row (`table` gets the number of columns to span) and a whole card (an `<li>`). */
export interface RecordLine { kind: 'group' | 'more'; id: string; table: (columns: number) => ReactNode; card: ReactNode }
export type RecordItem<R> = RecordRow<R> | RecordLine;

export interface RecordColumn<R> {
  key: string;
  header: string;
  /** a Tailwind width class written out in full: 'w-[120px]' */
  width?: string;
  /** 1 always, 2 from 768px, 3 from 1024px (cards ignore it) */
  priority?: ColumnPriority;
  /** the header sorts by this key */
  sortKey?: string;
  firstDir?: 'asc' | 'desc';
  cell: (row: RecordRow<R>) => ReactNode;
}

export interface RecordSelection<R> {
  ticked: ReadonlySet<number>;
  onToggle: (id: number) => void;
  /** the header's tick box: the rows on the page */
  state: TickState;
  onToggleAll: () => void;
  headLabel: string;
  rowLabel: (record: R) => string;
}

export interface RecordTableProps<R> {
  caption: string;
  columns: RecordColumn<R>[];
  items: RecordItem<R>[];
  sort: SortState;
  /** a header was pressed: the page decides the next order (its own cycle: first direction, the other, the default) */
  onSort: (key: string) => void;
  selection?: RecordSelection<R>;
  /** the record whose details are open */
  activeId?: number | null;
  /** the record under the j / k cursor */
  cursorId?: number | null;
  onActivate: (record: R) => void;
  /** the row's menu: the last cell of a row and the top right of a card */
  actions?: (record: R) => ReactNode;
  /** a card on a phone: its title and facts */
  card: (row: RecordRow<R>) => ReactNode;
  /** one line a row, tighter */
  compact?: boolean;
  /** a max-height class written out in full ('max-h-[calc(100vh-15rem)]'): the table scrolls inside it under a header that stays */
  maxHeight?: string;
  /** shown as a table under this class, as cards over it */
  className?: string;
}

const STEP = 20;

function Caret<R>({ row }: { row: RecordRow<R> }) {
  const n = row.nested;
  if (!n || n.count === 0) return <span aria-hidden className="inline-block h-ds-control-sm w-[24px] shrink-0" />;
  const Icon = n.open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-expanded={n.open}
      aria-label={n.label}
      title={n.label}
      onClick={(e) => { e.stopPropagation(); n.onToggle(); }}
      className="inline-grid h-ds-control-sm w-[24px] shrink-0 place-items-center rounded-ds-control text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring max-md:w-[44px] [@media(pointer:coarse)]:w-[44px]"
    >
      <Icon aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
    </button>
  );
}

/** What the first cell of a row is built from: the indent and the caret, then the page's own content. */
export function RowLead<R>({ row, children }: { row: RecordRow<R>; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-[6px]" style={{ paddingLeft: row.depth * STEP }}>
      <Caret row={row} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function RecordTable<R>({
  caption, columns, items, sort, onSort, selection, activeId = null, cursorId = null, onActivate, actions, card, compact = false, maxHeight = 'max-h-[calc(100vh-15rem)]', className,
}: RecordTableProps<R>) {
  const wide = useMinWidth(768);
  const span = columns.length + (selection ? 1 : 0) + (actions ? 1 : 0);
  const cellPad = compact ? '[&&]:!py-[2px]' : '[&&]:!py-[3px]';
  return (
    <div className={clsx('min-w-0 max-w-full', className)}>
      {wide ? (
        <TableFrame aria-label={caption} maxHeight={maxHeight}>
          <Table caption={caption} className="table-fixed">
            <THead>
              <Tr>
                {selection && (
                  <Th sticky className="w-[44px] [&&]:!pr-0">
                    <Checkbox aria-label={selection.headLabel} checked={selection.state === 'all'} indeterminate={selection.state === 'some'} onChange={selection.onToggleAll} />
                  </Th>
                )}
                {columns.map((c) => (
                  <Th key={c.key} sticky sortKey={c.sortKey} sort={sort} onSortChange={c.sortKey ? () => onSort(c.sortKey!) : undefined} firstDir={c.firstDir} priority={c.priority} className={c.width}>
                    {c.header}
                  </Th>
                ))}
                {actions && <Th sticky className="w-[48px]"><span className="sr-only">Actions</span></Th>}
              </Tr>
            </THead>
            <TBody>
              {items.map((item) => {
                if (item.kind !== 'row') return <Fragment key={`${item.kind}-${item.id}`}>{item.table(span)}</Fragment>;
                const { id, record } = item;
                const active = activeId === id;
                const cursor = cursorId === id;
                return (
                  <Tr
                    key={id}
                    data-record-row={id}
                    selected={active}
                    onActivate={() => onActivate(record)}
                    className={clsx(item.context && 'text-ds-fg-muted', cursor && '[&>td:first-child]:shadow-[inset_3px_0_0_var(--ds-primary)] [&>th:first-child]:shadow-[inset_3px_0_0_var(--ds-primary)]')}
                  >
                    {selection && (
                      <Td className={clsx('w-[44px] [&&]:!pr-0', cellPad)}>
                        {!item.context && (
                          <Checkbox aria-label={selection.rowLabel(record)} checked={selection.ticked.has(id)} onChange={() => selection.onToggle(id)} />
                        )}
                      </Td>
                    )}
                    {columns.map((c) => <Td key={c.key} priority={c.priority} className={clsx(cellPad, c.width)}>{c.cell(item)}</Td>)}
                    {actions && <Td className={clsx('w-[48px] [&&]:!pl-0', cellPad)}>{actions(record)}</Td>}
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableFrame>
      ) : (
      <ul aria-label={caption} className="m-0 flex list-none flex-col gap-[8px] p-0">
        {items.map((item) => {
          if (item.kind !== 'row') return <Fragment key={`${item.kind}-${item.id}`}>{item.card}</Fragment>;
          const { id, record } = item;
          const active = activeId === id;
          return (
            <li
              key={id}
              data-record-row={id}
              style={{ marginLeft: item.depth * 12 }}
              className={clsx('flex items-start gap-[4px] rounded-ds-card border', active ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border bg-ds-surface', item.context && 'text-ds-fg-muted')}
            >
              {selection && !item.context && (
                <label className="flex min-h-ds-control min-w-[44px] shrink-0 items-center justify-center">
                  <Checkbox aria-label={selection.rowLabel(record)} checked={selection.ticked.has(id)} onChange={() => selection.onToggle(id)} />
                </label>
              )}
              <button type="button" onClick={() => onActivate(record)} aria-current={active ? 'true' : undefined} className="min-h-ds-control min-w-0 flex-1 px-[8px] py-[6px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring">
                {card(item)}
              </button>
              {item.nested && item.nested.count > 0 && <div className="pt-[2px]"><Caret row={item} /></div>}
              {actions && <div className="shrink-0 pr-[2px] pt-[2px]">{actions(record)}</div>}
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
}
